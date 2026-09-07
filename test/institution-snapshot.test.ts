import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  INSTITUTION_SNAPSHOT_SCHEMA_VERSION,
  type InstitutionSnapshot,
} from "../src/institution-snapshot.ts";
import { parseCivilizationConfig, parseMandateConfig } from "../src/institution.ts";
import { ObservationStore } from "../src/store.ts";

const body = {
  schemaVersion: 1,
  domain: "synthetic engineering",
  sources: ["synthetic-source"],
  mayActAlone: ["read.source"],
  mustEscalate: ["spend.money"],
};

test("institution snapshots are closed, ordered, and reflect redraw and dissolution", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-snapshot-"));
  const store = new ObservationStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const snapshot = (): InstitutionSnapshot => ({
    schemaVersion: INSTITUTION_SNAPSHOT_SCHEMA_VERSION,
    civilizations: store.listFoundedCivilizations(),
  });
  assert.deepEqual(snapshot(), { schemaVersion: 1, civilizations: [] });

  const early = "2026-01-01T00:00:00.000Z";
  const late = "2026-01-02T00:00:00.000Z";
  // Insert out of timestamp order to distinguish chronological from insertion order.
  const second = store.foundCivilization(parseCivilizationConfig({ ...body, name: "Second" }), new Date(late));
  const first = store.foundCivilization(parseCivilizationConfig({ ...body, name: "First" }), new Date(early));
  const expected = [
    { founded: first, name: "First", time: early },
    { founded: second, name: "Second", time: late },
  ].map(({ founded, name, time }) => ({
    civilizationId: founded.civilizationId,
    name,
    foundedAt: time,
    bodyReadable: true,
    domain: body.domain,
    sources: body.sources,
    mayActAlone: body.mayActAlone,
    mustEscalate: body.mustEscalate,
    mandate: { status: "active", mandateId: founded.mandateId, revision: "revision:1", recordedAt: time },
  }));
  assert.deepEqual(snapshot().civilizations, expected);
  assert.deepEqual(snapshot().civilizations, expected);
  for (const entry of snapshot().civilizations) {
    assert.deepEqual(Object.keys(entry).sort(), [
      "civilizationId", "name", "foundedAt", "bodyReadable", "domain", "sources", "mayActAlone", "mustEscalate", "mandate",
    ].sort());
    assert.deepEqual(Object.keys(entry.mandate).sort(), ["status", "mandateId", "revision", "recordedAt"].sort());
  }

  const redrawnAt = "2026-01-03T00:00:00.000Z";
  const redrawn = parseMandateConfig({ ...body, domain: "redrawn domain", sources: ["new-source"] });
  const revision = store.redrawMandate(first.civilizationId, redrawn, new Date(redrawnAt));
  const afterRedraw = store.listFoundedCivilizations();
  assert.deepEqual(afterRedraw[0], {
    ...expected[0], domain: redrawn.config.domain, sources: redrawn.config.sources,
    mandate: { status: "active", mandateId: first.mandateId, revision, recordedAt: redrawnAt },
  });
  assert.deepEqual(afterRedraw[1], expected[1]);

  const dissolvedAt = "2026-01-04T00:00:00.000Z";
  assert.equal(store.dissolveCivilization(first.civilizationId, new Date(dissolvedAt)), true);
  assert.deepEqual(store.listFoundedCivilizations(), [
    { ...afterRedraw[0], mandate: {
      status: "dissolved", mandateId: first.mandateId, revision: "revision:3", recordedAt: dissolvedAt,
    } },
    expected[1],
  ]);
});

for (const corruption of ["digest mismatch", "invalid JSON", "invalid mandate", "missing revision"]) {
  test(`institution snapshot isolates ${corruption} and orders timestamp ties by ID`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-snapshot-corrupt-"));
    const store = new ObservationStore(directory);
    const database = new DatabaseSync(store.path);
    t.after(() => { database.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
    const time = new Date("2026-01-01T00:00:00.000Z");
    const broken = store.foundCivilization(parseCivilizationConfig({ ...body, name: "Broken" }), time);
    const healthy = store.foundCivilization(parseCivilizationConfig({ ...body, name: "Healthy" }), time);
    const sortedIds = [broken.civilizationId, healthy.civilizationId].sort();
    // Force physical row order opposite to ID order, independent of random UUIDs.
    sortedIds.toReversed().forEach((id, index) => {
      database.prepare("UPDATE civilizations SET rowid = ? WHERE civilization_id = ?").run(index + 3, id);
    });
    const before = store.listFoundedCivilizations();
    assert.deepEqual(before.map((entry) => entry.civilizationId), sortedIds);
    assert.deepEqual(store.listFoundedCivilizations(), before);
    if (corruption === "missing revision") {
      database.prepare("DELETE FROM mandate_revisions WHERE civilization_id = ?").run(broken.civilizationId);
    } else {
      const json = corruption === "digest mismatch"
        ? parseMandateConfig({ ...body, domain: "tampered" }).canonical
        : corruption === "invalid JSON" ? "{" : "{}";
      database.prepare("UPDATE mandate_revisions SET mandate_json = ? WHERE civilization_id = ?")
        .run(json, broken.civilizationId);
    }
    const after = store.listFoundedCivilizations();
    assert.deepEqual(after, before.map((entry) => entry.civilizationId === broken.civilizationId
      ? { ...entry, bodyReadable: false, domain: "", sources: [], mayActAlone: [], mustEscalate: [],
        mandate: corruption === "missing revision" ? { status: "unreadable" } : entry.mandate }
      : entry));
    assert.deepEqual(Object.keys(after.find((entry) => entry.civilizationId === broken.civilizationId)!.mandate).sort(),
      corruption === "missing revision" ? ["status"] : ["status", "mandateId", "revision", "recordedAt"].sort());
  });
}

test("institution snapshot preserves dissolved revision metadata when its body is corrupted", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-snapshot-dissolved-"));
  const store = new ObservationStore(directory);
  const database = new DatabaseSync(store.path);
  t.after(() => { database.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const foundedAt = "2026-01-01T00:00:00.000Z";
  const dissolvedAt = "2026-01-02T00:00:00.000Z";
  const founded = store.foundCivilization(parseCivilizationConfig({ ...body, name: "Dissolved" }), new Date(foundedAt));
  assert.equal(store.dissolveCivilization(founded.civilizationId, new Date(dissolvedAt)), true);
  database.prepare("UPDATE mandate_revisions SET mandate_json = ? WHERE civilization_id = ? AND revision = ?")
    .run("{", founded.civilizationId, "revision:2");
  assert.deepEqual(store.listFoundedCivilizations(), [{
    civilizationId: founded.civilizationId,
    name: "Dissolved",
    foundedAt,
    bodyReadable: false,
    domain: "",
    sources: [],
    mayActAlone: [],
    mustEscalate: [],
    mandate: { status: "dissolved", mandateId: founded.mandateId, revision: "revision:2", recordedAt: dissolvedAt },
  }]);
});
