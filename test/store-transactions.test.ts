import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ObservationStore } from "../src/store.ts";
import { arenaBundle } from "./arena-fixture.ts";

function busyError(): Error {
  return Object.assign(new Error("database is locked"), {
    code: "ERR_SQLITE_ERROR",
    errcode: 5,
    errstr: "database is locked",
  });
}

async function admittedStore(): Promise<ObservationStore> {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-transactions-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  await store.admitArenaBundle("arena", JSON.stringify(arenaBundle()));
  return store;
}

function isStoreContention(injected: Error) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof Error);
    assert.equal((error as { code?: unknown }).code, "store_contention");
    assert.equal(error.name, "StoreContentionError");
    assert.equal(error.cause, injected);
    return true;
  };
}

for (const statement of ["BEGIN", "COMMIT"]) {
  test(`F36: read transaction maps contention at ${statement} to store_contention`, async () => {
    const store = await admittedStore();
    const exec = DatabaseSync.prototype.exec;
    const injected = busyError();
    DatabaseSync.prototype.exec = function (sql: string): void {
      if (sql === statement) {
        throw injected;
      }
      exec.call(this, sql);
    };
    try {
      assert.throws(() => store.narrate(), isStoreContention(injected));
    } finally {
      DatabaseSync.prototype.exec = exec;
    }
    try {
      assert.equal(store.narrate().claims.length, 1);
    } finally {
      store.close();
    }
  });
}

test("F38: a failed ROLLBACK in a read transaction keeps the original error", async () => {
  const store = await admittedStore();
  const exec = DatabaseSync.prototype.exec;
  const commitFailure = new Error("commit failed");
  DatabaseSync.prototype.exec = function (sql: string): void {
    if (sql === "COMMIT") {
      throw commitFailure;
    }
    exec.call(this, sql);
    if (sql === "ROLLBACK") {
      throw new Error("rollback failed");
    }
  };
  try {
    assert.throws(() => store.narrate(), (error: unknown) => error === commitFailure);
  } finally {
    DatabaseSync.prototype.exec = exec;
  }
  try {
    assert.equal(store.narrate().claims.length, 1);
  } finally {
    store.close();
  }
});

test("F38: a failed ROLLBACK in a write transaction keeps the original error", () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-transactions-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql: string): void {
    exec.call(this, sql);
    if (sql === "ROLLBACK") {
      throw new Error("rollback failed");
    }
  };
  try {
    assert.throws(
      () => store.registerArenaSource("arena", "other-source", "Synthetic Owner"),
      { name: "ConnectionConflictError", code: "connection_conflict" },
    );
  } finally {
    DatabaseSync.prototype.exec = exec;
  }
  try {
    assert.deepEqual(store.getConnection("arena").config.reader, {
      type: "arena",
      sourceId: "source",
      owner: "Synthetic Owner",
    });
  } finally {
    store.close();
  }
});

test("F10: fact query reads facts and provenance from one snapshot", async () => {
  const store = await admittedStore();
  const baseline = store.queryClaims();
  assert.equal(baseline.length, 1);
  assert.notEqual(baseline[0]?.sourceReport, undefined);

  const blocker = new DatabaseSync(store.path);
  blocker.exec("PRAGMA foreign_keys = ON");
  const prepare = DatabaseSync.prototype.prepare;
  let interleaved = 0;
  DatabaseSync.prototype.prepare = function (this: DatabaseSync, sql: string) {
    if (this !== blocker && interleaved === 0 && sql.includes("ROW_NUMBER() OVER (PARTITION BY f.fact_id")) {
      interleaved += 1;
      // Another connection commits between the facts SELECT and the provenance SELECT.
      blocker.exec("BEGIN IMMEDIATE; DELETE FROM source_reports WHERE connection_id = 'arena'; COMMIT");
    }
    return prepare.call(this, sql);
  };
  try {
    assert.deepEqual(store.queryClaims(), baseline);
  } finally {
    DatabaseSync.prototype.prepare = prepare;
  }
  try {
    assert.equal(interleaved, 1);
    assert.equal(store.queryClaims()[0]?.sourceReport, undefined);
  } finally {
    blocker.close();
    store.close();
  }
});
