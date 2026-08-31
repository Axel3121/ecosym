import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig, type ConnectionConfig } from "../src/config.ts";
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

function fileConnection(
  id: string,
  reader: ConnectionConfig["reader"],
  payloadPath = "value",
  recordedAt: ConnectionConfig["sourceRecord"]["recordedAt"] = { unavailable: true },
) {
  return parseConnectionConfig({
    schemaVersion: 1,
    id,
    factOwner: "source-owner",
    reader,
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt,
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "example.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: payloadPath } },
      },
    ],
  });
}

test("SQLite collection stores configured facts and excludes sampled unselected fields", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "source.db");
  const source = createSqliteSource(sourcePath);
  const secret = "SECRET-do-not-copy-47a8";
  const privateHistory = "PRIVATE-history-do-not-copy-92b1";
  source
    .prepare(
      `INSERT INTO measurements
        (record_id, subject_id, measured_at, public_value, reported_state,
         secret_token, private_history)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("record-1", "video-1", "2026-08-30T10:00:00.000Z", 7, "completed", secret, privateHistory);
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
  const storedBytes = readFileSync(join(directory, "state", "observations.sqlite"));
  assert.equal(storedBytes.includes(secret), false);
  assert.equal(storedBytes.includes(privateHistory), false);
});

test("keeps changing values as a source-time series and does not promote a late older point", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "source.db");
  const source = createSqliteSource(sourcePath);
  source
    .prepare(
      `INSERT INTO measurements VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("record-1", "video-1", "2026-08-30T10:00:00.000Z", 7, "running", "unused", "unused");
  source.close();
  const store = new ObservationStore(join(directory, "state"));
  const parsed = sqliteConnection(sourcePath);
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);

    const update = new DatabaseSync(sourcePath);
    update
      .prepare("UPDATE measurements SET measured_at = ?, public_value = ? WHERE record_id = ?")
      .run("2026-08-31T10:00:00.000Z", 12, "record-1");
    update.close();
    await collectConnection(store, parsed.config.id);

    const late = new DatabaseSync(sourcePath);
    late
      .prepare("UPDATE measurements SET measured_at = ?, public_value = ? WHERE record_id = ?")
      .run("2026-08-29T10:00:00.000Z", 5, "record-1");
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
    .run("record-1", "video-1", "2026-08-30T10:00:00.000Z", 7, "running", "unused", "unused");
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
    const reversionReport = await collectConnection(store, parsed.config.id);
    assert.equal(reversionReport.result.factsAdded, 0);
    assert.equal(reversionReport.result.factsChanged, 1);
    assert.equal(store.statuses()[0]?.status, "changed");
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
    `${JSON.stringify({ id: "one", video_id: "video-1", at: "2026-08-30T00:00:00.000Z", deleted: true, day7_stats: null })}\n`,
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
      generated_at: "2026-08-30T06:00:00.000Z",
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
    'reading_id,subject,recorded_at,value,note\r\n1,sensor-a,2026-08-30T00:00:00.000Z,green,"comma, kept out"\r\n',
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

test("rejects characters after a closing CSV quote", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "malformed.csv");
  writeFileSync(sourcePath, 'id,subject,value\n1,item,"abc"x\n');
  const parsed = fileConnection("malformed-csv", {
    type: "csv",
    path: sourcePath,
    delimiter: ",",
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await assert.rejects(collectConnection(store, parsed.config.id), {
      code: "source_malformed",
    });
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("rejects a terminal bare carriage return instead of trimming it", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "bare-carriage-return.csv");
  writeFileSync(sourcePath, "id,subject,value\n1,item,abc\r");
  const parsed = fileConnection("bare-carriage-return", {
    type: "csv",
    path: sourcePath,
    delimiter: ",",
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await assert.rejects(collectConnection(store, parsed.config.id), {
      code: "source_malformed",
    });
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("preserves a selected __proto__ CSV column", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "prototype-header.csv");
  writeFileSync(sourcePath, "id,__proto__,subject\n1,kept,item\n");
  const parsed = fileConnection(
    "prototype-header",
    { type: "csv", path: sourcePath, delimiter: "," },
    "__proto__",
  );
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(store.queryObservations().map((fact) => fact.payload), [
      { value: "kept" },
    ]);
  } finally {
    store.close();
  }
});

test("collects a top-level JSON record array", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "records.json");
  writeFileSync(sourcePath, JSON.stringify([{ id: "one", subject: "item", value: 7 }]));
  const parsed = fileConnection("json-array", {
    type: "json",
    pathPattern: sourcePath,
    recordsPath: "",
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(store.queryObservations().map((fact) => fact.payload), [{ value: 7 }]);
  } finally {
    store.close();
  }
});

for (const scenario of [
  { name: "an impossible calendar date", format: "date", value: "2026-02-30" },
  { name: "a non-leap-year February 29", format: "date", value: "2026-02-29" },
  {
    name: "an impossible ISO calendar date",
    format: "iso8601",
    value: "2026-02-30T00:00:00.000Z",
  },
  {
    name: "a non-UTC ISO representation",
    format: "iso8601",
    value: "2026-08-30T12:00:00+02:00",
  },
  {
    name: "sub-millisecond ISO precision",
    format: "iso8601",
    value: "2026-08-30T10:00:00.1234Z",
  },
  {
    name: "a leap second JavaScript cannot represent",
    format: "iso8601",
    value: "2016-12-31T23:59:60Z",
  },
  {
    name: "an extended ISO year the store cannot order",
    format: "iso8601",
    value: "+010000-01-01T00:00:00.000Z",
  },
  {
    name: "a finite out-of-range Unix timestamp",
    format: "unix-milliseconds",
    value: 8_640_000_000_000_001,
  },
] as const) {
  test(`rejects ${scenario.name} as malformed source time`, async () => {
    const directory = workspace();
    const sourcePath = join(directory, "time.jsonl");
    writeFileSync(
      sourcePath,
      `${JSON.stringify({ id: "one", subject: "item", at: scenario.value, value: 7 })}\n`,
    );
    const parsed = fileConnection(
      `invalid-time-${scenario.format}`,
      { type: "jsonl", path: sourcePath },
      "value",
      {
        selector: { scope: "record", path: "at" },
        format: scenario.format,
      },
    );
    const store = new ObservationStore(join(directory, "state"));
    try {
      store.register(parsed);
      await assert.rejects(collectConnection(store, parsed.config.id), {
        code: "source_malformed",
      });
      assert.equal(store.countFacts(), 0);
    } finally {
      store.close();
    }
  });
}

test("rejects numeric source times with sub-millisecond precision", async (t) => {
  for (const scenario of [
    { format: "unix-seconds", value: 1_756_550_400.0005 },
    { format: "unix-milliseconds", value: 1_756_550_400_000.5 },
  ] as const) {
    await t.test(scenario.format, async () => {
      const directory = workspace();
      const sourcePath = join(directory, "time.jsonl");
      writeFileSync(
        sourcePath,
        `${JSON.stringify({ id: "one", subject: "item", at: scenario.value, value: 7 })}\n`,
      );
      const parsed = fileConnection(
        `sub-millisecond-${scenario.format}`,
        { type: "jsonl", path: sourcePath },
        "value",
        {
          selector: { scope: "record", path: "at" },
          format: scenario.format,
        },
      );
      const store = new ObservationStore(join(directory, "state"));
      try {
        store.register(parsed);
        await assert.rejects(collectConnection(store, parsed.config.id), {
          code: "source_malformed",
        });
        assert.equal(store.countFacts(), 0);
      } finally {
        store.close();
      }
    });
  }
});

test("collects representable UTC spellings without rewriting them", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "utc-spellings.jsonl");
  const spellings = [
    "2026-08-30T10:00:00Z",
    "2026-08-30T10:00:00.5Z",
    "2026-08-30T10:00:00.25Z",
    "2026-08-30T10:00:00.000Z",
    "2026-08-30T10:00:00+00:00",
    "2026-08-30T24:00:00Z",
  ];
  writeFileSync(
    sourcePath,
    spellings
      .map((at, index) => JSON.stringify({ id: index, subject: `item-${index}`, at, value: 7 }))
      .join("\n") + "\n",
  );
  const parsed = fileConnection(
    "utc-spellings",
    { type: "jsonl", path: sourcePath },
    "value",
    {
      selector: { scope: "record", path: "at" },
      format: "iso8601",
    },
  );
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.deepEqual(
      store.queryObservations().map((record) => record.sourceRecordedAt),
      spellings,
    );
  } finally {
    store.close();
  }
});

test("accepts a valid leap-day source time", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "leap-day.jsonl");
  writeFileSync(
    sourcePath,
    `${JSON.stringify({ id: "one", subject: "item", at: "2028-02-29", value: 7 })}\n`,
  );
  const parsed = fileConnection(
    "valid-leap-day",
    { type: "jsonl", path: sourcePath },
    "value",
    {
      selector: { scope: "record", path: "at" },
      format: "date",
    },
  );
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    assert.equal(store.queryObservations()[0]?.sourceRecordedAt, "2028-02-29T00:00:00.000Z");
  } finally {
    store.close();
  }
});

test("maps a post-open CSV read failure to source_unreadable", async () => {
  const directory = workspace();
  const parsed = fileConnection("unreadable-csv", {
    type: "csv",
    path: directory,
    delimiter: ",",
  });
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await assert.rejects(collectConnection(store, parsed.config.id), {
      code: "source_unreadable",
    });
  } finally {
    store.close();
  }
});

test("a malformed later JSONL row rolls back facts from earlier rows", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "broken.jsonl");
  writeFileSync(
    sourcePath,
    `${JSON.stringify({ id: "one", subject: "a", at: "2026-08-30T00:00:00.000Z", value: 1 })}\n{"broken":\n`,
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
    .run("record-1", "video-1", "2026-08-30T10:00:00.000Z", 7, "running", "unused", "unused");
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
