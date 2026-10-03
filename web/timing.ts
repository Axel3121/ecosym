import type { WorldPlaceForm } from "../src/world-form.ts";
import type { WorldProjectSnapshot } from "../src/project-types.ts";
import type { WorldSourceSnapshot } from "../src/world-snapshot.ts";

/**
 * Pure derivations for the observatory field. Every value here is read off the validated
 * world form; nothing infers activity, success or presence.
 */

export type SectorKind = "changed" | "quiet" | "unread" | "missing";
export interface Sector {
  connectionId: string; kind: SectorKind; attempt: boolean; lastAttemptAt: string | null; reason: string | null;
  /** The source's own latest admitted report says it could not observe: Ecosym's read can succeed while sight is lost. */
  blind: boolean;
}

/**
 * The latest attempt in this lifetime admitted a report saying the source could not be observed: Ecosym read the
 * report, not the source. An older report, such as one from before a reconnect, does not count.
 */
function reportsLostSight(source: WorldSourceSnapshot): boolean {
  return source.collection?.status === "quiet" && source.sourceReport?.observation.state === "cannot_observe";
}

export function sectors(place: WorldPlaceForm): Sector[] {
  return place.sourcePicture.sources.map((source) => ({
    connectionId: source.connectionId,
    kind: source.collection === null ? "missing" : source.collection.status,
    attempt: source.attemptsInProgress.length > 0,
    blind: reportsLostSight(source),
    lastAttemptAt: source.collection?.lastAttemptAt ?? null,
    reason: source.collection?.reason ?? null,
  }));
}

/** amber = observed change, red = EcoSym cannot see, blue = waiting on you, neutral = nothing to colour. */
export type Tone = "velocity" | "loss" | "waiting" | "neutral";

export interface Signal { tone: Tone; line: string }

const lossReasons = new Set(["failed", "record-index-unknown"]);

/** One honest line per team. Loss wins over velocity; a quiet team gets no colour. */
export function signal(place: WorldPlaceForm, projects: WorldProjectSnapshot[]): Signal {
  if (place.institution === "unreadable") return { tone: "loss", line: "Erklæringen kan ikke leses" };
  const strip = sectors(place);
  const missing = strip.filter((sector) => sector.kind === "missing");
  const lost = strip.filter((sector) => sector.reason !== null && lossReasons.has(sector.reason));
  if (missing.length > 0) return { tone: "loss", line: `Ingen signal: ${missing.length === 1 ? missing[0]!.connectionId : `${missing.length} kilder`} mangler` };
  if (lost.length > 0) return { tone: "loss", line: `Ingen signal: lesing av ${lost.length === 1 ? lost[0]!.connectionId : `${lost.length} kilder`} feilet` };
  const blind = strip.filter((sector) => sector.blind);
  if (blind.length > 0) return { tone: "loss", line: `Ingen signal: ${blind.length === 1 ? blind[0]!.connectionId : `${blind.length} kilder`} melder tapt sikt` };
  const waiting = projects.filter((project) => project.state !== "established").length;
  if (waiting > 0) return { tone: "waiting", line: `${waiting} ${waiting === 1 ? "prosjekt venter" : "prosjekter venter"} på deg` };
  if (place.institution === "dissolved") return { tone: "neutral", line: "Oppløst" };
  if (strip.length === 0) return { tone: "neutral", line: "Ingen kilder erklært" };
  const changed = strip.filter((sector) => sector.kind === "changed").length;
  const quiet = strip.filter((sector) => sector.kind === "quiet").length;
  const unread = strip.filter((sector) => sector.kind === "unread").length;
  const parts = [changed > 0 ? `${changed} endret` : null, quiet > 0 ? `${quiet} stille` : null, unread > 0 ? `${unread} ulest` : null].filter((part) => part !== null);
  return { tone: changed > 0 ? "velocity" : "neutral", line: parts.join(", ") };
}

/**
 * When the latest successful read happened, or null when the picture cannot say. An attempt is a read only when it
 * read the source: a failed, skipped, retired or unfinished attempt reads nothing, nor does a report that could not
 * observe. It also hides when its source was last read, so if it came after every successful read, the latest read is
 * unknown and withheld rather than understated.
 */
export function latestRead(sources: readonly WorldSourceSnapshot[]): string | null {
  let read: string | null = null;
  let unread: string | null = null;
  for (const source of sources) {
    const { collection } = source;
    const at = collection?.lastAttemptAt ?? null;
    if (collection === null || at === null) continue;
    if (collection.status !== "unread" && !reportsLostSight(source)) { if (read === null || Date.parse(at) > Date.parse(read)) read = at; }
    else if (unread === null || Date.parse(at) > Date.parse(unread)) unread = at;
  }
  return read !== null && (unread === null || Date.parse(read) >= Date.parse(unread)) ? read : null;
}

export function lastRead(place: WorldPlaceForm): string | null {
  return latestRead(place.sourcePicture.sources);
}

/** How long since the latest successful read, never an attempt dressed as one. */
export function readLine(sources: readonly WorldSourceSnapshot[], now: number): string {
  const read = latestRead(sources);
  if (read !== null) return `lest for ${gap(read, now)} siden`;
  return sources.some((source) => source.collection?.lastAttemptAt != null) ? "ulest etter siste forsøk" : "aldri lest";
}

/** Timing-sheet gap: how long since a recorded instant. Never a clock. */
export function gap(instant: string | null, now: number): string {
  if (instant === null) return "aldri";
  const elapsed = now - Date.parse(instant);
  if (!Number.isFinite(elapsed)) return "ukjent";
  if (elapsed < 45_000) return "nå";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(elapsed / 3_600_000);
  if (hours < 48) return `${hours} t`;
  const days = Math.round(elapsed / 86_400_000);
  if (days < 60) return `${days} d`;
  const months = Math.round(days / 30.44);
  if (months < 24) return `${months} mnd`;
  return `${Math.round(days / 365.25)} år`;
}

export const sectorWord: Record<SectorKind, string> = { changed: "endret", quiet: "stille", unread: "ulest", missing: "mangler" };

/** What a sector's collection reason means, in the product's own words; never operational success. */
export function meaningOf(sector: Sector): string {
  return sector.reason === null ? "ingen aktiv registrert tilkobling med denne ID-en" : reasonWord[sector.reason] ?? sector.reason;
}

export const reasonWord: Record<string, string> = {
  collected: "nye eller endrede felt sett ved siste lesing; ikke operasjonell suksess",
  "nothing-new": "lest uten nye felt; stille bare i innsamlingsbildet",
  "never-run": "ikke lest i denne aktiveringen",
  incomplete: "siste lesing har ingen registrert avslutning",
  failed: "siste lesing feilet; lagrede felt beviser ingen fersk lesing",
  retired: "siste lesing ble trukket tilbake",
  skipped: "siste lesing ble hoppet over",
  "record-index-unknown": "posttolkningen er ukjent; identiteten til poster kan ikke leses",
};
