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
  { key: "W",  box: { x1: 446, y1: 389, x2: 607, y2: 565 },  seat: { x: 530, y: 470 },  chimneys: [{ x: 565, y: 435 }, { x: 500, y: 520 }],                    gate: { x: 620, y: 500 } },
  { key: "SE", box: { x1: 791, y1: 541, x2: 1134, y2: 838 }, seat: { x: 955, y: 680 },  chimneys: [{ x: 945, y: 630 }, { x: 1040, y: 720 }, { x: 870, y: 760 }], gate: { x: 800, y: 560 } },
  { key: "NW", box: { x1: 436, y1: 114, x2: 714, y2: 387 },  seat: { x: 555, y: 260 },  chimneys: [{ x: 560, y: 235 }, { x: 640, y: 320 }],                    gate: { x: 700, y: 380 } },
  { key: "SW", box: { x1: 450, y1: 555, x2: 738, y2: 842 },  seat: { x: 610, y: 700 },  chimneys: [{ x: 600, y: 655 }, { x: 680, y: 760 }],                    gate: { x: 730, y: 590 } },
  { key: "E",  box: { x1: 887, y1: 353, x2: 1043, y2: 555 }, seat: { x: 985, y: 400 },  chimneys: [{ x: 975, y: 355 }, { x: 960, y: 500 }],                    gate: { x: 880, y: 470 } },
  { key: "S",  box: { x1: 693, y1: 744, x2: 868, y2: 939 },  seat: { x: 785, y: 800 },  chimneys: [{ x: 775, y: 750 }],                                        gate: { x: 780, y: 730 } },
  { key: "NE", box: { x1: 969, y1: 280, x2: 1122, y2: 537 }, seat: { x: 1050, y: 400 }, chimneys: [{ x: 1040, y: 330 }, { x: 1080, y: 470 }],                   gate: { x: 960, y: 420 } },
  { key: "N",  box: { x1: 783, y1: 191, x2: 897, y2: 350 },  seat: { x: 840, y: 265 },  chimneys: [{ x: 855, y: 235 }],                                        gate: { x: 800, y: 350 } },
];

export const SQUARE = { x: 780, y: 515, r: 60 };
export const HALL = { box: { x1: 690, y1: 335, x2: 800, y2: 430 }, door: { x: 745, y: 424 } };
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
