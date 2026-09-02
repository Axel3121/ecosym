// The painted world has a fixed set of empty clearings — places a civilization can be founded.
// Sixteen around one central plain (the Capital). A civilization takes its declared ground if it
// has one; otherwise the next free clearing in declaration order. No upper bound in code: when
// the clearings run out, the next civilization is placed on a ring outside them.
import type { Settlement } from "./scene.ts";

export type Clearing = { x: number; y: number; r: number; kind: "bay" | "hilltop" | "lakeshore" | "orchard" | "forest" | "meadow" | "marsh" };

export const CAPITAL_GROUND = { x: 555, y: 505, r: 110 };

/** Measured on world.png (1536×1024). Order = founding order: spread out first, then fill in. */
export const CLEARINGS: Clearing[] = [
  { x: 215, y: 580, r: 55, kind: "lakeshore" },
  { x: 1300, y: 435, r: 70, kind: "hilltop" },
  { x: 390, y: 205, r: 65, kind: "forest" },
  { x: 795, y: 950, r: 60, kind: "bay" },
  { x: 890, y: 175, r: 80, kind: "hilltop" },
  { x: 135, y: 745, r: 60, kind: "marsh" },
  { x: 1075, y: 545, r: 65, kind: "hilltop" },
  { x: 450, y: 690, r: 55, kind: "meadow" },
  { x: 1130, y: 245, r: 65, kind: "forest" },
  { x: 235, y: 355, r: 60, kind: "lakeshore" },
  { x: 720, y: 690, r: 55, kind: "meadow" },
  { x: 1000, y: 320, r: 60, kind: "hilltop" },
  { x: 615, y: 235, r: 55, kind: "forest" },
  { x: 290, y: 875, r: 55, kind: "marsh" },
  { x: 110, y: 1000, r: 45, kind: "marsh" },
];

/** Assign ground to every settlement. Declared ground wins; the rest take clearings in order. */
export function placeSettlements<T extends { id: string; ground?: { x: number; y: number } }>(list: T[]): Map<string, { x: number; y: number; r: number }> {
  const out = new Map<string, { x: number; y: number; r: number }>();
  const free = [...CLEARINGS];
  for (const s of list) {
    if (s.ground) {
      const hit = free.findIndex((c) => Math.hypot(c.x - s.ground!.x, c.y - s.ground!.y) < c.r);
      if (hit >= 0) free.splice(hit, 1);
      out.set(s.id, { ...s.ground, r: 60 });
    }
  }
  let overflow = 0;
  for (const s of list) {
    if (out.has(s.id)) continue;
    const c = free.shift();
    if (c) { out.set(s.id, { x: c.x, y: c.y, r: c.r }); continue; }
    // beyond the painted clearings: a ring around the capital, still on the map
    const a = (overflow++ * 2.399963) % (Math.PI * 2); // golden angle: no two neighbours align
    out.set(s.id, { x: Math.round(CAPITAL_GROUND.x + Math.cos(a) * 380), y: Math.round(CAPITAL_GROUND.y + Math.sin(a) * 300), r: 50 });
  }
  return out;
}

export function groundOf(s: Settlement, placed: Map<string, { x: number; y: number; r: number }>) {
  return placed.get(s.civilizationId) ?? { x: s.ground.x, y: s.ground.y, r: 60 };
}
