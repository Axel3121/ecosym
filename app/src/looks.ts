// Derived looks: which plate and which seat face a civilization gets.
// Never declared, never hardcoded per id — a stable hash of the identity, so any
// number of civilizations works and adding one never reshuffles the others.
export const PLATE_KEYS = ["harbor", "hill", "orchard", "lake"] as const;
export type PlateKey = (typeof PLATE_KEYS)[number];

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

export function plateKeyFor(civilizationId: string): PlateKey {
  return PLATE_KEYS[hashId(civilizationId) % PLATE_KEYS.length]!;
}

/** Seat portraits are 0..2, handed out in declaration order so seats never share a face
 *  while there are faces to spare; 3 is the hooded face reserved for the unobserved. */
export function seatFaceFor(index: number, observed: boolean): number {
  return observed ? index % 3 : 3;
}

/** Agent portraits: by tool when known, else 6..11 by run identity. */
const TOOL_FACES: Record<string, number> = { browser: 4, python: 5, opencode: 7, tsc: 7 };
export function agentFaceFor(runId: string, tool?: string): number {
  if (tool && TOOL_FACES[tool] !== undefined) return TOOL_FACES[tool]!;
  return 6 + (hashId(runId) % 6);
}
