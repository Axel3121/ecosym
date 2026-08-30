import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig } from "../src/config.ts";
import {
  openFileReadOnly,
  openSqliteReadOnly,
  SourceReadError,
} from "../src/readers.ts";
import { CollectionFailedError, ObservationStore } from "../src/store.ts";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "ecosym-collection-"));
}

function sqliteConnection(path: string, id = "sqlite-source") {
  return parseConnectionConfig({
    schemaVersion: 1,
    id,
    factOwner: "external-platform",
    reader: { type: "sqlite", path, table: "measurements" },
    sourceRecord: {
      identity: [{ scope: "record", path: "record_id" }],
      retention: "latest",
      recordedAt: {
        selector: { scope: "record", path: "measured_at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api-a.views",
        subject: { scope: "record", path: "subject_id" },
        payload: { value: { scope: "record", path: "public_value" } },
      },
      {
        epistemicStatus: "claim",
        kind: "runtime.completion-report",
        subject: { scope: "record", path: "subject_id" },
        payload: { state: { scope: "record", path: "reported_state" } },
      },
    ],
  });
}

function createSqliteSource(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    CREATE TABLE measurements (
      record_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      measured_at TEXT NOT NULL,
      public_value INTEGER NOT NULL,
      reported_state TEXT NOT NULL,
      secret_token TEXT NOT NULL,
      private_history TEXT NOT NULL
    ) STRICT;
  `);
  return database;
}

test("collects named SQLite fields while unselected personal fields never reach the store", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "source.db");
  const source = createSqliteSource(sourcePath);
  const secret = "SECRET-do-not-copy-47a8";
  source
    .prepare(
      `INSERT INTO measurements
        (record_id, subject_id, measured_at, public_value, reported_state,
         secret_token, private_history)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("record-1", "video-1", "2026-08-30T10:00:00Z", 7, "completed", secret, "private prose");
  source.close();

  const store = new ObservationStore(join(directory, "state"));
  try {
    const parsed = sqliteConnection(sourcePath);
    store.register(parsed);
    const report = await collectConnection(store, parsed.config.id);

    assert.equal(report.result.factsAdded, 2);
    assert.deepEqual(store.queryObservations().map((fact) => fact.payload), [{ value: 7 }]);
    assert.deepEqual(store.queryClaims().map((fact) => fact.payload), [{ state: "completed" }]);
  } finally {
    store.close();
  }
  assert.equal(readFileSync(join(directory, "state", "observations.sqlite")).includes(secret), false);
});

test("keeps changing values as a source-time series and does not promote a late older point", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "source.db");
  const source = createSqliteSource(sourcePath);
  source
    .prepare(
      `INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("record-1", "video-1", "2026-08-30T10:00:00Z", 7, "running", "unused", "unused");
  source.close();
  const store = new ObservationStore(join(directory, "state"));
  const parsed = sqliteConnection(sourcePath);
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);

    const update = new DatabaseSync(sourcePath);
    update
      .prepare("UPDATE measurements SET measured_at = ?, public_value = ? WHERE record_id = ?")
      .run("2026-08-31T10:00:00Z", 12, "record-1");
    update.close();
    await collectConnection(store, parsed.config.id);

    const late = new DatabaseSync(sourcePath);
    late
      .prepare("UPDATE measurements SET measured_at = ?, public_value = ? WHERE record_id = ?")
      .run("2026-08-29T10:00:00Z", 5, "record-1");
    late.close();
    await collectConnection(store, parsed.config.id);

    const series = store.queryObservations();
    assert.deepEqual(
      series.map((point) => [point.payload.value, point.temporalStatus]),
      [
        [7, "historical"],
        [12, "current"],
        [5, "historical"],
      ],
    );
  } finally {
    store.close();
  }
});

test("a corrected source version has one current payload, including after reversion", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "source.db");
  const source = createSqliteSource(sourcePath);
  source
    .prepare("INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("record-1", "video-1", "2026-08-30T10:00:00Z", 7, "running", "unused", "unused");
  source.close();
  const store = new ObservationStore(join(directory, "state"));
  const parsed = sqliteConnection(sourcePath);
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);

    const correction = new DatabaseSync(sourcePath);
    correction
      .prepare("UPDATE measurements SET public_value = ? WHERE record_id = ?")
      .run(12, "record-1");
    correction.close();
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(
      store.queryObservations().map((point) => [point.payload.value, point.temporalStatus]),
      [
        [7, "historical"],
        [12, "current"],
      ],
    );

    const reversion = new DatabaseSync(sourcePath);
    reversion
      .prepare("UPDATE measurements SET public_value = ? WHERE record_id = ?")
      .run(7, "record-1");
    reversion.close();
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(
      store.queryObservations().map((point) => [point.payload.value, point.temporalStatus]),
      [
        [7, "current"],
        [12, "historical"],
      ],
    );
  } finally {
    store.close();
  }
});

test("JSONL history preserves deletion markers and treats required null metrics as unknown", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "history.jsonl");
  writeFileSync(
    sourcePath,
    `${JSON.stringify({ id: "one", video_id: "video-1", at: "2026-08-30T00:00:00Z", deleted: true, day7_stats: null })}\n`,
  );
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "history-source",
    factOwner: "video-platform",
    reader: { type: "jsonl", path: sourcePath },
    sourceRecord: {
      identity: [
        { scope: "meta", value: "source-path" },
        { scope: "meta", value: "record-index" },
      ],
      retention: "history",
      recordedAt: {
        selector: { scope: "record", path: "at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "upload.history",
        subject: { scope: "record", path: "video_id" },
        payload: {
          deleted: { default: false, selector: { scope: "record", path: "deleted" } },
        },
      },
      {
        epistemicStatus: "observation",
        kind: "analytics.day7-views",
        subject: { scope: "record", path: "video_id" },
        payload: { value: { scope: "record", path: "day7_stats.views" } },
        required: [{ scope: "record", path: "day7_stats.views" }],
      },
    ],
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(store.queryObservations().map((fact) => [fact.kind, fact.payload]), [
      ["upload.history", { deleted: true }],
    ]);
  } finally {
    store.close();
  }
});

test("reads nested JSON snapshots with source-root metadata", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "snapshot-1.json");
  writeFileSync(
    sourcePath,
    JSON.stringify({
      generated_at: "2026-08-30T06:00:00Z",
      unselected_channel_secret: "must stay outside the store",
      videos: [{ video_id: "video-1", views: 12, unselected_title: "private title" }],
    }),
  );
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "snapshot-source",
    factOwner: "video-platform",
    reader: { type: "json", pathPattern: join(directory, "snapshot-*.json"), recordsPath: "videos" },
    sourceRecord: {
      identity: [
        { scope: "meta", value: "source-path" },
        { scope: "record", path: "video_id" },
      ],
      retention: "history",
      recordedAt: {
        selector: { scope: "root", path: "generated_at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "analytics-api.views",
        subject: { scope: "record", path: "video_id" },
        payload: { value: { scope: "record", path: "views" } },
      },
    ],
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(store.queryObservations().map((fact) => fact.payload), [{ value: 12 }]);
  } finally {
    store.close();
  }
  const storedBytes = readFileSync(join(directory, "state", "observations.sqlite"));
  assert.equal(storedBytes.includes("must stay outside the store"), false);
  assert.equal(storedBytes.includes("private title"), false);
});

test("reads quoted CSV records through the same declarative contract", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "readings.csv");
  writeFileSync(
    sourcePath,
    'reading_id,subject,recorded_at,value,note\n1,sensor-a,2026-08-30T00:00:00Z,green,"comma, kept out"\n',
  );
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "csv-source",
    factOwner: "sensor-owner",
    reader: { type: "csv", path: sourcePath, delimiter: "," },
    sourceRecord: {
      identity: [{ scope: "record", path: "reading_id" }],
      retention: "history",
      recordedAt: {
        selector: { scope: "record", path: "recorded_at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "sensor.color",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(store.queryObservations().map((fact) => fact.payload), [{ value: "green" }]);
  } finally {
    store.close();
  }
});

test("a malformed later JSONL row rolls back facts from earlier rows", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "broken.jsonl");
  writeFileSync(
    sourcePath,
    `${JSON.stringify({ id: "one", subject: "a", at: "2026-08-30T00:00:00Z", value: 1 })}\n{"broken":\n`,
  );
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "broken-source",
    factOwner: "owner",
    reader: { type: "jsonl", path: sourcePath },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: {
        selector: { scope: "record", path: "at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "example.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await assert.rejects(collectConnection(store, parsed.config.id), CollectionFailedError);
    assert.equal(store.countFacts(), 0);
    assert.equal(store.statuses()[0]?.status, "unread");
  } finally {
    store.close();
  }
});

test("source helpers refuse writes through every reader's open path", async () => {
  const directory = workspace();
  const sqlitePath = join(directory, "source.db");
  const source = new DatabaseSync(sqlitePath);
  source.exec("CREATE TABLE write_probe (value TEXT); INSERT INTO write_probe VALUES ('kept')");
  source.close();

  const readonlyDatabase = openSqliteReadOnly(sqlitePath);
  try {
    assert.throws(
      () => readonlyDatabase.exec("INSERT INTO main.write_probe VALUES ('must-not-land')"),
      (error: unknown) =>
        error !== null &&
        typeof error === "object" &&
        "errcode" in error &&
        error.errcode === 8,
    );
  } finally {
    readonlyDatabase.close();
  }

  for (const extension of ["jsonl", "json", "csv"]) {
    const path = join(directory, `source.${extension}`);
    writeFileSync(path, "kept", { mode: 0o600 });
    const handle = await openFileReadOnly(path);
    try {
      await assert.rejects(handle.write("must-not-land", 0), { code: "EBADF" });
    } finally {
      await handle.close();
    }
    assert.equal(readFileSync(path, "utf8"), "kept");
  }

  const check = new DatabaseSync(sqlitePath, { readOnly: true });
  try {
    const row = check.prepare("SELECT count(*) AS count FROM write_probe").get() as {
      count: number;
    };
    assert.equal(row.count, 1);
  } finally {
    check.close();
  }
});

test("an existing path SQLite cannot open is unreadable rather than absent", () => {
  const directory = workspace();

  assert.throws(
    () => openSqliteReadOnly(directory),
    (error: unknown) =>
      error instanceof SourceReadError && error.code === "source_unreadable",
  );
});

test("a locked SQLite source records an unread attempt", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "locked.db");
  const source = createSqliteSource(sourcePath);
  source
    .prepare("INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("record-1", "video-1", "2026-08-30T10:00:00Z", 7, "running", "unused", "unused");
  source.close();
  const parsed = sqliteConnection(sourcePath, "locked-source");
  const store = new ObservationStore(join(directory, "state"));
  const blocker = new DatabaseSync(sourcePath);
  try {
    store.register(parsed);
    blocker.exec("BEGIN EXCLUSIVE");
    await assert.rejects(collectConnection(store, parsed.config.id), {
      code: "source_locked",
    });
    assert.equal(store.statuses()[0]?.status, "unread");
  } finally {
    if (blocker.isTransaction) {
      blocker.exec("ROLLBACK");
    }
    blocker.close();
    store.close();
  }
});

test("two connections sharing a reader keep attempts and status isolated", async () => {
  const directory = workspace();
  const goodPath = join(directory, "good.jsonl");
  const badPath = join(directory, "bad.jsonl");
  writeFileSync(goodPath, '{"id":"one","subject":"a","value":1}\n');
  writeFileSync(badPath, "not-json\n");

  const makeConfig = (id: string, path: string) =>
    parseConnectionConfig({
      schemaVersion: 1,
      id,
      factOwner: "owner",
      reader: { type: "jsonl", path },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }],
        retention: "history",
        recordedAt: { unavailable: true },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "example.value",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
      ],
    });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(makeConfig("good", goodPath));
    store.register(makeConfig("bad", badPath));
    await collectConnection(store, "good");
    await assert.rejects(collectConnection(store, "bad"), CollectionFailedError);

    assert.deepEqual(
      store.statuses().map(({ connectionId, status }) => ({ connectionId, status })),
      [
        { connectionId: "bad", status: "unread" },
        { connectionId: "good", status: "changed" },
      ],
    );
    assert.equal(store.countFacts("good"), 1);
    assert.equal(store.countFacts("bad"), 0);
  } finally {
    store.close();
  }
});
