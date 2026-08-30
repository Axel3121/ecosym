import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig } from "../src/config.ts";
import { ObservationStore } from "../src/store.ts";
import {
  exitCodeForVerification,
  verifyAll,
  verifyConnection,
} from "../src/verify.ts";

const fixtures = fileURLToPath(new URL("fixtures/verification/", import.meta.url));

function setup(retention: "history" | "latest" = "history") {
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
      recordedAt: {
        selector: { scope: "record", path: "recorded_at" },
        format: "iso8601",
      },
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
        },
      ],
    });
    assert.equal(exitCodeForVerification(report), 0);
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

test("distinguishes missing and never-collected records", async () => {
  const { parsed, sourcePath, store } = setup();
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-2","subject":"new-subject","recorded_at":"2026-08-30T00:00:00Z","value":4}\n',
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
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-31T00:00:00Z","value":12}\n',
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

test("history retention still reports an older source version that disappeared", async () => {
  const { parsed, sourcePath, store } = setup("history");
  try {
    await collectConnection(store, parsed.config.id);
    writeFileSync(
      sourcePath,
      '{"record_id":"record-1","subject":"subject-1","recorded_at":"2026-08-31T00:00:00Z","value":12}\n',
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
