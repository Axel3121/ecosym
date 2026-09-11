import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { parseConnectionConfig } from "../src/config.ts";
import { parseCivilizationConfig, parseMandateConfig } from "../src/institution.ts";
import { sha256 } from "../src/json.ts";
import {
  ConfirmationAlreadySpentError,
  ConfirmationPreviewNotFoundError,
  CivilizationNotFoundError,
  ForgetCivilizationExportCoverageError,
  ForgetCivilizationNotFoundError,
  ForgetCivilizationNotDissolvedError,
  ForgetCivilizationStateChangedError,
  ForgetConnectionActiveError,
  ForgetExportCoverageError,
  ForgetStateChangedError,
  MandateUnreadableError,
  ObservationStore,
  type FactInput,
} from "../src/store.ts";

function civilization(name: string) {
  return parseCivilizationConfig({
    schemaVersion: 1,
    name,
    domain: `${name.toLowerCase()} domain`,
    sources: [`${name.toLowerCase()}-source`],
    mayActAlone: ["read.source"],
    mustEscalate: ["spend.money"],
  });
}

function redrawnMandate(extraCapability: string) {
  return parseMandateConfig({
    schemaVersion: 1,
    domain: "redrawn domain",
    sources: ["redrawn-source"],
    mayActAlone: ["read.source", extraCapability],
    mustEscalate: ["spend.money"],
  });
}

function connection(id: string) {
  return parseConnectionConfig({
    schemaVersion: 1,
    id,
    factOwner: `owner-${id}`,
    reader: { type: "jsonl", path: `/synthetic/${id}.jsonl` },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "synthetic.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
      {
        epistemicStatus: "claim",
        kind: "synthetic.report",
        subject: { scope: "record", path: "subject" },
        payload: { text: { scope: "record", path: "text" } },
      },
    ],
  });
}

function fact(id: string, epistemicStatus: "claim" | "observation"): FactInput {
  return epistemicStatus === "observation"
    ? {
        epistemicStatus,
        factOwner: `owner-${id}`,
        kind: "synthetic.value",
        payload: { value: "payload-that-must-be-deleted" },
        sourceRecordedAt: null,
        sourceRecordId: `${id}-observation`,
        subject: id,
      }
    : {
        epistemicStatus,
        factOwner: `owner-${id}`,
        kind: "synthetic.report",
        payload: { text: "claim-that-must-be-deleted" },
        sourceRecordedAt: null,
        sourceRecordId: `${id}-claim`,
        subject: id,
      };
}

test("owned state exports deterministically and forgets one exact covered inventory", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-state-"));
  const store = new ObservationStore(directory);
  const target = connection("target");
  const other = connection("other");
  try {
    store.register(target, new Date("2026-09-01T00:00:00.000Z"));
    store.register(other, new Date("2026-09-01T00:01:00.000Z"));
    await store.collect(
      store.getConnection("target"),
      (sink) => sink.recordSourceRecord(() => [fact("target", "observation"), fact("target", "claim")]),
      () => new Date("2026-09-01T01:00:00.000Z"),
    );
    await store.collect(
      store.getConnection("other"),
      (sink) => sink.recordSourceRecord(() => [fact("other", "observation")]),
      () => new Date("2026-09-01T01:01:00.000Z"),
    );
    const targetActive = store.getConnection("target");
    const setup = new DatabaseSync(store.path);
    try {
      setup
        .prepare(
          "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
        )
        .run("target");
      setup
        .prepare(
          `INSERT INTO collection_attempts
             (attempt_order, attempt_id, connection_id, config_hash, activation_id,
              started_at, completed_at, outcome, source_records_seen, facts_seen,
              facts_added, facts_changed, failure_code)
           VALUES (3, 'retired-target-attempt', 'target', ?, ?,
                   '2026-09-01T01:02:00.000Z', NULL, 'running', 0, 0, 0, 0, NULL)`,
        )
        .run(target.hash, targetActive.activationId);
    } finally {
      setup.close();
    }
    const retirementPlan = store.planCollectionAttemptRetirement(
      "retired-target-attempt",
      "operator:test",
    );
    await store.retireCollectionAttempt(
      "retired-target-attempt",
      "operator:test",
      retirementPlan.confirmationToken,
    );
    const resolutionPlan = store.planRecordIndexModeResolution(
      "target",
      target.hash,
      "physical-line",
    );
    await store.resolveRecordIndexMode(
      "target",
      target.hash,
      "physical-line",
      resolutionPlan.confirmationToken,
    );

    assert.throws(
      () => store.planForget("target", "operator:test"),
      ForgetConnectionActiveError,
    );
    assert.equal(store.disconnect("target"), true);
    await assert.rejects(
      () =>
        store.forget(
          "target",
          "operator:test",
          "sha256:unissued",
          "confirmation:unissued",
        ),
      ConfirmationPreviewNotFoundError,
    );

    const staleExport = store.exportOwnedState(new Date("2026-09-01T02:00:00.000Z"));
    const repeatedExport = store.exportOwnedState(new Date("2026-09-02T02:00:00.000Z"));
    assert.equal(repeatedExport.bytes, staleExport.bytes);
    assert.equal(staleExport.digest, `sha256:${sha256(staleExport.bytes)}`);
    const bundle = JSON.parse(staleExport.bytes) as {
      exportedAt: string;
      observationStore: { facts: { epistemicStatus: string; temporalStatus: string }[] };
      omitted: { section: string; reason: string }[];
    };
    assert.equal(bundle.exportedAt, "2026-09-01T02:00:00.000Z");
    assert.deepEqual(
      new Set(bundle.observationStore.facts.map((stored) => stored.epistemicStatus)),
      new Set(["claim", "observation"]),
    );
    assert.ok(bundle.observationStore.facts.every((stored) => stored.temporalStatus === "unknown"));
    assert.deepEqual(
      bundle.omitted.map((item) => item.section),
      ["confirmationPreviews", "ownedStateExports"],
    );

    assert.equal(store.register(target), "connected");
    await store.collect(store.getConnection("target"), (sink) => {
      sink.recordSourceRecord(() => [
        fact("target", "observation"),
        fact("target", "claim"),
        { ...fact("target", "observation"), sourceRecordId: "target-new" },
      ]);
    });
    assert.equal(store.disconnect("target"), true);
    const plan = store.planForget("target", "operator:test");
    assert.deepEqual(plan.connectionVersions, [target.hash]);
    assert.equal(plan.counts.facts, 3);
    assert.equal(plan.counts.collectionAttempts, 3);
    assert.equal(plan.counts.collectionAttemptRetirements, 1);
    assert.equal(plan.counts.recordIndexModeResolutions, 1);
    await assert.rejects(
      () =>
        store.forget(
          "target",
          "operator:test",
          staleExport.digest,
          plan.confirmationToken,
        ),
      ForgetExportCoverageError,
    );

    const coveringExport = store.exportOwnedState(new Date("2026-09-01T03:00:00.000Z"));
    assert.notEqual(coveringExport.digest, staleExport.digest);
    const forgotten = await store.forget(
      "target",
      "operator:test",
      coveringExport.digest,
      plan.confirmationToken,
      new Date("2026-09-01T04:00:00.000Z"),
    );
    assert.equal(forgotten.inventoryDigest, plan.inventoryDigest);
    assert.equal(forgotten.exportDigest, coveringExport.digest);
    assert.equal(store.countFacts("target"), 0);
    assert.equal(store.queryObservations({ connectionId: "target" }).length, 0);
    assert.equal(store.queryClaims({ connectionId: "target" }).length, 0);
    assert.deepEqual(store.statuses().map((status) => status.connectionId), ["other"]);
    assert.equal(store.countFacts("other"), 1);
    assert.equal(store.factsForVerification(store.getConnection("other")).facts.length, 1);
    await assert.rejects(
      () =>
        store.forget(
          "target",
          "operator:test",
          coveringExport.digest,
          plan.confirmationToken,
        ),
      ConfirmationAlreadySpentError,
    );
    const records = store.forgetRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.forgottenBy, "operator:test");
    assert.equal(JSON.stringify(records).includes("payload-that-must-be-deleted"), false);
    assert.equal(JSON.stringify(records).includes("claim-that-must-be-deleted"), false);

    const database = new DatabaseSync(store.path, { readOnly: true });
    try {
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
      for (const table of [
        "connection_versions",
        "active_connections",
        "facts",
        "collection_attempts",
        "collection_attempt_retirements",
        "record_index_mode_resolutions",
      ]) {
        const row = database
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE connection_id = ?`)
          .get("target") as { count: number };
        assert.equal(row.count, 0, table);
      }
    } finally {
      database.close();
    }
  } finally {
    store.close();
  }
});

test("owned state exports confirmation digests without confirmation tokens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-state-confirmations-"));
  const store = new ObservationStore(directory);
  const parsed = connection("confirmation-export");
  try {
    store.register(parsed);
    const active = store.getConnection(parsed.config.id);
    const setup = new DatabaseSync(store.path);
    try {
      setup
        .prepare(
          "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
        )
        .run(parsed.config.id);
      setup
        .prepare(
          `INSERT INTO collection_attempts
             (attempt_order, attempt_id, connection_id, config_hash, activation_id,
              started_at, completed_at, outcome, source_records_seen, facts_seen,
              facts_added, facts_changed, failure_code)
           VALUES (1, 'confirmation-export-attempt', ?, ?, ?,
                   '2026-09-03T00:00:00.000Z', NULL, 'running', 0, 0, 0, 0, NULL)`,
        )
        .run(parsed.config.id, parsed.hash, active.activationId);
    } finally {
      setup.close();
    }

    const retirementPreview = store.planCollectionAttemptRetirement(
      "confirmation-export-attempt",
      "operator:test",
    );
    await store.retireCollectionAttempt(
      retirementPreview.attemptId,
      retirementPreview.retiredBy,
      retirementPreview.confirmationToken,
    );
    const resolutionPreview = store.planRecordIndexModeResolution(
      parsed.config.id,
      parsed.hash,
      "physical-line",
    );
    await store.resolveRecordIndexMode(
      resolutionPreview.connectionId,
      resolutionPreview.connectionVersion,
      resolutionPreview.recordIndexMode,
      resolutionPreview.confirmationToken,
    );

    const exported = store.exportOwnedState();
    assert.equal(
      exported.bundle.observationStore.collectionAttemptRetirements[0]
        ?.confirmationTokenDigest,
      sha256(retirementPreview.confirmationToken),
    );
    assert.equal(
      exported.bundle.observationStore.recordIndexModeResolutions[0]
        ?.confirmationTokenDigest,
      sha256(resolutionPreview.confirmationToken),
    );
    for (const confirmationToken of [
      retirementPreview.confirmationToken,
      resolutionPreview.confirmationToken,
    ]) {
      assert.equal(exported.bytes.includes(confirmationToken), false);
      assert.equal(exported.bytes.includes(sha256(confirmationToken)), true);
    }
  } finally {
    store.close();
  }
});

test("owned state exports institutional history and fingerprints its changes", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-institution-"));
  const store = new ObservationStore(directory);
  try {
    const before = store.exportOwnedState(new Date("2026-09-04T00:00:00.000Z"));
    const founded = store.foundCivilization(
      parseCivilizationConfig({
        schemaVersion: 1,
        name: "Engineering",
        domain: "the software this person builds",
        sources: ["cli-source"],
        mayActAlone: ["read.source"],
        mustEscalate: ["spend.money"],
      }),
      new Date("2026-09-04T01:00:00.000Z"),
    );
    const after = store.exportOwnedState(new Date("2026-09-04T02:00:00.000Z"));

    assert.notEqual(after.digest, before.digest);
    assert.equal(after.counts.civilizations, 1);
    assert.equal(after.counts.mandateRevisions, 1);
    assert.equal(
      after.bundle.institutionStore.civilizations[0]?.civilizationId,
      founded.civilizationId,
    );
    assert.equal(
      after.bundle.institutionStore.mandateRevisions[0]?.mandateId,
      founded.mandateId,
    );
    assert.equal(after.bytes.includes("confirmationToken"), false);
  } finally {
    store.close();
  }
});

test("unchanged institutional state exports byte-identically with the same digest", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-institution-repeat-"));
  const store = new ObservationStore(directory);
  try {
    store.foundCivilization(civilization("Engineering"));
    const first = store.exportOwnedState(new Date("2026-09-04T00:00:00.000Z"));
    const second = store.exportOwnedState(new Date("2026-09-05T00:00:00.000Z"));
    assert.equal(second.bytes, first.bytes);
    assert.equal(second.digest, first.digest);
  } finally {
    store.close();
  }
});

test("redrawing changes the export while preserving the earlier mandate revision", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-institution-redraw-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(civilization("Engineering"));
    const before = store.exportOwnedState(new Date("2026-09-04T00:00:00.000Z"));
    store.redrawMandate(founded.civilizationId, redrawnMandate("write.code"));
    const after = store.exportOwnedState(new Date("2026-09-04T01:00:00.000Z"));
    assert.notEqual(after.digest, before.digest);
    assert.deepEqual(
      after.bundle.institutionStore.mandateRevisions.map((row) => row.revision),
      ["revision:1", "revision:2"],
    );
  } finally {
    store.close();
  }
});

test("dissolution export appends a dissolved revision without losing its chain", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-institution-dissolve-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(civilization("Engineering"));
    store.redrawMandate(founded.civilizationId, redrawnMandate("write.code"));
    store.dissolveCivilization(founded.civilizationId);
    const exported = store.exportOwnedState();
    assert.deepEqual(
      exported.bundle.institutionStore.mandateRevisions.map((row) => [
        row.revision,
        row.previousRevision,
        row.status,
      ]),
      [
        ["revision:1", null, "active"],
        ["revision:2", "revision:1", "active"],
        ["revision:3", "revision:2", "dissolved"],
      ],
    );
  } finally {
    store.close();
  }
});

test("owned state export refuses a mandate whose stored digest disagrees", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-institution-tamper-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(
      parseCivilizationConfig({
        schemaVersion: 1,
        name: "Engineering",
        domain: "the software this person builds",
        sources: ["cli-source"],
        mayActAlone: ["read.source"],
        mustEscalate: ["spend.money"],
      }),
    );
    const database = new DatabaseSync(store.path);
    try {
      database
        .prepare(
          "UPDATE mandate_revisions SET mandate_digest = 'sha256:wrong' WHERE civilization_id = ?",
        )
        .run(founded.civilizationId);
    } finally {
      database.close();
    }

    assert.throws(() => store.exportOwnedState(), MandateUnreadableError);
  } finally {
    store.close();
  }
});

test("civilization forget confirmation requires a matching preview", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-civilization-preview-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(civilization("Engineering"));
    store.dissolveCivilization(founded.civilizationId);
    const exported = store.exportOwnedState();
    await assert.rejects(
      store.forgetCivilization(
        founded.civilizationId,
        "operator:test",
        exported.digest,
        "confirmation:unissued",
      ),
      ConfirmationPreviewNotFoundError,
    );
  } finally {
    store.close();
  }
});

test("civilization forget preview distinctly refuses a live civilization", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-civilization-live-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(civilization("Engineering"));
    assert.throws(
      () => store.planForgetCivilization(founded.civilizationId, "operator:test"),
      ForgetCivilizationNotDissolvedError,
    );
    assert.throws(
      () => store.planForgetCivilization("civilization:absent", "operator:test"),
      ForgetCivilizationNotFoundError,
    );
  } finally {
    store.close();
  }
});

test("civilization forget requires export coverage after dissolution", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-civilization-coverage-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(civilization("Engineering"));
    const beforeDissolution = store.exportOwnedState();
    store.dissolveCivilization(founded.civilizationId);
    const plan = store.planForgetCivilization(founded.civilizationId, "operator:test");
    await assert.rejects(
      store.forgetCivilization(
        founded.civilizationId,
        "operator:test",
        beforeDissolution.digest,
        plan.confirmationToken,
      ),
      ForgetCivilizationExportCoverageError,
    );
  } finally {
    store.close();
  }
});

test("civilization forget deletes one whole covered chain and preserves unrelated state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-civilization-success-"));
  const store = new ObservationStore(directory);
  const observed = connection("observed");
  try {
    const target = store.foundCivilization(civilization("Engineering"));
    store.redrawMandate(target.civilizationId, redrawnMandate("write.code"));
    store.dissolveCivilization(target.civilizationId);
    const other = store.foundCivilization(civilization("Household"));
    const otherBefore = store.resolveAuthorityContext(other.civilizationId);
    store.register(observed);
    await store.collect(store.getConnection(observed.config.id), (sink) => {
      sink.recordSourceRecord(() => [fact("observed", "observation")]);
    });

    const coveringExport = store.exportOwnedState();
    const plan = store.planForgetCivilization(target.civilizationId, "operator:test");
    assert.equal(plan.counts.civilizations, 1);
    assert.equal(plan.counts.mandateRevisions, 3);
    assert.deepEqual(
      plan.mandateRevisions.map((revision) => Object.keys(revision).sort()),
      Array.from({ length: 3 }, () => ["civilizationId", "mandateId", "revision"]),
    );

    // State outside the target inventory may move without invalidating its evidence.
    store.foundCivilization(civilization("Garden"));
    await store.collect(store.getConnection(observed.config.id), (sink) => {
      sink.recordSourceRecord(() => [
        fact("observed", "observation"),
        { ...fact("observed", "observation"), sourceRecordId: "observed-later" },
      ]);
    });
    const forgotten = await store.forgetCivilization(
      target.civilizationId,
      "operator:test",
      coveringExport.digest,
      plan.confirmationToken,
      new Date("2026-09-04T04:00:00.000Z"),
    );
    assert.equal(forgotten.inventoryDigest, plan.inventoryDigest);
    assert.equal(forgotten.exportDigest, coveringExport.digest);
    assert.throws(
      () => store.resolveAuthorityContext(target.civilizationId),
      CivilizationNotFoundError,
    );
    assert.deepEqual(
      store.resolveAuthorityContext(other.civilizationId),
      otherBefore,
    );
    assert.equal(store.countFacts(observed.config.id), 2);
    assert.equal(
      store.factsForVerification(store.getConnection(observed.config.id)).facts.length,
      2,
    );

    const database = new DatabaseSync(store.path, { readOnly: true });
    try {
      assert.equal(
        (database
          .prepare("SELECT count(*) AS count FROM civilizations WHERE civilization_id = ?")
          .get(target.civilizationId) as { count: number }).count,
        0,
      );
      assert.equal(
        (database
          .prepare("SELECT count(*) AS count FROM mandate_revisions WHERE civilization_id = ?")
          .get(target.civilizationId) as { count: number }).count,
        0,
      );
    } finally {
      database.close();
    }

    const records = store.civilizationForgetRecords();
    assert.equal(records.length, 1);
    assert.deepEqual(records[0]?.mandateRevisions, plan.mandateRevisions);
    const serialized = JSON.stringify(records[0]);
    assert.equal(serialized.includes("mandateDigest"), false);
    assert.equal(serialized.includes("mandate_digest"), false);
    assert.equal(serialized.includes("mandateJson"), false);
    assert.equal(serialized.includes("mandate_json"), false);
    assert.equal(serialized.includes("revisionOrder"), false);
    const afterForgetExport = store.exportOwnedState();
    assert.equal(afterForgetExport.counts.civilizationForgetRecords, 1);
    assert.equal(
      afterForgetExport.bundle.institutionStore.civilizationForgetRecords.length,
      1,
    );

    await assert.rejects(
      store.forgetCivilization(
        target.civilizationId,
        "operator:test",
        coveringExport.digest,
        plan.confirmationToken,
      ),
      ConfirmationAlreadySpentError,
    );
  } finally {
    store.close();
  }
});

test("civilization forget confirmation refuses a changed revision chain as stale", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-civilization-stale-"));
  const store = new ObservationStore(directory);
  try {
    const founded = store.foundCivilization(civilization("Engineering"));
    store.dissolveCivilization(founded.civilizationId);
    const plan = store.planForgetCivilization(founded.civilizationId, "operator:test");
    const database = new DatabaseSync(store.path);
    try {
      database.exec(`
        INSERT INTO mandate_revisions (
          civilization_id, mandate_id, revision, previous_revision, status,
          mandate_json, mandate_digest, recorded_at
        )
        SELECT civilization_id, mandate_id, 'revision:3', revision, 'dissolved',
               mandate_json, mandate_digest, '2026-09-04T03:00:00.000Z'
          FROM mandate_revisions
         WHERE civilization_id = '${founded.civilizationId}'
         ORDER BY revision_order DESC LIMIT 1
      `);
    } finally {
      database.close();
    }
    const exported = store.exportOwnedState();
    await assert.rejects(
      store.forgetCivilization(
        founded.civilizationId,
        "operator:test",
        exported.digest,
        plan.confirmationToken,
      ),
      ForgetCivilizationStateChangedError,
    );
  } finally {
    store.close();
  }
});

test("forget confirmation refuses when the previewed inventory moves", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-stale-"));
  const store = new ObservationStore(directory);
  const parsed = connection("moving");
  try {
    store.register(parsed);
    store.disconnect("moving");
    const plan = store.planForget("moving", "operator:test");
    const database = new DatabaseSync(store.path);
    database
      .prepare(
        `INSERT INTO collection_attempts
           (attempt_order, attempt_id, connection_id, config_hash, activation_id,
            started_at, completed_at, outcome, source_records_seen, facts_seen,
            facts_added, facts_changed, failure_code)
         VALUES (1, 'later-attempt', 'moving', ?, 'inactive-lifetime',
                 '2026-09-02T00:00:00.000Z', '2026-09-02T00:00:00.000Z',
                 'skipped', 0, 0, 0, 0, 'synthetic_skip')`,
      )
      .run(parsed.hash);
    database.close();
    const exported = store.exportOwnedState();
    await assert.rejects(
      () =>
        store.forget(
          "moving",
          "operator:test",
          exported.digest,
          plan.confirmationToken,
        ),
      ForgetStateChangedError,
    );
    assert.equal(store.collectionAttempts()[0]?.attemptId, "later-attempt");
  } finally {
    store.close();
  }
});

test("confirmed forget retries through store contention without double-applying", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-forget-contention-"));
  const store = new ObservationStore(directory, 20);
  const parsed = connection("contended-forget");
  store.register(parsed);
  store.disconnect(parsed.config.id);
  const exported = store.exportOwnedState();
  const plan = store.planForget(parsed.config.id, "operator:test");
  const blocker = new DatabaseSync(store.path);
  blocker.exec("BEGIN IMMEDIATE");
  blocker
    .prepare("UPDATE connection_versions SET registered_at = registered_at WHERE connection_id = ?")
    .run(parsed.config.id);
  const forgetting = store.forget(
    parsed.config.id,
    "operator:test",
    exported.digest,
    plan.confirmationToken,
  );
  await delay(75);
  blocker.exec("ROLLBACK");
  blocker.close();

  try {
    const forgotten = await forgetting;
    assert.equal(forgotten.connectionId, parsed.config.id);
    assert.equal(store.forgetRecords().length, 1);
    await assert.rejects(
      store.forget(
        parsed.config.id,
        "operator:test",
        exported.digest,
        plan.confirmationToken,
      ),
      ConfirmationAlreadySpentError,
    );
    assert.equal(store.forgetRecords().length, 1);
  } finally {
    store.close();
  }
});

test("either branch's schema twelve converges without losing confirmations", async (context) => {
  for (const source of ["institution", "owned-state"] as const) {
    await context.test(source, async () => {
      const directory = mkdtempSync(join(tmpdir(), `ecosym-schema-twelve-${source}-`));
      const initial = new ObservationStore(directory);
      const parsed = connection(`schema-twelve-${source}`);
      initial.register(parsed);
      const setup = new DatabaseSync(initial.path);
      setup
        .prepare(
          "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
        )
        .run(parsed.config.id);
      setup.close();
      const preview = initial.planRecordIndexModeResolution(
        parsed.config.id,
        parsed.hash,
        "physical-line",
      );
      initial.close();

      const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
      if (source === "institution") {
        downgraded.exec(`
          ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v13;
          CREATE TABLE confirmation_previews (
            confirmation_token_hash TEXT NOT NULL PRIMARY KEY,
            operation TEXT NOT NULL
              CHECK (operation IN ('resolve-record-index', 'retire-collection-attempt')),
            arguments_json TEXT NOT NULL,
            state_fingerprint TEXT NOT NULL,
            issued_at TEXT NOT NULL,
            consumed_at TEXT
          ) STRICT;
          INSERT INTO confirmation_previews SELECT * FROM confirmation_previews_v13;
          DROP TABLE confirmation_previews_v13;
          DROP TABLE owned_state_exports;
          DROP TABLE forget_records;
        `);
      } else {
        downgraded.exec(`
          DROP INDEX mandate_revisions_current;
          DROP TABLE mandate_revisions;
          DROP TABLE civilizations;
        `);
      }
      downgraded.exec("PRAGMA user_version = 12");
      downgraded.close();

      const migrated = new ObservationStore(directory);
      try {
        await migrated.resolveRecordIndexMode(
          parsed.config.id,
          parsed.hash,
          "physical-line",
          preview.confirmationToken,
        );
        const inspected = new DatabaseSync(migrated.path, { readOnly: true });
        try {
          assert.equal(
            (inspected.prepare("PRAGMA user_version").get() as { user_version: number })
              .user_version,
              18,
          );
          for (const table of [
            "civilizations",
            "mandate_revisions",
            "owned_state_exports",
            "forget_records",
          ]) {
            assert.equal(
              (inspected
                .prepare(
                  "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
                )
                .get(table) as { count: number }).count,
              1,
              table,
            );
          }
        } finally {
          inspected.close();
        }
      } finally {
        migrated.close();
      }
    });
  }
});

test("schema eleven stores gain forget and export evidence without losing previews", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-owned-state-migration-"));
  const initial = new ObservationStore(directory);
  const parsed = connection("migration");
  initial.register(parsed);
  const resolutionSetup = new DatabaseSync(initial.path);
  resolutionSetup
    .prepare(
      "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
    )
    .run("migration");
  resolutionSetup.close();
  const preview = initial.planRecordIndexModeResolution(
    "migration",
    parsed.hash,
    "physical-line",
  );
  initial.close();

  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  downgraded.exec(`
    ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v12;
    CREATE TABLE confirmation_previews (
      confirmation_token_hash TEXT NOT NULL PRIMARY KEY,
      operation TEXT NOT NULL
        CHECK (operation IN ('resolve-record-index', 'retire-collection-attempt')),
      arguments_json TEXT NOT NULL,
      state_fingerprint TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
    INSERT INTO confirmation_previews SELECT * FROM confirmation_previews_v12;
    DROP TABLE confirmation_previews_v12;
    DROP TABLE owned_state_exports;
    DROP TABLE forget_records;
    PRAGMA user_version = 11;
  `);
  downgraded.close();

  const migrated = new ObservationStore(directory);
  try {
    await migrated.resolveRecordIndexMode(
      "migration",
      parsed.hash,
      "physical-line",
      preview.confirmationToken,
    );
    assert.equal(migrated.recordIndexModeResolutions().length, 1);
    const inspected = new DatabaseSync(migrated.path, { readOnly: true });
    try {
      const version = inspected.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      assert.equal(version.user_version, 18);
      for (const table of ["owned_state_exports", "forget_records"]) {
        const row = inspected
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?",
          )
          .get(table) as { count: number };
        assert.equal(row.count, 1, table);
      }
    } finally {
      inspected.close();
    }
  } finally {
    migrated.close();
  }
});

test("schema thirteen stores gain civilization evidence without losing previews", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-schema-thirteen-"));
  const initial = new ObservationStore(directory);
  const parsed = connection("schema-thirteen");
  initial.register(parsed);
  initial.disconnect(parsed.config.id);
  const exported = initial.exportOwnedState();
  const preview = initial.planForget(parsed.config.id, "operator:test");
  initial.close();

  const downgraded = new DatabaseSync(join(directory, "observations.sqlite"));
  downgraded.exec(`
    ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v14;
    CREATE TABLE confirmation_previews (
      confirmation_token_hash TEXT NOT NULL PRIMARY KEY,
      operation TEXT NOT NULL
        CHECK (operation IN ('resolve-record-index', 'retire-collection-attempt', 'forget')),
      arguments_json TEXT NOT NULL,
      state_fingerprint TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
    INSERT INTO confirmation_previews SELECT * FROM confirmation_previews_v14;
    DROP TABLE confirmation_previews_v14;
    ALTER TABLE owned_state_exports DROP COLUMN civilization_inventories_json;
    DROP TABLE civilization_forget_records;
    PRAGMA user_version = 13;
  `);
  downgraded.close();

  const migrated = new ObservationStore(directory);
  try {
    await migrated.forget(
      parsed.config.id,
      "operator:test",
      exported.digest,
      preview.confirmationToken,
    );
    const inspected = new DatabaseSync(migrated.path, { readOnly: true });
    try {
      assert.equal(
        (inspected.prepare("PRAGMA user_version").get() as { user_version: number })
          .user_version,
        18,
      );
      assert.deepEqual(
        (inspected.prepare("SELECT civilization_inventories_json FROM owned_state_exports").get() as {
          civilization_inventories_json: string;
        }).civilization_inventories_json,
        "[]",
      );
      assert.equal(
        (inspected
          .prepare(
            "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'civilization_forget_records'",
          )
          .get() as { count: number }).count,
        1,
      );
    } finally {
      inspected.close();
    }
  } finally {
    migrated.close();
  }
});
