import type { WorldPlaceForm } from "../src/world-form.ts";
import type { WorldProjectSnapshot } from "../src/project-types.ts";
import { lastRead, sectors, signal, type Sector } from "./timing.ts";

/**
 * The observatory field. Every value here is derived from the validated world form: a body's position from its
 * identity and founding order, its brightness from the latest recorded read, its occlusion from lost sight, its bloom
 * from a project waiting on the user. Nothing is authored, and nothing can light without an observation behind it.
 */

/** Separation is a box, not a radius: a body owns its ring plus the label beside (desktop) or below (phone) it. */
export interface Field {
  width: number; height: number; minDx: number; minDy: number;
  /** Always use the lattice (narrow screens). */ lattice?: boolean;
  /** Width kept clear at the field's right edge so a label beside a body always fits (sparse skies). */ labelReserve?: number;
}
export interface Body { id: string; x: number; y: number }

function fnv(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash;
}

/**
 * Position is derived, never authored. A sparse sky is an ellipse inside the strip the field keeps clear: the angle
 * comes from a hash of the civilization id, the reach from founding order, and a 23° sweep steps the angle (then the
 * reach) until the body's label box (`minDx` × `minDy`) clears every body already placed. A dense or narrow sky is a
 * lattice instead. The same snapshot always yields the same sky, and a new founding never moves an older body.
 */
export function placeBodies(ids: readonly string[], field: Field): Body[] {
  const { width, height, minDx, minDy } = field;
  const { cells, cols, bounds } = latticeOf(field);
  const compact = field.lattice || isDense(ids.length, field);
  const cx = compact ? width / 2 : (bounds.left + bounds.right) / 2;
  const cy = compact ? height / 2 : (bounds.top + bounds.bottom) / 2;
  const maxRx = Math.max(1, (bounds.right - bounds.left) / 2);
  const maxRy = Math.max(1, (bounds.bottom - bounds.top) / 2);
  const rings = Math.max(1, Math.floor(maxRy / (minDy * 1.2)));
  const step = (23 * Math.PI) / 180;
  const apart = (a: Body, b: Body) => Math.abs(a.x - b.x) >= minDx || Math.abs(a.y - b.y) >= minDy;
  // How far a candidate clears the nearest placed body, in label boxes; 1 or more is apart.
  const clearance = (candidate: Body, others: Body[]) => Math.min(1, ...others.map((other) => Math.max(Math.abs(other.x - candidate.x) / minDx, Math.abs(other.y - candidate.y) / minDy)));
  const placed: Body[] = [];
  ids.forEach((id, index) => {
    const seed = ((fnv(id) % 360) * Math.PI) / 180;
    const turn = (candidate: Body) => { const delta = Math.abs(Math.atan2(candidate.y - cy, candidate.x - cx) - (seed > Math.PI ? seed - 2 * Math.PI : seed)); return Math.min(delta, 2 * Math.PI - delta); };
    let candidates: Body[];
    if (compact) {
      candidates = cells.map((cell) => ({ id, x: cell.x, y: cell.y }));
      // A single column reads top-down in founding order; a wider lattice hands each body the free cell nearest its direction.
      if (cols > 1) candidates.sort((a, b) => turn(a) - turn(b));
    } else {
      const home = ((index % rings) + 1) / rings;
      const reaches = [home, ...[1, 0.85, 0.7, 0.55, 0.4].filter((reach) => reach !== home)];
      candidates = reaches.flatMap((reach) => Array.from({ length: 16 }, (_, k) => {
        const angle = seed + k * step;
        return { id, x: cx + Math.cos(angle) * maxRx * reach, y: cy + Math.sin(angle) * maxRy * reach };
      }));
    }
    let best = candidates.find((candidate) => placed.every((other) => apart(other, candidate)));
    if (!best) {
      // Nothing clears: the candidate with the most clearance, deterministically.
      let bestScore = -1;
      for (const candidate of candidates) { const score = clearance(candidate, placed); if (score > bestScore) { bestScore = score; best = candidate; } }
    }
    placed.push(best!);
  });
  return placed;
}

interface Lattice { cells: { x: number; y: number }[]; cols: number; rows: number; slackX: number; slackY: number; bounds: { left: number; right: number; top: number; bottom: number } }

/** The strips the lattice keeps clear: the wordmark row above, a body's own label stack below. */
export const LATTICE_TOP = 120;
export const LATTICE_BOTTOM = 130;

/** The lattice keeps the wordmark strip (top), a body's own label stack (bottom) and the label reserve (right) clear. */
function latticeOf(field: Field): Lattice {
  const { width, height, minDx, minDy } = field;
  const top = LATTICE_TOP;
  const bottom = LATTICE_BOTTOM;
  const insetX = Math.max(60, Math.round(width * 0.12));
  const rightEdge = width - Math.max(insetX, field.labelReserve ?? 0);
  const latticeWidth = field.labelReserve ? rightEdge + 64 : width;
  const cols = Math.max(1, Math.floor((latticeWidth - 128) / minDx) + 1);
  const rows = Math.max(1, Math.floor((height - top - bottom) / minDy) + 1);
  const stretch = !field.lattice;
  const spanX = cols > 1 ? (stretch ? latticeWidth - 128 : (cols - 1) * minDx) : 0;
  const spanY = rows > 1 ? (stretch ? height - top - bottom : (rows - 1) * minDy) : 0;
  const stepX = cols > 1 ? spanX / (cols - 1) : 0;
  const stepY = rows > 1 ? spanY / (rows - 1) : 0;
  const x0 = (latticeWidth - spanX) / 2;
  const y0 = cols === 1 ? top : top + (height - top - bottom - spanY) / 2;
  const cells: { x: number; y: number }[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) cells.push({ x: x0 + col * stepX, y: y0 + row * stepY });
  return { cells, cols, rows, slackX: cols > 1 ? Math.max(0, stepX - minDx) : 0, slackY: rows > 1 ? Math.max(0, stepY - minDy) : 0,
    bounds: { left: insetX, right: rightEdge, top, bottom: height - bottom } };
}

/**
 * More bodies than the ellipse sweep can hold, or a field that asks for the lattice outright. Crossing this threshold
 * re-projects the whole sky once (sparse to compact); within a mode a new founding never moves an older body.
 */
export function isDense(count: number, field: Field): boolean {
  if (field.lattice) return true;
  const { bounds } = latticeOf(field);
  const maxRy = Math.max(1, (bounds.bottom - bounds.top) / 2);
  return count > Math.max(1, Math.floor(maxRy / (field.minDy * 1.2))) * 5;
}

/** Bodies in angular order around the field centre, for arrow-key travel. */
export function angularOrder(bodies: readonly Body[], field: { width: number; height: number }): Body[] {
  const cx = field.width / 2;
  const cy = field.height / 2;
  return [...bodies].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
}

/** Brightness is a strict step function of time since the latest recorded read. Steps, never a gradient. */
export type Brightness = "now" | "hours" | "days" | "months" | "never";

export function brightness(lastReadAt: string | null, now: number): Brightness {
  if (lastReadAt === null) return "never";
  const elapsed = now - Date.parse(lastReadAt);
  if (!Number.isFinite(elapsed)) return "never";
  if (elapsed < 3_600_000) return "now";
  if (elapsed < 48 * 3_600_000) return "hours";
  if (elapsed < 60 * 86_400_000) return "days";
  return "months";
}

export const brightnessLevel: Record<Brightness, number> = { now: 1, hours: 0.7, days: 0.4, months: 0.2, never: 0 };

export interface BodyState {
  brightness: Brightness;
  /** EcoSym cannot see: a missing source, a failed or unreadable latest read, or an unreadable declaration. */
  occluded: boolean;
  dissolved: boolean;
  /** Projects not yet established: the only thing that earns pure white. */
  waiting: number;
  ticks: Sector[];
}

export function bodyState(place: WorldPlaceForm, projects: readonly WorldProjectSnapshot[], now: number): BodyState {
  const own = projects.filter((project) => project.civilizationId === place.id);
  return {
    brightness: brightness(lastRead(place), now),
    occluded: signal(place, own).tone === "loss",
    dissolved: place.institution === "dissolved",
    waiting: own.filter((project) => project.state !== "established").length,
    ticks: sectors(place),
  };
}

/** One arc per declared source, spread around the ring from the top. Returns start and end angles in radians. */
export function tickArc(index: number, count: number, kind: Sector["kind"]): { from: number; to: number } {
  const spacing = (2 * Math.PI) / Math.max(3, count);
  const centre = -Math.PI / 2 + index * spacing;
  // Form before hue: a full tick is three times a half tick, and both shrink together when the ring is crowded.
  const full = Math.min(0.9, spacing * 0.7);
  const length = kind === "quiet" ? full / 3 : kind === "missing" ? full * 0.7 : full;
  return { from: centre - length / 2, to: centre + length / 2 };
}

/** Break a label into at most two lines at the last space before `max` characters. */
export function wrapLine(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  // Break at the space nearest the middle that leaves both halves within `max`, so no line is a single widowed word.
  const spaces = [...text.matchAll(/ /gu)].map((match) => match.index!);
  const balanced = spaces.filter((index) => index <= max && text.length - index - 1 <= max)
    .sort((a, b) => Math.abs(a - text.length / 2) - Math.abs(b - text.length / 2));
  const cut = balanced[0] ?? text.lastIndexOf(" ", max);
  if (cut <= 0) return [text];
  // The break keeps its space so the two lines still read back as the original text.
  return [text.slice(0, cut + 1), text.slice(cut + 1)];
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const x0 = cx + r * Math.cos(from);
  const y0 = cy + r * Math.sin(from);
  const x1 = cx + r * Math.cos(to);
  const y1 = cy + r * Math.sin(to);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}
