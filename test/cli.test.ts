import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { parseConnectionConfig } from "../src/config.ts";
import { canonicalJson, sha256 } from "../src/json.ts";
import { materializeFacts } from "../src/materialize.ts";
import { ObservationStore } from "../src/store.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface CliResult {
  code: number;
  output: Record<string, unknown>;
  stderr: string;
}

test("the command surface connects, collects, queries, and verifies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-"));
  const sourcePath = join(directory, "source.jsonl");
  const configPath = join(directory, "connection.json");
  const xdgDataHome = join(directory, "data");
  writeFileSync(
    sourcePath,
    '{"id":"record-1","subject":"subject-1","at":"2026-08-30T00:00:00.000Z","value":7,"secret":"not selected"}\n',
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "cli-source",
      factOwner: "external-owner",
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
          kind: "api.value",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
      ],
    }),
  );

  const connect = await runCli(["connect", configPath], xdgDataHome);
  assert.equal(connect.code, 0);
  assert.equal(connect.output.outcome, "connected");

  const before = await runCli(["status"], xdgDataHome);
  assert.equal(
    (before.output.connections as { connectionVersion: string }[])[0]
      ?.connectionVersion,
    connect.output.connectionVersion,
  );
  assert.equal(
    (before.output.connections as { status: string }[])[0]?.status,
    "unread",
  );

  const collect = await runCli(["collect"], xdgDataHome);
  assert.equal(collect.code, 0);
  assert.equal(collect.output.outcome, "success");

  const query = await runCli(["query", "observations", "--limit", "10"], xdgDataHome);
  assert.equal(query.code, 0);
  const records = query.output.records as { payload: unknown }[];
  assert.deepEqual(records.map((record) => record.payload), [{ value: 7 }]);
  assert.equal(JSON.stringify(query.output).includes("not selected"), false);

  const verify = await runCli(["verify"], xdgDataHome);
  assert.equal(verify.code, 0);
  assert.equal(verify.output.outcome, "agreement");

  writeFileSync(
    sourcePath,
    '{"id":"record-1","subject":"subject-1","at":"2026-08-30T00:00:00.000Z","value":8}\n',
  );
  const disagreement = await runCli(["verify"], xdgDataHome);
  assert.equal(disagreement.code, 1);
  assert.equal(disagreement.output.outcome, "disagreement");
  assert.equal(disagreement.stderr, "");
});

test("the command surface exports and forgets only disconnected covered state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-forget-"));
  const sourcePath = join(directory, "source.jsonl");
  const configPath = join(directory, "connection.json");
  const exportPath = join(directory, "owned-state.json");
  const xdgDataHome = join(directory, "data");
  writeFileSync(
    sourcePath,
    '{"id":"record-1","subject":"subject-1","value":7}\n',
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "forgettable-source",
      factOwner: "external-owner",
      reader: { type: "jsonl", path: sourcePath },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }],
        retention: "history",
        recordedAt: { unavailable: true },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "api.value",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
      ],
    }),
  );

  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  assert.equal((await runCli(["collect"], xdgDataHome)).code, 0);
  const activeRefusal = await runCli(
    ["forget", "forgettable-source", "--by", "operator:test"],
    xdgDataHome,
  );
  assert.equal(activeRefusal.code, 1);
  assert.equal(activeRefusal.output.error, "forget_connection_active");
  assert.equal(
    (await runCli(["disconnect", "forgettable-source"], xdgDataHome)).code,
    0,
  );

  writeFileSync(exportPath, "pre-existing permissive file");
  chmodSync(exportPath, 0o666);
  const exported = await runCli(["export", exportPath], xdgDataHome);
  assert.equal(exported.code, 0);
  assert.equal(exported.output.outcome, "exported");
  assert.equal(exported.output.destination, exportPath);
  assert.equal(statSync(exportPath).mode & 0o777, 0o600);
  assert.equal(
    exported.output.digest,
    `sha256:${sha256(readFileSync(exportPath, "utf8"))}`,
  );
  const preview = await runCli(
    ["forget", "forgettable-source", "--by", "operator:test"],
    xdgDataHome,
  );
  assert.equal(preview.code, 0);
  assert.equal(preview.output.outcome, "confirmation-required");
  assert.equal(typeof preview.output.consequence, "string");
  assert.match(preview.output.recoverability as string, /no import or restore path/);
  const forgotten = await runCli(
    [
      "forget",
      "forgettable-source",
      "--by",
      "operator:test",
      "--export-digest",
      exported.output.digest as string,
      "--confirm",
      preview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(forgotten.code, 0);
  assert.equal(forgotten.output.outcome, "forgotten");
  assert.deepEqual(
    (await runCli(["query", "observations"], xdgDataHome)).output.records,
    [],
  );
  const status = await runCli(["status"], xdgDataHome);
  assert.deepEqual(status.output.connections, []);
  assert.equal((status.output.forgetRecords as unknown[]).length, 1);
  const verification = await runCli(["verify"], xdgDataHome);
  assert.equal(verification.code, 4);
  assert.equal(verification.output.unverifiedReason, "no_connections");
});

test("the query limit accepts its own boundaries", async (t) => {
  // Only rejected values were covered, so tightening the bound to exclude 1 and
  // 1000 would not have failed a single test.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-limit-ok-"));
  const xdgDataHome = join(directory, "data");
  for (const limit of ["1", "1000"]) {
    await t.test(limit, async () => {
      const result = await runCli(
        ["query", "observations", "--limit", limit],
        xdgDataHome,
      );
      assert.equal(result.code, 0);
    });
  }
});

test("out-of-range query limits are invalid arguments", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-limit-"));
  const xdgDataHome = join(directory, "data");
  for (const limit of ["0", "1001"]) {
    await t.test(limit, async () => {
      const result = await runCli(
        ["query", "observations", "--limit", limit],
        xdgDataHome,
      );
      assert.equal(result.code, 64);
      assert.deepEqual(result.output, {
        schemaVersion: 1,
        command: "query",
        outcome: "error",
        error: "invalid_arguments",
      });
      assert.equal(result.stderr, "");
    });
  }
});

test("an ambiguous legacy record index can be resolved by a recorded user choice", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-resolution-"));
  const sourcePath = join(directory, "source.jsonl");
  const configPath = join(directory, "connection.json");
  const xdgDataHome = join(directory, "data");
  const stateDirectory = join(xdgDataHome, "ecosym");
  const sourceText =
    '{"subject":"alpha","value":1}\n\n{"subject":"beta","value":2}\n';
  const configInput = {
    schemaVersion: 1,
    id: "legacy-index",
    factOwner: "external-owner",
    reader: { type: "jsonl", path: sourcePath },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  };
  writeFileSync(sourcePath, sourceText);
  writeFileSync(configPath, JSON.stringify(configInput));
  const parsed = parseConnectionConfig(configInput);
  const legacy = new ObservationStore(stateDirectory);
  legacy.register(parsed);
  await legacy.collect(legacy.getConnection(parsed.config.id), (sink) => {
    for (const [recordIndex, line] of sourceText.split("\n").entries()) {
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
  const identities = legacy.queryObservations().map((fact) => fact.sourceRecordId);
  legacy.close();
  const downgraded = new DatabaseSync(join(stateDirectory, "observations.sqlite"));
  downgraded.exec(`
    DROP TABLE IF EXISTS record_index_mode_resolutions;
    DROP TABLE IF EXISTS confirmation_previews;
    ALTER TABLE connection_versions DROP COLUMN jsonl_record_index_mode;
    PRAGMA user_version = 6;
  `);
  downgraded.close();

  const before = await runCli(["status"], xdgDataHome);
  assert.equal(
    (before.output.connections as { reason: string }[])[0]?.reason,
    "record-index-unknown",
  );
  assert.equal((await runCli(["disconnect", parsed.config.id], xdgDataHome)).code, 0);
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  const stillUnknown = await runCli(["status"], xdgDataHome);
  assert.equal(
    (stillUnknown.output.connections as { reason: string }[])[0]?.reason,
    "record-index-unknown",
  );

  const preview = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "physical-line"],
    xdgDataHome,
  );
  assert.equal(preview.code, 0);
  assert.equal(preview.output.outcome, "confirmation-required");
  assert.equal(preview.output.currentRecordIndexMode, "unknown");
  assert.equal(preview.output.factsAffected, 2);
  assert.equal(preview.output.collectionAttemptsRecorded, 1);
  assert.deepEqual(preview.output.affectedFactIds, [1, 2]);
  assert.equal(
    (preview.output.collectionAttemptIds as unknown[]).length,
    1,
  );
  assert.equal(typeof preview.output.consequence, "string");
  assert.equal(typeof preview.output.recoverability, "string");
  const confirmationToken = preview.output.confirmationToken;
  assert.equal(typeof confirmationToken, "string");
  const secondPreview = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "physical-line"],
    xdgDataHome,
  );
  assert.notEqual(secondPreview.output.confirmationToken, confirmationToken);
  const wrongChoice = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "record-ordinal",
      "--confirm",
      confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(wrongChoice.code, 1);
  assert.equal(wrongChoice.output.error, "confirmation_preview_not_found");

  const replacementSourcePath = join(directory, "replacement.jsonl");
  const replacementConfigPath = join(directory, "replacement.json");
  writeFileSync(replacementSourcePath, sourceText);
  const replacementInput = JSON.parse(JSON.stringify(configInput)) as {
    reader: { path: string };
  };
  replacementInput.reader.path = replacementSourcePath;
  writeFileSync(replacementConfigPath, JSON.stringify(replacementInput));
  assert.equal((await runCli(["disconnect", parsed.config.id], xdgDataHome)).code, 0);
  assert.equal((await runCli(["connect", replacementConfigPath], xdgDataHome)).code, 0);
  const wrongVersion = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(wrongVersion.code, 1);
  assert.equal(wrongVersion.output.error, "connection_inactive");
  assert.equal((await runCli(["disconnect", parsed.config.id], xdgDataHome)).code, 0);
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);

  const resolution = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(resolution.code, 0);
  assert.equal(resolution.output.outcome, "resolved");
  assert.equal(resolution.output.connectionVersion, parsed.hash);
  assert.equal(resolution.output.previousRecordIndexMode, "unknown");
  assert.equal(resolution.output.recordIndexMode, "physical-line");
  assert.equal(typeof resolution.output.resolutionId, "string");
  assert.equal(typeof resolution.output.resolvedAt, "string");
  const repeatedResolution = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(repeatedResolution.code, 1);
  assert.equal(repeatedResolution.output.error, "confirmation_already_spent");
  const supersededPreview = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      secondPreview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(supersededPreview.code, 1);
  assert.equal(
    supersededPreview.output.error,
    "record_index_resolution_state_changed",
  );

  const verification = await runCli(["verify"], xdgDataHome);
  assert.equal(verification.code, 0);
  assert.equal(verification.output.outcome, "agreement");

  const staleCorrectionPreview = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "record-ordinal"],
    xdgDataHome,
  );
  assert.equal((await runCli(["collect", parsed.config.id], xdgDataHome)).code, 0);
  const staleCorrection = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "record-ordinal",
      "--confirm",
      staleCorrectionPreview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(staleCorrection.code, 1);
  assert.equal(
    staleCorrection.output.error,
    "record_index_resolution_state_changed",
  );
  const correctionPreview = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "record-ordinal"],
    xdgDataHome,
  );
  const correction = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "record-ordinal",
      "--confirm",
      correctionPreview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(correction.code, 0);
  assert.equal(correction.output.previousRecordIndexMode, "physical-line");

  const restorationPreview = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "physical-line"],
    xdgDataHome,
  );
  const restoration = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      restorationPreview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(restoration.code, 0);
  assert.equal(restoration.output.previousRecordIndexMode, "record-ordinal");
  assert.equal((await runCli(["verify"], xdgDataHome)).code, 0);
  assert.equal((await runCli(["disconnect", parsed.config.id], xdgDataHome)).code, 0);
  const status = await runCli(["status"], xdgDataHome);
  assert.deepEqual(status.output.connections, []);
  const resolutions = status.output.recordIndexModeResolutions as {
    affectedFactIds: number[];
    collectionAttemptIds: string[];
    previousRecordIndexMode: string;
    recordIndexMode: string;
  }[];
  assert.deepEqual(
    resolutions.map((record) => [
      record.previousRecordIndexMode,
      record.recordIndexMode,
    ]),
    [
      ["unknown", "physical-line"],
      ["physical-line", "record-ordinal"],
      ["record-ordinal", "physical-line"],
    ],
  );
  assert.deepEqual(
    resolutions.map((record) => record.affectedFactIds),
    [[1, 2], [1, 2], [1, 2]],
  );
  assert.deepEqual(
    resolutions.map((record) => record.collectionAttemptIds.length),
    [1, 2, 2],
  );

  const inspected = new ObservationStore(stateDirectory);
  try {
    assert.deepEqual(
      inspected.queryObservations().map((fact) => fact.sourceRecordId),
      identities,
    );
  } finally {
    inspected.close();
  }
});

test("record-index confirmation cannot be forged from readable empty state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-resolution-preview-"));
  const xdgDataHome = join(directory, "data");
  const stateDirectory = join(xdgDataHome, "ecosym");
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "empty-legacy-index",
    factOwner: "external-owner",
    reader: { type: "jsonl", path: "/unused.jsonl" },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  const store = new ObservationStore(stateDirectory);
  store.register(parsed);
  const database = new DatabaseSync(store.path);
  database
    .prepare(
      "UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?",
    )
    .run(parsed.config.id);
  database.close();
  store.close();

  const status = await runCli(["status"], xdgDataHome);
  assert.equal(status.code, 0);
  assert.deepEqual(status.output.collectionAttempts, []);
  assert.deepEqual(
    (await runCli(["query", "observations"], xdgDataHome)).output.records,
    [],
  );
  assert.deepEqual(
    (await runCli(["query", "claims"], xdgDataHome)).output.records,
    [],
  );
  const forgedToken = `sha256:${sha256(
    canonicalJson([
      parsed.config.id,
      parsed.hash,
      "unknown",
      "physical-line",
      [],
      [],
      0,
      0,
    ]),
  )}`;
  const forgedConfirmation = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      forgedToken,
    ],
    xdgDataHome,
  );
  assert.equal(forgedConfirmation.code, 1);
  assert.equal(
    forgedConfirmation.output.error,
    "confirmation_preview_not_found",
  );

  const preview = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "physical-line"],
    xdgDataHome,
  );
  const issuedToken = preview.output.confirmationToken as string;
  const previewDatabase = new DatabaseSync(
    join(stateDirectory, "observations.sqlite"),
    { readOnly: true },
  );
  const persistedPreview = previewDatabase
    .prepare(
      `SELECT confirmation_token_hash, operation, issued_at, consumed_at
         FROM confirmation_previews`,
    )
    .get() as {
    confirmation_token_hash: string;
    consumed_at: null | string;
    issued_at: string;
    operation: string;
  };
  previewDatabase.close();
  assert.equal(persistedPreview.confirmation_token_hash, sha256(issuedToken));
  assert.notEqual(persistedPreview.confirmation_token_hash, issuedToken);
  assert.equal(persistedPreview.operation, "resolve-record-index");
  assert.match(persistedPreview.issued_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(persistedPreview.consumed_at, null);
  const resolution = await runCli(
    [
      "resolve-record-index",
      parsed.config.id,
      parsed.hash,
      "physical-line",
      "--confirm",
      issuedToken,
    ],
    xdgDataHome,
  );
  assert.equal(resolution.code, 0);
  const consumedDatabase = new DatabaseSync(
    join(stateDirectory, "observations.sqlite"),
    { readOnly: true },
  );
  const consumed = consumedDatabase
    .prepare("SELECT consumed_at FROM confirmation_previews")
    .get() as { consumed_at: null | string };
  consumedDatabase.close();
  assert.equal(consumed.consumed_at, resolution.output.resolvedAt);
});

test("retirement is an explicit, durable CLI recovery for an abandoned attempt", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-retire-"));
  const xdgDataHome = join(directory, "data");
  const stateDirectory = join(xdgDataHome, "ecosym");
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "abandoned-indexed-source",
    factOwner: "external-owner",
    reader: { type: "jsonl", path: "/unused.jsonl" },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  const store = new ObservationStore(stateDirectory);
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const database = new DatabaseSync(store.path);
  database
    .prepare("UPDATE connection_versions SET jsonl_record_index_mode = 'unknown' WHERE connection_id = ?")
    .run(parsed.config.id);
  database
    .prepare(
      `INSERT INTO collection_attempts (
        attempt_order, attempt_id, connection_id, config_hash, activation_id,
        started_at, completed_at, outcome, source_records_seen, facts_seen,
        facts_added, facts_changed, failure_code
      ) VALUES (1, 'abandoned-attempt', ?, ?, ?, ?, NULL, 'running', 0, 0, 0, 0, NULL)`,
    )
    .run(parsed.config.id, parsed.hash, active.activationId, "2026-09-01T10:00:00.000Z");
  database.close();
  store.close();

  const blocked = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "record-ordinal"],
    xdgDataHome,
  );
  assert.equal(blocked.code, 1);
  assert.equal(blocked.output.error, "record_index_resolution_collection_running");
  const listed = await runCli(["status"], xdgDataHome);
  assert.deepEqual(listed.output.collectionAttempts, [
    {
      activationId: active.activationId,
      attemptId: "abandoned-attempt",
      completedAt: null,
      connectionId: parsed.config.id,
      connectionVersion: parsed.hash,
      factsAdded: 0,
      factsChanged: 0,
      factsSeen: 0,
      failureCode: null,
      outcome: "running",
      sourceRecordsSeen: 0,
      startedAt: "2026-09-01T10:00:00.000Z",
    },
  ]);
  const listedAttempt = (listed.output.collectionAttempts as {
    attemptId: string;
    connectionId: string;
    connectionVersion: string;
    outcome: string;
    startedAt: string;
  }[])[0] as {
    attemptId: string;
    connectionId: string;
    connectionVersion: string;
    outcome: string;
    startedAt: string;
  };
  const forgedToken = `sha256:${sha256(
    canonicalJson([
      listedAttempt.attemptId,
      listedAttempt.connectionId,
      listedAttempt.connectionVersion,
      listedAttempt.startedAt,
      listedAttempt.outcome,
      "operator:recovery",
    ]),
  )}`;
  const forgedRetirement = await runCli(
    [
      "retire-collection-attempt",
      "abandoned-attempt",
      "--by",
      "operator:recovery",
      "--confirm",
      forgedToken,
    ],
    xdgDataHome,
  );
  assert.equal(forgedRetirement.code, 1);
  assert.equal(
    forgedRetirement.output.error,
    "confirmation_preview_not_found",
  );
  const preview = await runCli(
    ["retire-collection-attempt", "abandoned-attempt", "--by", "operator:recovery"],
    xdgDataHome,
  );
  assert.equal(preview.code, 0);
  assert.equal(preview.output.outcome, "confirmation-required");
  const secondPreview = await runCli(
    ["retire-collection-attempt", "abandoned-attempt", "--by", "operator:recovery"],
    xdgDataHome,
  );
  assert.notEqual(
    secondPreview.output.confirmationToken,
    preview.output.confirmationToken,
  );
  const wrongActor = await runCli(
    [
      "retire-collection-attempt",
      "abandoned-attempt",
      "--by",
      "operator:other",
      "--confirm",
      preview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(wrongActor.code, 1);
  assert.equal(wrongActor.output.error, "confirmation_preview_not_found");
  const confirmationArguments = [
    "retire-collection-attempt",
    "abandoned-attempt",
    "--by",
    "operator:recovery",
    "--confirm",
    preview.output.confirmationToken as string,
  ];
  const competingConfirmations = await Promise.all([
    runCli(confirmationArguments, xdgDataHome),
    runCli(confirmationArguments, xdgDataHome),
  ]);
  const retired = competingConfirmations.find((result) => result.code === 0);
  const refusedReplay = competingConfirmations.find((result) => result.code === 1);
  assert.equal(retired?.output.outcome, "retired");
  assert.equal(refusedReplay?.output.error, "confirmation_already_spent");
  const repeatedRetirement = await runCli(
    confirmationArguments,
    xdgDataHome,
  );
  assert.equal(repeatedRetirement.code, 1);
  assert.equal(repeatedRetirement.output.error, "confirmation_already_spent");
  const supersededPreview = await runCli(
    [
      "retire-collection-attempt",
      "abandoned-attempt",
      "--by",
      "operator:recovery",
      "--confirm",
      secondPreview.output.confirmationToken as string,
    ],
    xdgDataHome,
  );
  assert.equal(supersededPreview.code, 1);
  assert.equal(
    supersededPreview.output.error,
    "record_index_resolution_state_changed",
  );
  const recovered = await runCli(
    ["resolve-record-index", parsed.config.id, parsed.hash, "record-ordinal"],
    xdgDataHome,
  );
  assert.equal(recovered.code, 0);
  assert.equal(recovered.output.outcome, "confirmation-required");
  const audited = await runCli(["status"], xdgDataHome);
  assert.equal((audited.output.collectionAttempts as { outcome: string }[])[0]?.outcome, "retired");
  const retirementAudit = audited.output.collectionAttemptRetirements as {
    attemptId: string;
    retiredAt: string;
    retiredBy: string;
  }[];
  assert.deepEqual(
    retirementAudit.map((retirement) => [retirement.attemptId, retirement.retiredBy]),
    [["abandoned-attempt", "operator:recovery"]],
  );
  assert.match(retirementAudit[0]?.retiredAt as string, /^\d{4}-\d{2}-\d{2}T/);
});

test("a confirmed retirement retries through a SQLite write lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-retire-contention-"));
  const xdgDataHome = join(directory, "data");
  const stateDirectory = join(xdgDataHome, "ecosym");
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "contended-retirement-source",
    factOwner: "external-owner",
    reader: { type: "jsonl", path: "/unused.jsonl" },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  const store = new ObservationStore(stateDirectory);
  store.register(parsed);
  const active = store.getConnection(parsed.config.id);
  const database = new DatabaseSync(store.path);
  database
    .prepare(
      `INSERT INTO collection_attempts (
         attempt_order, attempt_id, connection_id, config_hash, activation_id,
         started_at, completed_at, outcome, source_records_seen, facts_seen,
         facts_added, facts_changed, failure_code
       ) VALUES (1, 'contended-attempt', ?, ?, ?, ?, NULL, 'running', 0, 0, 0, 0, NULL)`,
    )
    .run(parsed.config.id, parsed.hash, active.activationId, "2026-09-01T10:00:00.000Z");
  database.close();
  store.close();

  const preview = await runCli(
    ["retire-collection-attempt", "contended-attempt", "--by", "operator:recovery"],
    xdgDataHome,
  );
  const confirmationArguments = [
    "retire-collection-attempt",
    "contended-attempt",
    "--by",
    "operator:recovery",
    "--confirm",
    preview.output.confirmationToken as string,
  ];
  const blocker = new DatabaseSync(join(stateDirectory, "observations.sqlite"));
  blocker.exec("BEGIN IMMEDIATE");
  blocker
    .prepare("UPDATE collection_attempts SET facts_seen = facts_seen WHERE attempt_id = ?")
    .run("contended-attempt");
  const confirmation = runCli(confirmationArguments, xdgDataHome);
  await delay(1_500);
  blocker.exec("ROLLBACK");
  blocker.close();

  const retired = await confirmation;
  assert.equal(retired.code, 0);
  assert.equal(retired.output.outcome, "retired");
  const replay = await runCli(confirmationArguments, xdgDataHome);
  assert.equal(replay.code, 1);
  assert.equal(replay.output.error, "confirmation_already_spent");
  const status = await runCli(["status"], xdgDataHome);
  assert.equal(
    (status.output.collectionAttemptRetirements as unknown[]).length,
    1,
  );
});

async function runCli(arguments_: string[], xdgDataHome: string): Promise<CliResult> {
  const child = spawn(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? -1));
  });
  return {
    code,
    output: JSON.parse(stdout) as Record<string, unknown>,
    stderr,
  };
}

test("collect reports failure in its outcome and its exit status", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-failure-"));
  const xdgDataHome = join(directory, "data");
  const readablePath = join(directory, "readable.jsonl");
  const unreadablePath = join(directory, "absent.jsonl");
  writeFileSync(
    readablePath,
    '{"id":"record-1","subject":"subject-1","at":"2026-08-30T00:00:00.000Z","value":7}\n',
  );

  const configFor = (id: string, sourcePath: string) => {
    const path = join(directory, `${id}.json`);
    writeFileSync(
      path,
      JSON.stringify({
        schemaVersion: 1,
        id,
        factOwner: "external-owner",
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
            kind: "api.value",
            subject: { scope: "record", path: "subject" },
            payload: { value: { scope: "record", path: "value" } },
          },
        ],
      }),
    );
    return path;
  };

  // The source file for this one is never created, so collection fails for a
  // reason the store reports rather than a crash.
  assert.equal((await runCli(["connect", configFor("absent-source", unreadablePath)], xdgDataHome)).code, 0);

  // One connection, and it fails: every collection attempted was unreadable.
  const allFailed = await runCli(["collect"], xdgDataHome);
  assert.equal(allFailed.output.outcome, "unread");
  assert.equal(allFailed.code, 2);

  assert.equal((await runCli(["connect", configFor("readable-source", readablePath)], xdgDataHome)).code, 0);

  // Two connections, one of each: a partial failure is neither success nor a
  // total failure, and it must not exit zero.
  const mixed = await runCli(["collect"], xdgDataHome);
  assert.equal(mixed.output.outcome, "mixed");
  assert.equal(mixed.code, 2);
  assert.deepEqual(
    (mixed.output.connections as { connectionId: string; outcome: string }[])
      .map((connection) => [connection.connectionId, connection.outcome])
      .sort(),
    [
      ["absent-source", "unread"],
      ["readable-source", "success"],
    ],
  );

  // Collecting only the healthy connection still succeeds, so the assertions
  // above distinguish failure from a CLI that reports failure unconditionally.
  const succeeded = await runCli(["collect", "readable-source"], xdgDataHome);
  assert.equal(succeeded.output.outcome, "success");
  assert.equal(succeeded.code, 0);
});

test("extra arguments are rejected rather than silently ignored", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-arity-"));
  const xdgDataHome = join(directory, "data");
  const sourcePath = join(directory, "source.jsonl");
  const configPath = join(directory, "connection.json");
  writeFileSync(
    sourcePath,
    '{"id":"record-1","subject":"subject-1","at":"2026-08-30T00:00:00.000Z","value":7}\n',
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "arity-source",
      factOwner: "external-owner",
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
          kind: "api.value",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
      ],
    }),
  );
  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);

  // An argument the command has no meaning for is a malformed invocation, not
  // an argument to discard. Accepting it would run something other than what
  // the caller wrote.
  for (const invocation of [
    ["collect", "arity-source", "unexpected"],
    ["status", "unexpected"],
    ["verify", "unexpected"],
  ]) {
    const rejected = await runCli(invocation, xdgDataHome);
    assert.equal(rejected.code, 64, invocation.join(" "));
    assert.equal(rejected.output.error, "invalid_arguments", invocation.join(" "));
    assert.equal(rejected.output.command, invocation[0], invocation.join(" "));
  }

  // The same commands without the extra argument still work, so the assertions
  // above are about arity rather than a CLI that rejects everything.
  for (const invocation of [["collect", "arity-source"], ["status"], ["verify"]]) {
    const accepted = await runCli(invocation, xdgDataHome);
    assert.notEqual(accepted.code, 64, invocation.join(" "));
    assert.notEqual(accepted.output.error, "invalid_arguments", invocation.join(" "));
  }
});
