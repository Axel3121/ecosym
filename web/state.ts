import type { FoundedCivilizationSnapshot } from "../src/institution-snapshot.ts";
import { validateWorldSnapshot, type WorldSnapshot } from "../src/world-snapshot.ts";

export type WorldState =
  | { kind: "loading" | "error" }
  | { kind: "empty" | "ready"; snapshot: WorldSnapshot };

export function worldState(value?: unknown, failed = false): WorldState {
  if (failed) return { kind: "error" };
  if (value === undefined) return { kind: "loading" };
  try {
    const snapshot = validateWorldSnapshot(value);
    return { kind: snapshot.civilizations.length === 0 ? "empty" : "ready", snapshot };
  } catch { return { kind: "error" }; }
}

export const stateCopy = {
  loading: { title: "Leser grunnlagte sivilisasjoner", detail: "Henter det lagrede institusjonsbildet." },
  empty: { title: "Ingen sivilisasjoner er grunnlagt", detail: "Landskapet er en visuell ramme, ikke et kart over erklærte domener." },
  error: { title: "Institusjonsbildet kunne ikke leses", detail: "Ingen steder vises. Last siden på nytt for å forsøke igjen." },
  ready: { title: "Utforsk sivilisasjonene", detail: "Velg et sted for å lese erklæringen. Tab flytter fokus, Enter åpner, Escape går tilbake." },
} as const;

// Only the list index determines position. No institutional content enters the map.
export function placePosition(index: number): { x: number; y: number } {
  return { x: 220 + (index % 3) * 290 + (Math.floor(index / 3) % 2) * 55, y: 230 + Math.floor(index / 3) * 220 };
}

export function inspectFields(entry: FoundedCivilizationSnapshot): { label: string; values: string[] }[] {
  const unknown = ["Ukjent: mandatteksten kunne ikke leses."];
  const declared = (values: string[]) => values.length ? values : ["Ingen oppføringer i erklæringen."];
  return [
    { label: "Sivilisasjons-ID", values: [entry.civilizationId] },
    { label: "Navn", values: [entry.name] },
    { label: "Grunnlagt", values: [entry.foundedAt] },
    { label: "Mandattekst lesbar", values: [String(entry.bodyReadable), entry.bodyReadable
      ? "Den lagrede mandatteksten kunne leses." : "Den lagrede mandatteksten kunne ikke leses. Innholdet er ukjent, ikke tomt."] },
    { label: "Domene", values: entry.bodyReadable ? [entry.domain || "Tomt domene i erklæringen."] : unknown },
    { label: "Kilder", values: entry.bodyReadable ? declared(entry.sources) : unknown },
    { label: "Kan handle alene", values: entry.bodyReadable ? declared(entry.mayActAlone) : unknown },
    { label: "Må eskalere", values: entry.bodyReadable ? declared(entry.mustEscalate) : unknown },
    { label: "Mandatstatus", values: [entry.mandate.status, entry.mandate.status === "unreadable"
      ? "Den lagrede mandatposten kunne ikke leses. Posten har ingen lesbar revisjon."
      : entry.mandate.status === "dissolved" ? "Sivilisasjonen er oppløst i den lagrede posten." : "Mandatet er aktivt i den lagrede posten."] },
    ...(entry.mandate.status === "unreadable" ? [] : [
      { label: "Mandat-ID", values: [entry.mandate.mandateId] },
      { label: "Revisjon", values: [entry.mandate.revision] },
      { label: "Registrert", values: [entry.mandate.recordedAt] },
    ]),
  ];
}
