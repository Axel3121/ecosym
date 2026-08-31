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
    const [status] = store.statuses();
    assert.deepEqual(
      { ...status, lastAttemptAt: undefined },
      {
        connectionId: "source-a",
        lastAttemptAt: undefined,
        reason: "failed",
        status: "unread",
      },
    );
    // Reading the expectation from the method under test would compare the
    // field to itself and pass for any value, including null. A failed attempt
    // is still an attempt, so it must carry a time.
    assert.notEqual(status?.lastAttemptAt, null);
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

test("non-string source identities fail collection without persistence", async (t) => {
  for (const field of ["subject", "sourceRecordId"] as const) {
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

test("the persisted declaration enforces fact owner and kind strings", async (t) => {
  for (const field of ["factOwner", "kind"] as const) {
    await t.test(field, async () => {
      const { store } = temporaryStore();
      try {
        const parsed = connection();
        store.register(parsed);
        const active = store.getConnection(parsed.config.id);
        // Forge a well-formed string, not a malformed value. A non-string is
        // refused by the identity check alone, which would let this test pass
        // even if admission consulted the caller's mutable copy instead of the
        // declaration the connection was registered with.
        const forged = "forged-but-well-formed";
        const malformed = fact();
        (malformed as unknown as Record<string, unknown>)[field] = forged;
        if (field === "factOwner") {
          (active.config as unknown as Record<string, unknown>).factOwner = forged;
        } else {
          const callerFact = active.config.facts[0];
          assert.ok(callerFact);
          (callerFact as unknown as Record<string, unknown>).kind = forged;
        }

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

test("source times must be representable real UTC instants or null", async (t) => {
  for (const sourceRecordedAt of [
    "2026-02-30",
    "2026-08-30T12:00:00+02:00",
    "2026-08-30T10:00:00.1234Z",
    "2016-12-31T23:59:60Z",
    "2026-08-30T24:01:00Z",
    "2026-08-30T24:00:01Z",
    "2026-08-30T24:00:00.001Z",
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

test("representable UTC spellings persist without being rewritten", async () => {
  const { store } = temporaryStore();
  const spellings = [
    "2026-08-30T10:00:00Z",
    "2026-08-30T10:00:00.5Z",
    "2026-08-30T10:00:00.25Z",
    "2026-08-30T10:00:00.000Z",
    "2026-08-30T10:00:00+00:00",
    "2026-08-30T10:00:00.5+00:00",
    "2026-08-30T24:00:00Z",
  ];
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      for (const [index, sourceRecordedAt] of spellings.entries()) {
        sink.recordSourceRecord(() => [
          fact({
            sourceRecordedAt,
            sourceRecordId: `record-${index}`,
            subject: `subject-${index}`,
          }),
        ]);
      }
    });

    const stored = store.queryObservations().map((record) => record.sourceRecordedAt);
    assert.deepEqual(stored, spellings);
    for (const [index, sourceRecordedAt] of spellings.entries()) {
      assert.equal(Date.parse(stored[index] ?? ""), Date.parse(sourceRecordedAt));
    }

    // Read the database directly. Comparing through the query API cannot show
    // a value rewritten on the way in if the same code normalises on the way
    // out; only the stored bytes can.
    const database = new DatabaseSync(store.path, { readOnly: true });
    try {
      const persisted = (
        database
          .prepare("select source_recorded_at from facts order by source_record_id")
          .all() as { source_recorded_at: string }[]
      ).map((row) => row.source_recorded_at);
      assert.deepEqual(persisted, spellings);
    } finally {
      database.close();
    }
  } finally {
    store.close();
  }
});

test("a repeated instant retains the latest supplied spelling", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [
        fact({ sourceRecordedAt: "2026-08-30T10:00:00.000Z" }),
      ]);
    });
    const repeated = await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [
        fact({ sourceRecordedAt: "2026-08-30T10:00:00Z" }),
      ]);
    });

    assert.equal(repeated.factsAdded, 0);
    assert.equal(store.countFacts(), 1);
    assert.equal(
      store.queryObservations()[0]?.sourceRecordedAt,
      "2026-08-30T10:00:00Z",
    );
    const inspected = new DatabaseSync(store.path, { readOnly: true });
    try {
      const provenance = inspected
        .prepare(
          `SELECT a.attempt_order, f.collected_at, a.started_at
             FROM facts f
             JOIN collection_attempts a ON a.attempt_id = f.attempt_id`,
        )
        .get() as {
        attempt_order: number;
        collected_at: string;
        started_at: string;
      };
      assert.equal(provenance.attempt_order, 2);
      assert.equal(provenance.collected_at, provenance.started_at);
    } finally {
      inspected.close();
    }
  } finally {
    store.close();
  }
});

test("an older concurrent repeat cannot restore an earlier spelling", async () => {
  const { store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  let announceBuffered: (() => void) | undefined;
  const buffered = new Promise<void>((resolve) => {
    announceBuffered = resolve;
  });
  let allowCommit: (() => void) | undefined;
  const commit = new Promise<void>((resolve) => {
    allowCommit = resolve;
  });
  const older = store.collect(active, async (sink) => {
    sink.recordSourceRecord(() => [
      fact({ sourceRecordedAt: "2026-08-30T10:00:00.000Z" }),
    ]);
    announceBuffered?.();
    await commit;
  });
  await buffered;
  await store.collect(active, (sink) => {
    sink.recordSourceRecord(() => [
      fact({ sourceRecordedAt: "2026-08-30T10:00:00Z" }),
    ]);
  });
  allowCommit?.();
  await older;

  try {
    assert.equal(store.queryObservations()[0]?.sourceRecordedAt, "2026-08-30T10:00:00Z");
    const inspected = new DatabaseSync(store.path, { readOnly: true });
    try {
      const provenance = inspected
        .prepare(
          `SELECT a.attempt_order
             FROM facts f
             JOIN collection_attempts a ON a.attempt_id = f.attempt_id`,
        )
        .get() as { attempt_order: number };
      assert.equal(provenance.attempt_order, 2);
    } finally {
      inspected.close();
    }
  } finally {
    store.close();
  }
});

test("a fractional second is later than the whole second it follows", async () => {
  // Two rows whose text order and instant order disagree: "10:00:00.5Z" sorts
  // before "10:00:00Z" as text, and after it in time. The wider ordering test
  // ends at a later whole second, which masks a regression to text comparison.
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      for (const [index, sourceRecordedAt] of [
        "2026-08-30T10:00:00Z",
        "2026-08-30T10:00:00.5Z",
      ].entries()) {
        sink.recordSourceRecord(() => [
          fact({ sourceRecordedAt, sourceRecordId: `record-${index}` }),
        ]);
      }
    });

    const current = store
      .queryObservations()
      .filter((record) => record.temporalStatus === "current");
    assert.equal(current.length, 1);
    assert.equal(current[0]?.sourceRecordedAt, "2026-08-30T10:00:00.5Z");
  } finally {
    store.close();
  }
});

test("mixed UTC spellings use chronological ordering keys", async (t) => {
  const { store } = temporaryStore();
  const spellings = [
    "2026-08-30T10:00:01Z",
    "2026-08-30T10:00:00.5Z",
    "2026-08-30T09:59:59.999Z",
    "2026-08-30T10:00:00.25+00:00",
    "2026-08-30T10:00:00Z",
  ];
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      for (const [index, sourceRecordedAt] of spellings.entries()) {
        sink.recordSourceRecord(() => [
          fact({ sourceRecordedAt, sourceRecordId: `record-${index}` }),
        ]);
      }
    });

    const inspected = new DatabaseSync(store.path, { readOnly: true });
    try {
      const ordered = inspected
        .prepare(
          `SELECT source_recorded_at AS supplied, source_time_key AS ordering_key
             FROM facts
            ORDER BY source_time_key, fact_id`,
        )
        .all()
        .map((row) => ({ ...(row as Record<string, unknown>) }));
      t.diagnostic(`stored UTC order: ${JSON.stringify(ordered)}`);
      assert.deepEqual(ordered, [
        {
          supplied: "2026-08-30T09:59:59.999Z",
          ordering_key: "2026-08-30T09:59:59.999Z",
        },
        {
          supplied: "2026-08-30T10:00:00Z",
          ordering_key: "2026-08-30T10:00:00.000Z",
        },
        {
          supplied: "2026-08-30T10:00:00.25+00:00",
          ordering_key: "2026-08-30T10:00:00.250Z",
        },
        {
          supplied: "2026-08-30T10:00:00.5Z",
          ordering_key: "2026-08-30T10:00:00.500Z",
        },
        {
          supplied: "2026-08-30T10:00:01Z",
          ordering_key: "2026-08-30T10:00:01.000Z",
        },
      ]);
    } finally {
      inspected.close();
    }
    assert.deepEqual(
      store
        .queryObservations()
        .map((record) => [record.sourceRecordedAt, record.temporalStatus]),
      [
        ["2026-08-30T10:00:01Z", "current"],
        ["2026-08-30T10:00:00.5Z", "historical"],
        ["2026-08-30T09:59:59.999Z", "historical"],
        ["2026-08-30T10:00:00.25+00:00", "historical"],
        ["2026-08-30T10:00:00Z", "historical"],
      ],
    );
  } finally {
    store.close();
  }
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

    const orphaned = await store.collect(active, (sink) => {
      assert.equal("writeFact" in sink, false);
    });
    assert.equal(orphaned.sourceRecordsSeen, 0);
    assert.equal(orphaned.factsSeen, 0);
    assert.equal(orphaned.factsAdded, 0);
    assert.equal(store.countFacts(), 0);

    const result = await store.collect(active, (sink) => {
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

test("failure-marker contention retries within the collection budget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-failure-marker-contention-"));
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  const attempted = store.collect(active, () => {
    blocker.exec("BEGIN IMMEDIATE");
    throw Object.assign(new Error("synthetic source failure"), {
      code: "source_unreadable",
    });
  });
  const rejected = assert.rejects(attempted, { code: "source_unreadable" });
  await delay(75);
  blocker.exec("ROLLBACK");
  blocker.close();

  try {
    await rejected;
    assert.equal(store.statuses()[0]?.status, "unread");
    assert.equal(store.statuses()[0]?.reason, "failed");
  } finally {
    store.close();
  }
});

test("post-admission contention has one bounded machine-readable failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-completion-contention-"));
  const store = new ObservationStore(directory);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  const startedAt = Date.now();
  const collection = store.collect(active, () => {
    blocker.exec("BEGIN IMMEDIATE");
  });
  const outcome = await Promise.race([
    collection.then(
      () => "success",
      (error: unknown) =>
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unclassified_failure",
    ),
    delay(750).then(() => "deadline"),
  ]);
  const elapsedMilliseconds = Date.now() - startedAt;
  blocker.exec("ROLLBACK");
  blocker.close();
  await collection.catch(() => undefined);

  try {
    assert.equal(outcome, "store_contention");
    assert.ok(elapsedMilliseconds < 350);
    assert.equal(store.statuses()[0]?.reason, "incomplete");
  } finally {
    store.close();
  }
});

test("admission and completion consume one contention budget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-shared-contention-budget-"));
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  const startedAt = Date.now();
  const collection = store.collect(active, () => {
    blocker.exec("BEGIN IMMEDIATE");
  });
  const outcome = collection.then(
    () => "success",
    (error: unknown) =>
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unclassified_failure",
  );
  await delay(75);
  blocker.exec("ROLLBACK");
  const result = await Promise.race([outcome, delay(750).then(() => "deadline")]);
  const elapsedMilliseconds = Date.now() - startedAt;
  if (blocker.isTransaction) {
    blocker.exec("ROLLBACK");
  }
  blocker.close();
  await collection.catch(() => undefined);

  try {
    assert.equal(result, "store_contention");
    assert.ok(elapsedMilliseconds < 300);
    assert.equal(store.statuses()[0]?.reason, "incomplete");
  } finally {
    store.close();
  }
});

test("store contention returns a bounded machine-readable failure", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-contention-bound-"));
  const store = new ObservationStore(directory);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  const startedAt = Date.now();
  const collection = store.collect(active, () => undefined);
  const outcome = await Promise.race([
    collection.then(
      () => "success",
      (error: unknown) =>
        error !== null && typeof error === "object" && "code" in error
          ? String(error.code)
          : "unclassified_failure",
    ),
    delay(750).then(() => "deadline"),
  ]);
  const elapsedMilliseconds = Date.now() - startedAt;
  blocker.exec("ROLLBACK");
  blocker.close();
  await collection.catch(() => undefined);

  try {
    assert.equal(outcome, "store_contention");
    assert.ok(elapsedMilliseconds < 350);
  } finally {
    store.close();
  }
});

test("a configured SQLite timeout cannot outlive the contention window", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-timeout-bound-"));
  assert.throws(() => new ObservationStore(directory, 251), RangeError);
});

test("configured SQLite waits share one contention window", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-timeout-total-"));
  const store = new ObservationStore(directory, 200);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  const startedAt = Date.now();

  try {
    await assert.rejects(store.collect(active, () => undefined), {
      code: "store_contention",
    });
    assert.ok(Date.now() - startedAt < 350);
  } finally {
    blocker.exec("ROLLBACK");
    blocker.close();
    store.close();
  }
});

test("extended SQLite busy snapshots retain the contention failure code", async () => {
  const { store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function (sql: string): void {
    if (sql === "BEGIN IMMEDIATE") {
      throw Object.assign(new Error("database is locked"), {
        code: "ERR_SQLITE_ERROR",
        errcode: 517,
        errstr: "database is locked",
      });
    }
    exec.call(this, sql);
  };

  try {
    await assert.rejects(store.collect(active, () => undefined), {
      code: "store_contention",
    });
  } finally {
    DatabaseSync.prototype.exec = exec;
    store.close();
  }
});

test("historical ordering uses an index for identity and source time", (t) => {
  const { store } = temporaryStore();
  const database = new DatabaseSync(store.path, { readOnly: true });
  try {
    const plan = database
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT f.fact_id
           FROM facts f
          WHERE EXISTS (
            SELECT 1
              FROM facts newer
             WHERE newer.connection_id = f.connection_id
               AND newer.fact_owner = f.fact_owner
               AND newer.kind = f.kind
               AND newer.subject = f.subject
               AND newer.epistemic_status = f.epistemic_status
               AND newer.source_time_key > f.source_time_key
          )`,
      )
      .all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    t.diagnostic(`historical ordering plan: ${JSON.stringify(plan)}`);
    const search = plan.find(
      (step) => typeof step.detail === "string" && step.detail.includes("SEARCH newer"),
    );
    assert.ok(search);
    const detail = String(search.detail);
    for (const column of [
      "connection_id",
      "fact_owner",
      "kind",
      "subject",
      "epistemic_status",
    ]) {
      assert.match(detail, new RegExp(`${column}=\\?`));
    }
    assert.match(detail, /source_time_key>\?/);
  } finally {
    database.close();
    store.close();
  }
});

test("the ordering-index migration does not rewrite version-five facts", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  await store.collect(store.getConnection(parsed.config.id), (sink) => {
    sink.recordSourceRecord(() => [fact()]);
  });
  store.close();

  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  const before = downgraded
    .prepare("SELECT * FROM facts ORDER BY fact_id")
    .all()
    .map((row) => ({ ...(row as Record<string, unknown>) }));
  downgraded.exec(`
    DROP INDEX facts_identity_source_time;
    ALTER TABLE connection_versions DROP COLUMN jsonl_record_index_mode;
    PRAGMA user_version = 5;
  `);
  downgraded.close();

  const migrated = new ObservationStore(directory);
  migrated.close();
  const inspected = new DatabaseSync(join(directory, "observations.sqlite"), {
    readOnly: true,
  });
  try {
    const after = inspected
      .prepare("SELECT * FROM facts ORDER BY fact_id")
      .all()
      .map((row) => ({ ...(row as Record<string, unknown>) }));
    assert.deepEqual(after, before);
    const version = inspected.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(version.user_version, 8);
    const columns = (
      inspected.prepare("PRAGMA index_info(facts_identity_source_time)").all() as {
        name: string;
      }[]
    ).map((column) => column.name);
    assert.deepEqual(columns, [
      "connection_id",
      "fact_owner",
      "kind",
      "subject",
      "epistemic_status",
      "source_time_key",
    ]);
  } finally {
    inspected.close();
  }
});

test("the unpublished schema-seven migration is refused rather than trusted", () => {
  const { directory, store } = temporaryStore();
  store.close();
  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  downgraded.exec("PRAGMA user_version = 7");
  downgraded.close();

  assert.throws(
    () => new ObservationStore(directory),
    /schema 7 does not record a trustworthy JSONL record-index mode/,
  );
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
    DROP INDEX facts_identity_source_time;
    ALTER TABLE connection_versions DROP COLUMN jsonl_record_index_mode;
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
