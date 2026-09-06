import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import { parseConnectionConfig } from "../src/config.ts";
import { canonicalJson, type JsonScalar, sha256 } from "../src/json.ts";
import { defaultStateDirectory } from "../src/paths.ts";
import {
  CollectionFailedError,
  ConnectionConflictError,
  createCollectionContentionBudget,
  isSqliteContentionError,
  ObservationStore,
  type EpistemicStatus,
  type FactInput,
} from "../src/store.ts";

function contendOnVirtualClock(configuredMilliseconds: number) {
  const exec = DatabaseSync.prototype.exec;
  const realNow = performance.now.bind(performance);
  const grantedWaits: number[] = [];
  let inForceMilliseconds = configuredMilliseconds;
  let virtualNow = 0;
  let contending = false;

  performance.now = () => virtualNow;
  DatabaseSync.prototype.exec = function (sql: string): void {
    const pragma = /^PRAGMA busy_timeout = (\d+)$/.exec(sql);
    if (pragma !== null) {
      inForceMilliseconds = Number(pragma[1]);
      exec.call(this, sql);
      return;
    }
    if (!contending || sql !== "BEGIN IMMEDIATE") {
      exec.call(this, sql);
      return;
    }
    if (grantedWaits.length >= 32) {
      throw new Error("The contention retry loop did not converge within 32 waits");
    }
    grantedWaits.push(inForceMilliseconds);
    virtualNow += inForceMilliseconds;
    throw Object.assign(new Error("database is locked"), {
      code: "ERR_SQLITE_ERROR",
      errcode: 517,
      errstr: "database is locked",
    });
  };

  return {
    beginContending: () => {
      contending = true;
    },
    grantedWaits,
    inForceMilliseconds: () => inForceMilliseconds,
    restore: () => {
      DatabaseSync.prototype.exec = exec;
      performance.now = realNow;
    },
  };
}

const contentionWindowMilliseconds =
  createCollectionContentionBudget().remainingMilliseconds;

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

function allEpistemicStatuses<const Statuses extends readonly EpistemicStatus[]>(
  statuses: Statuses & ([EpistemicStatus] extends [Statuses[number]] ? unknown : never),
): Statuses {
  return statuses;
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

test("every epistemic status round-trips through the store", async () => {
  const epistemicStatuses = allEpistemicStatuses(["observation", "claim"]);
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      for (const epistemicStatus of epistemicStatuses) {
        sink.recordSourceRecord(() => [
          epistemicStatus === "observation"
            ? fact({ epistemicStatus })
            : fact({
                epistemicStatus,
                kind: "example.completion-report",
                payload: { state: "completed" },
              }),
        ]);
      }
    });

    const storedStatuses = [...store.queryObservations(), ...store.queryClaims()].map(
      (stored) => stored.epistemicStatus,
    );
    assert.deepEqual(storedStatuses.sort(), [...epistemicStatuses].sort());
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
        connectionVersion: parsed.hash,
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
      (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
    );
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

// Caller-supplied producer errors can carry source paths and source text, so the
// failure contract exposes only the machine code.
test("a wrapped collection failure carries a code and no chained exception detail", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    const sentinel = "ECOSYM_SENTINEL_VALUE";
    let collectionError: unknown;

    await assert.rejects(
      store.collect(active, (_sink) => {
        throw Object.assign(new Error(`row 3: ${sentinel}`), {
          code: "source_unreadable",
          path: `/home/example/${sentinel}.csv`,
        });
      }),
      (error: unknown) => {
        collectionError = error;
        return error instanceof CollectionFailedError;
      },
    );
    assert.ok(collectionError instanceof CollectionFailedError);
    assert.equal(collectionError.code, "source_unreadable");
    assert.equal(Object.hasOwn(collectionError, "cause"), false);
    assert.equal(collectionError.message, "Collection failed");
    assert.equal(inspect(collectionError, { depth: null }).includes(sentinel), false);
    assert.equal(JSON.stringify(collectionError).includes(sentinel), false);
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
          (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
        );
        assert.equal(store.countFacts(), 0);
      } finally {
        store.close();
      }
    });
  }
});

test("owner and kind forged into the caller copy are still not declared", async (t) => {
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
          (error: any) => error instanceof CollectionFailedError && error.code === "fact_not_declared",
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
    ["subject", "\uD800"],
    ["sourceRecordId", "\uDC00"],
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
          (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
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
          (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
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
      (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
    );
    assert.equal(store.countFacts(), 0);

    const values = [null, true, 7, "7", "\uD800"] as const;
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

test("identity fields are rejected unless they are lossless strings", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    const bad = (overrides: Partial<FactInput>) =>
      fact({ ...overrides, payload: { value: 7 } });

    const cases = [
      { name: "subject as number", input: bad({ subject: 99 as any }) },
      { name: "sourceRecordId as number", input: bad({ sourceRecordId: 42 as any }) },
      { name: "factOwner as number", input: bad({ factOwner: 7 as any }) },
      { name: "kind as number", input: bad({ kind: 7 as any }) },
      { name: "epistemicStatus as number", input: bad({ epistemicStatus: 7 as any }) },
    ] as const;
    for (const { name, input } of cases) {
      await assert.rejects(
        store.collect(active, (sink) => {
          sink.recordSourceRecord(() => [input]);
        }),
        (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
      );
      assert.equal(store.countFacts(), 0);
    }
  } finally {
    store.close();
  }
});

test("an epistemic status outside the enum is rejected before the declaration check", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    const rejected = [
      "rumour", // Guard deletion or widening.
      "Claim", // Case normalization.
      "claimed", // startsWith/includes matching.
      "", // Truthiness; the empty string passes the lossless-string check.
    ] as const;
    for (const status of rejected) {
      const context = `epistemicStatus ${JSON.stringify(status)}`;
      await assert.rejects(
        store.collect(active, (sink) => {
          sink.recordSourceRecord(() => [fact({ epistemicStatus: status as any })]);
        }),
        (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
        context,
      );
      assert.equal(store.countFacts(), 0, context);
    }

    // The distinct code proves declaration validation, not the enum guard, rejected this fact.
    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [fact({ epistemicStatus: "claim" })]);
      }),
      (error: any) => error instanceof CollectionFailedError && error.code === "fact_not_declared",
    );
    assert.equal(store.countFacts(), 0);
  } finally {
    store.close();
  }
});

test("identity fields are rejected when they contain unpaired surrogates", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [
          fact({ subject: "\uD800" as any, sourceRecordId: "\uDC00" as any }),
        ]);
      }),
      (error: any) => error instanceof CollectionFailedError && error.code === "fact_rejected",
    );
    assert.equal(store.countFacts(), 0);
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

test("facts can only be written through a counted source record, even after a failed attempt", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    // Without a prior attempt that prepared a fact, countFacts cannot fail for
    // any implementation of the source-record gating path.
    await assert.rejects(
      store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [fact()]);
        throw Object.assign(new Error("fixture failure"), { code: "source_malformed" });
      }),
      { code: "source_malformed" },
    );
    assert.equal(store.countFacts(), 0);

    const orphaned = await store.collect(active, (sink) => {
      assert.equal("writeFact" in sink, false);
    });
    assert.equal(orphaned.sourceRecordsSeen, 0);
    assert.equal(orphaned.factsSeen, 0);
    assert.equal(
      orphaned.factsAdded,
      0,
      "a fact prepared by an earlier failed attempt must not reach the store",
    );
    assert.equal(
      store.countFacts(),
      0,
      "a fact prepared by an earlier failed attempt must not reach the store",
    );

    const result = await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [fact()]);
      sink.recordSourceRecord(() => []);
    });
    assert.equal(result.sourceRecordsSeen, 2);
    assert.equal(result.factsSeen, 1);
    assert.equal(result.factsAdded, 1);
    assert.equal(store.countFacts(), 1);

    const inspected = new DatabaseSync(store.path, { readOnly: true });
    try {
      const orphanedFacts = inspected
        .prepare(
          `SELECT count(*) AS orphans FROM facts f
             JOIN collection_attempts a ON a.attempt_id = f.attempt_id
            WHERE a.source_records_seen = 0`,
        )
        .get() as { orphans: number };
      assert.equal(orphanedFacts.orphans, 0);
    } finally {
      inspected.close();
    }
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

test("retiring one explicitly named running attempt leaves another concurrent attempt guarding resolution", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  let firstStarted: (() => void) | undefined;
  const firstReady = new Promise<void>((resolve) => {
    firstStarted = resolve;
  });
  let releaseFirst: (() => void) | undefined;
  const firstReleased = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let secondStarted: (() => void) | undefined;
  const secondReady = new Promise<void>((resolve) => {
    secondStarted = resolve;
  });
  let releaseSecond: (() => void) | undefined;
  const secondReleased = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const first = store.collect(active, async () => {
    firstStarted?.();
    await firstReleased;
  });
  await firstReady;
  const second = store.collect(active, async () => {
    secondStarted?.();
    await secondReleased;
  });
  await secondReady;

  const modifier = new DatabaseSync(store.path);
  modifier
    .prepare("UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?")
    .run(parsed.config.id);
  modifier.close();

  try {
    assert.throws(
      () =>
        store.planRecordIndexModeResolution(
          parsed.config.id,
          parsed.hash,
          "record-ordinal",
        ),
      { code: "record_index_resolution_collection_running" },
    );
    const running = store.collectionAttempts().filter((attempt) => attempt.outcome === "running");
    assert.equal(running.length, 2);
    const retirementPlan = store.planCollectionAttemptRetirement(
      running[0]?.attemptId as string,
      "operator:recovery",
    );
    const retirement = await store.retireCollectionAttempt(
      retirementPlan.attemptId,
      retirementPlan.retiredBy,
      retirementPlan.confirmationToken,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    assert.deepEqual(retirement, {
      attemptId: retirementPlan.attemptId,
      connectionId: parsed.config.id,
      connectionVersion: parsed.hash,
      retiredAt: "2026-09-01T12:00:00.000Z",
      retiredBy: "operator:recovery",
      retirementId: retirement.retirementId,
    });
    assert.throws(
      () =>
        store.planRecordIndexModeResolution(
          parsed.config.id,
          parsed.hash,
          "record-ordinal",
        ),
      { code: "record_index_resolution_collection_running" },
    );
    assert.deepEqual(
      store.collectionAttempts().map((attempt) => [attempt.attemptId, attempt.outcome]),
      [
        [running[0]?.attemptId, "retired"],
        [running[1]?.attemptId, "running"],
      ],
    );
    assert.deepEqual(store.collectionAttemptRetirements(), [retirement]);
    releaseSecond?.();
    await second.catch(() => undefined);
    releaseFirst?.();
    await first.catch(() => undefined);
    const resolution = store.planRecordIndexModeResolution(
      parsed.config.id,
      parsed.hash,
      "record-ordinal",
    );
    await store.resolveRecordIndexMode(
      parsed.config.id,
      parsed.hash,
      "record-ordinal",
      resolution.confirmationToken,
      new Date("2026-09-01T12:01:00.000Z"),
    );
    assert.equal(store.getConnection(parsed.config.id).jsonlRecordIndexMode, "record-ordinal");
  } finally {
    releaseFirst?.();
    releaseSecond?.();
    await Promise.allSettled([first, second]);
    store.close();
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

test("confirmed record-index resolution retries contention without double-applying", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-resolution-contention-"));
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const database = new DatabaseSync(store.path);
  database
    .prepare(
      "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
    )
    .run(parsed.config.id);
  const plan = store.planRecordIndexModeResolution(
    parsed.config.id,
    parsed.hash,
    "record-ordinal",
  );
  database.exec("BEGIN IMMEDIATE");
  database
    .prepare(
      "UPDATE connection_versions SET registered_at = registered_at WHERE connection_id = ?",
    )
    .run(parsed.config.id);
  const resolving = store.resolveRecordIndexMode(
    parsed.config.id,
    parsed.hash,
    "record-ordinal",
    plan.confirmationToken,
  );
  await delay(75);
  database.exec("ROLLBACK");
  database.close();

  try {
    await resolving;
    assert.equal(store.recordIndexModeResolutions().length, 1);
    await assert.rejects(
      store.resolveRecordIndexMode(
        parsed.config.id,
        parsed.hash,
        "record-ordinal",
        plan.confirmationToken,
      ),
      { code: "confirmation_already_spent" },
    );
    assert.equal(store.recordIndexModeResolutions().length, 1);
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
  const configuredMilliseconds = 100;
  const directory = mkdtempSync(join(tmpdir(), "ecosym-completion-contention-"));
  const store = new ObservationStore(directory, configuredMilliseconds);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  // Contention is charged to a virtual clock, so the assertions below read the
  // waits the store ASKED SQLite for, never how long the machine actually took.
  const contention = contendOnVirtualClock(configuredMilliseconds);
  let outcome = "success";
  try {
    await store.collect(active, () => {
      contention.beginContending();
    });
  } catch (error: unknown) {
    outcome =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unclassified_failure";
  } finally {
    contention.restore();
  }

  try {
    assert.equal(outcome, "store_contention");
    // Each wait is clamped to what remains of the shared window: 100, 100, then
    // the final 50, then a zero-timeout probe. An unclamped implementation asks
    // for the full 100 every time and overruns the window.
    assert.deepEqual(contention.grantedWaits, [100, 100, 50, 0]);
    assert.equal(
      contention.grantedWaits.reduce((total, wait) => total + wait, 0),
      contentionWindowMilliseconds,
    );
    assert.equal(contention.inForceMilliseconds(), configuredMilliseconds);
    assert.equal(store.statuses()[0]?.reason, "incomplete");
  } finally {
    store.close();
  }
});

test("admission and completion consume one contention budget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-shared-contention-budget-"));
  // Short SQLite waits let timers run; a default wait would exhaust the budget in admission.
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
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
  await delay(150);
  blocker.exec("ROLLBACK");
  await delay(150);
  if (blocker.isTransaction) {
    blocker.exec("ROLLBACK");
  }
  const result = await Promise.race([outcome, delay(750).then(() => "deadline")]);
  blocker.close();
  await collection.catch(() => undefined);

  try {
    assert.equal(result, "store_contention");
    assert.equal(store.statuses()[0]?.status, "unread");
    assert.equal(store.statuses()[0]?.reason, "incomplete");
  } finally {
    store.close();
  }
});

test("a collection within the contention budget still completes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-shared-contention-control-"));
  // Short SQLite waits let timers run; a default wait would exhaust the budget in admission.
  const store = new ObservationStore(directory, 20);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
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
  await delay(30);
  blocker.exec("ROLLBACK");
  const reacquireDeadline = Date.now() + 500;
  while (!blocker.isTransaction && Date.now() < reacquireDeadline) {
    await delay(5);
  }
  if (blocker.isTransaction) {
    blocker.exec("ROLLBACK");
  }
  const result = await Promise.race([outcome, delay(750).then(() => "deadline")]);
  blocker.close();
  await collection.catch(() => undefined);

  try {
    assert.equal(result, "success");
  } finally {
    store.close();
  }
});

function observeWaitsAgainstRealLock(configuredMilliseconds: number) {
  const exec = DatabaseSync.prototype.exec;
  const requestedWaits: number[] = [];
  let inForceMilliseconds = configuredMilliseconds;
  let observing = false;

  DatabaseSync.prototype.exec = function (sql: string): void {
    const pragma = /^PRAGMA busy_timeout = (\d+)$/.exec(sql);
    if (pragma !== null) {
      inForceMilliseconds = Number(pragma[1]);
      exec.call(this, sql);
      return;
    }
    if (observing && sql === "BEGIN IMMEDIATE") {
      requestedWaits.push(inForceMilliseconds);
    }
    exec.call(this, sql);
  };

  return {
    beginObserving: () => {
      observing = true;
    },
    inForceMilliseconds: () => inForceMilliseconds,
    requestedWaits,
    restore: () => {
      DatabaseSync.prototype.exec = exec;
    },
  };
}

test("store contention returns a bounded machine-readable failure", async () => {
  // Pinned to a literal on purpose. The assertions below compare against the
  // real busy_timeout SQLite was asked for, not against how long the machine
  // actually took -- so a widened window must fail HERE, immediately, or a
  // regression that makes contention resolution correct-but-arbitrarily-slow
  // would sail through undetected. Measured: a synchronous SQLite busy wait
  // blocks the event loop, so when the retry loop's promise finally settles,
  // its reaction is a microtask that always runs before an overdue macrotask
  // timer -- a `Promise.race` against a wall-clock deadline cannot bound this
  // property, however long the deadline is (verified: widening the window to
  // 2000ms still resolves "store_contention" successfully after ~2000ms,
  // i.e. a 750ms deadline race does not fire). This literal pin is what
  // makes "bounded" a real, categorical guarantee instead of a race that
  // never wins.
  assert.equal(contentionWindowMilliseconds, 250);

  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-contention-bound-"));
  const store = new ObservationStore(directory);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  const observed = observeWaitsAgainstRealLock(contentionWindowMilliseconds);
  // A hang guard, not a timing assertion: correct code settles in ~250ms, so
  // this bound is generous and cannot discriminate between implementations
  // by itself -- it exists only so a retry loop that never terminates fails
  // this test instead of hanging the whole runner. The real, categorical
  // guard against a "too slow" (not just "never returns") regression is the
  // literal pin above plus the requestedWaits assertion below.
  const hangGuard = new AbortController();
  let outcome = "success";
  observed.beginObserving();
  const collection = store.collect(active, () => undefined).then(
    () => "success",
    (error: unknown) =>
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unclassified_failure",
  );
  try {
    outcome = await Promise.race([
      collection,
      delay(10_000, "hang_guard_deadline", { signal: hangGuard.signal }).catch(
        () => "hang_guard_aborted",
      ),
    ]);
  } finally {
    hangGuard.abort();
    observed.restore();
  }
  blocker.exec("ROLLBACK");
  blocker.close();
  // store.collect() has no cancellation signal, so a losing collection from
  // the hang guard above cannot be aborted -- only awaited out. Without this,
  // a hung collection would keep running against `store` after store.close()
  // below, and any resulting rejection would be unhandled. Waiting here first
  // guarantees the collection has actually settled before shared resources
  // (the blocker connection above, the store below) are torn down.
  await collection.catch(() => undefined);

  try {
    assert.equal(outcome, "store_contention");
    // One real SQLite wait of the full window, then the budget is spent. A
    // connection that never received the configured busy timeout, or that
    // failed to clamp a widened window, produces a different wait here --
    // this is the same discriminator that catches a widened-window mutant,
    // now checked against the actual value SQLite was told to wait for
    // rather than against how long the wait happened to take.
    assert.deepEqual(observed.requestedWaits, [contentionWindowMilliseconds]);
    assert.equal(observed.inForceMilliseconds(), contentionWindowMilliseconds);
  } finally {
    store.close();
  }
});

test("a configured SQLite timeout cannot outlive the contention window", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-timeout-bound-"));
  assert.throws(() => new ObservationStore(directory, 251), RangeError);
});

test("configured SQLite waits share one contention window", async () => {
  const configuredMilliseconds = 200;
  const directory = mkdtempSync(join(tmpdir(), "ecosym-store-timeout-total-"));
  const store = new ObservationStore(directory, configuredMilliseconds);
  const parsed = connection();
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const contention = contendOnVirtualClock(configuredMilliseconds);
  contention.beginContending();
  let outcome = "success";
  try {
    await store.collect(active, () => undefined);
  } catch (error: unknown) {
    outcome =
      error !== null && typeof error === "object" && "code" in error
        ? String(error.code)
        : "unclassified_failure";
  } finally {
    contention.restore();
  }

  try {
    assert.equal(outcome, "store_contention");
    // 200 then the remaining 50 — never 200 twice.
    assert.deepEqual(contention.grantedWaits, [200, 50]);
    assert.equal(
      contention.grantedWaits.reduce((total, wait) => total + wait, 0),
      contentionWindowMilliseconds,
    );
    assert.equal(contention.inForceMilliseconds(), configuredMilliseconds);
  } finally {
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

test("an unrelated error wrapping SQLite contention remains unrelated", () => {
  const busy = Object.assign(new Error("database is locked"), { errcode: 5 });
  assert.equal(isSqliteContentionError(new Error("unrelated failure", { cause: busy })), false);
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
    DROP TABLE record_index_mode_resolutions;
    DROP TABLE confirmation_previews;
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
    assert.equal(version.user_version, 15);
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

test("schema-eight stores gain an empty resolution log without rewriting facts", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  await store.collect(store.getConnection(parsed.config.id), (sink) => {
    sink.recordSourceRecord(() => [fact()]);
  });
  const facts = store.queryObservations();
  store.close();

  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  downgraded.exec(`
    DROP TABLE record_index_mode_resolutions;
    DROP TABLE confirmation_previews;
    PRAGMA user_version = 8;
  `);
  downgraded.close();

  const migrated = new ObservationStore(directory);
  try {
    assert.deepEqual(migrated.queryObservations(), facts);
    assert.deepEqual(migrated.recordIndexModeResolutions(), []);
  } finally {
    migrated.close();
  }
  const inspected = new DatabaseSync(join(directory, "observations.sqlite"), {
    readOnly: true,
  });
  try {
    const version = inspected.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(version.user_version, 15);
    const resolutions = inspected
      .prepare("SELECT count(*) AS count FROM record_index_mode_resolutions")
      .get() as { count: number };
    assert.equal(resolutions.count, 0);
  } finally {
    inspected.close();
  }
});

test("schema-ten stores gain an empty confirmation-preview ledger without rewriting history", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  store.register(parsed);
  await store.collect(store.getConnection(parsed.config.id), (sink) => {
    sink.recordSourceRecord(() => [fact()]);
  });
  const active = store.getConnection(parsed.config.id);
  const prepared = new DatabaseSync(store.path);
  prepared
    .prepare(
      `INSERT INTO collection_attempts (
         attempt_order, attempt_id, connection_id, config_hash, activation_id,
         started_at, completed_at, outcome, source_records_seen, facts_seen,
         facts_added, facts_changed, failure_code
       ) VALUES (2, 'legacy-abandoned-attempt', ?, ?, ?, ?, NULL, 'running',
                 0, 0, 0, 0, NULL)`,
    )
    .run(
      parsed.config.id,
      parsed.hash,
      active.activationId,
      "2026-09-01T09:00:00.000Z",
    );
  prepared
    .prepare(
      "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
    )
    .run(parsed.config.id);
  prepared.close();
  const retirementPlan = store.planCollectionAttemptRetirement(
    "legacy-abandoned-attempt",
    "operator:migration-fixture",
    new Date("2026-09-01T09:01:00.000Z"),
  );
  await store.retireCollectionAttempt(
    retirementPlan.attemptId,
    retirementPlan.retiredBy,
    retirementPlan.confirmationToken,
    new Date("2026-09-01T09:02:00.000Z"),
  );
  const resolutionPlan = store.planRecordIndexModeResolution(
    parsed.config.id,
    parsed.hash,
    "physical-line",
    new Date("2026-09-01T09:03:00.000Z"),
  );
  await store.resolveRecordIndexMode(
    parsed.config.id,
    parsed.hash,
    "physical-line",
    resolutionPlan.confirmationToken,
    new Date("2026-09-01T09:04:00.000Z"),
  );
  const facts = store.queryObservations();
  const attempts = store.collectionAttempts();
  const retirements = store.collectionAttemptRetirements();
  const resolutions = store.recordIndexModeResolutions();
  store.close();

  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  downgraded.exec(`
    DROP TABLE confirmation_previews;
    PRAGMA user_version = 10;
  `);
  downgraded.close();

  const migrated = new ObservationStore(directory);
  try {
    assert.deepEqual(migrated.queryObservations(), facts);
    assert.deepEqual(migrated.collectionAttempts(), attempts);
    assert.deepEqual(migrated.collectionAttemptRetirements(), retirements);
    assert.deepEqual(migrated.recordIndexModeResolutions(), resolutions);
  } finally {
    migrated.close();
  }
  const inspected = new DatabaseSync(join(directory, "observations.sqlite"), {
    readOnly: true,
  });
  try {
    const version = inspected.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    assert.equal(version.user_version, 15);
    const previews = inspected
      .prepare("SELECT count(*) AS count FROM confirmation_previews")
      .get() as { count: number };
    assert.equal(previews.count, 0);
  } finally {
    inspected.close();
  }
});

test("schema-eleven stores gain institutional tables before WAL is enabled", () => {
  const { directory, store } = temporaryStore();
  store.close();
  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  downgraded.exec(`
    DROP INDEX mandate_revisions_current;
    DROP TABLE mandate_revisions;
    DROP TABLE civilizations;
    PRAGMA user_version = 11;
  `);
  downgraded.close();

  const migrated = new ObservationStore(directory);
  migrated.close();
  const inspected = new DatabaseSync(join(directory, "observations.sqlite"));
  try {
    assert.equal(
      (inspected.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      15,
    );
    assert.deepEqual(
      inspected
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE '%civilization%' OR type = 'table' AND name = 'mandate_revisions'")
        .all()
        .map((row) => (row as { name: string }).name)
        .sort(),
      ["civilization_forget_records", "civilizations", "mandate_revisions"],
    );
    assert.equal(
      (inspected.prepare("PRAGMA journal_mode").get() as { journal_mode: string })
        .journal_mode,
      "wal",
    );
  } finally {
    inspected.close();
  }
});

test("an interrupted legacy rebuild remains resumable as schema nine", () => {
  const { directory, store } = temporaryStore();
  store.close();
  const path = join(directory, "observations.sqlite");
  const downgraded = new DatabaseSync(path);
  downgraded.exec(`
    DROP INDEX mandate_revisions_current;
    DROP TABLE mandate_revisions;
    DROP TABLE civilizations;
    DROP TABLE record_index_mode_resolutions;
    DROP TABLE confirmation_previews;
    CREATE TABLE collection_attempts_replacement (blocker INTEGER) STRICT;
    PRAGMA user_version = 8;
  `);
  downgraded.close();

  assert.throws(() => new ObservationStore(directory), /already exists/);
  const interrupted = new DatabaseSync(path);
  assert.equal(
    (interrupted.prepare("PRAGMA user_version").get() as { user_version: number })
      .user_version,
    9,
  );
  interrupted.exec("DROP TABLE collection_attempts_replacement");
  interrupted.close();

  const resumed = new ObservationStore(directory);
  resumed.close();
  const inspected = new DatabaseSync(path);
  try {
    assert.equal(
      (inspected.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
      15,
    );
    assert.equal(
      (inspected
        .prepare("SELECT count(*) AS count FROM mandate_revisions")
        .get() as { count: number }).count,
      0,
    );
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
    DROP TABLE record_index_mode_resolutions;
    DROP TABLE confirmation_previews;
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

test("every query filter narrows the result rather than widening it", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [
        fact({ kind: "example.value", subject: "subject-a", payload: { value: 1 } }),
        fact({ kind: "example.value", subject: "subject-b", payload: { value: 2 } }),
        fact({
          epistemicStatus: "claim",
          kind: "example.completion-report",
          payload: { state: "completed" },
          subject: "subject-a",
        }),
      ]);
    });

    // Each filter is a further restriction, so asking for observations about
    // one subject must not also return the claim about it, nor the other
    // subject's observation. Combining the conditions with OR instead of AND
    // returns all three: the epistemic-status condition is one of the terms.
    const narrowed = store.queryObservations({ subject: "subject-a" });
    assert.deepEqual(
      narrowed.map((record) => [record.epistemicStatus, record.subject, record.payload]),
      [["observation", "subject-a", { value: 1 }]],
    );

    // The same, one filter deeper: a kind that no claim shares still must not
    // admit a fact that fails the subject condition.
    assert.deepEqual(
      store
        .queryObservations({ kind: "example.value", subject: "subject-b" })
        .map((record) => record.payload),
      [{ value: 2 }],
    );

    // And a filter that matches nothing returns nothing rather than everything
    // that satisfies some other term.
    assert.deepEqual(store.queryObservations({ subject: "absent" }), []);
    assert.deepEqual(store.queryClaims({ subject: "subject-b" }), []);

    // The unfiltered queries still see all three facts, so the assertions above
    // are narrowing rather than an empty store.
    assert.equal(store.queryObservations().length, 2);
    assert.equal(store.queryClaims().length, 1);
  } finally {
    store.close();
  }
});

test("stored configuration that no longer matches its identity is refused", async () => {
  const { directory, store } = temporaryStore();
  const parsed = connection();
  const path = store.path;
  try {
    store.register(parsed);
    // A fact collected under the honest configuration, so the tampering below
    // is the only thing that changes between the reads.
    const active = store.getConnection(parsed.config.id);
    await store.collect(active, (sink) => {
      sink.recordSourceRecord(() => [fact()]);
    });
    assert.equal(store.getConnection(parsed.config.id).config.factOwner, "owner-a");
  } finally {
    store.close();
  }

  // Rewrite the stored configuration in place, leaving its identity hash
  // untouched. This is what an edited state file looks like: the row still
  // claims to be the configuration whose hash is recorded beside it.
  const tampered = JSON.parse(parsed.canonical) as { factOwner: string };
  tampered.factOwner = "attacker-owner";
  const database = new DatabaseSync(path);
  try {
    database
      .prepare("UPDATE connection_versions SET config_json = ? WHERE config_hash = ?")
      .run(JSON.stringify(tampered), parsed.hash);
  } finally {
    database.close();
  }

  const reopened = new ObservationStore(directory);
  try {
    // Reading it back must fail rather than hand out an authority the recorded
    // identity never covered. Both read paths derive the configuration from the
    // same stored row, so both must refuse it.
    assert.throws(
      () => reopened.getConnection(parsed.config.id),
      /does not match its identity/,
    );
    assert.throws(() => reopened.listConnections(), /does not match its identity/);
  } finally {
    reopened.close();
  }
});

test("payload values that cannot be persisted exactly are refused", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);

    // NaN and the infinities have no JSON spelling, and negative zero does not
    // survive a round trip distinguishably from zero. Storing any of them would
    // record a value the store cannot return. The payload guard now throws
    // FactRejectedError so collection wraps it and records fact_rejected.
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0]) {
      await assert.rejects(
        store.collect(active, (sink) => {
          sink.recordSourceRecord(() => [fact({ payload: { value } })]);
        }),
        (error: unknown) =>
          error instanceof CollectionFailedError && error.code === "fact_rejected",
        String(value),
      );
      assert.equal(store.countFacts(), 0, String(value));
    }

    // Ordinary finite numbers, including positive zero and a negative value,
    // are still accepted, so the guard is not rejecting every number.
    for (const value of [0, -1.5, 7]) {
      await store.collect(active, (sink) => {
        sink.recordSourceRecord(() => [fact({ payload: { value } })]);
      });
    }
    assert.deepEqual(
      store.queryObservations().map((record) => record.payload.value).sort(),
      [-1.5, 0, 7],
    );
  } finally {
    store.close();
  }
});

test("a retirement actor must be a bounded machine identifier", async () => {
  const { store } = temporaryStore();
  try {
    const parsed = connection();
    store.register(parsed);

    // The bound is part of the grammar: an actor is recorded in an audit trail,
    // so an unbounded string is not an identifier. Validation happens before
    // the confirmation token is examined, so an unused token is enough.
    for (const actor of ["a".repeat(129), "a".repeat(200), "a".repeat(1024)]) {
      await assert.rejects(
        store.retireCollectionAttempt("absent-attempt", actor, "unused-token"),
        /stable machine identifier/,
        `length ${actor.length}`,
      );
    }
    // The longest permitted identifier passes the grammar, so the assertions
    // above are about the bound rather than rejecting everything. It fails for
    // the unrelated reason that no such confirmation exists.
    await assert.rejects(
      store.retireCollectionAttempt(
        "absent-attempt",
        `a${"b".repeat(127)}`,
        "unused-token",
      ),
      (error: Error) => !/stable machine identifier/.test(error.message),
    );
  } finally {
    store.close();
  }
});
