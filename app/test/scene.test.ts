import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScene } from "../src/scene.ts";
import { fixture } from "../src/fixture.ts";

test("unobserved civilization takes no form", () => {
  const scene = deriveScene(fixture);
  const thule = scene.settlements.find((s) => s.civilizationId === "thule")!;
  assert.equal(thule.epistemic, "unobserved");
  assert.equal(thule.inhabitants.length, 0, "a live run in an unobserved place must not walk");
  assert.equal(thule.traces.length, 0);
  assert.equal(thule.buildings.filter((b) => b.kind === "workshop").length, 0);
  assert.equal(thule.live, false);
});

test("only runs observed live become inhabitants; finished runs become traces", () => {
  const scene = deriveScene(fixture);
  const roma = scene.settlements.find((s) => s.civilizationId === "roma")!;
  assert.deepEqual(roma.inhabitants.map((i) => i.runId).sort(), ["r1", "r1a", "r1b"]);
  assert.deepEqual(roma.traces.map((t) => t.runId), ["r0"]);
  assert.ok(roma.traces[0]!.freshness > 0 && roma.traces[0]!.freshness < 1);
  assert.equal(roma.live, true);
});

test("children live in their root's workshop and carry their depth", () => {
  const scene = deriveScene(fixture);
  const roma = scene.settlements.find((s) => s.civilizationId === "roma")!;
  const child = roma.inhabitants.find((i) => i.runId === "r1b")!;
  assert.equal(child.buildingId, "roma:w:r1");
  assert.equal(child.depth, 1);
  assert.equal(child.parentRunId, "r1");
});

test("a petition is a letter with progress from state, never a building", () => {
  const scene = deriveScene(fixture);
  const p1 = scene.letters.find((l) => l.petitionId === "p1")!;
  assert.equal(p1.state, "in-progress");
  assert.ok(p1.progress < 1, "a petition never arrives as a result");
  const roma = scene.settlements.find((s) => s.civilizationId === "roma")!;
  assert.ok(!roma.buildings.some((b) => b.id.includes("p1")));
});

test("routes exist only where something crossed a border", () => {
  const scene = deriveScene(fixture);
  const touched = new Set(scene.routes.map((r) => JSON.stringify(r.to) + JSON.stringify(r.from)));
  assert.equal(touched.size, scene.routes.length, "one route per crossing pair");
  // Thule was never observed and never petitioned: no route may touch it.
  const thule = scene.settlements.find((s) => s.civilizationId === "thule")!;
  assert.ok(
    !scene.routes.some((r) => r.to === thule.ground || r.from === thule.ground),
    "Thule neither petitioned nor was petitioned: no route",
  );
  // A refused petition still crossed the border: Midgard has a route, and the letter says refused.
  const midgard = scene.settlements.find((s) => s.civilizationId === "midgard")!;
  assert.ok(scene.routes.some((r) => r.to === midgard.ground || r.from === midgard.ground), "a refused petition is still a crossing");
  assert.equal(scene.letters.find((l) => l.toCivilizationId === "midgard")?.state, "refused");
});

test("the capital holds a hall for every civilization in summary only", () => {
  const scene = deriveScene(fixture);
  assert.equal(scene.capital.halls.length, fixture.civilizations.length);
  const roma = scene.capital.halls.find((h) => h.civilizationId === "roma")!;
  assert.equal(roma.openMatters, 2);
  assert.equal(roma.seatName, "Curia");
  assert.ok(!("buildings" in roma), "halls are summary, not detail");
});

test("derivation is deterministic", () => {
  assert.deepEqual(deriveScene(fixture), deriveScene(fixture));
});
