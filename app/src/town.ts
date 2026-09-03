// The town. One painted ground (town.png, 1254×1254) with eight quarters around a small square.
// A civilization is a QUARTER: its largest building is the seat; the cottages with chimneys are
// workshops. The town hall on the square is the council. Nothing here is drawn unless observed:
// smoke and walkers only where work runs, a queue at the hall door only for matters that wait,
// fog over quarters no civilization has founded.
import type { Scene, Settlement } from "./scene.ts";

export const TOWN_W = 1536, TOWN_H = 1024;
type P = { x: number; y: number };

export interface Quarter {
  key: string;
  box: { x1: number; y1: number; x2: number; y2: number };
  seat: P;            // the largest building — where the seat's hover/click lands
  chimneys: P[];      // workshop chimneys; smoke rises here only when that workshop runs
  gate: P;            // where the quarter meets its lane — walkers leave from here toward the square
}

/** Measured on town.png. Order = founding order: spread out first (cardinal), then the corners. */
export const QUARTERS: Quarter[] = [
  { key: "W",  box: { x1: 334, y1: 386, x2: 429, y2: 553 },  seat: { x: 396, y: 450 }, chimneys: [{ x: 402, y: 418 }],                                        gate: { x: 440, y: 470 } },
  { key: "SE", box: { x1: 617, y1: 556, x2: 935, y2: 827 },  seat: { x: 763, y: 663 }, chimneys: [{ x: 798, y: 628 }, { x: 700, y: 740 }, { x: 860, y: 720 }], gate: { x: 620, y: 570 } },
  { key: "NW", box: { x1: 261, y1: 137, x2: 521, y2: 378 },  seat: { x: 365, y: 238 }, chimneys: [{ x: 345, y: 200 }, { x: 440, y: 300 }],                     gate: { x: 500, y: 370 } },
  { key: "SW", box: { x1: 296, y1: 587, x2: 548, y2: 838 },  seat: { x: 422, y: 688 }, chimneys: [{ x: 452, y: 653 }, { x: 360, y: 760 }],                     gate: { x: 540, y: 600 } },
  { key: "E",  box: { x1: 696, y1: 362, x2: 928, y2: 539 },  seat: { x: 793, y: 408 }, chimneys: [{ x: 763, y: 370 }, { x: 880, y: 470 }],                     gate: { x: 690, y: 450 } },
  { key: "S",  box: { x1: 506, y1: 743, x2: 683, y2: 906 },  seat: { x: 604, y: 798 }, chimneys: [{ x: 598, y: 758 }],                                        gate: { x: 590, y: 740 } },
  { key: "N",  box: { x1: 609, y1: 188, x2: 720, y2: 327 },  seat: { x: 665, y: 250 }, chimneys: [{ x: 690, y: 215 }],                                        gate: { x: 620, y: 330 } },
  { key: "WS", box: { x1: 272, y1: 468, x2: 347, y2: 566 },  seat: { x: 312, y: 503 }, chimneys: [{ x: 294, y: 473 }],                                        gate: { x: 350, y: 540 } },
];

export const SQUARE = { x: 572, y: 527, r: 78 };
export const HALL = { box: { x1: 518, y1: 348, x2: 622, y2: 452 }, door: { x: 570, y: 450 } };
/** Where petitioners stand when a matter waits: a line down the steps, one body per matter. */
export function queueSpot(i: number): P { void i; return { x: HALL.door.x - 30, y: HALL.door.y + 34 }; }

/** Assign quarters in founding order. No upper bound in code: past the eighth, a civilization is
 *  placed on a ring outside the town (the wall must break — see the design brief); it is still on
 *  the map and still truthful, just not yet painted. */
export function assignQuarters(list: Array<{ id: string }>): Map<string, Quarter> {
  const out = new Map<string, Quarter>();
  list.forEach((c, i) => {
    if (i < QUARTERS.length) { out.set(c.id, QUARTERS[i]!); return; }
    const k = i - QUARTERS.length, a = (k / 6) * Math.PI * 2 - Math.PI / 2, R = 440;
    const cx = SQUARE.x + Math.cos(a) * R, cy = SQUARE.y + Math.sin(a) * R;
    out.set(c.id, { key: `ring${k}`, box: { x1: cx - 90, y1: cy - 70, x2: cx + 90, y2: cy + 70 }, seat: { x: cx, y: cy }, chimneys: [{ x: cx - 40, y: cy - 20 }, { x: cx + 40, y: cy - 20 }], gate: { x: cx, y: cy + 70 } });
  });
  return out;
}

export function quarterOf(scene: Scene, s: Settlement): Quarter {
  return assignQuarters(scene.settlements.map((x) => ({ id: x.civilizationId }))).get(s.civilizationId)!;
}
export function unfoundedQuarters(scene: Scene): Quarter[] {
  return QUARTERS.slice(scene.settlements.length);
}
