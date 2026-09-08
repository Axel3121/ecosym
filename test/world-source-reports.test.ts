import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { parseCivilizationConfig } from "../src/institution.ts";
import { ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { worldForm } from "../src/world-form.ts";
import { validateWorldSnapshot } from "../src/world-snapshot.ts";
import { arenaBundle } from "./arena-fixture.ts";
import type { WorldSnapshot } from "../src/world-snapshot.ts";

async function fixture(t: TestContext, bundle: unknown = arenaBundle()) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-world-reports-"));
  const store = new ObservationStore(join(directory, "state"));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1, name: "Synthetic", domain: "Synthetic",
    sources: ["arena"], mayActAlone: ["read"], mustEscalate: ["write"] }));
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  return store;
}

test("source reports travel through owner composition and form as bounded upstream metadata and claims", async (t) => {
  const store = await fixture(t);
  const snapshot = composeWorldSnapshot(store);
  const source = snapshot.sourcePictures[0]!.sources[0]!;
  assert.equal(source.sourceReport?.bundleId, "bundle-one");
  assert.equal(source.sourceReport.factCount, 1);
  assert.equal(source.claims.length, 1);
  assert.deepEqual(source.observations, []);
  assert.deepEqual(source.claims[0]!.payload, {});
  assert.deepEqual(source.claims[0]!.sourceReport, { reportId: source.sourceReport.reportId, epistemicType: "observation" });
  assert.deepEqual(validateWorldSnapshot(JSON.parse(JSON.stringify(snapshot))), snapshot);
  const form = worldForm(snapshot);
  const rendered = JSON.stringify(form);
  for (const privateField of ["OWNER-PRIVATE-PAYLOAD", "private note", "private uncertainty", "processingRefs", "inputRefs", "endpoint", "outputDigest"]) {
    assert.ok(!rendered.includes(privateField), privateField);
  }
  assert.match(rendered, /Source-reported epistemic type: observation/);
  assert.match(rendered, /Source-reported verification: partially_verified/);
  assert.match(rendered, /Source-reported freshness: current/);
  assert.match(rendered, /Source-reported uncertainty: unknown/);
  assert.equal(form.terrain, null);
});

for (const status of ["current", "stale"] as const) {
  for (const boundary of [validateWorldSnapshot, worldForm]) {
    test(`${boundary.name} refuses ${status} freshness with null validUntil`, async (t) => {
      const snapshot = composeWorldSnapshot(await fixture(t));
      const freshness = snapshot.sourcePictures[0]!.sources[0]!.sourceReport!.freshness;
      freshness.status = status;
      freshness.sourceAsOf = "2026-08-31T12:00:00Z";
      if (status === "stale") freshness.validUntil = "2026-09-01T11:59:59.999Z";
      assert.doesNotThrow(() => boundary(snapshot));
      freshness.validUntil = null;
      assert.throws(() => boundary(snapshot), /source report/);
      freshness.status = "unknown";
      assert.doesNotThrow(() => boundary(snapshot));
    });
  }
}

test("world validation preserves source-reported submillisecond fact times", async (t) => {
  const store = await fixture(t);
  const snapshot = composeWorldSnapshot(store);
  const instant = "2026-09-01T11:59:59.123456789Z";
  snapshot.sourcePictures[0]!.sources[0]!.claims[0]!.sourceRecordedAt = instant;
  assert.equal(worldForm(snapshot).snapshot.sourcePictures[0]!.sources[0]!.claims[0]!.sourceRecordedAt, instant);
});

test("no activity and cannot observe are upstream scope reports, not EcoSym read failure or domain inactivity", async (t) => {
  for (const state of ["observed", "cannot_observe"]) {
    const bundle = arenaBundle();
    const observation = state === "observed" ? { ...bundle.observation, activity: "none" }
      : { state, attemptedAt: bundle.producedAt, failedAt: bundle.producedAt, activity: "unknown", failure: "timeout",
        retryable: true, lastSuccessfulBundleId: "earlier-bundle" };
    const store = await fixture(t, { ...bundle, facts: [], observation,
      ...(state === "cannot_observe" ? { freshness: { status: "unknown", basis: "unavailable", evaluatedAt: bundle.producedAt,
        sourceAsOf: null, validUntil: null }, processing: { ...bundle.processing,
        models: bundle.processing.models.map((model) => ({ ...model, status: "not_run", outputDigest: null })) } } : {}) });
    const snapshot = composeWorldSnapshot(store);
    const source = snapshot.sourcePictures[0]!.sources[0]!;
    assert.equal(source.collection?.status, "quiet");
    assert.equal(source.sourceReport?.observation.state, state);
    assert.equal(source.sourceReport.factCount, 0);
    assert.deepEqual(source.claims, []);
    const form = worldForm(snapshot);
    assert.equal(form.terrain, null);
    assert.match(form.places[0]!.marks.find((mark) => mark.axis === "report")!.label, /only in selected scope/);
    assert.match(JSON.stringify(form), /Not Ecosym collection health or domain inactivity/);
  }
});

test("world and direct form input refuse raw payload even when report provenance is stripped", async (t) => {
  const store = await fixture(t);
  const snapshot = composeWorldSnapshot(store);
  const claim = snapshot.sourcePictures[0]!.sources[0]!.claims[0]!;
  claim.payload = { rawArenaPayload: "OWNER-PRIVATE-PAYLOAD" };
  for (const boundary of [validateWorldSnapshot, worldForm]) assert.throws(() => boundary(snapshot));
  delete claim.sourceReport;
  for (const boundary of [validateWorldSnapshot, worldForm]) assert.throws(() => boundary(snapshot));
});

test("closed world and form refuse extra fields at every nested object and malformed report metadata", async (t) => {
  const snapshot = composeWorldSnapshot(await fixture(t));
  const at = (value: unknown, path: string[]): Record<string, unknown> =>
    path.reduce((entry, key) => (entry as Record<string, unknown>)[key], value) as Record<string, unknown>;
  const refuse = (mutate: (value: WorldSnapshot) => void, label: string) => {
    const changed = structuredClone(snapshot);
    mutate(changed);
    for (const boundary of [validateWorldSnapshot, worldForm]) assert.throws(() => boundary(changed), label);
  };
  const visit = (value: unknown, path: string[] = []) => {
    if (typeof value !== "object" || value === null) return;
    refuse((changed) => { at(changed, path).rawArenaField = { payload: "OWNER-PRIVATE-PAYLOAD" }; }, path.join("."));
    for (const [key, entry] of Object.entries(value)) visit(entry, [...path, key]);
  };
  visit(snapshot);
  const root = ["sourcePictures", "0", "sources", "0"];
  const report = [...root, "sourceReport"];
  const cases: [string, unknown][] = [
    ["reportId", ""], ["reportId", "r".repeat(129)], ["bundleId", "b".repeat(129)],
    ["connectionId", "another"], ["connectionVersion", "a".repeat(63)], ["connectionVersion", "b".repeat(64)],
    ["sourceId", "s".repeat(129)], ["owner", "o".repeat(513)], ["selectedScope", "s".repeat(2049)],
    ["factCount", -1], ["factCount", 1001], ["factCount", 1.5], ["factCount", 0],
    ["admittedFrom", "2026-01-01T00:00:00Z"], ["admittedAt", "2020-01-01T00:00:00.000Z"],
    ["producedAt", "2026-02-30T00:00:00Z"], ["producedAt", "2026-09-01T12:00:00+00:00"],
    ["producedAt", "2026-09-01T12:00:60Z"], ["producedAt", `2026-09-01T12:00:00.${"1".repeat(44)}Z`],
    ["producedAt", "2026-09-01T11:59:59.999999999Z"],
    ["observation.state", "success"], ["observation.activity", "unknown"], ["observation.scopeComplete", false],
    ["observation.attemptedAt", "2026-09-01T12:00:00.000000001Z"],
    ["observation.completedAt", "2026-09-01T12:00:00.000000001Z"],
    ["verification.status", "confirmed"], ["verification.scope", "all"],
    ["verification.checkedAt", "2026-09-01T12:00:00.000000001Z"],
    ["freshness.status", "live"], ["freshness.basis", "unavailable"], ["freshness.sourceAsOf", null],
    ["freshness.evaluatedAt", "2026-09-01T12:00:00.000000001Z"],
    ["freshness.sourceAsOf", "2026-09-01T12:00:00.000000001Z"],
    ["freshness.validUntil", "2026-09-01T11:59:59.999999999Z"],
    ["freshness.status", "stale"], ["uncertainty.classification", "certain"],
    ["uncertainty.dimensions", []], ["uncertainty.dimensions", Array(33).fill({ kind: "coverage", level: "unknown" })],
    ["uncertainty.dimensions.0.kind", "authority"], ["uncertainty.dimensions.0.level", "certain"],
  ];
  for (const [field, value] of cases) {
    const path = [...report, ...field.split(".")];
    refuse((changed) => { at(changed, path.slice(0, -1))[path.at(-1)!] = value; }, field);
  }
  for (const [field, value] of [["reportId", "x".repeat(129)], ["epistemicType", "confirmed"]]) {
    refuse((changed) => { at(changed, [...root, "claims", "0", "sourceReport"])[field!] = value; }, `provenance.${field}`);
  }
  refuse((changed) => {
    const source = changed.sourcePictures[0]!.sources[0]!;
    const claim = source.claims.pop()!;
    claim.epistemicStatus = "observation";
    source.observations.push(claim);
  }, "report-backed observation");
  let accessorCalls = 0;
  refuse((changed) => {
    Object.defineProperty(at(changed, report), "owner", { enumerable: true, get() { accessorCalls++; return "owner"; } });
  }, "accessor");
  assert.equal(accessorCalls, 0);
});

test("latest local admission can have older source time and zero bundle facts while retained claims stay distinct", async (t) => {
  const bundle = arenaBundle();
  bundle.facts.push({ ...bundle.facts[0]!, factId: "second-fact", subject: "second subject", epistemicType: "derived" });
  const store = await fixture(t, bundle);
  const limited = composeWorldSnapshot(store, 1);
  assert.equal(limited.claimsTruncated, true);
  assert.equal(limited.sourcePictures[0]!.sources[0]!.sourceReport?.factCount, 2);
  assert.equal(limited.sourcePictures[0]!.sources[0]!.claims.length, 1);
  const older = "2026-08-01T00:00:00Z";
  await store.admitArenaBundle("arena", JSON.stringify({ ...bundle, bundleId: "later-admission", producedAt: older, facts: [],
    observation: { state: "cannot_observe", attemptedAt: older, failedAt: older, activity: "unknown", failure: "timeout",
      retryable: true, lastSuccessfulBundleId: "bundle-one" },
    provenance: { inputs: bundle.provenance.inputs.map((input) => ({ ...input, retrievedAt: older })) },
    processing: { ...bundle.processing, models: bundle.processing.models.map((model) => ({ ...model, status: "not_run", outputDigest: null })) },
    verification: { ...bundle.verification, checkedAt: older },
    freshness: { status: "unknown", basis: "unavailable", evaluatedAt: older, sourceAsOf: null, validUntil: null },
  }));
  const snapshot = composeWorldSnapshot(store);
  const source = snapshot.sourcePictures[0]!.sources[0]!;
  assert.equal(source.sourceReport?.bundleId, "later-admission");
  assert.equal(source.sourceReport.factCount, 0);
  assert.equal(source.claims.length, 2);
  assert.ok(source.claims.every((claim) => claim.sourceReport?.reportId !== source.sourceReport!.reportId));
  assert.equal(source.collection?.status, "quiet");
  assert.match(JSON.stringify(worldForm(snapshot)), /Latest locally admitted report, not newest external truth/);
  const report = source.sourceReport;
  assert.equal(report.observation.state, "cannot_observe");
  if (report.observation.state !== "cannot_observe") assert.fail("Expected upstream failure");
  for (const patch of [{ failure: "success" }, { retryable: "true" }, { lastSuccessfulBundleId: "later-admission" },
    { lastSuccessfulBundleId: "x".repeat(129) }, { activity: "none" }, { failedAt: "2026-07-01T00:00:00Z" }]) {
    const changed = structuredClone(snapshot);
    Object.assign(changed.sourcePictures[0]!.sources[0]!.sourceReport!.observation, patch);
    for (const boundary of [validateWorldSnapshot, worldForm]) assert.throws(() => boundary(changed));
  }
  for (const mutate of [
    (value: typeof report) => { value.freshness.status = "current"; },
    (value: typeof report) => { value.freshness.sourceAsOf = older; },
    (value: typeof report) => { value.freshness.validUntil = older; },
    (value: typeof report) => { value.uncertainty.dimensions = [{ kind: "extraction", level: "unknown" }]; },
  ]) {
    const changed = structuredClone(snapshot);
    mutate(changed.sourcePictures[0]!.sources[0]!.sourceReport!);
    for (const boundary of [validateWorldSnapshot, worldForm]) assert.throws(() => boundary(changed));
  }
});
