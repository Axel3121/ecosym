import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { parseConnectionConfig } from "../src/config.ts";
import { canonicalJson, type JsonScalar, sha256 } from "../src/json.ts";
import { defaultStateDirectory } from "../src/paths.ts";
import {
  CollectionFailedError,
  ConnectionConflictError,
  ObservationStore,
  type FactInput,
} from "../src/store.ts";

function connection(id = "source-a", factOwner = "owner-a") {
  return parseConnectionConfig(JSON.parse(parseConnectionConfigInput(id, factOwner)) as unknown);
}

function parseConnectionConfigInput(id: string, factOwner: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    id,
    factOwner,
    reader: { type: "jsonl", path: "/unused.jsonl" },
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
      {
        epistemicStatus: "claim",
        kind: "example.completion-report",
        subject: { scope: "record", path: "subject" },
        payload: { state: { scope: "record", path: "state" } },
      },
    ],
  });
}

function fact(overrides: Partial<FactInput> = {}): FactInput {
  return {
    epistemicStatus: "observation",
    factOwner: "owner-a",
    kind: "example.value",
    payload: { value: 7 },
    sourceRecordedAt: "2026-08-30T00:00:00.000Z",
    sourceRecordId: "record-a",
    subject: "subject-a",
    ...overrides,
  };
}

function temporaryStore(): { directory: string; store: ObservationStore } {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-"));
  return { directory, store: new ObservationStore(directory) };
}

test("uses the required XDG state location", () => {
  assert.equal(
    defaultStateDirectory({ XDG_DATA_HOME: "/var/data" }, "/home/example"),
    "/var/data/ecosym",
  );
  assert.equal(
    defaultStateDirectory({}, "/home/example"),
    "/home/example/.local/share/ecosym",
  );
  assert.throws(() => defaultStateDirectory({ XDG_DATA_HOME: "relative" }, "/home/example"));
});

test("creates a private durable store", () => {
  const { directory, store } = temporaryStore();
  try {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(store.path).mode & 0o777, 0o600);
    assert.ok(readFileSync(store.path).subarray(0, 15).equals(Buffer.from("SQLite format 3")));
  } finally {
    store.close();
  }
});

test("registers atomically and rejects a different configuration under the same id", () => {
  const { store } = temporaryStore();
  try {
    const first = connection();
    assert.equal(store.register(first, new Date("2026-08-30T00:00:00Z")), "connected");
    assert.equal(store.register(first, new Date("2026-08-30T00:01:00Z")), "unchanged");
    assert.throws(
      () => store.register(connection("source-a", "different-owner")),
      ConnectionConflictError,
    );
    assert.equal(store.getConnection("source-a").configHash, first.hash);
  } finally {
    store.close();
  }
});

test("two processes cannot interleave different configurations under one id", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-register-race-"));
  const gate = join(directory, "start");
  const worker = fileURLToPath(new URL("helpers/register-worker.ts", import.meta.url));
  const configurations = [
    parseConnectionConfigInput("shared-id", "owner-one"),
    parseConnectionConfigInput("shared-id", "owner-two"),
  ];
  const children = configurations.map((config) =>
    spawn(process.execPath, [worker, directory, gate, config], {
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  await Promise.all(children.map((child) => new Promise<void>((resolve) => child.once("spawn", resolve))));
  writeFileSync(gate, "start", { mode: 0o600 });
  const results = await Promise.all(
    children.map(
      (child) =>
        new Promise<{ hash: string; outcome: string }>((resolve, reject) => {
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
          });
          child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
          });
          child.once("error", reject);
          child.once("exit", (code) => {
            if (code !== 0) {
              reject(new Error(`register worker exited ${code}: ${stderr}`));
              return;
            }
            resolve(JSON.parse(stdout) as { hash: string; outcome: string });
          });
        }),
    ),
  );

  assert.deepEqual(
    results.map((result) => result.outcome).sort(),
    ["conflict", "connected"],
  );
  const winner = results.find((result) => result.outcome === "connected");
  const store = new ObservationStore(directory);
  try {
    assert.equal(store.getConnection("shared-id").configHash, winner?.hash);
  } finally {
    store.close();
  }
});

test("disconnecting removes configuration but preserves collected history", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [fact()]);
    });

    assert.equal(store.disconnect(parsed.config.id), true);
    assert.equal(store.listConnections().length, 0);
    assert.equal(store.queryObservations().length, 1);
  } finally {
    store.close();
  }
});

test("observation queries exclude claims and preserve late historical points", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [
        fact({ sourceRecordedAt: "2026-08-31T00:00:00.000Z", payload: { value: 12 } }),
        fact({ sourceRecordedAt: "2026-08-29T00:00:00.000Z", payload: { value: 7 } }),
        fact({
          epistemicStatus: "claim",
          kind: "example.completion-report",
          payload: { state: "completed" },
        }),
      ]);
    });

    const observations = store.queryObservations();
    assert.deepEqual(
      observations.map((record) => [record.payload, record.temporalStatus]),
      [
        [{ value: 12 }, "current"],
        [{ value: 7 }, "historical"],
      ],
    );
    assert.equal(store.queryClaims().length, 1);
  } finally {
    store.close();
  }
});

test("a failed collection rolls back all facts before recording unread status", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [fact()]);
        throw Object.assign(new Error("fixture failure"), { code: "source_malformed" });
      }),
      { code: "source_malformed" },
    );

    assert.equal(store.countFacts(), 0);
    assert.deepEqual(store.statuses(), [
      {
        connectionId: "source-a",
        lastAttemptAt: store.statuses()[0]?.lastAttemptAt ?? null,
        reason: "failed",
        status: "unread",
      },
    ]);
  } finally {
    store.close();
  }
});

test("facts carrying undeclared payload fields fail collection", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [
          fact({ payload: { value: 7, unselected_secret: "must-not-land" } }),
        ]);
      }),
    );
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("fact admission uses the persisted declaration rather than the caller copy", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    const callerFact = active.config.facts[0];
    assert.ok(callerFact);
    active.config.factOwner = "caller-owner";
    callerFact.kind = "caller.kind";

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [
          fact({ factOwner: "caller-owner", kind: "caller.kind" }),
        ]);
      }),
      CollectionFailedError,
    );
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("a null source record id fails collection instead of being ignored", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [
          fact({ sourceRecordId: null as unknown as string }),
        ]);
      }),
    );
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("non-string fact identities fail collection without persistence", async (t) => {
  for (const field of ["subject", "sourceRecordId", "factOwner", "kind"] as const) {
    await t.test(field, async () => {
      const { store } = temporaryStore();
      try {
        const parsed = connection();
        store.register(parsed);
        const active = store.getConnection(parsed.config.id);
        const malformed = fact();
        (malformed as unknown as Record<string, unknown>)[field] = 42;

        await assert.rejects(
          store.collect(active, (sink) => {
            sink.recordSourceRecord(() => [malformed]);
          }),
          CollectionFailedError,
        );
        assert.equal(store.countFacts(), 0);
      } finally {
        store.close();
      }
    });
  }
});

test("identity strings that SQLite cannot preserve fail collection", async (t) => {
  for (const [field, value] of [
    ["subject", "\ud800"],
    ["sourceRecordId", "\udfff"],
  ] as const) {
    await t.test(field, async () => {
      const { store } = temporaryStore();
      try {
        const parsed = connection();
        store.register(parsed);
        const active = store.getConnection(parsed.config.id);
        const malformed = fact();
        malformed[field] = value;

        await assert.rejects(
          store.collect(active, (sink) => {
            sink.recordSourceRecord(() => [malformed]);
          }),
          CollectionFailedError,
        );
        assert.equal(store.countFacts(), 0);
      } finally {
        store.close();
      }
    });
  }
});

test("source times must be canonical real UTC instants or null", async (t) => {
  for (const sourceRecordedAt of [
    "2026-02-30",
    "2026-08-30T12:00:00+02:00",
    "+010000-01-01T00:00:00.000Z",
    42,
  ] as const) {
    await t.test(String(sourceRecordedAt), async () => {
      const { store } = temporaryStore();
      try {
        const parsed = connection();
        store.register(parsed);
        const active = store.getConnection(parsed.config.id);

        await assert.rejects(
          store.collect(active, (sink) => {
            sink.recordSourceRecord(() => [
              fact({ sourceRecordedAt: sourceRecordedAt as unknown as string }),
            ]);
          }),
          CollectionFailedError,
        );
        assert.equal(store.countFacts(), 0);
      } finally {
        store.close();
      }
    });
  }

  await t.test("null", async () => {
    const { store } = temporaryStore();
    try {
      const parsed = connection();
      store.register(parsed);
      const active = store.getConnection(parsed.config.id);
      await store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [fact({ sourceRecordedAt: null })]);
      });
      assert.equal(store.queryObservations()[0]?.sourceRecordedAt, null);
    } finally {
      store.close();
    }
  });
});

test("payload scalars are persisted exactly or rejected", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [fact({ payload: { value: -0 } })]);
      }),
      CollectionFailedError,
    );
    assert.equal(store.countFacts(), 0);

    const values = [null, true, 7, "7", "\ud800"] as const;
    await store.collect(active, (sink) => {
      for (const [index, value] of values.entries()) {
        sink.recordSourceRecord(() => [
          fact({
            payload: { value },
            sourceRecordId: `record-${index}`,
            subject: `subject-${index}`,
          }),
        ]);
      }
    });
    const stored = store.queryObservations();
    assert.equal(stored.length, values.length);
    for (const [index, value] of values.entries()) {
      assert.ok(Object.is(stored[index]?.payload.value, value));
    }
  } finally {
    store.close();
  }
});

test("array payloads cannot discard declared named values", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    const payload: unknown[] = [];
    (payload as unknown as Record<string, unknown>).value = 7;

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [
          fact({ payload: payload as unknown as Record<string, JsonScalar> }),
        ]);
      }),
      CollectionFailedError,
    );
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("fact and payload accessors are read once before persistence", async (t) => {
  for (const scenario of [
    { field: "subject", first: "subject-a", second: "\ud800" },
    {
      field: "sourceRecordedAt",
      first: "2026-08-30T00:00:00.000Z",
      second: "2026-08-31T00:00:00.000Z",
    },
  ] as const) {
    await t.test(scenario.field, async () => {
      const { store } = temporaryStore();
      try {
        const parsed = connection();
        store.register(parsed);
        const active = store.getConnection(parsed.config.id);
        const input = fact();
        let reads = 0;
        Object.defineProperty(input, scenario.field, {
          enumerable: true,
          get: () => (reads++ === 0 ? scenario.first : scenario.second),
        });

        await store.collect(active, (sink) => {
          sink.recordSourceRecord(() => [input]);
        });
        const stored = store.queryObservations()[0];
        assert.ok(stored);
        assert.equal(reads, 1);
        assert.equal(stored[scenario.field], scenario.first);
      } finally {
        store.close();
      }
    });
  }

  await t.test("payload value", async () => {
    const { store } = temporaryStore();
    try {
      const parsed = connection();
      store.register(parsed);
      const active = store.getConnection(parsed.config.id);
      const input = fact();
      let reads = 0;
      Object.defineProperty(input.payload, "value", {
        enumerable: true,
        get: () => (reads++ === 0 ? 7 : -0),
      });

      await store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [input]);
      });
      const stored = store.queryObservations()[0];
      assert.ok(stored);
      assert.equal(reads, 1);
      assert.ok(Object.is(stored.payload.value, 7));
    } finally {
      store.close();
    }
  });
});

test("facts can only be written through a counted source record", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    const result = await store.collect(active, (sink) => {
      assert.equal("writeFact" in sink, false);
      sink.recordSourceRecord(() => [fact()]);
      sink.recordSourceRecord(() => []);
    });
    assert.equal(result.sourceRecordsSeen, 2);
    assert.equal(result.factsSeen, 1);
    assert.equal(result.factsAdded, 1);
    assert.equal(store.countFacts(), 1);
  } finally {
    store.close();
  }
});

test("a source record stays counted when producing its facts fails", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => {
          throw Object.assign(new Error("fixture mapping failure"), {
            code: "source_malformed",
          });
        });
      }),
      { code: "source_malformed" },
    );

    const inspected = new DatabaseSync(store.path, { readOnly: true });
    try {
      const attempt = inspected
        .prepare(
          `SELECT outcome, source_records_seen, facts_seen, facts_added
             FROM collection_attempts
            ORDER BY attempt_order DESC
            LIMIT 1`,
        )
        .get() as {
        facts_added: number;
        facts_seen: number;
        outcome: string;
        source_records_seen: number;
      };
      assert.deepEqual({ ...attempt }, {
        facts_added: 0,
        facts_seen: 0,
        outcome: "failed",
        source_records_seen: 1,
      });
    } finally {
      inspected.close();
    }
  } finally {
    store.close();
  }
});

test("a successful empty repeat is quiet rather than unread", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [fact()]);
    });
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [fact()]);
    });

    assert.equal(store.statuses()[0]?.status, "quiet");
    assert.equal(store.countFacts(), 1);
  } finally {
    store.close();
  }
});

test("a skipped attempt is unread", () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    store.recordSkipped(store.getConnection(parsed.config.id), "already_collecting");

    assert.equal(store.statuses()[0]?.status, "unread");
    assert.equal(store.statuses()[0]?.reason, "skipped");
  } finally {
    store.close();
  }
});

test("disconnect during source reading prevents the stale revision from writing", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  let announceStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    announceStarted = resolve;
  });
  let allowFinish: (() => void) | undefined;
  const finish = new Promise<void>((resolve) => {
    allowFinish = resolve;
  });
  const collection = store.collect(active, async (sink) => {
    announceStarted?.();
    await finish;
    sink.recordSourceRecord(() => [fact()]);
  });
  await started;

  const otherProcess = new ObservationStore(directory);
  try {
    assert.equal(otherProcess.statuses()[0]?.status, "unread");
    assert.equal(otherProcess.statuses()[0]?.reason, "incomplete");
    assert.equal(otherProcess.disconnect(parsed.config.id), true);
    assert.equal(otherProcess.register(parsed), "connected");
  } finally {
    otherProcess.close();
  }
  allowFinish?.();

  try {
    await assert.rejects(collection, { code: "connection_inactive" });
    assert.equal(store.countFacts(), 0);
    assert.equal(store.statuses()[0]?.status, "unread");
    assert.equal(store.statuses()[0]?.reason, "never-run");
  } finally {
    store.close();
  }
});

test("process termination leaves a durable incomplete attempt and no partial facts", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  store.close();
  const worker = fileURLToPath(
    new URL("helpers/interrupted-collection-worker.ts", import.meta.url),
  );
  const child = spawn(process.execPath, [worker, directory, parsed.config.id], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.stdout.once("data", (chunk: string) => {
      if (chunk === "ready\n") {
        resolve();
      } else {
        reject(new Error("interrupted collection worker emitted unexpected output"));
      }
    });
  });
  child.kill("SIGKILL");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));

  const reopened = new ObservationStore(directory);
  try {
    assert.equal(reopened.countFacts(), 0);
    assert.equal(reopened.statuses()[0]?.status, "unread");
    assert.equal(reopened.statuses()[0]?.reason, "incomplete");
    assert.notEqual(reopened.statuses()[0]?.lastAttemptAt, null);
  } finally {
    reopened.close();
  }
});

test("version-one correction history stays unknown until it is observed again", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-v1-store-"));
  const parsed = connection();
  const path = join(directory, "observations.sqlite");
  const oldStore = new DatabaseSync(path);
  oldStore.exec(`
    CREATE TABLE connection_versions (
      connection_id TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,
      registered_at TEXT NOT NULL,
      PRIMARY KEY (connection_id, config_hash)
    ) STRICT;
    CREATE TABLE active_connections (
      connection_id TEXT PRIMARY KEY,
      config_hash TEXT NOT NULL,
      connected_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE collection_attempts (
      attempt_id TEXT PRIMARY KEY,
      connection_id TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      outcome TEXT NOT NULL,
      source_records_seen INTEGER NOT NULL,
      facts_seen INTEGER NOT NULL,
      facts_added INTEGER NOT NULL,
      failure_code TEXT
    ) STRICT;
    CREATE INDEX collection_attempts_latest
      ON collection_attempts(connection_id, config_hash, started_at DESC);
    CREATE TABLE facts (
      fact_id INTEGER PRIMARY KEY,
      connection_id TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      attempt_id TEXT NOT NULL,
      fact_owner TEXT NOT NULL,
      kind TEXT NOT NULL,
      subject TEXT NOT NULL,
      epistemic_status TEXT NOT NULL,
      source_record_id TEXT NOT NULL,
      source_recorded_at TEXT,
      source_time_key TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      UNIQUE (
        connection_id, config_hash, fact_owner, kind, subject,
        epistemic_status, source_record_id, source_time_key, payload_hash
      )
    ) STRICT;
    PRAGMA user_version = 1;
  `);
  oldStore
    .prepare("INSERT INTO connection_versions VALUES (?, ?, ?, ?)")
    .run(parsed.config.id, parsed.hash, parsed.canonical, "2026-08-30T00:00:00.000Z");
  oldStore
    .prepare("INSERT INTO active_connections VALUES (?, ?, ?)")
    .run(parsed.config.id, parsed.hash, "2026-08-30T00:00:00.000Z");
  const insertAttempt = oldStore.prepare(
    "INSERT INTO collection_attempts VALUES (?, ?, ?, ?, ?, 'success', 1, 1, ?, NULL)",
  );
  insertAttempt.run("attempt-1", parsed.config.id, parsed.hash, "2026-08-30T00:00:00.000Z", "2026-08-30T00:00:01.000Z", 1);
  insertAttempt.run("attempt-2", parsed.config.id, parsed.hash, "2026-08-30T00:01:00.000Z", "2026-08-30T00:01:01.000Z", 1);
  insertAttempt.run("attempt-3", parsed.config.id, parsed.hash, "2026-08-30T00:02:00.000Z", "2026-08-30T00:02:01.000Z", 0);
  const insertFact = oldStore.prepare(
    `INSERT INTO facts
       (connection_id, config_hash, attempt_id, fact_owner, kind, subject,
        epistemic_status, source_record_id, source_recorded_at, source_time_key,
        payload_json, payload_hash, collected_at)
     VALUES (?, ?, ?, ?, ?, ?, 'observation', ?, ?, ?, ?, ?, ?)`,
  );
  for (const [attemptId, value, collectedAt] of [
    ["attempt-1", 7, "2026-08-30T00:00:00.000Z"],
    ["attempt-2", 12, "2026-08-30T00:01:00.000Z"],
  ] as const) {
    const payload = canonicalJson({ value });
    insertFact.run(
      parsed.config.id,
      parsed.hash,
      attemptId,
      "owner-a",
      "example.value",
      "subject-a",
      "record-a",
      "2026-08-30T00:00:00.000Z",
      "2026-08-30T00:00:00.000Z",
      payload,
      sha256(payload),
      collectedAt,
    );
  }
  oldStore.close();

  const migrated = new ObservationStore(directory);
  try {
    assert.equal(migrated.statuses()[0]?.reason, "never-run");
    assert.deepEqual(
      migrated.queryObservations().map((record) => record.temporalStatus),
      ["unknown", "unknown"],
    );
    assert.equal(
      migrated.factsForVerification(migrated.getConnection(parsed.config.id)).currentnessKnown,
      false,
    );
    await migrated.collect(migrated.getConnection(parsed.config.id), (sink) => {
      sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
    });
    assert.deepEqual(
      migrated.queryObservations().map((record) => [record.payload.value, record.temporalStatus]),
      [
        [7, "current"],
        [12, "historical"],
      ],
    );
  } finally {
    migrated.close();
  }
});

test("an older concurrent attempt cannot regress a later reversion", async () => {
  const { store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
  });

  let announceBuffered: (() => void) | undefined;
  const buffered = new Promise<void>((resolve) => {
    announceBuffered = resolve;
  });
  let allowCommit: (() => void) | undefined;
  const commit = new Promise<void>((resolve) => {
    allowCommit = resolve;
  });
  const older = store.collect(active, async (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
    announceBuffered?.();
    await commit;
  });
  await buffered;
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 12 } })]);
  });
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
  });
  allowCommit?.();
  await older;

  try {
    assert.deepEqual(
      store.queryObservations().map((record) => [record.payload.value, record.temporalStatus]),
      [
        [7, "current"],
        [12, "historical"],
      ],
    );
  } finally {
    store.close();
  }
});

test("store contention waits until a failed attempt can be recorded", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-contention-"));
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  await store.collect(active, () => undefined);

  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  const attempted = assert.rejects(
    store.collect(active, () => {
      throw Object.assign(new Error("synthetic source failure"), {
        code: "source_unreadable",
      });
    }),
    { code: "source_unreadable" },
  );
  await delay(75);
  blocker.exec("ROLLBACK");
  blocker.close();

  try {
    await attempted;
    assert.equal(store.statuses()[0]?.status, "unread");
    assert.equal(store.statuses()[0]?.reason, "failed");
  } finally {
    store.close();
  }
});

test("collection time starts after store-contention admission", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-collection-time-"));
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  const collected = store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact()]);
  });
  await delay(75);
  blocker.exec("ROLLBACK");
  const admittedAfter = Date.now();
  blocker.close();

  try {
    await collected;
    const observation = store.queryObservations()[0];
    assert.ok(observation);
    assert.ok(Date.parse(observation.collectedAt) >= admittedAfter);
  } finally {
    store.close();
  }
});

test("corrections remain ordered across configuration revisions", async () => {
  const { store } = temporaryStore();
  const first = connection();
  store.register(first);
  await store.collect(store.getConnection(first.config.id), (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
  });
  store.disconnect(first.config.id);
  const secondInput = JSON.parse(
    parseConnectionConfigInput(first.config.id, first.config.factOwner),
  ) as { reader: { path: string } };
  secondInput.reader.path = "/different-source.jsonl";
  const second = parseConnectionConfig(secondInput);
  store.register(second);
  await store.collect(store.getConnection(second.config.id), (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 12 } })]);
  });

  try {
    assert.deepEqual(
      store.queryObservations().map((record) => [record.payload.value, record.temporalStatus]),
      [
        [7, "historical"],
        [12, "current"],
      ],
    );
  } finally {
    store.close();
  }
});

test("correction state stays isolated between connection ids", async () => {
  const { store } = temporaryStore();
  const first = connection("source-a", "shared-owner");
  const second = connection("source-b", "shared-owner");
  store.register(first);
  store.register(second);
  const sharedFact = (value: number): FactInput =>
    fact({ factOwner: "shared-owner", payload: { value } });
  await store.collect(store.getConnection(first.config.id), (sink) => {
    sink.recordSourceRecord(() => [sharedFact(7)]);
  });
  await store.collect(store.getConnection(second.config.id), (sink) => {
    sink.recordSourceRecord(() => [sharedFact(12)]);
  });

  try {
    assert.deepEqual(
      store.queryObservations().map((record) => [record.payload.value, record.temporalStatus]),
      [
        [7, "current"],
        [12, "current"],
      ],
    );
  } finally {
    store.close();
  }
});

test("source-time ordering stays isolated between connection ids", async () => {
  const { store } = temporaryStore();
  const first = connection("source-a", "shared-owner");
  const second = connection("source-b", "shared-owner");
  store.register(first);
  store.register(second);
  await store.collect(store.getConnection(first.config.id), (sink) => {
    sink.recordSourceRecord(() => [
      fact({
        factOwner: "shared-owner",
        sourceRecordedAt: "2026-08-30T00:00:00.000Z",
      }),
    ]);
  });
  await store.collect(store.getConnection(second.config.id), (sink) => {
    sink.recordSourceRecord(() => [
      fact({
        factOwner: "shared-owner",
        sourceRecordedAt: "2026-08-31T00:00:00.000Z",
      }),
    ]);
  });

  try {
    assert.equal(
      store.queryObservations({ connectionId: first.config.id })[0]?.temporalStatus,
      "current",
    );
    assert.equal(
      store.queryObservations({ connectionId: second.config.id })[0]?.temporalStatus,
      "current",
    );
  } finally {
    store.close();
  }
});

test("version-three reversions migrate without claiming a current attempt status", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
  });
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 12 } })]);
  });
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [fact({ payload: { value: 7 } })]);
  });
  const path = store.path;
  store.close();

  const oldStore = new DatabaseSync(path);
  oldStore.exec(`
    DROP INDEX facts_correction_slot;
    ALTER TABLE collection_attempts DROP COLUMN facts_changed;
    PRAGMA user_version = 3;
  `);
  oldStore.close();

  const migrated = new ObservationStore(directory);
  assert.equal(migrated.statuses()[0]?.reason, "never-run");
  migrated.close();
  const inspected = new DatabaseSync(path, { readOnly: true });
  try {
    const latest = inspected
      .prepare(
        "SELECT facts_added, facts_changed FROM collection_attempts ORDER BY attempt_order DESC LIMIT 1",
      )
      .get() as { facts_added: number; facts_changed: number };
    assert.equal(latest.facts_added, 0);
    assert.equal(latest.facts_changed, 1);
  } finally {
    inspected.close();
  }
});
