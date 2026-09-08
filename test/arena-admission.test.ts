import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ObservationStore } from "../src/store.ts";
import { arenaBundle } from "./arena-fixture.ts";
import type { ArenaBundle } from "../src/arena-adapter.ts";
import { ARENA_SCHEMA_ID, ARENA_SCHEMA_SHA256 } from "../src/arena-schema-provenance.ts";
import { sha256 } from "../src/json.ts";
import { sameVerificationFactSet, verificationFactKey } from "../src/verification-facts.ts";
import { verifyConnection } from "../src/verify.ts";
import { parseCivilizationConfig } from "../src/institution.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { worldForm } from "../src/world-form.ts";

test("Arena schema dependency retains its exact byte hash and upstream identifier", () => {
  const bytes = readFileSync(new URL("../src/arena-observation-bundle-v1.schema.json", import.meta.url), "utf8");
  assert.equal(sha256(bytes), ARENA_SCHEMA_SHA256);
  assert.equal(JSON.parse(bytes).$id, ARENA_SCHEMA_ID);
});

test("Arena registration persists expected identity and refuses active replacement", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-arena-"));
  let store = new ObservationStore(directory);
  assert.equal(store.registerArenaSource("arena", "source", "Synthetic Owner"), "connected");
  assert.equal(store.registerArenaSource("arena", "source", "Synthetic Owner"), "unchanged");
  assert.throws(() => store.registerArenaSource("arena", "other", "Synthetic Owner"));
  store.close();
  store = new ObservationStore(directory);
  assert.deepEqual(store.getConnection("arena").config.reader, {
    type: "arena", sourceId: "source", owner: "Synthetic Owner",
  });
  store.close();
});

test("Arena reconnect retains the latest report by configuration while collection health resets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-arena-"));
  let store = new ObservationStore(directory);
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  bundle.bundleId = "latest-report";
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  const latest = store.narrate().sourceReports![0]!;
  store.disconnect("arena");
  assert.equal(store.narrate().sourceReports!.length, 0);
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  store.close();
  store = new ObservationStore(directory);
  assert.equal(store.narrate().claims.length, 1);
  assert.deepEqual(store.narrate().sourceReports, [latest]);
  assert.equal(store.statuses()[0]!.reason, "never-run");
  assert.equal(store.statuses()[0]!.lastAttemptAt, null);
  await assert.rejects(store.admitArenaBundle("arena", "{"), { code: "arena_invalid" });
  assert.equal(store.statuses()[0]!.reason, "failed");
  assert.deepEqual(store.narrate().sourceReports, [latest]);
  store.disconnect("arena");
  store.registerArenaSource("arena", "other-source", "Synthetic Owner");
  assert.equal(store.narrate().sourceReports!.length, 0);
  assert.equal(store.narrate().claims.length, 0);
  store.close();
});

test("Arena previous-bundle references reject plain and percent-encoded self references but preserve valid prior URIs", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  bundle.provenance.inputs[0]!.role = "previous_bundle";
  for (const uri of [
    "urn:arena:bundle:bundle-one",
    "urn:arena:bundle:%62undle-one",
    "urn:arena:bundle:bundle%2Done",
    "https://example.invalid/bundles/%62undle-one",
  ]) {
    bundle.provenance.inputs[0]!.uri = uri;
    await assert.rejects(store.admitArenaBundle("arena", JSON.stringify(bundle)), { code: "arena_invalid" }, uri);
    assert.equal(store.countFacts(), 0);
    assert.equal(store.narrate().sourceReports!.length, 0);
  }
  const previousUris = [
    "urn:arena:bundle:bundle-old",
    "urn:arena:bundle:%62undle-old",
    "https://example.invalid/bundles/bundle%2Dold",
    "urn:arena:bundle:previous-proof-3-extra",
  ];
  for (const [index, uri] of previousUris.entries()) {
    bundle.bundleId = `previous-proof-${index}`;
    bundle.provenance.inputs[0]!.uri = uri;
    const result = await store.admitArenaBundle("arena", JSON.stringify(bundle));
    assert.equal(result.outcome, "success");
    assert.equal(store.querySourceReport(result.reportId)!.bundle.provenance.inputs[0]!.uri, uri);
  }
  store.close();
});

test("Arena upstream empty and outage reports remain successful reads, late onboarding and local latest order stay distinct", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const initial = arenaBundle();
  initial.producedAt = "2099-01-01T00:00:00Z";
  await store.admitArenaBundle("arena", JSON.stringify(initial));
  const empty = arenaBundle();
  empty.bundleId = "empty"; empty.facts = []; empty.observation.activity = "none";
  await store.admitArenaBundle("arena", JSON.stringify(empty));
  assert.equal(store.narrate().sourceReports![0]!.bundleId, "empty");
  assert.equal(store.narrate().sourceReports![0]!.factCount, 0);
  assert.equal(store.statuses()[0]!.status, "quiet");
  assert.equal(store.queryClaims()[0]!.temporalStatus, "historical");
  const outage = arenaBundle() as ArenaBundle;
  outage.bundleId = "outage"; outage.facts = [];
  outage.observation = { state: "cannot_observe", attemptedAt: outage.producedAt, failedAt: outage.producedAt, activity: "unknown", failure: "timeout", retryable: true, lastSuccessfulBundleId: "not-collected-locally" };
  outage.processing.models.forEach((model) => { model.status = "not_run"; model.outputDigest = null; });
  outage.freshness = { status: "unknown", basis: "unavailable", evaluatedAt: outage.producedAt, sourceAsOf: null, validUntil: null };
  const result = await store.admitArenaBundle("arena", JSON.stringify(outage));
  assert.equal(result.outcome, "success");
  assert.equal(store.statuses()[0]!.status, "quiet");
  assert.equal(store.narrate().sourceReports![0]!.observation.state, "cannot_observe");
  assert.equal(store.querySourceReport(result.reportId)!.bundle.observation.state, "cannot_observe");
  outage.observation.lastSuccessfulBundleId = "outage";
  await assert.rejects(store.admitArenaBundle("arena", JSON.stringify(outage)), { code: "arena_invalid" });
  assert.equal(store.statuses()[0]!.status, "unread");
  assert.equal(store.narrate().sourceReports![0]!.bundleId, "outage");
  store.close();
});

test("Arena only admits through registered text/bytes boundary, never generic raw fact collection", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  await assert.rejects(store.admitArenaBundle("missing", JSON.stringify(arenaBundle())), { code: "connection_not_found" });
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  let called = false;
  await assert.rejects(store.collect(store.getConnection("arena"), () => { called = true; }), { code: "fact_not_declared" });
  assert.equal(called, false);
  const json = JSON.stringify(arenaBundle());
  await assert.rejects(store.admitArenaBundle("arena", "\ufeff" + json), { code: "arena_invalid" });
  await assert.rejects(store.admitArenaBundle("arena", new TextEncoder().encode("\ufeff" + json)), { code: "arena_invalid" });
  assert.equal(store.countFacts(), 0);
  store.close();
});

test("Arena canonical digest preserves __proto__ as private data and refuses changed prototype-key content", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const text = JSON.stringify(arenaBundle()).replace('"OWNER-PRIVATE-PAYLOAD"', '{"__proto__":{"marker":"original"},"constructor":{"prototype":"data"}}');
  const first = await store.admitArenaBundle("arena", text);
  const payload = store.querySourceReport(first.reportId)!.bundle.facts[0]!.payload.private as Record<string, unknown>;
  assert.equal(Object.hasOwn(payload, "__proto__"), true);
  assert.equal(Object.getPrototypeOf(payload), null);
  assert.equal(({} as Record<string, unknown>).marker, undefined);
  await assert.rejects(store.admitArenaBundle("arena", text.replace("original", "changed")), { code: "arena_conflict" });
  store.close();
});

test("Arena replay is canonical and idempotent, repeated facts retain last-seen and source time spelling", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-arena-"));
  const store = new ObservationStore(directory);
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  const first = await store.admitArenaBundle("arena", JSON.stringify(bundle));
  const again = await store.admitArenaBundle("arena", new TextEncoder().encode(JSON.stringify(bundle, null, 2)));
  assert.equal(again.reportId, first.reportId);
  assert.equal(again.factsAdded, 0);
  assert.equal(store.queryClaims()[0]!.collectionAsOf?.attemptId, again.attemptId);
  bundle.bundleId = "bundle-two";
  bundle.facts[0]!.sourceRecordedAt = "2026-09-01T12:00:00.000Z";
  bundle.facts[0]!.epistemicType = "derived";
  const next = await store.admitArenaBundle("arena", JSON.stringify(bundle));
  assert.notEqual(next.reportId, first.reportId);
  assert.equal(next.factsAdded, 0);
  assert.equal(store.countFacts(), 1);
  assert.equal(store.queryClaims()[0]!.sourceRecordedAt, bundle.facts[0]!.sourceRecordedAt);
  assert.equal(store.queryClaims()[0]!.sourceReport?.epistemicType, "derived");
  bundle.facts[0]!.payload.private = "conflicting";
  await assert.rejects(store.admitArenaBundle("arena", JSON.stringify(bundle)), { code: "arena_conflict" });
  assert.equal(store.narrate().sourceReports?.[0]?.bundleId, "bundle-two");
  const full = store.querySourceReport(first.reportId)!;
  assert.equal(Object.getPrototypeOf(full.bundle), null);
  store.close();
});

test("Arena admits nanosecond fact times with exact spelling, ordering and deduplication across reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-arena-"));
  let store = new ObservationStore(directory);
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  bundle.facts[0]!.sourceRecordedAt = "2026-09-01T11:59:59.123Z";
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  const legacy = store.exportOwnedState().bundle.observationStore.facts;
  store.close();
  store = new ObservationStore(directory);
  assert.deepEqual(store.exportOwnedState().bundle.observationStore.facts, legacy);

  bundle.bundleId = "nanosecond-bundle";
  const times = ["123", "123456", "123456788", "123456789"];
  bundle.facts = times.map((fraction, index) => ({
    ...bundle.facts[0]!, factId: index === 0 ? "fact" : `fact-${index}`,
    sourceRecordedAt: `2026-09-01T11:59:59.${fraction}Z`,
  }));
  const admitted = await store.admitArenaBundle("arena", JSON.stringify(bundle));
  assert.equal(admitted.factsAdded, 3);
  const claims = store.queryClaims();
  assert.deepEqual(claims.map((fact) => fact.sourceRecordedAt), bundle.facts.map((fact) => fact.sourceRecordedAt));
  assert.deepEqual(claims.map((fact) => fact.temporalStatus), ["historical", "historical", "historical", "current"]);
  assert.equal(store.querySourceReport(admitted.reportId)!.bundle.facts[3]!.sourceRecordedAt, "2026-09-01T11:59:59.123456789Z");
  assert.equal(store.exportOwnedState().bundle.observationStore.facts[0]!.sourceTimeKey, legacy[0]!.sourceTimeKey);
  assert.equal(store.factsForVerification(store.getConnection("arena")).sourceTimeKeysValid, true);

  bundle.bundleId = "equivalent-nanosecond-bundle";
  bundle.facts[3]!.sourceRecordedAt = "2026-09-01T11:59:59.1234567890Z";
  assert.equal((await store.admitArenaBundle("arena", JSON.stringify(bundle))).factsAdded, 0);
  store.close();
  store = new ObservationStore(directory);
  assert.equal(store.countFacts(), 4);
  assert.equal(store.narrate().claims[0]!.sourceRecordedAt, bundle.facts[3]!.sourceRecordedAt);
  assert.equal(store.narrate().claims[0]!.temporalStatus, "current");
  assert.equal(store.factsForVerification(store.getConnection("arena")).sourceTimeKeysValid, true);
  store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1, name: "Synthetic", domain: "Synthetic",
    sources: ["arena"], mayActAlone: ["read"], mustEscalate: ["write"] }));
  const world = composeWorldSnapshot(store);
  assert.equal(world.sourcePictures[0]!.sources[0]!.claims[0]!.sourceRecordedAt, bundle.facts[3]!.sourceRecordedAt);
  assert.equal(worldForm(world).snapshot.sourcePictures[0]!.sources[0]!.claims[0]!.sourceRecordedAt, bundle.facts[3]!.sourceRecordedAt);
  store.close();
});

test("Arena verification identities distinguish adjacent nanoseconds and equate trailing-zero spellings", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  bundle.facts[0]!.sourceRecordedAt = "2026-09-01T11:59:59.123456788Z";
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  const first = store.factsForVerification(store.getConnection("arena")).facts[0]!;
  bundle.bundleId = "later-nanosecond";
  bundle.facts[0]!.sourceRecordedAt = "2026-09-01T11:59:59.123456789Z";
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  const last = store.factsForVerification(store.getConnection("arena")).facts[1]!;
  assert.notEqual(verificationFactKey(first), verificationFactKey(last));
  assert.equal(sameVerificationFactSet([first], [last]), false);
  assert.equal(sameVerificationFactSet([last], [{ ...last, sourceRecordedAt: "2026-09-01T11:59:59.1234567890Z" }]), true);
  store.close();
});

test("Arena persists schema-maximum fact precision and detects corruption of its exact ordering key", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  const time = `2026-09-01T11:59:59.${"0".repeat(42)}1Z`;
  bundle.facts[0]!.sourceRecordedAt = time;
  const admitted = await store.admitArenaBundle("arena", JSON.stringify(bundle));
  assert.equal(time.length, 64);
  assert.equal(store.queryClaims()[0]!.sourceRecordedAt, time);
  assert.equal(store.querySourceReport(admitted.reportId)!.bundle.facts[0]!.sourceRecordedAt, time);
  assert.equal(store.factsForVerification(store.getConnection("arena")).sourceTimeKeysValid, true);
  const database = new DatabaseSync(store.path);
  database.prepare("UPDATE facts SET source_time_key = ?").run("2026-09-01T11:59:59.000Z");
  assert.equal(store.factsForVerification(store.getConnection("arena")).sourceTimeKeysValid, false);
  database.close();
  store.close();
});

test("Arena verification without an upstream reader is unread rather than evidence of missing facts", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const bundle = arenaBundle();
  bundle.facts[0]!.sourceRecordedAt = "2026-09-01T11:59:59.123456789Z";
  await store.admitArenaBundle("arena", JSON.stringify(bundle));
  const report = await verifyConnection(store, store.getConnection("arena"));
  assert.equal(report.outcome, "unread");
  assert.equal(report.unreadReason, "source_unreadable");
  assert.equal(report.counts.missingAtSource, 0);
  assert.equal(store.queryClaims()[0]!.temporalStatus, "current");
  store.close();
});

test("Arena migration preserves schema-15 history and exports exact report/link inventory before irreversible forget", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-arena-"));
  let store = new ObservationStore(directory);
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  store.close();
  const old = new DatabaseSync(join(directory, "observations.sqlite"));
  old.exec("DROP TABLE IF EXISTS source_report_admissions; DROP TABLE IF EXISTS source_report_facts; DROP TABLE IF EXISTS source_reports; PRAGMA user_version = 15");
  const prior = old.prepare("SELECT * FROM connection_versions").all();
  old.close();
  store = new ObservationStore(directory);
  const result = await store.admitArenaBundle("arena", JSON.stringify(arenaBundle()));
  store.close();
  store = new ObservationStore(directory);
  const inspect = new DatabaseSync(store.path);
  assert.deepEqual(inspect.prepare("SELECT * FROM connection_versions").all(), prior);
  assert.equal(inspect.prepare("PRAGMA user_version").get()!.user_version, 16);
  inspect.close();
  assert.equal(store.narrate().claims.length, 1);
  store.disconnect("arena");
  const exported = store.exportOwnedState();
  assert.match(exported.bytes, /OWNER-PRIVATE-PAYLOAD/);
  assert.equal(exported.counts.sourceReports, 1);
  const plan = store.planForget("arena", "synthetic-user");
  assert.deepEqual(plan.sourceReportIds, [result.reportId]);
  assert.equal(plan.counts.sourceReportFacts, 1);
  assert.equal(plan.counts.sourceReportAdmissions, 1);
  assert.match(plan.consequence, /source report/i);
  await store.forget("arena", "synthetic-user", exported.digest, plan.confirmationToken);
  assert.equal(store.querySourceReport(result.reportId), undefined);
  assert.equal(store.countFacts(), 0);
  assert.equal(store.forgetRecords()[0]!.counts.sourceReports, 1);
  assert.doesNotMatch(store.exportOwnedState().bytes, /OWNER-PRIVATE-PAYLOAD/);
  store.close();
  store = new ObservationStore(directory);
  assert.equal(store.querySourceReport(result.reportId), undefined);
  store.close();
});

test("Arena refuses bounded malformed inputs, unsafe values and semantic reference/time violations without admitting data", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const invalid: (string | Uint8Array)[] = ["{", new Uint8Array([0xc3, 0x28]), " ".repeat(2 * 1024 * 1024 + 1), {} as string];
  const mutate = (change: (bundle: ReturnType<typeof arenaBundle>) => void) => {
    const bundle = arenaBundle(); change(bundle); invalid.push(JSON.stringify(bundle));
  };
  mutate((b) => { b.source.owner = "Other"; });
  mutate((b) => { b.schemaVersion = 2; });
  mutate((b) => { b.source.endpoint = "not a URI"; });
  mutate((b) => { b.processing.models.pop(); });
  mutate((b) => { b.processing.models[1]!.role = "extraction"; });
  mutate((b) => { b.processing.models[0]!.status = "not_run"; });
  mutate((b) => { b.observation.scopeComplete = false; });
  mutate((b) => { Object.assign(b, { unknown: "private-extra" }); });
  mutate((b) => { b.facts[0]!.subject = "unsafe\u0000suffix"; });
  mutate((b) => { b.facts[0]!.inputRefs = ["missing"]; });
  mutate((b) => { b.processing.rules[0]!.status = "not_run"; b.processing.rules.push({ ...b.processing.rules[0]!, ruleId: "completed", status: "completed" }); });
  mutate((b) => { b.processing.rules[0]!.ruleId = "extraction"; });
  mutate((b) => { b.provenance.inputs.push({ ...b.provenance.inputs[0]! }); });
  mutate((b) => { b.facts.push({ ...b.facts[0]! }); });
  mutate((b) => { b.verification.methods.push({ ...b.verification.methods[0]! }); });
  mutate((b) => { b.observation.attemptedAt = "2026-09-02T12:00:00Z"; });
  mutate((b) => { b.producedAt = "2026-09-01T11:59:59Z"; });
  mutate((b) => { b.facts[0]!.sourceRecordedAt = "2026-09-02T12:00:00Z"; });
  mutate((b) => { b.facts[0]!.validUntil = "2026-08-01T12:00:00Z" as never; });
  mutate((b) => { b.freshness.validUntil = "2026-08-01T12:00:00Z"; });
  mutate((b) => { b.verification.checkedAt = "2026-02-30T12:00:00Z"; });
  mutate((b) => { b.provenance.inputs[0]!.role = "previous_bundle"; b.provenance.inputs[0]!.uri = `urn:arena:bundle:${b.bundleId}`; });
  mutate((b) => { b.facts[0]!.payload = { nested: JSON.parse("[".repeat(40) + "0" + "]".repeat(40)) } as never; });
  mutate((b) => { b.facts[0]!.payload = { items: Array(10001).fill(0) } as never; });
  mutate((b) => { b.facts[0]!.payload = Object.fromEntries(Array.from({ length: 10001 }, (_, i) => [`key${i}`, i])) as never; });
  invalid.push(JSON.stringify(arenaBundle()).replace('"OWNER-PRIVATE-PAYLOAD"', "1e999"));
  invalid.push(JSON.stringify(arenaBundle()).replace('"OWNER-PRIVATE-PAYLOAD"', "-0"));
  invalid.push(JSON.stringify(arenaBundle()).replace('"OWNER-PRIVATE-PAYLOAD"', '"\\ud800"'));
  invalid.push(JSON.stringify(arenaBundle()).replace('"OWNER-PRIVATE-PAYLOAD"', "9007199254740993"));
  for (const [index, input] of invalid.entries()) {
    await assert.rejects(store.admitArenaBundle("arena", input), { code: "arena_invalid", message: "Collection failed" }, `case ${index}`);
    assert.equal(store.countFacts(), 0);
    assert.equal(store.narrate().sourceReports?.length, 0);
    assert.equal(store.statuses()[0]!.reason, "failed");
  }
  assert.equal(store.collectionAttempts().length, invalid.length);
  store.close();
});

test("Arena admits normal claims and only bounded generic metadata, with private detached owner query", async () => {
  const store = new ObservationStore(mkdtempSync(join(tmpdir(), "ecosym-arena-")));
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  const result = await store.admitArenaBundle("arena", JSON.stringify(arenaBundle()));
  const picture = store.narrate();
  assert.equal(picture.observations.length, 0);
  assert.equal(picture.claims.length, 1);
  assert.deepEqual(picture.claims[0]!.payload, {});
  assert.deepEqual(picture.claims[0]!.sourceReport, { reportId: result.reportId, epistemicType: "observation" });
  assert.equal(picture.claims[0]!.factOwner, "External Owner");
  assert.equal(picture.claims[0]!.collectionAsOf?.attemptId, result.attemptId);
  assert.equal(picture.sourceReports?.[0]?.factCount, 1);
  assert.equal(picture.connections[0]!.status, "changed");
  assert.doesNotMatch(JSON.stringify(picture), /OWNER-PRIVATE|private note|inputRefs|processingRefs|private uncertainty/);
  const report = store.querySourceReport(result.reportId)!;
  assert.equal(report.bundle.facts[0]!.payload.private, "OWNER-PRIVATE-PAYLOAD");
  report.bundle.facts[0]!.payload.private = "modified";
  assert.equal(store.querySourceReport(result.reportId)!.bundle.facts[0]!.payload.private, "OWNER-PRIVATE-PAYLOAD");
  store.close();
});
