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
  // measured from the diff between town-built.png and town.png (connected components, area ≥ 1500)
  { key: "W",  box: { x1: 150, y1: 465, x2: 405, y2: 725 },   seat: { x: 330, y: 560 },  chimneys: [{ x: 300, y: 495 }, { x: 205, y: 600 }],                                    gate: { x: 420, y: 640 } },
  { key: "SE", box: { x1: 781, y1: 723, x2: 1209, y2: 1124 }, seat: { x: 995, y: 900 },  chimneys: [{ x: 880, y: 780 }, { x: 1110, y: 800 }, { x: 960, y: 1010 }, { x: 1150, y: 1040 }], gate: { x: 800, y: 760 } },
  { key: "NW", box: { x1: 136, y1: 52,  x2: 545, y2: 419 },   seat: { x: 300, y: 235 },  chimneys: [{ x: 215, y: 85 }, { x: 375, y: 105 }, { x: 215, y: 175 }, { x: 470, y: 330 }], gate: { x: 520, y: 420 } },
  { key: "SW", box: { x1: 187, y1: 756, x2: 592, y2: 1131 },  seat: { x: 390, y: 940 },  chimneys: [{ x: 430, y: 780 }, { x: 250, y: 900 }, { x: 470, y: 1050 }],              gate: { x: 560, y: 800 } },
  { key: "NE", box: { x1: 816, y1: 394, x2: 1185, y2: 730 },  seat: { x: 1000, y: 540 }, chimneys: [{ x: 935, y: 430 }, { x: 1140, y: 470 }, { x: 1040, y: 640 }],             gate: { x: 830, y: 560 } },
  { key: "S",  box: { x1: 539, y1: 1001, x2: 808, y2: 1242 }, seat: { x: 690, y: 1110 }, chimneys: [{ x: 620, y: 1040 }, { x: 760, y: 1130 }],                                 gate: { x: 660, y: 1000 } },
  { key: "N",  box: { x1: 687, y1: 113, x2: 860, y2: 368 },   seat: { x: 770, y: 230 },  chimneys: [{ x: 740, y: 160 }, { x: 800, y: 300 }],                                  gate: { x: 720, y: 370 } },
  { key: "N2", box: { x1: 968, y1: 287, x2: 1106, y2: 418 },  seat: { x: 1037, y: 355 }, chimneys: [{ x: 1010, y: 320 }],                                                       gate: { x: 960, y: 400 } },
];

export const SQUARE = { x: 630, y: 645, r: 150 };
export const HALL = { box: { x1: 545, y1: 365, x2: 705, y2: 565 }, door: { x: 620, y: 548 } };
/** Where petitioners stand when a matter waits: a line down the steps, one body per matter. */
export function queueSpot(i: number): P { void i; return { x: HALL.door.x - 30, y: HALL.door.y + 34 }; }

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
