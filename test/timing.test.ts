import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ArenaBundle } from "../src/arena-adapter.ts";
import { parseCivilizationConfig } from "../src/institution.ts";
import type { ConnectionStatus } from "../src/observation-snapshot.ts";
import { ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { worldForm } from "../src/world-form.ts";
import type { WorldSourceSnapshot } from "../src/world-snapshot.ts";
import { latestRead, readLine, sectors, signal } from "../web/timing.ts";
import { arenaBundle } from "./arena-fixture.ts";

const now = Date.parse("2026-03-01T12:00:00.000Z");
const status = { "nothing-new": "quiet", collected: "changed" } as Partial<Record<ConnectionStatus["reason"], ConnectionStatus["status"]>>;

function source(connectionId: string, reason: ConnectionStatus["reason"] | null, lastAttemptAt: string | null): WorldSourceSnapshot {
  return { connectionId, attemptsInProgress: [], observations: [], claims: [],
    collection: reason === null ? null : { connectionId, connectionVersion: "v1", reason, status: status[reason] ?? "unread", lastAttemptAt } };
}

test("only a successful latest attempt is a read; failed, skipped, retired and unfinished attempts read nothing", () => {
  for (const reason of ["collected", "nothing-new"] as const) {
    const sources = [source("a", reason, "2026-03-01T11:58:00.000Z")];
    assert.equal(latestRead(sources), "2026-03-01T11:58:00.000Z");
    assert.equal(readLine(sources, now), "lest for 2 min siden");
  }
  for (const reason of ["failed", "skipped", "retired", "incomplete", "record-index-unknown"] as const) {
    const sources = [source("a", reason, "2026-03-01T11:58:00.000Z")];
    assert.equal(latestRead(sources), null, `${reason} is not a read`);
    assert.equal(readLine(sources, now), "ulest etter siste forsøk", `${reason} is not shown as read two minutes ago`);
  }
});

test("an unsuccessful attempt after every read withholds the read time rather than understating it", () => {
  // Source b may have been read after a's read and before its own failure: when the world was last read is unknown.
  const hidden = [source("a", "nothing-new", "2026-03-01T09:00:00.000Z"), source("b", "failed", "2026-03-01T11:00:00.000Z")];
  assert.equal(latestRead(hidden), null);
  assert.equal(readLine(hidden, now), "ulest etter siste forsøk");
  // A read after every unsuccessful attempt is the latest read, whatever failed before it.
  const shown = [source("a", "collected", "2026-03-01T11:00:00.000Z"), source("b", "skipped", "2026-03-01T09:00:00.000Z")];
  assert.equal(latestRead(shown), "2026-03-01T11:00:00.000Z");
  assert.equal(readLine(shown, now), "lest for 1 t siden");
  assert.equal(latestRead([...shown, source("c", "incomplete", "2026-03-01T11:00:00.000Z")]), "2026-03-01T11:00:00.000Z", "an attempt no later than a read hides nothing");
});

test("never read, missing and undeclared sources are not reads, and instants order by time, not by spelling", () => {
  assert.equal(readLine([], now), "aldri lest");
  assert.equal(readLine([source("a", "never-run", null), source("b", null, null)], now), "aldri lest");
  assert.equal(readLine([source("a", "record-index-unknown", null)], now), "aldri lest");
  // Lexically "…00Z" sorts after "…00.500Z"; in time it is half a second earlier.
  assert.equal(latestRead([source("a", "collected", "2026-03-01T11:00:00Z"), source("b", "collected", "2026-03-01T11:00:00.500Z")]), "2026-03-01T11:00:00.500Z");
  assert.equal(latestRead([source("a", "collected", "2026-03-01T11:00:00.500Z"), source("b", "failed", "2026-03-01T11:00:00Z")]), "2026-03-01T11:00:00.500Z");
});

test("a source whose own report cannot observe is lost sight, never quiet, even though Ecosym read the report", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-timing-"));
  const store = new ObservationStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.registerArenaSource("arena", "source", "Synthetic Owner");
  store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1, name: "Synthetic", domain: "Synthetic domain", sources: ["arena"], mayActAlone: [], mustEscalate: [] }));
  await store.admitArenaBundle("arena", JSON.stringify(arenaBundle()));
  assert.equal(signal(worldForm(composeWorldSnapshot(store)).places[0]!, []).tone, "velocity");
  const outage = arenaBundle() as ArenaBundle;
  outage.bundleId = "outage"; outage.facts = [];
  outage.observation = { state: "cannot_observe", attemptedAt: outage.producedAt, failedAt: outage.producedAt, activity: "unknown", failure: "timeout", retryable: true, lastSuccessfulBundleId: "bundle-one" };
  outage.processing.models.forEach((model) => { model.status = "not_run"; model.outputDigest = null; });
  outage.freshness = { status: "unknown", basis: "unavailable", evaluatedAt: outage.producedAt, sourceAsOf: null, validUntil: null };
  await store.admitArenaBundle("arena", JSON.stringify(outage));
  const place = worldForm(composeWorldSnapshot(store)).places[0]!;
  assert.equal(sectors(place)[0]!.kind, "quiet", "Ecosym's own read of the report is still quiet");
  assert.equal(sectors(place)[0]!.blind, true);
  assert.deepEqual(signal(place, []), { tone: "loss", line: "Ingen signal: arena melder tapt sikt" });
  assert.equal(latestRead(place.sourcePicture.sources), null, "reading a report that could not observe is not a read of the source");
  assert.equal(readLine(place.sourcePicture.sources, Date.now()), "ulest etter siste forsøk");
  // After a reconnect nothing has been read in the new lifetime; the old report is history, not this lifetime's sight.
  store.disconnect("arena");
  assert.equal(store.registerArenaSource("arena", "source", "Synthetic Owner"), "connected");
  const reconnected = worldForm(composeWorldSnapshot(store)).places[0]!;
  assert.equal(reconnected.sourcePicture.sources[0]!.sourceReport?.observation.state, "cannot_observe", "the old report is still the latest admitted");
  assert.equal(sectors(reconnected)[0]!.blind, false);
  assert.deepEqual(signal(reconnected, []), { tone: "neutral", line: "1 ulest" });
});
