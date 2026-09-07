// Sources and owned state are synthetic and isolated in temporary directories.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig } from "../src/config.ts";
import { parseCivilizationConfig } from "../src/institution.ts";
import { ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import type { WorldSnapshot } from "../src/world-snapshot.ts";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-world-transitions-"));
  const database = new DatabaseSync(join(directory, "source.sqlite"));
  const stateDirectory = join(directory, "state");
  const store = new ObservationStore(stateDirectory);
  t.after(() => {
    store.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  database.exec(`
    CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT, report TEXT, recorded_at TEXT);
    INSERT INTO tasks VALUES ('task-1', 'done', 'success', '2026-01-02T03:04:05.000Z');
    INSERT INTO tasks VALUES ('task-2', 'queued', 'pending', '2026-01-02T03:04:06.000Z');
  `);
  function config(factOwner = "synthetic-owner") {
    return parseConnectionConfig({
      schemaVersion: 1, id: "board", factOwner,
      reader: { type: "sqlite", path: join(directory, "source.sqlite"), table: "tasks" },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }], retention: "latest",
        recordedAt: { selector: { scope: "record", path: "recorded_at" }, format: "iso8601" },
      },
      facts: [
        { epistemicStatus: "observation", kind: "task.status", subject: { scope: "record", path: "id" },
          payload: { value: { scope: "record", path: "status" } } },
        { epistemicStatus: "claim", kind: "task.report", subject: { scope: "record", path: "id" },
          payload: { value: { scope: "record", path: "report" } } },
      ],
    });
  }
  const parsed = config();
  store.register(parsed);
  store.foundCivilization(parseCivilizationConfig({
    schemaVersion: 1, name: "Transitions", domain: "synthetic", sources: ["board"],
    mayActAlone: ["read"], mustEscalate: ["spend"],
  }));
  return { store, stateDirectory, config, parsed };
}

function source(snapshot: WorldSnapshot) {
  assert.equal(snapshot.sourcePictures.length, 1);
  assert.equal(snapshot.sourcePictures[0]!.sources.length, 1);
  return snapshot.sourcePictures[0]!.sources[0]!;
}

function gatedCollection(store: ObservationStore) {
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const pending = store.collect(store.getConnection("board"), async () => {
    ready.resolve();
    await release.promise;
  });
  return { ready: ready.promise, release: release.resolve, pending };
}

test("first-ever gated collection composes as incomplete without facts or a completed attempt", async (t) => {
  const { store, parsed } = fixture(t);
  assert.equal(source(composeWorldSnapshot(store)).collection?.reason, "never-run");
  const gate = gatedCollection(store);
  try {
    await gate.ready;
    const snapshot = composeWorldSnapshot(store);
    const running = source(snapshot);
    const [attempt] = store.collectionAttempts();
    assert.ok(attempt);
    assert.equal(attempt.outcome, "running");
    assert.deepEqual(running.collection, {
      connectionId: "board", connectionVersion: parsed.hash,
      lastAttemptAt: attempt.startedAt, reason: "incomplete", status: "unread",
    });
    assert.deepEqual(running.attemptsInProgress, [{
      attemptId: attempt.attemptId, connectionId: "board", connectionVersion: parsed.hash,
      startedAt: attempt.startedAt,
    }]);
    assert.deepEqual(running.observations, []);
    assert.deepEqual(running.claims, []);
    assert.equal(snapshot.observationsTruncated, false);
    assert.equal(snapshot.claimsTruncated, false);
  } finally {
    gate.release();
    await gate.pending;
  }
  const completed = source(composeWorldSnapshot(store));
  assert.equal(completed.collection?.reason, "nothing-new");
  assert.deepEqual(completed.attemptsInProgress, []);
});

for (const changed of [false, true]) {
  test(`disconnect/reconnect with ${changed ? "changed" : "same"} config scopes facts and running attempts`, async (t) => {
    const { store, config, parsed } = fixture(t);
    await collectConnection(store, "board");
    const before = source(composeWorldSnapshot(store));
    assert.equal(before.observations.length, 2);
    assert.equal(before.claims.length, 2);
    const oldActivation = store.getConnection("board").activationId;
    const gate = gatedCollection(store);
    try {
      await gate.ready;
      const running = source(composeWorldSnapshot(store)).attemptsInProgress;
      assert.equal(running.length, 1);
      assert.equal(store.disconnect("board"), true);
      assert.deepEqual(source(composeWorldSnapshot(store)), {
        connectionId: "board", collection: null, attemptsInProgress: [], observations: [], claims: [],
      });
      const next = changed ? config("replacement-owner") : parsed;
      store.register(next);
      assert.notEqual(store.getConnection("board").activationId, oldActivation);
      const reconnected = source(composeWorldSnapshot(store));
      assert.deepEqual(reconnected.collection, {
        connectionId: "board", connectionVersion: next.hash,
        lastAttemptAt: null, reason: "never-run", status: "unread",
      });
      assert.deepEqual(reconnected.observations, changed ? [] : before.observations);
      assert.deepEqual(reconnected.claims, changed ? [] : before.claims);
      assert.deepEqual(reconnected.attemptsInProgress, []);
      assert.equal(store.collectionAttempts().find((entry) => entry.attemptId === running[0]!.attemptId)?.outcome, "running");
      assert.equal(store.countFacts(), 4, "excluded facts remain stored");
      await collectConnection(store, "board");
      const recollected = source(composeWorldSnapshot(store));
      assert.equal(recollected.observations.length, 2);
      assert.equal(recollected.claims.length, 2);
      for (const fact of [...recollected.observations, ...recollected.claims]) {
        assert.equal(fact.connectionVersion, next.hash);
        assert.equal(fact.factOwner, next.config.factOwner);
        assert.equal(fact.collectionAsOf?.activationId, store.getConnection("board").activationId);
      }
      assert.deepEqual(recollected.attemptsInProgress, []);
    } finally {
      gate.release();
      await assert.rejects(gate.pending, { code: "connection_inactive" });
    }
    assert.deepEqual(source(composeWorldSnapshot(store)).attemptsInProgress, []);
  });
}

test("narration keeps pre-write statuses, attempts, facts and counts in one read transaction", async (t) => {
  const { store, stateDirectory, config, parsed } = fixture(t);
  await collectConnection(store, "board");
  const writer = new ObservationStore(stateDirectory);
  const gate = gatedCollection(store);
  const originalStatuses = store.statuses;
  try {
    await gate.ready;
    const before = composeWorldSnapshot(store, 1);
    assert.equal(before.observationsTruncated, true);
    assert.equal(before.claimsTruncated, true);
    assert.equal(source(before).attemptsInProgress.length, 1);
    assert.equal(source(before).observations.length, 1);
    assert.equal(source(before).claims.length, 1);
    const next = config("interleaved-owner");
    let reads = 0;
    store.statuses = () => {
      const statuses = originalStatuses.call(store);
      reads++;
      assert.equal(statuses[0]?.connectionVersion, parsed.hash);
      assert.equal(writer.disconnect("board"), true);
      writer.register(next);
      assert.equal(writer.statuses()[0]?.connectionVersion, next.hash);
      return statuses;
    };
    assert.deepEqual(composeWorldSnapshot(store, 1), before);
    assert.equal(reads, 1);
    store.statuses = originalStatuses;
    const after = composeWorldSnapshot(store, 1);
    assert.deepEqual(source(after), {
      connectionId: "board",
      collection: { connectionId: "board", connectionVersion: next.hash,
        lastAttemptAt: null, reason: "never-run", status: "unread" },
      attemptsInProgress: [], observations: [], claims: [],
    });
    assert.equal(after.observationsTruncated, false);
    assert.equal(after.claimsTruncated, false);
  } finally {
    store.statuses = originalStatuses;
    gate.release();
    try {
      await assert.rejects(gate.pending, { code: "connection_inactive" });
    } finally {
      writer.close();
    }
  }
});

test("public skip and retirement APIs compose unread states while retaining prior evidence", async (t) => {
  const { store } = fixture(t);
  await collectConnection(store, "board");
  const before = source(composeWorldSnapshot(store));
  store.recordSkipped(store.getConnection("board"), "synthetic_skip");
  const skipped = source(composeWorldSnapshot(store));
  assert.equal(skipped.collection?.reason, "skipped");
  assert.equal(skipped.collection?.status, "unread");
  assert.ok(skipped.collection?.lastAttemptAt);
  assert.deepEqual(skipped.attemptsInProgress, []);
  assert.deepEqual(skipped.observations, before.observations);
  assert.deepEqual(skipped.claims, before.claims);
  const gate = gatedCollection(store);
  try {
    await gate.ready;
    const attempt = source(composeWorldSnapshot(store)).attemptsInProgress[0]!;
    const plan = store.planCollectionAttemptRetirement(attempt.attemptId, "operator:synthetic");
    await store.retireCollectionAttempt(plan.attemptId, plan.retiredBy, plan.confirmationToken);
    const retired = source(composeWorldSnapshot(store));
    assert.equal(retired.collection?.reason, "retired");
    assert.equal(retired.collection?.status, "unread");
    assert.ok(retired.collection?.lastAttemptAt);
    assert.deepEqual(retired.attemptsInProgress, []);
    assert.deepEqual(retired.observations, before.observations);
    assert.deepEqual(retired.claims, before.claims);
  } finally {
    gate.release();
    await assert.rejects(gate.pending);
  }
  assert.equal(source(composeWorldSnapshot(store)).collection?.reason, "retired");
});

test("synthetic stored unknown record-index mode composes safely without a prior attempt", (t) => {
  const { store, parsed } = fixture(t);
  store.disconnect("board");
  const indexed = parseConnectionConfig({
    ...parsed.config,
    reader: { type: "jsonl", path: "/unused-synthetic-world-transitions.jsonl" },
    sourceRecord: { ...parsed.config.sourceRecord, identity: [{ scope: "meta", value: "record-index" }] },
  });
  store.register(indexed);
  // Model the persisted ambiguous mode directly; this is not a migration test.
  const database = new DatabaseSync(store.path);
  try {
    database.prepare(`UPDATE connection_versions SET jsonl_record_index_mode = 'unknown'
      WHERE connection_id = ? AND config_hash = ?`).run("board", indexed.hash);
  } finally {
    database.close();
  }
  assert.deepEqual(source(composeWorldSnapshot(store)), {
    connectionId: "board",
    collection: { connectionId: "board", connectionVersion: indexed.hash,
      lastAttemptAt: null, reason: "record-index-unknown", status: "unread" },
    attemptsInProgress: [], observations: [], claims: [],
  });
});
