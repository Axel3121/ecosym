import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { collectConnection } from "../src/collect.ts";
import { parseConnectionConfig } from "../src/config.ts";
import { ObservationStore, type FactInput } from "../src/store.ts";

test("an exported bundle re-enters only as new observations of its file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-restore-boundary-"));
  const store = new ObservationStore(join(directory, "state"));
  try {
    const original = parseConnectionConfig({
      schemaVersion: 1,
      id: "original-source",
      factOwner: "original-owner",
      reader: { type: "jsonl", path: join(directory, "original.jsonl") },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }],
        retention: "history",
        recordedAt: { unavailable: true },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "original.observation",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
        {
          epistemicStatus: "claim",
          kind: "original.claim",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
      ],
    });
    store.register(original, new Date("2026-09-05T00:00:00.000Z"));
    const originalFacts: FactInput[] = [
      {
        epistemicStatus: "observation",
        factOwner: "original-owner",
        kind: "original.observation",
        payload: { value: "observed" },
        sourceRecordedAt: "2026-09-04T10:00:00.000Z",
        sourceRecordId: "original-observation-id",
        subject: "subject-a",
      },
      {
        epistemicStatus: "claim",
        factOwner: "original-owner",
        kind: "original.claim",
        payload: { value: "reported" },
        sourceRecordedAt: "2026-09-04T11:00:00.000Z",
        sourceRecordId: "original-claim-id",
        subject: "subject-b",
      },
    ];
    await store.collect(
      store.getConnection(original.config.id),
      (sink) => sink.recordSourceRecord(() => originalFacts),
      () => new Date("2026-09-05T01:00:00.000Z"),
    );

    const originalObservations = store.queryObservations({ connectionId: original.config.id });
    const originalClaims = store.queryClaims({ connectionId: original.config.id });
    assert.deepEqual(
      new Set([...originalObservations, ...originalClaims].map((fact) => fact.temporalStatus)),
      new Set(["current"]),
    );

    const bundlePath = join(directory, "observation-store-export.json");
    const exported = store.exportOwnedState(new Date("2026-09-05T02:00:00.000Z"));
    writeFileSync(bundlePath, exported.bytes, { mode: 0o600 });

    const bundleSource = parseConnectionConfig({
      schemaVersion: 1,
      id: "export-bundle-file",
      factOwner: "bundle-file-owner",
      reader: {
        type: "json",
        pathPattern: bundlePath,
        recordsPath: "observationStore.facts",
      },
      sourceRecord: {
        identity: [
          { scope: "meta", value: "source-path" },
          { scope: "record", path: "id" },
        ],
        retention: "history",
        recordedAt: { unavailable: true },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "ecosym-export.file-record",
          subject: { scope: "record", path: "sourceRecordId" },
          payload: {
            bundlePath: { scope: "meta", value: "source-path" },
            exportedFactId: { scope: "record", path: "id" },
            exportedFactOwner: { scope: "record", path: "factOwner" },
            exportedEpistemicStatus: { scope: "record", path: "epistemicStatus" },
            exportedTemporalStatus: { scope: "record", path: "temporalStatus" },
          },
        },
      ],
    });
    store.register(bundleSource, new Date("2026-09-05T03:00:00.000Z"));
    const collected = await collectConnection(store, bundleSource.config.id);
    assert.equal(collected.result.factsAdded, 2);

    const fileObservations = store.queryObservations({ connectionId: bundleSource.config.id });
    const originalIds = new Set(
      [...originalObservations, ...originalClaims].map((fact) => fact.id),
    );
    assert.equal(fileObservations.length, 2);
    assert.ok(fileObservations.every((fact) => fact.factOwner === "bundle-file-owner"));
    assert.ok(fileObservations.every((fact) => fact.epistemicStatus === "observation"));
    assert.ok(fileObservations.every((fact) => fact.kind === "ecosym-export.file-record"));
    assert.ok(fileObservations.every((fact) => fact.payload.bundlePath === bundlePath));
    assert.ok(fileObservations.every((fact) => fact.sourceRecordedAt === null));
    assert.ok(fileObservations.every((fact) => fact.temporalStatus === "unknown"));
    assert.ok(fileObservations.every((fact) => !originalIds.has(fact.id)));
    assert.deepEqual(
      new Set(fileObservations.map((fact) => fact.payload.exportedEpistemicStatus)),
      new Set(["claim", "observation"]),
    );
    assert.deepEqual(
      new Set(fileObservations.map((fact) => fact.payload.exportedTemporalStatus)),
      new Set(["current"]),
    );

    assert.deepEqual(
      store.queryObservations({ connectionId: original.config.id }),
      originalObservations,
    );
    assert.deepEqual(store.queryClaims({ connectionId: original.config.id }), originalClaims);
    assert.equal(store.queryClaims({ connectionId: bundleSource.config.id }).length, 0);
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
