import assert from "node:assert/strict";
import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
  type SpawnSyncReturns,
} from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseConnectionConfig, type ConnectionConfig } from "../src/config.ts";
import { prepareSandboxSources } from "../src/sandbox.ts";
import { ObservationStore } from "../src/store.ts";

const sandbox = fileURLToPath(new URL("../scripts/ecosym-sandbox", import.meta.url));

test("preparing a sqlite source never writes to the source database", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-source-readonly-"));
  const databasePath = join(directory, "state.db");

  const source = new DatabaseSync(databasePath);
  // WAL mode is what actually produces -wal/-shm sidecars; without it those
  // paths never exist, the sidecar branch in prepareSandboxSources never
  // runs, and this test would pass even if that branch started writing.
  source.exec("PRAGMA journal_mode = WAL;");
  source.exec(`
    CREATE TABLE async_delegations (id TEXT, status TEXT);
    INSERT INTO async_delegations VALUES ('one', 'done');
  `);
  // Deliberately do not close `source` yet: SQLite auto-checkpoints and
  // deletes the WAL/SHM sidecars when the last connection to a WAL database
  // closes, which would fold this test's own write into the main file and
  // remove the very sidecars it means to guard. Holding the writer's
  // connection open keeps the WAL live for the read-only guardian to see.

  const digest = (path: string): string | undefined =>
    existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : undefined;
  // The -shm sidecar is SQLite's wal-index: any connection that opens the
  // database for reading — including a strictly read-only one — legitimately
  // touches its locking/bookkeeping bytes as part of the WAL protocol. That
  // is not a write to the data being guarded, so only the main file and the
  // -wal file (which holds the actual pending log) are checked byte-for-byte;
  // -shm is checked for continued existence instead.
  const contentGuardedPaths = [databasePath, `${databasePath}-wal`];
  const shmPath = `${databasePath}-shm`;
  assert.ok(existsSync(`${databasePath}-wal`), "expected a WAL sidecar to exist before the check");
  assert.ok(existsSync(shmPath), "expected a SHM sidecar to exist before the check");
  const before = contentGuardedPaths.map(digest);

  let prepared: Awaited<ReturnType<typeof prepareSandboxSources>> | undefined;
  try {
    // A connected source is evidence: collection reads it and must not be able
    // to alter what it is reading, or a disagreement between store and source
    // could be resolved by quietly changing the source. Preparation opens the
    // database to hold it open for the run, and that open must be a read.
    prepared = await prepareSandboxSources([sqliteConnection(databasePath)], directory);
    assert.ok(existsSync(`${databasePath}-wal`), "the WAL sidecar disappeared during preparation");
    assert.ok(existsSync(shmPath), "the SHM sidecar disappeared during preparation");
    assert.deepEqual(
      contentGuardedPaths.map(digest),
      before,
      "preparing the sandbox altered the source database",
    );
  } finally {
    prepared?.close();
  }

  // digest() returns undefined for a path that is gone, and undefined equals
  // undefined — so a sidecar deleted during cleanup would compare equal to a
  // sidecar that was never there. Assert presence before trusting the compare.
  for (const path of contentGuardedPaths) {
    assert.ok(existsSync(path), `${path} disappeared during cleanup`);
  }
  assert.deepEqual(
    contentGuardedPaths.map(digest),
    before,
    "closing the sandbox sources altered the source database",
  );

  source.close();
  const surviving = new DatabaseSync(databasePath);
  try {
    assert.equal(
      surviving.prepare("SELECT count(*) AS rows FROM async_delegations").get()?.rows,
      1,
    );
  } finally {
    surviving.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("sandbox sources mount exact file paths and current source-glob matches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-sources-"));
  const reports = join(directory, "shorts-content", "output", "reports");
  const databasePath = join(directory, "state.db");
  const privatePath = join(directory, "shorts-content", "private.txt");
  mkdirSync(reports, { recursive: true });
  writeFileSync(join(reports, "uploads.jsonl"), '{}\n');
  writeFileSync(join(reports, "analytics_first.json"), '{"videos":[]}\n');
  writeFileSync(privatePath, "not declared\n");

  const source = new DatabaseSync(databasePath);
  source.exec(`
    CREATE TABLE async_delegations (id TEXT, status TEXT, private_note TEXT);
    INSERT INTO async_delegations VALUES ('one', 'done', 'not declared');
    CREATE TABLE messages (id TEXT, body TEXT);
    INSERT INTO messages VALUES ('one', 'not declared');
  `);
  source.close();

  const configs: ConnectionConfig[] = [
    sqliteConnection(databasePath),
    jsonlConnection(join(reports, "uploads.jsonl")),
    jsonConnection(join(reports, "analytics_*.json")),
  ];
  let prepared: Awaited<ReturnType<typeof prepareSandboxSources>> | undefined;

  try {
    prepared = await prepareSandboxSources(configs, directory);
    assert.deepEqual(
      prepared.mounts.map((mount) => mount.destination),
      [
        databasePath,
        join(reports, "analytics_first.json"),
        join(reports, "uploads.jsonl"),
      ].sort(),
    );
    assert.doesNotMatch(
      prepared.mounts.map((mount) => mount.destination).join("\n"),
      /private\.txt/u,
    );

    const databaseMount = prepared.mounts.find((mount) => mount.destination === databasePath);
    assert.ok(databaseMount);
    assert.equal(databaseMount.source, databasePath);
  } finally {
    prepared?.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

// These tests need bwrap, and they need a node the sandbox can reach. The
// sandbox binds /usr read-only, so the child runs /usr/bin/node — which is
// not necessarily the node running this suite. On a CI runner, setup-node
// installs into /opt/hostedtoolcache and /usr/bin/node may not exist at all.
//
// The skip is honest about that. What it must not do is hide it: a suite that
// silently skips its only real enforcement tests reports success for a
// property it never checked. Measured on PR #24: CI ran with 11 of these
// skipped and reported a pass. Name the reason on stderr so a reader of the
// log knows enforcement was not exercised.
const SANDBOX_BINARY = "/usr/bin/bwrap";
const SANDBOX_NODE = "/usr/bin/node";

function sandboxEnforcementUnavailable(): string | false {
  const missing = [SANDBOX_BINARY, SANDBOX_NODE].filter((path) => !existsSync(path));
  if (missing.length === 0) {
    return false;
  }
  const reason = `sandbox enforcement not exercised: missing ${missing.join(", ")}`;
  process.stderr.write(`# ${reason}\n`);
  return reason;
}

test(
  "sandbox runtime denies undeclared source paths and source writes",
  { skip: sandboxEnforcementUnavailable() },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "ecosym-sandbox-runtime-"));
    const home = join(directory, "home");
    const worktree = join(home, "project");
    const sourceDirectory = join(directory, "external-archive");
    const reports = join(sourceDirectory, "reports");
    const stateDirectory = join(home, ".local", "share", "ecosym");
    const databasePath = join(sourceDirectory, "state.db");
    const declaredPath = join(sourceDirectory, "declared.jsonl");
    const privatePath = join(sourceDirectory, "private.txt");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(reports, { recursive: true });
    mkdirSync(join(stateDirectory, "connections"), { recursive: true });
    mkdirSync(join(stateDirectory, "runs"), { recursive: true });
    mkdirSync(join(stateDirectory, "worktrees", "other"), { recursive: true });
    writeFileSync(join(worktree, "tracked.txt"), "original\n");
    writeFileSync(join(stateDirectory, "connections", "private.json"), "not current\n");
    writeFileSync(join(stateDirectory, "runs", "private.log"), "not current\n");
    writeFileSync(join(stateDirectory, "worktrees", "other", "private.txt"), "not current\n");
    writeFileSync(join(stateDirectory, "observations.sqlite3"), "legacy private state\n");
    writeFileSync(declaredPath, '{}\n');
    writeFileSync(privatePath, "not declared\n");
    writeFileSync(join(reports, "analytics_first.json"), '{"videos":[]}\n');
    writeFileSync(join(reports, "other-report.json"), "not declared\n");
    const source = new DatabaseSync(databasePath);
    source.exec(`
      CREATE TABLE async_delegations (id TEXT, status TEXT, private_note TEXT);
      INSERT INTO async_delegations VALUES ('one', 'done', 'not declared');
      CREATE TABLE messages (id TEXT, body TEXT);
      INSERT INTO messages VALUES ('one', 'not declared');
    `);
    source.close();
    const store = new ObservationStore(stateDirectory);
    store.register(parseConnectionConfig(sqliteConnection(databasePath)));
    store.register(parseConnectionConfig(jsonlConnection(declaredPath)));
    store.register(parseConnectionConfig(jsonConnection(join(reports, "analytics_*.json"))));
    store.close();

    try {
      const readable = runInSandbox(home, worktree, `cat ${shellQuote(declaredPath)}`);
      assert.equal(readable.status, 0, readable.stderr);
      assert.equal(readable.stdout, '{}\n');

      const undeclared = runInSandbox(home, worktree, `cat ${shellQuote(privatePath)}`);
      assert.equal(undeclared.status, 1);
      assert.match(undeclared.stderr, /No such file or directory/u);

      const undeclaredSibling = runInSandbox(
        home,
        worktree,
        `cat ${shellQuote(join(reports, "other-report.json"))}`,
      );
      assert.equal(undeclaredSibling.status, 1);
      assert.match(undeclaredSibling.stderr, /No such file or directory/u);

      for (const privateStatePath of [
        join(stateDirectory, "connections", "private.json"),
        join(stateDirectory, "runs", "private.log"),
        join(stateDirectory, "worktrees", "other", "private.txt"),
      ]) {
        const hiddenState = runInSandbox(home, worktree, `cat ${shellQuote(privateStatePath)}`);
        assert.equal(hiddenState.status, 1);
        assert.match(hiddenState.stderr, /No such file or directory/u);
      }
      const hiddenLegacyStore = runInSandbox(
        home,
        worktree,
        `cat ${shellQuote(join(stateDirectory, "observations.sqlite3"))}`,
      );
      assert.doesNotMatch(
        `${hiddenLegacyStore.stdout}${hiddenLegacyStore.stderr}`,
        /legacy private state/u,
      );

      const sqliteFileScope = runInSandbox(
        home,
        worktree,
        `/usr/bin/node --input-type=module -e ${shellQuote(
          `import { DatabaseSync } from "node:sqlite"; ` +
            `const db = new DatabaseSync(${JSON.stringify(databasePath)}, { readOnly: true }); ` +
            `db.prepare("SELECT * FROM messages").get();`,
        )}`,
      );
      assert.equal(sqliteFileScope.status, 0, sqliteFileScope.stderr);

      const write = runInSandbox(
        home,
        worktree,
        `printf changed > ${shellQuote(declaredPath)}`,
      );
      assert.equal(write.status, 1);
      assert.match(write.stderr, /Read-only file system/u);
      assert.equal(readFileSync(declaredPath, "utf8"), '{}\n');
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test(
  "sandbox sees source WAL commits made during a run",
  { skip: sandboxEnforcementUnavailable() },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "ecosym-sandbox-live-source-"));
    const home = join(directory, "home");
    const worktree = join(home, "project");
    const stateDirectory = join(home, ".local", "share", "ecosym");
    const sourceDirectory = join(directory, "external-archive");
    const databasePath = join(sourceDirectory, "state.db");
    const readyPath = join(worktree, "ready");
    const goPath = join(worktree, "go");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(stateDirectory, { recursive: true });
    const source = new DatabaseSync(databasePath);
    source.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE async_delegations (id TEXT, status TEXT);
      INSERT INTO async_delegations VALUES ('one', 'done');
    `);
    source.close();
    const store = new ObservationStore(stateDirectory);
    store.register(parseConnectionConfig(sqliteConnection(databasePath)));
    store.close();

    let child: ChildProcessWithoutNullStreams | undefined;
    try {
      const childScript = `
        import { existsSync, writeFileSync } from "node:fs";
        import { DatabaseSync } from "node:sqlite";
        writeFileSync(${JSON.stringify(readyPath)}, "ready");
        const deadline = Date.now() + 10_000;
        while (!existsSync(${JSON.stringify(goPath)}) && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
        }
        if (!existsSync(${JSON.stringify(goPath)})) throw new Error("host update timed out");
        const database = new DatabaseSync(${JSON.stringify(databasePath)}, { readOnly: true });
        const count = database.prepare("SELECT count(*) AS count FROM async_delegations").get().count;
        database.close();
        process.stdout.write(JSON.stringify({ count }));
      `;
      child = spawn(
        sandbox,
        ["-c", `/usr/bin/node --input-type=module -e ${shellQuote(childScript)}`],
        { env: sandboxEnvironment(home, worktree) },
      );
      const resultPromise = collectChild(child);
      await waitForPath(readyPath, child);

      const writer = new DatabaseSync(databasePath);
      writer.exec("INSERT INTO async_delegations VALUES ('two', 'running')");
      writer.close();
      writeFileSync(goPath, "go\n");

      const result = await resultPromise;
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        count: 2,
      });
    } finally {
      child?.kill();
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

function runInSandbox(
  home: string,
  worktree: string,
  command: string,
): SpawnSyncReturns<string> {
  return spawnSync(sandbox, ["-c", command], {
    encoding: "utf8",
    env: sandboxEnvironment(home, worktree),
  });
}

function sandboxEnvironment(home: string, worktree: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  delete environment.ECOSYM_PROJECT;
  delete environment.XDG_DATA_HOME;
  return {
    ...environment,
    ECOSYM_SANDBOX_EXEC: "/bin/bash",
    ECOSYM_WORKTREE: worktree,
    HOME: home,
  };
}

function collectChild(
  child: ChildProcessWithoutNullStreams,
): Promise<{ status: number | null; stderr: string; stdout: string }> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  return new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolvePromise({ status, stderr, stdout }));
  });
}

async function waitForPath(path: string, child: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!existsSync(path)) {
    if (child.exitCode !== null) {
      throw new Error(`Sandbox exited before creating ${path}`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${path}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function sqliteConnection(path: string): ConnectionConfig {
  return {
    schemaVersion: 1,
    id: "sqlite-source",
    factOwner: "fixture",
    reader: { type: "sqlite", path, table: "async_delegations" },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "latest",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "fixture.status",
        payload: { status: { scope: "record", path: "status" } },
        required: [],
        subject: { scope: "record", path: "id" },
      },
    ],
  };
}

function jsonlConnection(path: string): ConnectionConfig {
  return {
    schemaVersion: 1,
    id: "jsonl-source",
    factOwner: "fixture",
    reader: { type: "jsonl", path },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "fixture.upload",
        payload: { index: { scope: "meta", value: "record-index" } },
        required: [],
        subject: { scope: "meta", value: "record-index" },
      },
    ],
  };
}

function jsonConnection(pathPattern: string): ConnectionConfig {
  return {
    schemaVersion: 1,
    id: "json-source",
    factOwner: "fixture",
    reader: { type: "json", pathPattern, recordsPath: "videos" },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "latest",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "fixture.metric",
        payload: { index: { scope: "meta", value: "record-index" } },
        required: [],
        subject: { scope: "meta", value: "record-index" },
      },
    ],
  };
}
