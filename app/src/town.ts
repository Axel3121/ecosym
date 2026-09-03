// The world. One painted ground (town.png / town-built.png, 3072×2048): a town of eight quarters
// around a small square in the middle, its outskirts, and a countryside with ten empty hamlet sites
// along the lanes. A civilization is a QUARTER (or, from the ninth on, a hamlet site): its largest
// building is the seat; cottages with chimneys are workshops. The town hall on the square is the
// council. Nothing is drawn unless observed: the built painting is cut in only where a founded,
// observed civilization lives; smoke and walkers only where work runs; a queue at the hall door only
// for matters that wait. Coordinates: town measured on the 1536×1024 town painting, offset by
// (800, 545) into the world; hamlet sites measured on the wide painting ×2.
import type { Scene, Settlement } from "./scene.ts";

export const TOWN_W = 3072, TOWN_H = 2048;
type P = { x: number; y: number };

export interface Quarter {
  key: string;
  box: { x1: number; y1: number; x2: number; y2: number };
  seat: P;            // the largest building — where the seat's hover/click lands
  chimneys: P[];      // workshop chimneys; smoke rises here only when that workshop runs
  gate: P;            // where the quarter meets its lane — walkers leave from here toward the square
}

/** Founding order: the eight town quarters (spread out first), then the ten hamlet sites. */
export const QUARTERS: Quarter[] = [
  { key: "W", box: { x1: 1134, y1: 931, x2: 1229, y2: 1098 }, seat: { x: 1196, y: 995 }, chimneys: [{ x: 1202, y: 963 }], gate: { x: 1240, y: 1015 } },
  { key: "SE", box: { x1: 1417, y1: 1101, x2: 1735, y2: 1372 }, seat: { x: 1563, y: 1208 }, chimneys: [{ x: 1598, y: 1173 }, { x: 1500, y: 1285 }, { x: 1660, y: 1265 }], gate: { x: 1420, y: 1115 } },
  { key: "NW", box: { x1: 1061, y1: 682, x2: 1321, y2: 923 }, seat: { x: 1165, y: 783 }, chimneys: [{ x: 1145, y: 745 }, { x: 1240, y: 845 }], gate: { x: 1300, y: 915 } },
  { key: "SW", box: { x1: 1096, y1: 1132, x2: 1348, y2: 1383 }, seat: { x: 1222, y: 1233 }, chimneys: [{ x: 1252, y: 1198 }, { x: 1160, y: 1305 }], gate: { x: 1340, y: 1145 } },
  { key: "E", box: { x1: 1496, y1: 907, x2: 1728, y2: 1084 }, seat: { x: 1593, y: 953 }, chimneys: [{ x: 1563, y: 915 }, { x: 1680, y: 1015 }], gate: { x: 1490, y: 995 } },
  { key: "S", box: { x1: 1306, y1: 1288, x2: 1483, y2: 1451 }, seat: { x: 1404, y: 1343 }, chimneys: [{ x: 1398, y: 1303 }], gate: { x: 1390, y: 1285 } },
  { key: "N", box: { x1: 1409, y1: 733, x2: 1520, y2: 872 }, seat: { x: 1465, y: 795 }, chimneys: [{ x: 1490, y: 760 }], gate: { x: 1420, y: 875 } },
  { key: "WS", box: { x1: 1072, y1: 1013, x2: 1147, y2: 1111 }, seat: { x: 1112, y: 1048 }, chimneys: [{ x: 1094, y: 1018 }], gate: { x: 1150, y: 1085 } },
  { key: "H1", box: { x1: 680, y1: 220, x2: 920, y2: 400 }, seat: { x: 800, y: 310 }, chimneys: [{ x: 760, y: 280 }, { x: 840, y: 280 }], gate: { x: 800, y: 400 } },
  { key: "H2", box: { x1: 1050, y1: 310, x2: 1290, y2: 490 }, seat: { x: 1170, y: 400 }, chimneys: [{ x: 1130, y: 370 }, { x: 1210, y: 370 }], gate: { x: 1170, y: 490 } },
  { key: "H3", box: { x1: 2270, y1: 410, x2: 2510, y2: 590 }, seat: { x: 2390, y: 500 }, chimneys: [{ x: 2350, y: 470 }, { x: 2430, y: 470 }], gate: { x: 2390, y: 590 } },
  { key: "H4", box: { x1: 2050, y1: 580, x2: 2290, y2: 760 }, seat: { x: 2170, y: 670 }, chimneys: [{ x: 2130, y: 640 }, { x: 2210, y: 640 }], gate: { x: 2170, y: 760 } },
  { key: "H5", box: { x1: 420, y1: 610, x2: 660, y2: 790 }, seat: { x: 540, y: 700 }, chimneys: [{ x: 500, y: 670 }, { x: 580, y: 670 }], gate: { x: 540, y: 790 } },
  { key: "H6", box: { x1: 2090, y1: 930, x2: 2330, y2: 1110 }, seat: { x: 2210, y: 1020 }, chimneys: [{ x: 2170, y: 990 }, { x: 2250, y: 990 }], gate: { x: 2210, y: 1110 } },
  { key: "H7", box: { x1: 180, y1: 1140, x2: 420, y2: 1320 }, seat: { x: 300, y: 1230 }, chimneys: [{ x: 260, y: 1200 }, { x: 340, y: 1200 }], gate: { x: 300, y: 1320 } },
  { key: "H8", box: { x1: 2040, y1: 1240, x2: 2280, y2: 1420 }, seat: { x: 2160, y: 1330 }, chimneys: [{ x: 2120, y: 1300 }, { x: 2200, y: 1300 }], gate: { x: 2160, y: 1420 } },
  { key: "H9", box: { x1: 880, y1: 1620, x2: 1120, y2: 1800 }, seat: { x: 1000, y: 1710 }, chimneys: [{ x: 960, y: 1680 }, { x: 1040, y: 1680 }], gate: { x: 1000, y: 1800 } },
  { key: "H10", box: { x1: 2330, y1: 1700, x2: 2570, y2: 1880 }, seat: { x: 2450, y: 1790 }, chimneys: [{ x: 2410, y: 1760 }, { x: 2490, y: 1760 }], gate: { x: 2450, y: 1880 } },
];

export const SQUARE = { x: 1372, y: 1072, r: 78 };
export const HALL = { box: { x1: 1318, y1: 893, x2: 1422, y2: 997 }, door: { x: 1370, y: 995 } };
/** Where petitioners stand when a matter waits: a row at the foot of the steps. */
export function queueSpot(i: number): P { void i; return { x: HALL.door.x - 30, y: HALL.door.y + 34 }; }

/** Assign places in founding order. No upper bound in code: past the painted sites, a civilization
 *  is placed on a ring around the town — still on the map and still truthful, just not yet painted. */
export function assignQuarters(list: Array<{ id: string }>): Map<string, Quarter> {
  const out = new Map<string, Quarter>();
  list.forEach((c, i) => {
    if (i < QUARTERS.length) { out.set(c.id, QUARTERS[i]!); return; }
    const k = i - QUARTERS.length, a = (k / 8) * Math.PI * 2 - Math.PI / 2, R = 900;
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
