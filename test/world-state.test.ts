import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoundedCivilizationSnapshot } from "../src/institution-snapshot.ts";
import { inspectFields, placePosition, stateCopy, worldState } from "../web/state.ts";

const entry: FoundedCivilizationSnapshot = {
  civilizationId: "civilization:synthetic", name: "Prøvested", foundedAt: "2026-01-01T00:00:00.000Z",
  bodyReadable: true, domain: "syntetisk", sources: ["test:kilde"], mayActAlone: [], mustEscalate: ["test:eskaler"],
  mandate: { status: "active", mandateId: "mandate:synthetic", revision: "revision:1", recordedAt: "2026-01-01T00:00:00.000Z" },
};

test("empty, loading, failed fetch, invalid shape, and populated copy are distinct", () => {
  assert.equal(worldState().kind, "loading");
  assert.equal(worldState({ schemaVersion: 1, civilizations: [] }).kind, "empty");
  assert.equal(worldState(undefined, true).kind, "error");
  for (const invalid of [null, {}, { schemaVersion: 1, civilizations: [], extra: true }, { schemaVersion: 1, civilizations: [{}] }]) {
    assert.equal(worldState(invalid).kind, "error");
  }
  assert.equal(worldState({ schemaVersion: 1, civilizations: [entry] }).kind, "ready");
  assert.equal(new Set(Object.values(stateCopy).map((copy) => copy.title)).size, 4);
  assert.match(stateCopy.empty.title, /Ingen sivilisasjoner er grunnlagt/);
});

// placePosition takes only an index by signature: tests cannot supply institutional content; that guarantee is structural (type-checked), not behavioral.
test("placement is stable and unique", () => {
  assert.deepEqual(placePosition(0), { x: 220, y: 230 });
  const positions = Array.from({ length: 100 }, (_, i) => JSON.stringify(placePosition(i)));
  assert.equal(new Set(positions).size, 100);
  assert.deepEqual(positions, Array.from({ length: 100 }, (_, i) => JSON.stringify(placePosition(i))));
});

test("inspection retains every field, raw identifiers and states without treating unknown as empty", () => {
  const fields = inspectFields(entry);
  const values = fields.flatMap((field) => field.values);
  for (const raw of [entry.civilizationId, entry.name, entry.foundedAt, "true", entry.domain,
    ...entry.sources, ...entry.mustEscalate, "active", "mandate:synthetic", "revision:1"]) assert.ok(values.includes(raw));
  assert.equal(fields.length, 12);
  assert.match(fields.find((field) => field.label === "Kan handle alene")!.values[0]!, /Ingen oppføringer/);
  const unknown = inspectFields({ ...entry, bodyReadable: false, domain: "", sources: [], mayActAlone: [], mustEscalate: [], mandate: { status: "unreadable" } });
  assert.ok(unknown.flatMap((field) => field.values).includes("false"));
  for (const label of ["Domene", "Kilder", "Kan handle alene", "Må eskalere"]) {
    assert.match(unknown.find((field) => field.label === label)!.values[0]!, /^Ukjent:/);
  }
  assert.deepEqual(unknown.find((field) => field.label === "Mandatstatus")!.values, ["unreadable", "Den lagrede mandatposten kunne ikke leses. Posten har ingen lesbar revisjon."]);
  assert.equal(unknown.some((field) => field.label === "Revisjon"), false);
  const dissolved = inspectFields({ ...entry, mandate: { status: "dissolved", mandateId: "mandate:synthetic", revision: "revision:2", recordedAt: entry.foundedAt } });
  assert.deepEqual(dissolved.find((field) => field.label === "Mandatstatus")!.values, ["dissolved", "Sivilisasjonen er oppløst i den lagrede posten."]);
});
