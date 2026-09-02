import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScene } from "../src/scene.ts";
import { fixture } from "../src/fixture.ts";
import { plateKeyFor, seatFaceFor, agentFaceFor } from "../src/looks.ts";

test("any number of civilizations gets a plate and a seat face — nothing hardcoded per id", () => {
  const extra = Array.from({ length: 9 }, (_, i) => ({
    id: `civ-${i}`, name: `Civ ${i}`, domain: "test", seatName: `Seat ${i}`,
    mandate: { alone: [], council: [] }, ground: { x: 100 + i * 120, y: 200 + (i % 3) * 150 },
  }));
  const obs = { ...fixture, civilizations: [...fixture.civilizations, ...extra] };
  const scene = deriveScene(obs);
  assert.equal(scene.settlements.length, fixture.civilizations.length + 9, "all civilizations become settlements");
  for (const s of scene.settlements) {
    assert.ok(["harbor", "hill", "orchard", "lake"].includes(plateKeyFor(s.civilizationId)), `plate for ${s.civilizationId}`);
  }
  // seat faces: observed seats cycle 0..2, the unobserved always get the hood (3)
  assert.equal(seatFaceFor(0, true), 0); assert.equal(seatFaceFor(4, true), 1); assert.equal(seatFaceFor(99, false), 3);
  // stable: same identity, same look
  assert.equal(plateKeyFor("civ-7"), plateKeyFor("civ-7"));
  assert.equal(agentFaceFor("r1", "python"), 5);
  assert.ok(agentFaceFor("whatever", undefined) >= 6 && agentFaceFor("whatever", undefined) <= 11);
});
