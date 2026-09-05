import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig } from "../src/config.ts";
import { canonicalJson, sha256 } from "../src/json.ts";
import { ObservationStore } from "../src/store.ts";
import {
  exitCodeForVerification,
  verifyAll,
  verifyConnection,
} from "../src/verify.ts";

const fixtures = fileURLToPath(new URL("fixtures/verification/", import.meta.url));

function setup(
  retention: "history" | "latest" = "history",
  sourceTime: "recorded" | "unavailable" = "recorded",
) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-verify-"));
  const sourcePath = join(directory, "source.jsonl");
  copyFileSync(join(fixtures, "original.jsonl"), sourcePath);
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "verification-source",
    factOwner: "source-owner",
    reader: { type: "jsonl", path: sourcePath },
    sourceRecord: {
      identity: [{ scope: "record", path: "record_id" }],
      retention,
      recordedAt:
        sourceTime === "recorded"
          ? {
              selector: { scope: "record", path: "recorded_at" },
              format: "iso8601",
            }
          : { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "method-a.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  const store = new ObservationStore(join(directory, "state"));
  store.register(parsed);
  return { directory, parsed, sourcePath, store };
}

test("reports exact agreement in a stable machine-readable shape", async () => {
  const { parsed, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    const report = await verifyAll(store);

    assert.deepEqual(report, {
      schemaVersion: 1,
      outcome: "agreement",
      unverifiedReason: null,
      connections: [
        {
          connectionId: "verification-source",
          counts: {
            advanced: 0,
            matched: 1,
            missingAtSource: 0,
            payloadMismatch: 0,
            sourceFacts: 1,
            sourceVersionConflict: 0,
            storedFacts: 1,
            superseded: 0,
            uncollected: 0,
          },
          outcome: "agreement",
          unreadReason: null,
          unverifiedReason: null,
        },
      ],
    });
    assert.equal(exitCodeForVerification(report), 0);
  } finally {
    store.close();
  }
});

test("an empty connection is unverified rather than agreement", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    writeFileSync(sourcePath, "");
    const report = await verifyAll(store);

    assert.equal(report.outcome, "unverified");
    assert.equal(report.unverifiedReason, "connections_unverified");
    assert.equal(report.connections[0]?.outcome, "unverified");
    assert.equal(report.connections[0]?.unverifiedReason, "no_facts");
    assert.equal(exitCodeForVerification(report), 4);
  } finally {
    store.close();
  }
});

test("mixed connection outcomes remain mixed when one connection is unverified", async (t) => {
  for (const scenario of [
    { expected: "agreement", name: "agreement" },
    { expected: "unread", name: "unread" },
    { expected: "disagreement", name: "disagreement" },
  ] as const) {
    await t.test(scenario.name, async () => {
      const { directory, parsed, sourcePath, store } = setup();
      try {
        await collectConnection(store, parsed.config.id);
        const emptyPath = join(directory, "empty.jsonl");
        writeFileSync(emptyPath, "");
        const emptyInput = JSON.parse(parsed.canonical) as {
          id: string;
          reader: { path: string };
        };
        emptyInput.id = "empty-source";
        emptyInput.reader.path = emptyPath;
        store.register(parseConnectionConfig(emptyInput));

        if (scenario.expected === "unread") {
          rmSync(sourcePath);
        } else if (scenario.expected === "disagreement") {
          copyFileSync(join(fixtures, "corrupted.jsonl"), sourcePath);
        }

        const report = await verifyAll(store);
        const outcomes = new Map(
          report.connections.map((connection) => [connection.connectionId, connection.outcome]),
        );
        assert.equal(outcomes.get("empty-source"), "unverified");
        assert.equal(outcomes.get(parsed.config.id), scenario.expected);
        assert.equal(report.outcome, "mixed");
        assert.equal(report.unverifiedReason, "connections_unverified");
        assert.equal(exitCodeForVerification(report), 3);
      } finally {
        store.close();
      }
    });
  }
});

// Pin docs/observation-layer.md's mixed-outcome rule so aggregation changes
// cannot let a disagreement hide behind a homogeneous outcome.
test("heterogeneous outcomes are mixed without an unverified connection", async (t) => {
  for (const scenario of [
    { first: "agreement", name: "agreement + disagreement", second: "disagreement" },
    { first: "agreement", name: "agreement + unread", second: "unread" },
    { first: "unread", name: "unread + disagreement", second: "disagreement" },
  ] as const) {
    await t.test(scenario.name, async () => {
      const { directory, parsed, sourcePath, store } = setup();
      try {
        const secondPath = join(directory, "second-source.jsonl");
        copyFileSync(join(fixtures, "original.jsonl"), secondPath);
        const secondInput = JSON.parse(parsed.canonical) as {
          id: string;
          reader: { path: string };
        };
        secondInput.id = "second-source";
        secondInput.reader.path = secondPath;
        const secondParsed = parseConnectionConfig(secondInput);
        store.register(secondParsed);

        await collectConnection(store, parsed.config.id);
        await collectConnection(store, secondParsed.config.id);

        for (const [outcome, path] of [
          [scenario.first, sourcePath],
          [scenario.second, secondPath],
        ] as const) {
          if (outcome === "disagreement") {
            copyFileSync(join(fixtures, "corrupted.jsonl"), path);
          } else if (outcome === "unread") {
            rmSync(path);
          }
        }

        const report = await verifyAll(store);
        const outcomes = new Map(
          report.connections.map((connection) => [connection.connectionId, connection.outcome]),
        );
        assert.equal(outcomes.get(parsed.config.id), scenario.first);
        assert.equal(outcomes.get(secondParsed.config.id), scenario.second);
        assert.equal(report.outcome, "mixed");
        assert.equal(report.unverifiedReason, null);
        assert.equal(exitCodeForVerification(report), 3);
      } finally {
        store.close();
      }
    });
  }
});

test("an empty store is unverified rather than agreement", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-empty-verify-"));
  const store = new ObservationStore(directory);
  try {
    const report = await verifyAll(store);

    assert.deepEqual(report, {
      schemaVersion: 1,
      outcome: "unverified",
      unverifiedReason: "no_connections",
      connections: [],
    });
    assert.equal(exitCodeForVerification(report), 4);
  } finally {
    store.close();
  }
});

test("the deliberately corrupted fixture produces payload disagreement", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    copyFileSync(join(fixtures, "corrupted.jsonl"), sourcePath);
    const report = await verifyAll(store);

    assert.equal(report.outcome, "disagreement");
    assert.equal(report.connections[0]?.counts.payloadMismatch, 1);
    assert.equal(report.connections[0]?.outcome, "disagreement");
    assert.equal(exitCodeForVerification(report), 1);
  } finally {
    store.close();
  }
});

test("detects a store payload altered after collection", async () => {
  const { parsed, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    const payloadJson = canonicalJson({ value: 999 });
    const database = new DatabaseSync(store.path);
    try {
      const result = database
        .prepare("UPDATE facts SET payload_json = ?, payload_hash = ?")
        .run(payloadJson, sha256(payloadJson));
      assert.equal(Number(result.changes), 1);
    } finally {
      database.close();
    }

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "disagreement");
    assert.equal(report.counts.payloadMismatch, 1);
    assert.equal(report.counts.matched, 0);
  } finally {
    store.close();
  }
});

test("verification refuses a stable snapshot whose connection becomes inactive", async () => {
  const { parsed, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    const connection = store.getConnection(parsed.config.id);
    const snapshot = store.factsForVerification(connection);
    let snapshotReads = 0;
    store.factsForVerification = () => {
      snapshotReads += 1;
      queueMicrotask(() => store.disconnect(parsed.config.id));
      return snapshot;
    };

    const report = await verifyConnection(store, connection);

    assert.equal(report.outcome, "unread");
    assert.equal(report.unreadReason, "connection_inactive");
    assert.equal(report.counts.storedFacts, 1);
    assert.equal(snapshotReads, 1);
    assert.equal(store.listConnections().length, 0);
  } finally {
    store.close();
  }
});

test("a store change after the verification snapshot is not disagreement", async () => {
  const { parsed, store } = setup();
  const factsForVerification = store.factsForVerification.bind(store);
  let snapshotReads = 0;
  try {
    await collectConnection(store, parsed.config.id);
    const connection = store.getConnection(parsed.config.id);
    // The first read is the seam: the row stays invisible to the compared snapshot
    // but visible to any later read, catching a reintroduced second read anywhere.
    store.factsForVerification = (snapshotConnection) => {
      snapshotReads += 1;
      const snapshot = factsForVerification(snapshotConnection);
      if (snapshotReads === 1) {
        const database = new DatabaseSync(store.path);
        try {
          const result = database
            .prepare(
              `INSERT INTO facts
                 (connection_id, config_hash, attempt_id, fact_owner, kind, subject,
                  epistemic_status, source_record_id, source_recorded_at, source_time_key,
                  payload_json, payload_hash, collected_at, last_seen_attempt_order)
               SELECT connection_id, config_hash, attempt_id, fact_owner, kind, subject,
                      epistemic_status, ?, source_recorded_at, source_time_key,
                      payload_json, payload_hash, collected_at, last_seen_attempt_order
                 FROM facts`,
            )
            .run("collected-while-source-was-read");
          assert.equal(Number(result.changes), 1);
        } finally {
          database.close();
        }
      }
      return snapshot;
    };

    const report = await verifyConnection(store, connection);

    assert.equal(report.outcome, "agreement");
    assert.equal(report.counts.missingAtSource, 0);
    assert.equal(report.counts.storedFacts, 1);
    assert.equal(snapshotReads, 1);
  } finally {
    store.factsForVerification = factsForVerification;
    store.close();
  }
});

test("payload bytes changed without their hash make verification unread", async () => {
  const { parsed, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    const database = new DatabaseSync(store.path);
    try {
      database
        .prepare("UPDATE facts SET payload_json = ?")
        .run(canonicalJson({ value: 999 }));
    } finally {
      database.close();
    }
    assert.deepEqual(store.queryObservations().map((fact) => fact.payload), [
      { value: 999 },
    ]);

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "unread");
    assert.equal(report.unreadReason, "store_payload_invalid");
  } finally {
    store.close();
  }
});

test("a collected correction and reversion verify against only their current payload", async () => {
  const { parsed, sourcePath, store } = setup("history");
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.000Z","value":12}\n',
    );
    await collectConnection(store, parsed.config.id);
    let report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "agreement");
    assert.equal(report.counts.matched, 1);
    assert.equal(report.counts.payloadMismatch, 0);
    assert.equal(report.counts.storedFacts, 1);

    copyFileSync(join(fixtures, "original.jsonl"), sourcePath);
    await collectConnection(store, parsed.config.id);
    report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "agreement");
    assert.equal(report.counts.matched, 1);
    assert.equal(report.counts.payloadMismatch, 0);
    assert.equal(report.counts.storedFacts, 1);
  } finally {
    store.close();
  }
});

test("distinguishes missing and never-collected records", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-2","subject":"new-subject","recorded_at":"2026-08-30T00:00:00.000Z","value":4}\n',
    );
    const report = await verifyConnection(store, store.getConnection(parsed.config.id));

    assert.equal(report.counts.missingAtSource, 1);
    assert.equal(report.counts.uncollected, 1);
    assert.equal(report.outcome, "disagreement");
  } finally {
    store.close();
  }
});

test("a newer source value is advancement rather than payload disagreement", async () => {
  const { parsed, sourcePath, store } = setup("latest");
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-31T00:00:00.000Z","value":12}\n',
    );
    const report = await verifyConnection(store, store.getConnection(parsed.config.id));

    assert.equal(report.outcome, "agreement");
    assert.equal(report.counts.advanced, 1);
    assert.equal(report.counts.superseded, 1);
    assert.equal(report.counts.payloadMismatch, 0);
  } finally {
    store.close();
  }
});

test("a fractional instant after a whole second is advancement", async () => {
  const { parsed, sourcePath, store } = setup("latest");
  try {
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00Z","value":7}\n',
    );
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.5Z","value":12}\n',
    );

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "agreement");
    assert.equal(report.counts.advanced, 1);
    assert.equal(report.counts.superseded, 1);
  } finally {
    store.close();
  }
});

test("equivalent UTC spellings identify the same source version", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00+00:00","value":7}\n',
    );

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "agreement");
    assert.equal(report.counts.matched, 1);
    assert.equal(report.counts.missingAtSource, 0);
    assert.equal(report.counts.uncollected, 0);
  } finally {
    store.close();
  }
});

test("a corrupted stored source-time key makes verification unread", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    writeFileSync(
      sourcePath,
      [
        '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00Z","value":7}',
        '{"record_id":"record-2","subject":"subject-1","recorded_at":"2026-08-30T00:00:01Z","value":12}',
        "",
      ].join("\n"),
    );
    await collectConnection(store, parsed.config.id);
    const older = store.queryObservations()[0];
    assert.ok(older);
    const database = new DatabaseSync(store.path);
    try {
      database
        .prepare("UPDATE facts SET source_time_key = ? WHERE source_record_id = ?")
        .run("2026-08-30T00:00:02.000Z", older.sourceRecordId);
    } finally {
      database.close();
    }
    assert.deepEqual(
      store.queryObservations().map((record) => record.temporalStatus),
      ["current", "historical"],
    );

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "unread");
    assert.equal(report.unreadReason, "store_source_time_invalid");
  } finally {
    store.close();
  }
});

test("malformed stored text is not equivalent to unavailable source time", async () => {
  const { parsed, store } = setup("history", "unavailable");
  try {
    await collectConnection(store, parsed.config.id);
    const database = new DatabaseSync(store.path);
    try {
      database.prepare("UPDATE facts SET source_recorded_at = ?").run("not-an-instant");
    } finally {
      database.close();
    }

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "unread");
    assert.equal(report.unreadReason, "store_source_time_invalid");
  } finally {
    store.close();
  }
});

test("historical revision time-key corruption makes verification unread", async () => {
  const { directory, parsed, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    assert.equal(store.disconnect(parsed.config.id), true);
    const secondSourcePath = join(directory, "second-source.jsonl");
    writeFileSync(
      secondSourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-31T00:00:00Z","value":12}\n',
    );
    const secondInput = JSON.parse(parsed.canonical) as { reader: { path: string } };
    secondInput.reader.path = secondSourcePath;
    const second = parseConnectionConfig(secondInput);
    store.register(second);
    await collectConnection(store, second.config.id);

    const database = new DatabaseSync(store.path);
    try {
      database
        .prepare("UPDATE facts SET source_time_key = ? WHERE config_hash = ?")
        .run("2026-09-01T00:00:00.000Z", parsed.hash);
    } finally {
      database.close();
    }
    assert.deepEqual(
      store.queryObservations().map((record) => record.temporalStatus),
      ["current", "historical"],
    );

    const report = await verifyConnection(store, store.getConnection(second.config.id));
    assert.equal(report.outcome, "unread");
    assert.equal(report.unreadReason, "store_source_time_invalid");
  } finally {
    store.close();
  }
});

test("an inactive connection revision cannot verify as agreement", async () => {
  const { directory, parsed, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    const stale = store.getConnection(parsed.config.id);
    assert.equal(store.disconnect(parsed.config.id), true);
    const secondInput = JSON.parse(parsed.canonical) as { reader: { path: string } };
    secondInput.reader.path = join(directory, "replacement-source.jsonl");
    const second = parseConnectionConfig(secondInput);
    store.register(second);

    const report = await verifyConnection(store, stale);
    assert.equal(report.outcome, "unread");
    assert.equal(report.unreadReason, "connection_inactive");
  } finally {
    store.close();
  }
});

test("a late intermediate source point is uncollected rather than advancement", async () => {
  const { parsed, sourcePath, store } = setup("history");
  try {
    writeFileSync(
      sourcePath,
      [
        '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.000Z","value":7}',
        '{"record_id":"record-3","subject":"subject-1","recorded_at":"2026-09-01T00:00:00.000Z","value":14}',
        "",
      ].join("\n"),
    );
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      [
        '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.000Z","value":7}',
        '{"record_id":"record-2","subject":"subject-1","recorded_at":"2026-08-31T00:00:00.000Z","value":12}',
        '{"record_id":"record-3","subject":"subject-1","recorded_at":"2026-09-01T00:00:00.000Z","value":14}',
        "",
      ].join("\n"),
    );

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.counts.advanced, 0);
    assert.equal(report.counts.uncollected, 1);
    assert.equal(report.outcome, "disagreement");
  } finally {
    store.close();
  }
});

test("history retention still reports an older source version that disappeared", async () => {
  const { parsed, sourcePath, store } = setup("history");
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-31T00:00:00.000Z","value":12}\n',
    );
    const report = await verifyConnection(store, store.getConnection(parsed.config.id));

    assert.equal(report.counts.advanced, 1);
    assert.equal(report.counts.missingAtSource, 1);
    assert.equal(report.outcome, "disagreement");
  } finally {
    store.close();
  }
});

test("an absent source is unread and never succeeds by empty comparison", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    rmSync(sourcePath);
    const report = await verifyAll(store);

    assert.equal(report.outcome, "unread");
    assert.equal(report.connections[0]?.outcome, "unread");
    assert.equal(report.connections[0]?.unreadReason, "source_absent");
    assert.equal(exitCodeForVerification(report), 2);
  } finally {
    store.close();
  }
});

test("a source version that asserts two payloads is disagreement", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    const original = readFileSync(join(fixtures, "original.jsonl"), "utf8").trim();
    const corrupted = readFileSync(join(fixtures, "corrupted.jsonl"), "utf8").trim();
    writeFileSync(sourcePath, `${original}\n${corrupted}\n`);
    const report = await verifyConnection(store, store.getConnection(parsed.config.id));

    assert.equal(report.counts.sourceVersionConflict, 1);
    assert.equal(report.outcome, "disagreement");
  } finally {
    store.close();
  }
});

test("payload mismatch counts stored facts rather than source alternatives", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      [
        '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.000Z","value":12}',
        '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.000Z","value":14}',
        "",
      ].join("\n"),
    );

    const report = await verifyConnection(store, store.getConnection(parsed.config.id));

    assert.equal(report.counts.storedFacts, 1);
    assert.equal(report.counts.payloadMismatch, 1);
    assert.ok(report.counts.payloadMismatch <= report.counts.storedFacts);
  } finally {
    store.close();
  }
});

test("a collected source-version conflict is unknown in queries", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    const original = readFileSync(join(fixtures, "original.jsonl"), "utf8").trim();
    const corrupted = readFileSync(join(fixtures, "corrupted.jsonl"), "utf8").trim();
    writeFileSync(sourcePath, `${original}\n${corrupted}\n`);
    await collectConnection(store, parsed.config.id);

    assert.deepEqual(
      store.queryObservations().map((record) => record.temporalStatus),
      ["unknown", "unknown"],
    );
    const report = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(report.outcome, "disagreement");
    assert.equal(report.counts.sourceVersionConflict, 1);

    const repeat = await collectConnection(store, parsed.config.id);
    assert.equal(repeat.result.factsAdded, 0);
    assert.equal(repeat.result.factsChanged, 0);
    assert.equal(store.statuses()[0]?.status, "quiet");
  } finally {
    store.close();
  }
});

test("an equal source time is not an advancement over stored history", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);

    // A different source record, carrying the same instant as the fact already
    // stored. It is a version the store has never seen, but it does not follow
    // the stored one in time, so nothing has advanced.
    writeFileSync(
      sourcePath,
      '{"record_id":"record-2","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.000Z","value":9}\n',
    );
    const equal = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(equal.counts.advanced, 0);
    assert.equal(equal.counts.uncollected, 1);

    // The same shape one instant later is an advancement, so the assertion
    // above distinguishes equal from newer rather than refusing both.
    writeFileSync(
      sourcePath,
      '{"record_id":"record-2","subject":"subject-1","recorded_at":"2026-08-30T00:00:00.001Z","value":9}\n',
    );
    const newer = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(newer.counts.advanced, 1);
    assert.equal(newer.counts.uncollected, 0);

    // And earlier is not an advancement either.
    writeFileSync(
      sourcePath,
      '{"record_id":"record-2","subject":"subject-1","recorded_at":"2026-08-29T00:00:00.000Z","value":9}\n',
    );
    const older = await verifyConnection(store, store.getConnection(parsed.config.id));
    assert.equal(older.counts.advanced, 0);
    assert.equal(older.counts.uncollected, 1);
  } finally {
    store.close();
  }
});
