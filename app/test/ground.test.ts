import { test } from "node:test";
import assert from "node:assert/strict";
import { placeSettlements, CLEARINGS, CAPITAL_GROUND } from "../src/ground.ts";

const civs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}` }));

test("no cap: every civilization gets ground on the map, however many there are", () => {
  for (const n of [1, 4, CLEARINGS.length, CLEARINGS.length + 5, 40]) {
    const m = placeSettlements(civs(n));
    assert.equal(m.size, n);
    for (const g of m.values()) { assert.ok(g.x >= 0 && g.x <= 1536 && g.y >= 0 && g.y <= 1024, `${n}: off map`); }
  }
});

test("painted clearings are used first, in founding order, without reuse", () => {
  const m = placeSettlements(civs(CLEARINGS.length));
  const used = new Set([...m.values()].map((g) => `${g.x},${g.y}`));
  assert.equal(used.size, CLEARINGS.length);
  assert.deepEqual(m.get("c0"), { x: CLEARINGS[0]!.x, y: CLEARINGS[0]!.y, r: CLEARINGS[0]!.r });
});

test("declared ground wins and frees no clearing for others to collide with", () => {
  const m = placeSettlements([{ id: "a", ground: { x: CLEARINGS[0]!.x, y: CLEARINGS[0]!.y } }, { id: "b" }]);
  assert.notDeepEqual([m.get("a")!.x, m.get("a")!.y], [m.get("b")!.x, m.get("b")!.y]);
});

test("nothing is founded on the capital's plain", () => {
  const m = placeSettlements(civs(40));
  for (const g of m.values()) assert.ok(Math.hypot(g.x - CAPITAL_GROUND.x, g.y - CAPITAL_GROUND.y) > CAPITAL_GROUND.r, "on the capital");
});
