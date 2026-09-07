// All sources are synthetic SQLite databases in isolated temporary directories.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig } from "../src/config.ts";
import { parseCivilizationConfig } from "../src/institution.ts";
import { CollectionFailedError, ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { createWorldServer } from "../src/world-server.ts";
import { validateWorldSnapshot, type WorldSnapshot } from "../src/world-snapshot.ts";
import { inspectSourceFields } from "../src/world-form.ts";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-world-observations-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "PRIVATE-SOURCE-HANDLE.db");
  const database = new DatabaseSync(path);
  t.after(() => database.close());
  database.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT, reported_state TEXT, recorded_at TEXT, secret_token TEXT);
    INSERT INTO tasks VALUES ('synthetic-task', 'done', 'success', '2026-01-02T03:04:05.000Z', 'PRIVATE-UNMAPPED-TOKEN');
    CREATE TABLE empty_tasks AS SELECT * FROM tasks WHERE 0;
  `);
  const store = new ObservationStore(join(directory, "state"));
  t.after(() => store.close());
  function register(id: string, dated = false, table = "tasks") {
    const parsed = parseConnectionConfig({
      schemaVersion: 1, id, factOwner: "hermes",
      reader: { type: "sqlite", path, table },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }], retention: "latest",
        recordedAt: dated
          ? { selector: { scope: "record", path: "recorded_at" }, format: "iso8601" }
          : { unavailable: true },
      },
      facts: [
        { epistemicStatus: "observation", kind: "hermes.kanban-task.status",
          subject: { scope: "record", path: "id" }, payload: { value: { scope: "record", path: "status" } } },
        { epistemicStatus: "claim", kind: "hermes.completion-report",
          subject: { scope: "record", path: "id" }, payload: { state: { scope: "record", path: "reported_state" } } },
      ],
    });
    store.register(parsed);
    return parsed;
  }
  function found(name: string, sources: string[], domain = "synthetic") {
    return store.foundCivilization(parseCivilizationConfig({
      schemaVersion: 1, name, domain, sources, mayActAlone: ["read"], mustEscalate: ["spend"],
    }), new Date("2026-01-01T00:00:00.000Z"));
  }
  return { directory, path, database, store, register, found };
}

function picture(snapshot: WorldSnapshot, civilizationId: string) {
  const result = snapshot.sourcePictures.find((entry) => entry.civilizationId === civilizationId);
  assert.ok(result);
  return result;
}

async function serve(t: TestContext, readSnapshot: () => WorldSnapshot, directory: string) {
  const server = createWorldServer(readSnapshot, join(directory, "missing-build"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return (path = "/api/world-snapshot") => fetch(`http://127.0.0.1:${address.port}${path}`);
}

test("synthetic Hermes flows through registration, collection, founding, production composition and HTTP without source handles", async (t) => {
  const { directory, path, database, store, register, found } = fixture(t);
  const parsed = register("hermes-board");
  register("second-board", false, "empty_tasks");
  register("undeclared-board");
  await collectConnection(store, "hermes-board");
  await collectConnection(store, "undeclared-board");
  const first = found("First", ["hermes-board", "HERMES-BOARD", "hermes", "hermes-board-extra", "missing"]);
  const second = found("Second", ["second-board"]);
  const named = found("hermes-board", []);
  let reads = 0;
  const get = await serve(t, () => { reads++; return composeWorldSnapshot(store); }, directory);
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const text = await response.text();
  const snapshot = validateWorldSnapshot(JSON.parse(text));
  assert.deepEqual(snapshot, composeWorldSnapshot(store));
  assert.equal(reads, 1);
  const sources = picture(snapshot, first.civilizationId).sources;
  assert.deepEqual(sources.map((entry) => entry.connectionId), ["hermes-board", "HERMES-BOARD", "hermes", "hermes-board-extra", "missing"]);
  const source = sources[0]!;
  assert.equal(source.collection?.reason, "collected");
  assert.equal(source.collection?.status, "changed");
  assert.deepEqual(source.observations, store.narrate().observations.filter((fact) => fact.connectionId === "hermes-board"));
  assert.equal(source.observations.length, 1);
  assert.equal(source.claims.length, 1);
  assert.equal(source.observations[0]!.epistemicStatus, "observation");
  assert.equal(source.claims[0]!.epistemicStatus, "claim");
  assert.equal(source.observations[0]!.connectionVersion, parsed.hash);
  assert.equal(source.observations[0]!.factOwner, "hermes");
  assert.equal(source.observations[0]!.temporalStatus, "unknown");
  assert.equal(source.observations[0]!.sourceRecordedAt, null);
  assert.ok(source.observations[0]!.collectionAsOf);
  for (const entry of sources.slice(1)) {
    assert.deepEqual(entry, { connectionId: entry.connectionId, collection: null, attemptsInProgress: [], observations: [], claims: [] });
  }
  const secondSource = picture(snapshot, second.civilizationId).sources[0]!;
  assert.equal(secondSource.connectionId, "second-board");
  assert.equal(secondSource.collection?.reason, "never-run");
  assert.equal(secondSource.collection?.lastAttemptAt, null);
  assert.deepEqual(secondSource.observations, []);
  assert.deepEqual(secondSource.claims, []);
  assert.deepEqual(picture(snapshot, named.civilizationId).sources, []);
  for (const secret of [path, "PRIVATE-SOURCE-HANDLE", "PRIVATE-UNMAPPED-TOKEN", "secret_token", '"reader"', "undeclared-board"]) {
    assert.ok(!text.includes(secret), secret);
    for (const entry of snapshot.sourcePictures) {
      assert.ok(!JSON.stringify(inspectSourceFields(entry, snapshot)).includes(secret), secret);
    }
  }
  assert.equal((await get("/api/institution-snapshot")).status, 404);
  assert.equal(reads, 1);
  database.exec("INSERT INTO empty_tasks SELECT * FROM tasks");
  await collectConnection(store, "second-board");
  const withSecond = validateWorldSnapshot(await (await get()).json());
  const secondFact = picture(withSecond, second.civilizationId).sources[0]!.observations[0]!;
  assert.equal(secondFact.connectionId, "second-board");
  assert.equal(secondFact.payload.value, "done");
  assert.deepEqual(picture(withSecond, first.civilizationId), picture(snapshot, first.civilizationId));
  // Snapshot reads must not reopen Hermes or silently trigger a collection.
  database.exec("DROP TABLE tasks");
  assert.deepEqual(await (await get()).json(), withSecond);
  assert.equal(reads, 3);
});

test("empty and unchanged successful collections are quiet, not never-run or inferred activity", async (t) => {
  const { store, register, found } = fixture(t);
  register("empty", false, "empty_tasks");
  register("unchanged");
  const civilization = found("Quiet", ["empty", "unchanged"]);
  const empty = await collectConnection(store, "empty");
  await collectConnection(store, "unchanged");
  const repeat = await collectConnection(store, "unchanged");
  const snapshot = composeWorldSnapshot(store);
  const [emptySource, unchanged] = picture(snapshot, civilization.civilizationId).sources;
  for (const source of [emptySource!, unchanged!]) {
    assert.equal(source.collection?.reason, "nothing-new");
    assert.equal(source.collection?.status, "quiet");
    assert.ok(source.collection?.lastAttemptAt);
    assert.deepEqual(source.attemptsInProgress, []);
  }
  assert.equal(empty.result.sourceRecordsSeen, 0);
  assert.deepEqual(emptySource!.observations, []);
  assert.deepEqual(emptySource!.claims, []);
  assert.equal(repeat.result.factsAdded, 0);
  assert.equal(unchanged!.observations.length, 1);
  assert.equal(unchanged!.claims.length, 1);
  assert.equal(unchanged!.observations[0]!.temporalStatus, "unknown");
  assert.equal(unchanged!.observations[0]!.collectionAsOf?.attemptId, repeat.result.attemptId);
});

test("inspection distinguishes founding-only, missing, never-run, and quiet without activity defaults", async (t) => {
  const { store, register, found } = fixture(t);
  register("board", false, "empty_tasks");
  const empty = found("No sources", []);
  const linked = found("Linked", ["missing", "board"]);
  const shared = found("Shared", ["board"]);
  let snapshot = composeWorldSnapshot(store);
  const describe = (id: string) => inspectSourceFields(picture(snapshot, id), snapshot)
    .map((field) => `${field.label}: ${field.values.join("\n")}`).join("\n");
  assert.match(describe(empty.civilizationId), /No declared sources/);
  assert.match(describe(linked.civilizationId), /Missing registered source: no active connection/);
  assert.match(describe(linked.civilizationId), /no collection attempt in this active configuration\/activation lifetime/);
  const missing = inspectSourceFields(picture(snapshot, linked.civilizationId), snapshot)
    .find((field) => field.label === "Collection picture: missing")!;
  assert.doesNotMatch(missing.values.join("\n"), /unread|quiet/i);
  await collectConnection(store, "board");
  snapshot = composeWorldSnapshot(store);
  assert.match(describe(linked.civilizationId), /quiet only in the collection picture/);
  assert.match(describe(linked.civilizationId), /Missing registered source: no active connection/);
  assert.deepEqual(picture(snapshot, linked.civilizationId).sources[1], picture(snapshot, shared.civilizationId).sources[0]);
  const conflict = structuredClone(snapshot);
  picture(conflict, shared.civilizationId).sources[0]!.collection = null;
  assert.throws(() => validateWorldSnapshot(conflict), /shared source/);
});

test("failed and incomplete collection retain owner evidence without establishing absence", async (t) => {
  const { database, store, register, found } = fixture(t);
  register("board", true);
  const civilization = found("Partial", ["board"]);
  await collectConnection(store, "board");
  const before = composeWorldSnapshot(store).sourcePictures[0]!.sources[0]!;
  database.exec("DROP TABLE tasks");
  await assert.rejects(collectConnection(store, "board"), CollectionFailedError);
  const failed = composeWorldSnapshot(store).sourcePictures[0]!.sources[0]!;
  assert.equal(failed.collection?.reason, "failed");
  assert.equal(failed.collection?.status, "unread");
  assert.deepEqual(failed.observations, before.observations);
  assert.deepEqual(failed.claims, before.claims);
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = store.collect(store.getConnection("board"), async () => { entered(); await gate; });
  try {
    await started;
    const snapshot = composeWorldSnapshot(store);
    const source = picture(snapshot, civilization.civilizationId).sources[0]!;
    assert.equal(source.collection?.reason, "incomplete");
    assert.equal(source.collection?.status, "unread");
    assert.equal(source.attemptsInProgress.length, 1);
    assert.deepEqual(source.observations, before.observations);
    assert.deepEqual(source.claims, before.claims);
    const rendered = inspectSourceFields(picture(snapshot, civilization.civilizationId), snapshot).flatMap((field) => field.values).join("\n");
    assert.ok(rendered.includes(source.attemptsInProgress[0]!.attemptId));
    assert.match(rendered, /incomplete|running|in progress/i);
  } finally {
    release();
    await pending;
  }
});

test("pure form projection preserves claim, observation and temporal provenance without source-time fallback", async (t) => {
  const { database, store, register, found } = fixture(t);
  register("dated", true);
  register("undated");
  const civilization = found("Temporal", ["dated", "undated"]);
  await collectConnection(store, "dated");
  await collectConnection(store, "undated");
  for (const historical of [false, true]) {
    if (historical) {
      database.exec("DELETE FROM tasks");
      await collectConnection(store, "dated");
    }
    const snapshot = composeWorldSnapshot(store);
    const selected = picture(snapshot, civilization.civilizationId);
    const dated = selected.sources[0]!.observations[0]!;
    const undated = selected.sources[1]!.observations[0]!;
    assert.equal(dated.temporalStatus, historical ? "historical" : "current");
    assert.equal(dated.sourceRecordedAt, "2026-01-02T03:04:05.000Z");
    assert.equal(undated.temporalStatus, "unknown");
    assert.equal(undated.sourceRecordedAt, null);
    const fields = inspectSourceFields(selected, snapshot);
    const description = fields.flatMap((field) => field.values).join("\n");
    assert.match(description, /not completed work, operational success or civilization activity/);
    const observations = fields.filter((field) => /recorded source fields|observations/i.test(field.label)).flatMap((field) => field.values).join("\n");
    const claims = fields.filter((field) => /claims/i.test(field.label)).flatMap((field) => field.values).join("\n");
    assert.ok(observations.includes("hermes.kanban-task.status"));
    assert.ok(!observations.includes("hermes.completion-report"));
    assert.ok(observations.includes('"value":"done"'));
    const observationProse = selected.sources.flatMap((source) => source.observations)
      .reduce((text, fact) => text.replace(JSON.stringify(fact), ""), observations);
    assert.doesNotMatch(observationProse, /complet|success|activ(?:e|ity)/i);
    const semantics = fields.find((field) => field.label === "Source semantics")!.values.join("\n");
    assert.doesNotMatch(semantics.replace("not completed work, operational success or civilization activity", ""), /completed work|operational success|civilization activity/i);
    assert.ok(claims.includes("hermes.completion-report"));
    assert.ok(!claims.includes("hermes.kanban-task.status"));
    for (const [facts, rendered] of [[selected.sources.flatMap((source) => source.observations), observations],
      [selected.sources.flatMap((source) => source.claims), claims]] as const) {
      for (const fact of facts) {
        assert.ok(fact.collectionAsOf);
        for (const value of [fact.factOwner, fact.connectionId, fact.connectionVersion, fact.sourceRecordId,
          fact.subject, fact.kind, fact.temporalStatus, fact.collectedAt, ...Object.values(fact.collectionAsOf)]) {
          assert.ok(rendered.includes(value), `Missing provenance: ${value}`);
        }
      }
    }
    assert.ok(observations.includes(dated.sourceRecordedAt));
    assert.match(observations, /unavailable/i);
    // Isolate undated facts: collection time may be displayed, but never as source-recorded time.
    const undatedFields = inspectSourceFields({ ...selected, sources: [selected.sources[1]!] }, snapshot);
    const undatedText = undatedFields.flatMap((field) => field.values).join("\n");
    assert.match(undatedText, /source[^\n]*unavailable/i);
    const undatedObservation = undatedFields.find((field) => field.label === "Recorded source fields: undated")!.values[0]!;
    assert.ok(undatedObservation.includes('"sourceRecordedAt":null'));
    assert.ok(undatedObservation.includes("Source recorded time: unavailable. Temporal status: unknown."));
    const prose = undatedObservation.slice(0, undatedObservation.indexOf('{'));
    assert.ok(!prose.includes(undated.collectedAt));
    assert.ok(!prose.includes(undated.collectionAsOf!.completedAt));
    assert.doesNotMatch(undatedText, /source(?:RecordedAt|[- ]recorded(?:[- ]at| time)?| time)\s*[:=]\s*\d{4}-/i);
    assert.deepEqual(composeWorldSnapshot(store), snapshot);
  }
  const truncated = composeWorldSnapshot(store, 1);
  assert.equal(truncated.observationsTruncated, true);
  assert.equal(truncated.claimsTruncated, true);
  for (const observationsTruncated of [false, true]) {
    for (const claimsTruncated of [false, true]) {
      const value = { ...truncated, observationsTruncated, claimsTruncated };
      const fields = inspectSourceFields(picture(value, civilization.civilizationId), value);
      const limits = fields.find((field) => field.label === "Stored picture limits")!.values;
      assert.equal(limits[0], `observationsTruncated: ${observationsTruncated}; claimsTruncated: ${claimsTruncated}`);
      assert.equal(limits[1], observationsTruncated
        ? "Observations are truncated across active connections; per-source emptiness is unknown."
        : "Observations are not truncated across active connections.");
      assert.equal(limits[2], claimsTruncated
        ? "Claims are truncated across active connections; per-source emptiness is unknown."
        : "Claims are not truncated across active connections.");
      for (const [label, flag] of [["Recorded source fields", observationsTruncated], ["Claims", claimsTruncated]] as const) {
        const empty = fields.find((field) => field.label === `${label}: dated`)!.values;
        assert.deepEqual(empty, [flag ? "No entries returned; owner-wide truncation leaves this source's emptiness unknown."
          : "No collected entries in this returned picture; not evidence of no activity."]);
      }
    }
  }
});

test("world validator rejects closed nested fields, invalid links and accessors, and detaches accepted data", async (t) => {
  const { store, register, found } = fixture(t);
  register("board", true);
  found("Validated", ["board"]);
  await collectConnection(store, "board");
  const snapshot = composeWorldSnapshot(store);
  const targets = [
    (value: WorldSnapshot) => value,
    (value: WorldSnapshot) => value.civilizations[0]!,
    (value: WorldSnapshot) => value.civilizations[0]!.mandate,
    (value: WorldSnapshot) => value.sourcePictures[0]!,
    (value: WorldSnapshot) => value.sourcePictures[0]!.sources[0]!,
    (value: WorldSnapshot) => value.sourcePictures[0]!.sources[0]!.collection!,
    (value: WorldSnapshot) => value.sourcePictures[0]!.sources[0]!.observations[0]!,
    (value: WorldSnapshot) => value.sourcePictures[0]!.sources[0]!.claims[0]!,
    (value: WorldSnapshot) => value.sourcePictures[0]!.sources[0]!.observations[0]!.collectionAsOf!,
  ];
  for (const target of targets) {
    for (const key of ["privateSourceHandle", Symbol("privateSourceHandle")]) {
      const invalid = structuredClone(snapshot);
      Object.defineProperty(target(invalid), key, { value: "PRIVATE", enumerable: true });
      assert.throws(() => validateWorldSnapshot(invalid));
    }
    const invalid = structuredClone(snapshot);
    const object = target(invalid);
    let getterCalls = 0;
    Object.defineProperty(object, Object.keys(object)[0]!, { get() { getterCalls++; return "PRIVATE"; } });
    assert.throws(() => validateWorldSnapshot(invalid));
    assert.equal(getterCalls, 0);
  }
  const mutations: ((value: WorldSnapshot) => void)[] = [
    (value) => { value.sourcePictures[0]!.civilizationId = "missing"; },
    (value) => { value.sourcePictures[0]!.sources[0]!.connectionId = "BOARD"; },
    (value) => { value.sourcePictures[0]!.sources = []; },
    (value) => { value.sourcePictures.push(structuredClone(value.sourcePictures[0]!)); },
    (value) => { value.sourcePictures[0]!.sources[0]!.collection = null; },
    (value) => { value.sourcePictures[0]!.sources[0]!.observations[0]!.connectionVersion = "wrong"; },
    (value) => { value.sourcePictures[0]!.sources[0]!.observations[0]!.epistemicStatus = "claim"; },
    (value) => { value.sourcePictures[0]!.sources[0]!.observations[0]!.sourceRecordedAt = null; },
    (value) => { value.sourcePictures[0]!.sources[0]!.observations[0]!.collectionAsOf!.completedAt = "not-a-time"; },
    (value) => { Object.assign(value.sourcePictures[0]!.sources[0]!.observations[0]!.payload, { nested: { secret: true } }); },
    (value) => { value.sourcePictures[0]!.sources[0]!.observations[0]!.payload.value = Infinity; },
    (value) => { value.sourcePictures[0]!.sources[0]!.observations = new Array(1); },
    (value) => { value.sourcePictures[0]!.sources[0]!.attemptsInProgress = [{
      attemptId: "running", connectionId: "board", connectionVersion: value.sourcePictures[0]!.sources[0]!.collection!.connectionVersion,
      startedAt: "2026-01-03T00:00:00.000Z", ...{ reader: "PRIVATE" },
    }]; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(snapshot);
    mutate(invalid);
    assert.throws(() => validateWorldSnapshot(invalid));
  }
  const normalized = validateWorldSnapshot(snapshot);
  assert.deepEqual(normalized, snapshot);
  for (const target of targets) assert.notEqual(target(normalized), target(snapshot));
  normalized.sourcePictures[0]!.sources[0]!.observations[0]!.payload.value = "mutated";
  assert.equal(snapshot.sourcePictures[0]!.sources[0]!.observations[0]!.payload.value, "done");
});

test("form meanings and validator follow every owner collection reason and last-attempt constraint", (t) => {
  const { store, register, found } = fixture(t);
  register("board");
  found("Reasons", ["board"]);
  const base = composeWorldSnapshot(store);
  const cases = [
    ["collected", "changed", /new or changed stored facts; not operational success/],
    ["nothing-new", "quiet", /no new or changed facts: quiet only in the collection picture/],
    ["never-run", "unread", /no collection attempt in this active configuration\/activation lifetime/],
    ["incomplete", "unread", /latest attempt has no recorded completion/],
    ["failed", "unread", /latest collection attempt failed/],
    ["retired", "unread", /latest collection attempt was explicitly retired/],
    ["skipped", "unread", /latest collection attempt was skipped/],
    ["record-index-unknown", "unread", /stored JSONL record-index interpretation is unknown/],
  ] as const;
  const meanings = new Set<string>();
  for (const [reason, status, meaning] of cases) {
    for (const lastAttemptAt of [null, "2026-01-03T00:00:00.000Z"]) {
      const value = structuredClone(base);
      const source = value.sourcePictures[0]!.sources[0]!;
      Object.assign(source.collection!, { reason, status, lastAttemptAt });
      if (reason === "incomplete") source.attemptsInProgress = [{
        attemptId: "synthetic-running", connectionId: "board", connectionVersion: source.collection!.connectionVersion,
        startedAt: "2026-01-03T00:00:00.000Z",
      }];
      const valid = reason === "record-index-unknown" || (reason === "never-run" ? lastAttemptAt === null : lastAttemptAt !== null);
      if (!valid) {
        assert.throws(() => validateWorldSnapshot(value), /Inconsistent collection status/);
        continue;
      }
      const accepted = validateWorldSnapshot(value);
      const fields = inspectSourceFields(accepted.sourcePictures[0]!, accepted);
      const collection = fields.find((field) => field.label === "Collection picture: board")!.values;
      // Check the explanatory prose, not the raw provenance JSON.
      assert.match(collection[1]!, meaning);
      assert.equal(collection[2], JSON.stringify(source.collection));
      meanings.add(collection[1]!);
      for (const wrongStatus of ["changed", "quiet", "unread"] as const) {
        if (wrongStatus === status) continue;
        const invalid = structuredClone(value);
        invalid.sourcePictures[0]!.sources[0]!.collection!.status = wrongStatus;
        assert.throws(() => validateWorldSnapshot(invalid), /Inconsistent collection status/);
      }
    }
  }
  assert.equal(meanings.size, cases.length);
});

test("only explicit sources equality links despite adversarial names, domains and fact subjects", async (t) => {
  const { database, store, register, found } = fixture(t);
  register("source-a");
  register("source-b");
  database.exec("UPDATE tasks SET id = 'source-b'");
  await collectConnection(store, "source-a");
  database.exec("UPDATE tasks SET id = 'source-a'");
  await collectConnection(store, "source-b");
  const misleading = found("source-b", ["source-a"], "source-b");
  const unlinked = found("source-a", [], "source-b");
  const snapshot = composeWorldSnapshot(store);
  const sources = picture(snapshot, misleading.civilizationId).sources;
  assert.deepEqual(sources.map((source) => source.connectionId), ["source-a"]);
  assert.equal(sources[0]!.observations[0]!.subject, "source-b");
  assert.equal(sources[0]!.claims[0]!.subject, "source-b");
  assert.ok([...sources[0]!.observations, ...sources[0]!.claims].every((fact) => fact.connectionId === "source-a"));
  assert.deepEqual(picture(snapshot, unlinked.civilizationId).sources, []);
  assert.deepEqual(validateWorldSnapshot(snapshot), snapshot);
});

test("HTTP rejects invalid nested snapshots and callback failures without private details or stale data", async (t) => {
  const { directory, store, register, found } = fixture(t);
  register("board");
  found("Errors", ["board"]);
  await collectConnection(store, "board");
  const snapshot = composeWorldSnapshot(store);
  let value = snapshot;
  let fail = false;
  const get = await serve(t, () => {
    if (fail) throw new Error("PRIVATE-SOURCE-HANDLE /private/hermes.db");
    return value;
  }, directory);
  assert.equal((await get()).status, 200);
  value = structuredClone(snapshot);
  Object.assign(value.sourcePictures[0]!.sources[0]!.observations[0]!, { reader: "PRIVATE-SOURCE-HANDLE" });
  for (const throws of [false, true]) {
    fail = throws;
    const response = await get();
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.text();
    assert.doesNotMatch(body, /PRIVATE|hermes\.db|synthetic-task|sourcePictures/);
    assert.equal(typeof JSON.parse(body).error, "string");
  }
  fail = false;
  value = snapshot;
  assert.deepEqual(await (await get()).json(), snapshot);
});
