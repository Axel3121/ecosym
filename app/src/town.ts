// The town. One painted ground (town.png, 1254×1254) with eight quarters around a small square.
// A civilization is a QUARTER: its largest building is the seat; the cottages with chimneys are
// workshops. The town hall on the square is the council. Nothing here is drawn unless observed:
// smoke and walkers only where work runs, a queue at the hall door only for matters that wait,
// fog over quarters no civilization has founded.
import type { Scene, Settlement } from "./scene.ts";

export const TOWN_W = 1254, TOWN_H = 1254;
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
  { key: "W",  box: { x1: 150, y1: 480, x2: 480, y2: 720 },  seat: { x: 330, y: 550 },  chimneys: [{ x: 200, y: 610 }, { x: 355, y: 500 }],                                  gate: { x: 480, y: 640 } },
  { key: "E",  box: { x1: 680, y1: 750, x2: 950, y2: 950 },  seat: { x: 830, y: 850 },  chimneys: [{ x: 730, y: 800 }, { x: 900, y: 790 }],                                  gate: { x: 760, y: 750 } },
  { key: "N",  box: { x1: 680, y1: 180, x2: 870, y2: 350 },  seat: { x: 780, y: 270 },  chimneys: [{ x: 760, y: 210 }, { x: 840, y: 300 }],                                  gate: { x: 720, y: 360 } },
  { key: "S",  box: { x1: 580, y1: 950, x2: 820, y2: 1200 }, seat: { x: 700, y: 1080 }, chimneys: [{ x: 680, y: 990 }, { x: 760, y: 1130 }],                                 gate: { x: 660, y: 950 } },
  { key: "NW", box: { x1: 120, y1: 60,  x2: 560, y2: 400 },  seat: { x: 290, y: 250 },  chimneys: [{ x: 215, y: 85 }, { x: 375, y: 105 }, { x: 215, y: 175 }, { x: 470, y: 330 }], gate: { x: 520, y: 420 } },
  { key: "NE", box: { x1: 850, y1: 280, x2: 1180, y2: 620 }, seat: { x: 990, y: 480 },  chimneys: [{ x: 1045, y: 330 }, { x: 935, y: 430 }, { x: 1140, y: 470 }],           gate: { x: 850, y: 560 } },
  { key: "SW", box: { x1: 150, y1: 750, x2: 560, y2: 1150 }, seat: { x: 370, y: 950 },  chimneys: [{ x: 430, y: 780 }, { x: 250, y: 900 }, { x: 470, y: 1050 }],            gate: { x: 540, y: 800 } },
  { key: "SE", box: { x1: 900, y1: 750, x2: 1180, y2: 1100 }, seat: { x: 1000, y: 900 }, chimneys: [{ x: 1110, y: 800 }, { x: 960, y: 1000 }],                                gate: { x: 900, y: 780 } },
];

export const SQUARE = { x: 630, y: 645, r: 150 };
export const HALL = { box: { x1: 545, y1: 365, x2: 705, y2: 565 }, door: { x: 620, y: 548 } };
/** Where petitioners stand when a matter waits: a line down the steps, one body per matter. */
export function queueSpot(i: number): P { return { x: HALL.door.x + 18 + i * 22, y: HALL.door.y + 26 + (i % 2) * 4 }; }

/** Assign quarters in founding order. No upper bound in code: past the eighth, a civilization is
 *  placed on a ring outside the town (the wall must break — see the design brief); it is still on
 *  the map and still truthful, just not yet painted. */
export function assignQuarters(list: Array<{ id: string }>): Map<string, Quarter> {
  const out = new Map<string, Quarter>();
  list.forEach((c, i) => {
    if (i < QUARTERS.length) { out.set(c.id, QUARTERS[i]!); return; }
    const k = i - QUARTERS.length, a = (k / 6) * Math.PI * 2 - Math.PI / 2, R = 640;
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
