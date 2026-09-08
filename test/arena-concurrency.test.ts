import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { ObservationStore } from "../src/store.ts";
import { arenaBundle } from "./arena-fixture.ts";

test("Arena concurrent admission isolates caller bytes and active connection state", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bytes = new TextEncoder().encode(JSON.stringify(arenaBundle()));
  const pending = store.admitArenaBundle("arena", bytes);
  bytes.fill(0);
  const admitted = await pending;
  assert.equal(store.querySourceReport(admitted.reportId)!.bundle.bundleId, "bundle-one");
  const next = arenaBundle(); next.bundleId = "bundle-two";
  const disconnected = store.admitArenaBundle("arena", JSON.stringify(next));
  store.disconnect("arena");
  await assert.rejects(disconnected, { code: "connection_inactive" });
  assert.equal(store.exportOwnedState().counts.sourceReports, 1);
  assert.equal(store.countFacts(), 1);
  store.close();
});

test("Arena parallel SQLite writers deduplicate identical reports and conflict different content atomically", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-arena-"));
  const store = new ObservationStore(directory);
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const gate = new SharedArrayBuffer(4);
  const text = JSON.stringify(arenaBundle());
  const inputs = [text, text, text.replace("OWNER-PRIVATE-PAYLOAD", "conflicting")];
  const workers = inputs.map((input) => new Worker(new URL("./arena-admission-worker.ts", import.meta.url), { workerData: { directory, text: input, gate } }));
  const exited = workers.map((worker) => new Promise<void>((resolve) => worker.once("exit", () => resolve())));
  const results: Promise<{ reportId?: string; code?: string }>[] = [];
  await Promise.all(workers.map((worker) => new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("message", (message) => {
      assert.equal(message, "ready");
      results.push(new Promise((done, failed) => { worker.once("message", done); worker.once("error", failed); }));
      resolve();
    });
  })));
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0);
  const completed = await Promise.all(results);
  await Promise.all(exited);
  assert.equal(new Set(completed.filter((r) => r.reportId).map((r) => r.reportId)).size, 1);
  assert.ok(completed.some((r) => r.code === "arena_conflict"));
  assert.ok(completed.every((r) => r.reportId !== undefined || r.code === "arena_conflict"));
  assert.equal(store.exportOwnedState().counts.sourceReports, 1);
  assert.equal(store.exportOwnedState().counts.sourceReportFacts, 1);
  assert.equal(store.countFacts(), 1);
  assert.equal(store.collectionAttempts().length, 3);
  store.close();
});

test("Arena transaction rolls back report and facts when link persistence fails", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const database = new DatabaseSync(store.path);
  database.exec("CREATE TRIGGER reject_link BEFORE INSERT ON source_report_facts BEGIN SELECT RAISE(ABORT, 'synthetic private failure'); END");
  await assert.rejects(store.admitArenaBundle("arena", JSON.stringify(arenaBundle())), { message: "Collection failed", code: "internal_error" });
  assert.equal(store.countFacts(), 0);
  for (const table of ["source_reports", "source_report_facts", "source_report_admissions"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()!.count, 0);
  }
  assert.equal(store.collectionAttempts()[0]!.outcome, "failed");
  database.exec("DROP TRIGGER reject_link");
  await store.admitArenaBundle("arena", JSON.stringify(arenaBundle()));
  assert.equal(store.countFacts(), 1);
  database.close();
  store.close();
});

test("Arena contention never leaks SQLite causes at attempt start or failure completion", async () => {
  for (const stage of ["start", "failure"] as const) {
    const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")), 0);
    store.registerArenaSource("arena", "source", "Synthetic Owner");
    const blocker = new DatabaseSync(store.path);
    if (stage === "start") blocker.exec("BEGIN IMMEDIATE");
    const pending = store.admitArenaBundle("arena", "{");
    if (stage === "failure") blocker.exec("BEGIN IMMEDIATE");
    try {
      await assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Collection failed");
        assert.equal((error as Error & { code: string }).code, "store_contention");
        assert.equal(error.cause, undefined);
        return true;
      });
    } finally {
      blocker.exec("ROLLBACK"); blocker.close();
    }
    assert.equal(store.countFacts(), 0);
    if (stage === "failure") assert.equal(store.collectionAttempts()[0]!.outcome, "running");
    store.close();
  }
});
