import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig, type ConnectionConfig } from "../src/config.ts";
import { materializeFacts } from "../src/materialize.ts";
import {
  openFileReadOnly,
  openSqliteReadOnly,
  SourceReadError,
} from "../src/readers.ts";
import { CollectionFailedError, ObservationStore } from "../src/store.ts";
import { verifyConnection } from "../src/verify.ts";

const temporaryWorkspaces: string[] = [];

// Each test gets its own directory; a shared cleanup keeps the operating
// system's temporary directory from filling with state databases and sources
// as the suite grows.
function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-collection-"));
  temporaryWorkspaces.push(directory);
  return directory;
}

after(() => {
  for (const directory of temporaryWorkspaces.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

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

function indexedJsonlConnection(sourcePath: string) {
  return parseConnectionConfig({
    schemaVersion: 1,
    id: "indexed-jsonl",
    factOwner: "source-owner",
    reader: { type: "jsonl", path: sourcePath },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
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
}

function markStoreAsSchemaSix(stateDirectory: string): void {
  const database = new DatabaseSync(join(stateDirectory, "observations.sqlite"));
  const columns = database.prepare("PRAGMA table_info(connection_versions)").all() as {
    name: string;
  }[];
  if (columns.some((column) => column.name === "jsonl_record_index_mode")) {
    database.exec("ALTER TABLE connection_versions DROP COLUMN jsonl_record_index_mode");
  }
  database.exec("DROP TABLE IF EXISTS record_index_mode_resolutions");
  database.exec("DROP TABLE IF EXISTS confirmation_previews");
  database.exec("PRAGMA user_version = 6");
  database.close();
}

function resolveRecordIndexMode(
  store: ObservationStore,
  connectionId: string,
  connectionVersion: string,
  mode: "physical-line" | "record-ordinal",
): void {
  const plan = store.planRecordIndexModeResolution(
    connectionId,
    connectionVersion,
    mode,
  );
  store.resolveRecordIndexMode(
    connectionId,
    connectionVersion,
    mode,
    plan.confirmationToken,
  );
}

function numericTimeFixture(
  token: string,
  format: "unix-milliseconds" | "unix-seconds",
) {
  const directory = workspace();
  const sourcePath = join(directory, "time.jsonl");
  writeFileSync(
    sourcePath,
    `{"id":"one","subject":"item","at":${token},"value":7}\n`,
  );
  const parsed = fileConnection(
    "numeric-time",
    { type: "jsonl", path: sourcePath },
    "value",
    {
      selector: { scope: "record", path: "at" },
      format,
    },
  );
  const store = new ObservationStore(join(directory, "state"));
  store.register(parsed);
  return { parsed, store };
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

test("JSONL blank lines do not change record-index identity", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "records.jsonl");
  const records = [
    '{"subject":"alpha","value":1}',
    '{"subject":"beta","value":2}',
  ];
  writeFileSync(sourcePath, `${records.join("\n")}\n`);
  const parsed = indexedJsonlConnection(sourcePath);
  const store = new ObservationStore(join(directory, "state"));
  try {
    store.register(parsed);
    await collectConnection(store, parsed.config.id);
    const identities = store.queryObservations().map((fact) => fact.sourceRecordId);

    writeFileSync(sourcePath, `${records[0]}\n\n${records[1]}\n`);
    const verification = await verifyConnection(
      store,
      store.getConnection(parsed.config.id),
    );
    assert.equal(verification.outcome, "agreement");
    assert.equal(verification.counts.matched, 2);
    assert.equal(verification.counts.missingAtSource, 0);
    assert.equal(verification.counts.uncollected, 0);

    const repeated = await collectConnection(store, parsed.config.id);
    assert.equal(repeated.result.factsAdded, 0);
    assert.equal(repeated.result.factsChanged, 0);
    assert.deepEqual(
      store.queryObservations().map((fact) => fact.sourceRecordId),
      identities,
    );
  } finally {
    store.close();
  }
});

test("an ambiguous physical-line JSONL store is refused without rewriting identity", async () => {
  const directory = workspace();
  const stateDirectory = join(directory, "state");
  const sourcePath = join(directory, "records.jsonl");
  writeFileSync(
    sourcePath,
    '{"subject":"alpha","value":1}\n\n{"subject":"beta","value":2}\n',
  );
  const parsed = indexedJsonlConnection(sourcePath);
  const oldStore = new ObservationStore(stateDirectory);
  oldStore.register(parsed);
  await oldStore.collect(oldStore.getConnection(parsed.config.id), (sink) => {
    for (const [recordIndex, line] of readFileSync(sourcePath, "utf8").split("\n").entries()) {
      if (line.trim() === "") {
        continue;
      }
      const record = JSON.parse(line) as Record<string, unknown>;
      sink.recordSourceRecord(() =>
        materializeFacts(parsed.config, {
          meta: { recordIndex, sourcePath },
          numericLexemes: null,
          record,
          root: record,
        }),
      );
    }
  });
  const identities = oldStore.queryObservations().map((fact) => fact.sourceRecordId);
  oldStore.close();

  markStoreAsSchemaSix(stateDirectory);

  const migrated = new ObservationStore(stateDirectory);
  try {
    assert.equal(
      migrated.getConnection(parsed.config.id).jsonlRecordIndexMode,
      "unknown",
    );
    const forgedForVerification = migrated.getConnection(parsed.config.id);
    forgedForVerification.jsonlRecordIndexMode = "physical-line";
    const forgedVerification = await verifyConnection(
      migrated,
      forgedForVerification,
    );
    assert.equal(forgedVerification.outcome, "unread");
    assert.equal(
      forgedVerification.unreadReason,
      "store_record_index_mode_unknown",
    );
    const verification = await verifyConnection(
      migrated,
      migrated.getConnection(parsed.config.id),
    );
    assert.equal(verification.outcome, "unread");
    assert.equal(verification.unreadReason, "store_record_index_mode_unknown");
    assert.equal(verification.counts.storedFacts, 2);
    await assert.rejects(collectConnection(migrated, parsed.config.id), {
      code: "store_record_index_mode_unknown",
    });
    let producerCalled = false;
    await assert.rejects(
      migrated.collect(migrated.getConnection(parsed.config.id), () => {
        producerCalled = true;
      }),
      { code: "store_record_index_mode_unknown" },
    );
    assert.equal(producerCalled, false);
    const forged = migrated.getConnection(parsed.config.id);
    forged.jsonlRecordIndexMode = "record-ordinal";
    await assert.rejects(migrated.collect(forged, () => undefined), {
      code: "store_record_index_mode_unknown",
    });
    assert.equal(migrated.statuses()[0]?.status, "unread");
    assert.equal(migrated.statuses()[0]?.reason, "record-index-unknown");
    assert.equal(migrated.countFacts(), 2);
    assert.deepEqual(
      migrated.queryObservations().map((fact) => fact.sourceRecordId),
      identities,
    );
  } finally {
    migrated.close();
  }
});

test("an ambiguous ordinal JSONL store is refused without rewriting identity", async () => {
  const directory = workspace();
  const stateDirectory = join(directory, "state");
  const sourcePath = join(directory, "records.jsonl");
  writeFileSync(
    sourcePath,
    '{"subject":"alpha","value":1}\n\n{"subject":"beta","value":2}\n',
  );
  const parsed = indexedJsonlConnection(sourcePath);
  const oldStore = new ObservationStore(stateDirectory);
  oldStore.register(parsed);
  await collectConnection(oldStore, parsed.config.id);
  const identities = oldStore.queryObservations().map((fact) => fact.sourceRecordId);
  oldStore.close();
  markStoreAsSchemaSix(stateDirectory);

  const migrated = new ObservationStore(stateDirectory);
  try {
    assert.equal(migrated.getConnection(parsed.config.id).jsonlRecordIndexMode, "unknown");
    const verification = await verifyConnection(
      migrated,
      migrated.getConnection(parsed.config.id),
    );
    assert.equal(verification.outcome, "unread");
    assert.equal(verification.unreadReason, "store_record_index_mode_unknown");
    await assert.rejects(collectConnection(migrated, parsed.config.id), {
      code: "store_record_index_mode_unknown",
    });
    assert.equal(migrated.statuses()[0]?.reason, "record-index-unknown");
    assert.equal(migrated.countFacts(), 2);
    assert.deepEqual(
      migrated.queryObservations().map((fact) => fact.sourceRecordId),
      identities,
    );
  } finally {
    migrated.close();
  }
});

test("verification and collection refuse a replaced record-index mode", async () => {
  const directory = workspace();
  const stateDirectory = join(directory, "state");
  const sourcePath = join(directory, "records.jsonl");
  writeFileSync(
    sourcePath,
    '{"subject":"alpha","value":1}\n\n{"subject":"beta","value":2}\n',
  );
  const parsed = indexedJsonlConnection(sourcePath);
  const oldStore = new ObservationStore(stateDirectory);
  oldStore.register(parsed);
  await oldStore.collect(oldStore.getConnection(parsed.config.id), (sink) => {
    for (const [recordIndex, line] of readFileSync(sourcePath, "utf8").split("\n").entries()) {
      if (line.trim() === "") {
        continue;
      }
      const record = JSON.parse(line) as Record<string, unknown>;
      sink.recordSourceRecord(() =>
        materializeFacts(parsed.config, {
          meta: { recordIndex, sourcePath },
          numericLexemes: null,
          record,
          root: record,
        }),
      );
    }
  });
  oldStore.close();
  markStoreAsSchemaSix(stateDirectory);

  const migrated = new ObservationStore(stateDirectory);
  try {
    resolveRecordIndexMode(
      migrated,
      parsed.config.id,
      parsed.hash,
      "physical-line",
    );
    const physicalConnection = migrated.getConnection(parsed.config.id);
    const snapshot = migrated.factsForVerification(physicalConnection);
    migrated.factsForVerification = () => {
      queueMicrotask(() => {
        resolveRecordIndexMode(
          migrated,
          parsed.config.id,
          parsed.hash,
          "record-ordinal",
        );
      });
      return snapshot;
    };

    const verification = await verifyConnection(migrated, physicalConnection);
    assert.equal(verification.outcome, "unread");
    assert.equal(
      verification.unreadReason,
      "store_record_index_mode_changed",
    );
    assert.equal(
      migrated.getConnection(parsed.config.id).jsonlRecordIndexMode,
      "record-ordinal",
    );

    resolveRecordIndexMode(
      migrated,
      parsed.config.id,
      parsed.hash,
      "physical-line",
    );
    const staleCollection = migrated.getConnection(parsed.config.id);
    resolveRecordIndexMode(
      migrated,
      parsed.config.id,
      parsed.hash,
      "record-ordinal",
    );
    let producerCalled = false;
    await assert.rejects(
      migrated.collect(staleCollection, () => {
        producerCalled = true;
      }),
      { code: "store_record_index_mode_changed" },
    );
    assert.equal(producerCalled, false);
    assert.equal(migrated.countFacts(), 2);

    const currentCollection = migrated.getConnection(parsed.config.id);
    const correction = migrated.planRecordIndexModeResolution(
      parsed.config.id,
      parsed.hash,
      "physical-line",
    );
    let signalStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    let releaseProducer: () => void = () => undefined;
    const producerReleased = new Promise<void>((resolve) => {
      releaseProducer = resolve;
    });
    const collecting = migrated.collect(currentCollection, async () => {
      signalStarted();
      await producerReleased;
    });
    await started;
    try {
      assert.throws(
        () =>
          migrated.resolveRecordIndexMode(
            parsed.config.id,
            parsed.hash,
            "physical-line",
            correction.confirmationToken,
          ),
        { code: "record_index_resolution_collection_running" },
      );
    } finally {
      releaseProducer();
    }
    await collecting;
    assert.equal(
      migrated.getConnection(parsed.config.id).jsonlRecordIndexMode,
      "record-ordinal",
    );
  } finally {
    migrated.close();
  }
});

test("a schema-six physical-line store without blank lines remains readable", async () => {
  const directory = workspace();
  const stateDirectory = join(directory, "state");
  const sourcePath = join(directory, "records.jsonl");
  writeFileSync(
    sourcePath,
    '{"subject":"alpha","value":1}\n{"subject":"beta","value":2}\n',
  );
  const parsed = indexedJsonlConnection(sourcePath);
  const oldStore = new ObservationStore(stateDirectory);
  oldStore.register(parsed);
  await oldStore.collect(oldStore.getConnection(parsed.config.id), (sink) => {
    for (const [recordIndex, line] of readFileSync(sourcePath, "utf8").split("\n").entries()) {
      if (line.trim() === "") {
        continue;
      }
      const record = JSON.parse(line) as Record<string, unknown>;
      sink.recordSourceRecord(() =>
        materializeFacts(parsed.config, {
          meta: { recordIndex, sourcePath },
          numericLexemes: null,
          record,
          root: record,
        }),
      );
    }
  });
  const identities = oldStore.queryObservations().map((fact) => fact.sourceRecordId);
  oldStore.close();
  markStoreAsSchemaSix(stateDirectory);

  const migrated = new ObservationStore(stateDirectory);
  try {
    assert.equal(
      migrated.getConnection(parsed.config.id).jsonlRecordIndexMode,
      "unknown",
    );
    const verification = await verifyConnection(
      migrated,
      migrated.getConnection(parsed.config.id),
    );
    assert.equal(verification.outcome, "agreement");
    assert.equal(verification.counts.matched, 2);
    assert.equal(
      migrated.getConnection(parsed.config.id).jsonlRecordIndexMode,
      "record-ordinal",
    );
    const repeated = await collectConnection(migrated, parsed.config.id);
    assert.equal(repeated.result.factsAdded, 0);
    assert.equal(repeated.result.factsChanged, 0);
    assert.deepEqual(
      migrated.queryObservations().map((fact) => fact.sourceRecordId),
      identities,
    );
  } finally {
    migrated.close();
  }
});

test("a schema-six JSONL store without record-index remains readable", async () => {
  const directory = workspace();
  const stateDirectory = join(directory, "state");
  const sourcePath = join(directory, "records.jsonl");
  writeFileSync(sourcePath, '{"id":"one","subject":"alpha","value":1}\n');
  const parsed = fileConnection("stable-jsonl", { type: "jsonl", path: sourcePath });
  const oldStore = new ObservationStore(stateDirectory);
  oldStore.register(parsed);
  await collectConnection(oldStore, parsed.config.id);
  oldStore.close();
  markStoreAsSchemaSix(stateDirectory);

  const migrated = new ObservationStore(stateDirectory);
  try {
    assert.equal(
      migrated.getConnection(parsed.config.id).jsonlRecordIndexMode,
      "record-ordinal",
    );
    const verification = await verifyConnection(
      migrated,
      migrated.getConnection(parsed.config.id),
    );
    assert.equal(verification.outcome, "agreement");
    const repeated = await collectConnection(migrated, parsed.config.id);
    assert.equal(repeated.result.factsAdded, 0);
    assert.equal(migrated.countFacts(), 1);
  } finally {
    migrated.close();
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

test("rejects lossy numeric source time selected from a JSON root", async () => {
  const directory = workspace();
  const sourcePath = join(directory, "snapshot.json");
  writeFileSync(
    sourcePath,
    '{"generated":{"at":1756550400000.0001},"records":[{"id":"one","subject":"item","value":7}]}',
  );
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "numeric-root-time",
    factOwner: "source-owner",
    reader: { type: "json", pathPattern: sourcePath, recordsPath: "records" },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: {
        selector: { scope: "root", path: "generated.at" },
        format: "unix-milliseconds",
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
    await assert.rejects(collectConnection(store, parsed.config.id), {
      code: "source_malformed",
    });
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
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

test("converts exact decimal Unix seconds without floating-point classification", async (t) => {
  for (const scenario of [
    { expected: "1970-01-01T00:00:00.001Z", token: "0.001" },
    { expected: "1969-12-31T23:59:59.999Z", token: "-0.001" },
    { expected: "1970-01-01T00:00:01.001Z", token: "1.001" },
    { expected: "1969-12-31T23:59:58.999Z", token: "-1.001" },
    { expected: "1970-01-01T00:00:01.000Z", token: "1" },
    { expected: "9999-12-31T23:59:59.999Z", token: "253402300799.999" },
    { expected: "0000-01-01T00:00:00.000Z", token: "-62167219200" },
  ] as const) {
    await t.test(scenario.token, async () => {
      const { parsed, store } = numericTimeFixture(scenario.token, "unix-seconds");
      try {
        await collectConnection(store, parsed.config.id);
        assert.equal(store.queryObservations()[0]?.sourceRecordedAt, scenario.expected);
      } finally {
        store.close();
      }
    });
  }
});

test("rejects JSON numeric source times whose lexical precision would be lost", async (t) => {
  for (const scenario of [
    { format: "unix-milliseconds", token: "1756550400000.0001" },
    { format: "unix-seconds", token: "1073741824.0030001" },
    { format: "unix-seconds", token: "-34359738368.0010001" },
    { format: "unix-seconds", token: "253402300799.999001" },
    { format: "unix-seconds", token: "1e-324" },
    { format: "unix-seconds", token: "1.0001" },
  ] as const) {
    await t.test(`${scenario.format} ${scenario.token}`, async () => {
      const { parsed, store } = numericTimeFixture(scenario.token, scenario.format);
      try {
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

test("checks SQLite REAL Unix seconds as exact binary values", async (t) => {
  for (const scenario of [
    { expected: "1970-01-01T00:00:00.125Z", value: 0.125 },
    { expected: null, value: 1.001 },
    { expected: null, value: 2 ** 30 + 12_583 * 2 ** -22 },
    { expected: null, value: -34_359_738_368.001 },
  ] as const) {
    await t.test(String(scenario.value), async () => {
      const directory = workspace();
      const sourcePath = join(directory, "time.db");
      const source = new DatabaseSync(sourcePath);
      source.exec(
        "CREATE TABLE times (id TEXT, subject TEXT, at REAL, value INTEGER) STRICT",
      );
      source
        .prepare("INSERT INTO times (id, subject, at, value) VALUES (?, ?, ?, ?)")
        .run("one", "item", scenario.value, 7);
      source.close();
      const parsed = fileConnection(
        "binary-time",
        { type: "sqlite", path: sourcePath, table: "times" },
        "value",
        {
          selector: { scope: "record", path: "at" },
          format: "unix-seconds",
        },
      );
      const store = new ObservationStore(join(directory, "state"));
      try {
        store.register(parsed);
        if (scenario.expected === null) {
          await assert.rejects(collectConnection(store, parsed.config.id), {
            code: "source_malformed",
          });
          assert.equal(store.countFacts(), 0);
        } else {
          await collectConnection(store, parsed.config.id);
          assert.equal(
            store.queryObservations()[0]?.sourceRecordedAt,
            scenario.expected,
          );
        }
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

test("one instant spelled two ways is one observation, not two", async () => {
  // docs/observation-layer.md: two payloads under the same source identity and
  // source time are corrections, not later time-series points. `Z` and `+00:00`
  // name the same instant, so a source that respells it has corrected how it
  // writes the time -- it has not reported a second observation.
  const directory = workspace();
  const sourcePath = join(directory, "records.jsonl");
  writeFileSync(
    sourcePath,
    '{"subject":"alpha","value":1,"at":"2026-08-30T10:00:00Z"}\n' +
      '{"subject":"alpha","value":1,"at":"2026-08-30T10:00:00+00:00"}\n',
  );
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "respelled-instant",
    factOwner: "source-owner",
    reader: { type: "jsonl", path: sourcePath },
    sourceRecord: {
      identity: [{ scope: "record", path: "subject" }],
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
    const collected = await collectConnection(store, parsed.config.id);
    assert.equal(collected.result.factsAdded, 1);
    assert.equal(store.countFacts(parsed.config.id), 1);

    // The stored spelling is the one the source used most recently.
    assert.deepEqual(
      store.queryObservations().map((fact) => fact.sourceRecordedAt),
      ["2026-08-30T10:00:00+00:00"],
    );

    // Verification agrees: the source expresses one observation, not two.
    const verification = await verifyConnection(
      store,
      store.getConnection(parsed.config.id),
    );
    assert.equal(verification.outcome, "agreement");
    assert.equal(verification.counts.matched, 1);
    assert.equal(verification.counts.sourceFacts, 1);
    assert.equal(verification.counts.storedFacts, 1);
  } finally {
    store.close();
  }
});

test("a JSON source that cannot be read is unreadable, not malformed", async () => {
  // Blaming the source for malformed content it never got to express is the
  // same lie this layer exists to prevent: an unread source must say so.
  const directory = workspace();
  const sourcePath = join(directory, "records.json");
  mkdirSync(sourcePath);
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "unreadable-json",
    factOwner: "source-owner",
    reader: { type: "json", pathPattern: sourcePath, recordsPath: "" },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
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
    store.register(parsed);
    await assert.rejects(collectConnection(store, parsed.config.id), {
      code: "source_unreadable",
    });
  } finally {
    store.close();
  }
});
