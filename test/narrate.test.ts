// Synthetic SQLite sources only; no real runtime data is read.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { ObservationStore, type ConnectionStatus, type StoredFact } from "../src/store.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const attemptsInProgressCaveat =
  "Ecosym records that the attempts listed under attemptsInProgress have not been " +
  "marked complete, failed, skipped, or retired. It cannot determine from stored " +
  "state alone whether the process that started an attempt is still running or has " +
  "stopped without reporting; only a durable retirement (retire-collection-attempt) " +
  "records that determination, and only when an operator makes it.";
const truncationCaveat =
  "observationsTruncated/claimsTruncated is true when more matching facts exist " +
  "than --limit returned. A truncated list is not a complete picture of what is " +
  "currently true across active connections; raise --limit or narrow with the " +
  "existing 'query' command to see what was cut.";

interface CliResult {
  code: number;
  output: Record<string, unknown>;
  stderr: string;
}

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-narrate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, xdgDataHome: join(directory, "data") };
}

function sqliteConnection(directory: string, id: string, observations = 2, claims = 2) {
  const sourcePath = join(directory, `${id}.sqlite`);
  const configPath = join(directory, `${id}.json`);
  const database = new DatabaseSync(sourcePath);
  try {
    database.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, value INTEGER, state TEXT);
      CREATE TABLE replacement_tasks (id TEXT PRIMARY KEY, value INTEGER, state TEXT);
      BEGIN;
    `);
    const insert = database.prepare("INSERT INTO tasks VALUES (?, ?, ?)");
    for (let index = 0; index < Math.max(observations, claims); index += 1) {
      insert.run(
        `synthetic-task-${index}`,
        index < observations ? index : null,
        index < claims ? "reported-done" : null,
      );
    }
    database.exec("COMMIT");
  } finally {
    database.close();
  }
  const config = {
    schemaVersion: 1,
    id,
    factOwner: "synthetic-owner",
    reader: { type: "sqlite", path: sourcePath, table: "tasks" },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "latest",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "example.value",
        subject: { scope: "record", path: "id" },
        payload: { value: { scope: "record", path: "value" } },
        required: [{ scope: "record", path: "value" }],
      },
      {
        epistemicStatus: "claim",
        kind: "example.completion-report",
        subject: { scope: "record", path: "id" },
        payload: { state: { scope: "record", path: "state" } },
        required: [{ scope: "record", path: "state" }],
      },
    ],
  };
  writeFileSync(configPath, JSON.stringify(config));
  return { config, configPath };
}

async function connectAndCollect(configPath: string, id: string, xdgDataHome: string) {
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  const collected = await runCli(["collect", id], xdgDataHome);
  assert.equal(collected.code, 0);
  assert.equal(collected.output.outcome, "success");
}

async function narrate(xdgDataHome: string, arguments_: string[] = []) {
  const result = await runCli(["narrate", ...arguments_], xdgDataHome);
  assert.equal(result.code, 0, JSON.stringify(result));
  assert.equal(result.stderr, "");
  assert.equal(result.output.schemaVersion, 1);
  assert.equal(result.output.command, "narrate");
  assert.equal(result.output.outcome, "success");
  assert.equal(typeof result.output.generatedAt, "string");
  assert.ok(Number.isFinite(Date.parse(result.output.generatedAt as string)));
  assert.equal(result.output.attemptsInProgressCaveat, attemptsInProgressCaveat);
  assert.equal(result.output.truncationCaveat, truncationCaveat);
  return result.output;
}

test("query and narrate bound currentness to collection, not ephemeral verification", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  const { config, configPath } = sqliteConnection(directory, "currentness", 1, 1);
  const source = new DatabaseSync(config.reader.path);
  t.after(() => source.close());
  source.exec("ALTER TABLE tasks ADD COLUMN at TEXT DEFAULT '2026-08-30T00:00:00Z'");
  writeFileSync(configPath, JSON.stringify({
    ...config,
    sourceRecord: {
      ...config.sourceRecord,
      recordedAt: { selector: { scope: "record", path: "at" }, format: "iso8601" },
    },
  }));
  await connectAndCollect(configPath, config.id, xdgDataHome);
  const store = new ObservationStore(join(xdgDataHome, "ecosym"));
  t.after(() => store.close());
  const readPicture = async () => {
    const picture = await narrate(xdgDataHome);
    for (const kind of ["observations", "claims"]) {
      const query = await runCli(["query", kind], xdgDataHome);
      assert.equal(query.code, 0);
      assert.equal(query.output.currentnessCaveat, picture.currentnessCaveat);
      assert.deepEqual(query.output.records, picture[kind]);
    }
    return picture;
  };
  const initial = await readPicture();
  const [attempt] = store.collectionAttempts();
  assert.ok(attempt);
  const expectedBoundary = {
    attemptId: attempt.attemptId, activationId: attempt.activationId,
    startedAt: attempt.startedAt, completedAt: attempt.completedAt,
  };
  assert.deepEqual((initial.observations as Record<string, unknown>[])[0]?.collectionAsOf, expectedBoundary);
  assert.match(initial.currentnessCaveat as string, /stored collection evidence/);
  assert.equal((initial.observations as StoredFact[])[0]?.temporalStatus, "current");
  source.exec("DELETE FROM tasks");
  const beforeVerify = store.narrate();
  const attempts = store.collectionAttempts();
  const verification = await runCli(["verify"], xdgDataHome);
  assert.equal(verification.code, 1);
  assert.equal((verification.output.connections as { counts: { missingAtSource: number } }[])[0]?.counts.missingAtSource, 2);
  assert.deepEqual(store.narrate(), beforeVerify);
  assert.deepEqual(store.collectionAttempts(), attempts);
  assert.deepEqual((await readPicture()).observations, initial.observations);

  assert.equal((await runCli(["collect", config.id], xdgDataHome)).code, 0);
  const absent = await readPicture();
  assert.equal(absent.dataCompleteness, "complete");
  for (const kind of ["observations", "claims"]) {
    assert.equal((absent[kind] as StoredFact[])[0]?.temporalStatus, "historical");
  }
  assert.notDeepEqual((absent.observations as Record<string, unknown>[])[0]?.collectionAsOf, expectedBoundary);
  const historicalVerification = await runCli(["verify"], xdgDataHome);
  assert.equal(historicalVerification.code, 1);
  const [historicalReport] = historicalVerification.output.connections as {
    counts: { storedFacts: number; sourceFacts: number; missingAtSource: number };
  }[];
  assert.equal(historicalReport?.counts.storedFacts, 2);
  assert.equal(historicalReport?.counts.sourceFacts, 0);
  assert.equal(historicalReport?.counts.missingAtSource, 2);
  const exported = JSON.parse(store.exportOwnedState().bytes) as {
    observationStore: { facts: StoredFact[] };
  };
  assert.deepEqual(
    exported.observationStore.facts.map((fact) => [fact.id, fact.temporalStatus]),
    [...absent.observations as StoredFact[], ...absent.claims as StoredFact[]]
      .sort((left, right) => left.id - right.id)
      .map((fact) => [fact.id, fact.temporalStatus]),
  );
  source.exec("DROP TABLE tasks");
  assert.notEqual((await runCli(["collect", config.id], xdgDataHome)).code, 0);
  const failed = await readPicture();
  assert.equal(failed.dataCompleteness, "partial");
  assert.deepEqual(failed.observations, absent.observations);
  source.exec("CREATE TABLE tasks (id TEXT, value INTEGER, state TEXT, at TEXT); INSERT INTO tasks VALUES ('synthetic-task-0', 0, 'reported-done', '2026-08-30T00:00:00Z')");
  const beforeRestore = store.collectionAttempts();
  assert.equal((await runCli(["collect", config.id], xdgDataHome)).code, 0);
  const restoringAttempt = store.collectionAttempts().find(
    (candidate) => !beforeRestore.some((previous) => previous.attemptId === candidate.attemptId),
  );
  assert.ok(restoringAttempt);
  assert.equal(restoringAttempt.outcome, "success");
  const restored = await readPicture();
  for (const kind of ["observations", "claims"]) {
    assert.equal((restored[kind] as StoredFact[])[0]?.temporalStatus, "current");
    assert.deepEqual((restored[kind] as StoredFact[])[0]?.collectionAsOf, {
      attemptId: restoringAttempt.attemptId,
      activationId: restoringAttempt.activationId,
      startedAt: restoringAttempt.startedAt,
      completedAt: restoringAttempt.completedAt,
    });
  }
  assert.equal(store.countFacts(), 2);
});

test("1. narrate reports an empty store as complete", async (t) => {
  const { xdgDataHome } = fixture(t);
  const output = await narrate(xdgDataHome);
  assert.equal(output.dataCompleteness, "complete");
  for (const field of ["connections", "attemptsInProgress", "observations", "claims"]) {
    assert.deepEqual(output[field], []);
  }
  assert.equal(output.observationsTruncated, false);
  assert.equal(output.claimsTruncated, false);
});

test("2. narrate correlates facts and healthy statuses across two connections", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  for (const id of ["source-a", "source-b"]) {
    const { configPath } = sqliteConnection(directory, id);
    await connectAndCollect(configPath, id, xdgDataHome);
  }
  const output = await narrate(xdgDataHome);
  assert.equal(output.dataCompleteness, "complete");
  assert.deepEqual(
    (output.connections as ConnectionStatus[]).map((c) => [c.connectionId, c.status]).sort(),
    [["source-a", "changed"], ["source-b", "changed"]],
  );
  for (const field of ["observations", "claims"]) {
    const facts = output[field] as StoredFact[];
    assert.equal(facts.length, 4);
    assert.deepEqual([...new Set(facts.map((fact) => fact.connectionId))].sort(), ["source-a", "source-b"]);
  }
  assert.equal(output.observationsTruncated, false);
  assert.equal(output.claimsTruncated, false);
});

test("3. narrate orders newly inserted facts by descending fact_id", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  for (const id of ["source-a", "source-b"]) {
    const { configPath } = sqliteConnection(directory, id);
    await connectAndCollect(configPath, id, xdgDataHome);
  }
  const output = await narrate(xdgDataHome);
  // Re-collecting an existing fact bumps last_seen_attempt_order, not its
  // original fact_id: this ordering does not mean most recently re-collected.
  for (const field of ["observations", "claims"]) {
    const facts = output[field] as StoredFact[];
    assert.deepEqual(facts.map((fact) => fact.connectionId), ["source-b", "source-b", "source-a", "source-a"]);
    const ids = facts.map((fact) => fact.id);
    assert.deepEqual(ids, [...ids].sort((left, right) => right - left));
    assert.equal(new Set(ids).size, 4);
  }
});

test("4. reconnect never silently claims completeness over stale facts", async (t) => {
  for (const changedConfig of [true, false]) {
    await t.test(changedConfig ? "changed config excludes old facts" : "same config retains prior activation facts but stays partial", async (t) => {
      const { directory, xdgDataHome } = fixture(t);
      const { config, configPath } = sqliteConnection(directory, "reconnected");
      await connectAndCollect(configPath, config.id, xdgDataHome);
      const before = await narrate(xdgDataHome);
      assert.equal((before.observations as StoredFact[]).length, 2);
      assert.equal((before.claims as StoredFact[]).length, 2);
      const previousVersion = (before.connections as ConnectionStatus[])[0]?.connectionVersion;
      assert.equal((await runCli(["disconnect", config.id], xdgDataHome)).code, 0);
      if (changedConfig) {
        config.reader.table = "replacement_tasks";
        writeFileSync(configPath, JSON.stringify(config));
      }
      const connected = await runCli(["connect", configPath], xdgDataHome);
      assert.equal(connected.code, 0);
      assert.equal(connected.output.connectionVersion === previousVersion, !changedConfig);
      const output = await narrate(xdgDataHome);
      assert.equal(output.dataCompleteness, "partial");
      const connections = output.connections as ConnectionStatus[];
      assert.equal(connections.length, 1);
      assert.equal(connections[0]?.connectionId, config.id);
      assert.equal(connections[0]?.status, "unread");
      assert.equal(connections[0]?.reason, "never-run");
      // Facts have no activation_id; activeOnly is not statuses()'s three-key scope.
      for (const field of ["observations", "claims"]) {
        assert.deepEqual(output[field], changedConfig ? [] : before[field]);
      }
    });
  }
});

test("5. an interrupted collection remains visible as unread/incomplete", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  const { configPath } = sqliteConnection(directory, "interrupted");
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  const stop = await startInterruptedWorker(t, xdgDataHome, "interrupted");
  await stop();
  const output = await narrate(xdgDataHome);
  const connections = output.connections as ConnectionStatus[];
  assert.equal(connections.length, 1);
  assert.equal(connections[0]?.connectionId, "interrupted");
  assert.equal(connections[0]?.status, "unread");
  assert.equal(connections[0]?.reason, "incomplete");
  assert.equal(output.dataCompleteness, "partial");
  assert.deepEqual(output.observations, []);
});

test("6. a running attempt for an active current activation is surfaced", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  const { configPath } = sqliteConnection(directory, "running");
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  const stop = await startInterruptedWorker(t, xdgDataHome, "running");
  try {
    const store = new ObservationStore(join(xdgDataHome, "ecosym"));
    let expected;
    try {
      const [attempt] = store.collectionAttempts();
      assert.ok(attempt);
      assert.equal(attempt.outcome, "running");
      assert.equal(attempt.activationId, store.getConnection("running").activationId);
      expected = [{
        attemptId: attempt.attemptId,
        connectionId: attempt.connectionId,
        connectionVersion: attempt.connectionVersion,
        startedAt: attempt.startedAt,
      }];
    } finally {
      store.close();
    }
    const output = await narrate(xdgDataHome);
    assert.deepEqual(output.attemptsInProgress, expected);
    assert.equal(output.dataCompleteness, "partial");
    // A later success does not retire an earlier running row on this activation.
    assert.equal((await runCli(["collect", "running"], xdgDataHome)).code, 0);
    const later = await narrate(xdgDataHome);
    assert.equal((later.connections as ConnectionStatus[])[0]?.status, "changed");
    assert.deepEqual(later.attemptsInProgress, expected);
    assert.equal(later.dataCompleteness, "partial");
  } finally {
    await stop();
  }
});

test("7. disconnect excludes a stale running row and clears partial on its own", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  const { configPath } = sqliteConnection(directory, "disconnected");
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  const stop = await startInterruptedWorker(t, xdgDataHome, "disconnected");
  await stop();
  const before = await narrate(xdgDataHome);
  assert.equal((before.attemptsInProgress as unknown[]).length, 1);
  assert.equal(before.dataCompleteness, "partial");
  assert.equal((await runCli(["disconnect", "disconnected"], xdgDataHome)).code, 0);
  const output = await narrate(xdgDataHome);
  assert.deepEqual(output.connections, []);
  assert.deepEqual(output.attemptsInProgress, []);
  assert.equal(output.dataCompleteness, "complete");
  const store = new ObservationStore(join(xdgDataHome, "ecosym"));
  try {
    assert.equal(store.collectionAttempts()[0]?.outcome, "running");
  } finally {
    store.close();
  }
});

test("8. truncation is independent for both fact lists, including --limit 1000", async (t) => {
  for (const limit of [2, 1000]) {
    for (const [observationsExtra, claimsExtra] of [[1, 1], [1, 0], [0, 1]] as const) {
      await t.test(`limit ${limit}, observations +${observationsExtra}, claims +${claimsExtra}`, async (t) => {
        const { directory, xdgDataHome } = fixture(t);
        const { configPath } = sqliteConnection(directory, "many-facts", limit + observationsExtra, limit + claimsExtra);
        await connectAndCollect(configPath, "many-facts", xdgDataHome);
        const database = new DatabaseSync(join(xdgDataHome, "ecosym", "observations.sqlite"), { readOnly: true });
        try {
          const counts = database.prepare("SELECT epistemic_status, COUNT(*) AS total FROM facts GROUP BY epistemic_status ORDER BY epistemic_status").all();
          assert.deepEqual(counts.map((row) => [row.epistemic_status, row.total]), [
            ["claim", limit + claimsExtra],
            ["observation", limit + observationsExtra],
          ]);
        } finally {
          database.close();
        }
        const output = await narrate(xdgDataHome, ["--limit", String(limit)]);
        assert.equal((output.observations as StoredFact[]).length, limit);
        assert.equal((output.claims as StoredFact[]).length, limit);
        assert.equal(output.observationsTruncated, observationsExtra === 1);
        assert.equal(output.claimsTruncated, claimsExtra === 1);
        assert.equal(output.dataCompleteness, "partial");
        const connections = output.connections as ConnectionStatus[];
        assert.equal(connections.length, 1);
        assert.ok(connections.every((c) => c.status === "changed" || c.status === "quiet"));
        assert.deepEqual(output.attemptsInProgress, []);
      });
    }
  }
});

test("9. narrate accepts limit boundaries and rejects values outside them", async (t) => {
  const { xdgDataHome } = fixture(t);
  for (const limit of ["1", "1000", "0", "1001"]) {
    await t.test(limit, async () => {
      if (limit === "1" || limit === "1000") {
        await narrate(xdgDataHome, ["--limit", limit]);
      } else {
        const result = await runCli(["narrate", "--limit", limit], xdgDataHome);
        assert.equal(result.code, 64);
        assert.deepEqual(result.output, { schemaVersion: 1, command: "narrate", outcome: "error", error: "invalid_arguments" });
        assert.equal(result.stderr, "");
      }
    });
  }
});

test("10. narrate rejects extra and unrecognised arguments", async (t) => {
  const { xdgDataHome } = fixture(t);
  for (const arguments_ of [["extra-arg"], ["--connection", "source-a"], ["--limit"], ["--limit", "1", "extra-arg"]]) {
    const result = await runCli(["narrate", ...arguments_], xdgDataHome);
    assert.equal(result.code, 64);
    assert.deepEqual(result.output, { schemaVersion: 1, command: "narrate", outcome: "error", error: "invalid_arguments" });
    assert.equal(result.stderr, "");
  }
});

test("11. repeated narrate calls leave statuses, attempts, and fact counts unchanged", async (t) => {
  const { directory, xdgDataHome } = fixture(t);
  const { configPath } = sqliteConnection(directory, "read-only");
  await connectAndCollect(configPath, "read-only", xdgDataHome);
  const stop = await startInterruptedWorker(t, xdgDataHome, "read-only");
  await stop();
  const store = new ObservationStore(join(xdgDataHome, "ecosym"));
  try {
    const statuses = store.statuses();
    const attempts = store.collectionAttempts();
    const count = store.countFacts();
    assert.equal(count, 4);
    assert.equal(attempts.length, 2);
    for (const arguments_ of [[], ["--limit", "1"], ["--limit", "1000"]]) {
      await narrate(xdgDataHome, arguments_);
      assert.deepEqual(store.statuses(), statuses);
      assert.deepEqual(store.collectionAttempts(), attempts);
      assert.equal(store.countFacts(), count);
    }
  } finally {
    store.close();
  }
});

async function startInterruptedWorker(t: TestContext, xdgDataHome: string, id: string) {
  const worker = fileURLToPath(new URL("helpers/interrupted-collection-worker.ts", import.meta.url));
  const child = spawn(process.execPath, [worker, join(xdgDataHome, "ecosym"), id], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
    await exited;
  };
  t.after(stop);
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("interrupted collection worker did not become ready")), 10_000);
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`interrupted collection worker exited ${code}: ${stderr}`));
    });
    child.stdout.once("data", (chunk: string) => {
      clearTimeout(timeout);
      if (chunk === "ready\n") {
        resolve();
      } else {
        reject(new Error("interrupted collection worker emitted unexpected output"));
      }
    });
  });
  return stop;
}

async function runCli(arguments_: string[], xdgDataHome: string): Promise<CliResult> {
  const child = spawn(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? -1));
  });
  return {
    code,
    output: JSON.parse(stdout) as Record<string, unknown>,
    stderr,
  };
}
