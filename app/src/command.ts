// The one command line. Deterministic: a few verbs, resolved against the scene.
// It is the small dose of "B": what the map cannot do in a click — decide, ask, jump.
import type { Scene } from "./scene.ts";
import type { DeskState, Decision } from "./desk.ts";

export type Command =
  | { kind: "decide"; decision: Decision; matterId: string }
  | { kind: "talk"; target: "council" | { civ: string } | { civ: string; runId: string } }
  | { kind: "go"; civ: string | "__capital" }
  | { kind: "sheet"; sheet: "raadet" | "arbeid" | "petisjoner" | "observert" | "samtaler" | "innstillinger" }
  | { kind: "help" }
  | { kind: "unknown"; text: string };

export interface Suggestion { text: string; hint: string }

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

function findCiv(scene: Scene, word: string) {
  const w = norm(word);
  return scene.settlements.find((s) => s.name.toLowerCase() === w || s.civilizationId === w || s.seatName.toLowerCase() === w);
}

export function parse(scene: Scene, state: DeskState, raw: string): Command {
  const t = norm(raw);
  if (!t) return { kind: "unknown", text: "" };
  if (t === "?" || t === "hjelp" || t === "help") return { kind: "help" };

  const open = scene.capital.matters.filter((m) => !state.decisions[m.id]).sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
  const dec = t.match(/^(ja|nei|spør|spor)(?:\s+(\d+))?$/);
  if (dec) {
    const decision = (dec[1] === "spor" ? "spør" : dec[1]) as Decision;
    const n = dec[2] ? Number(dec[2]) : 1;
    const m = open[n - 1];
    return m ? { kind: "decide", decision, matterId: m.id } : { kind: "unknown", text: `ingen sak nr. ${n} venter` };
  }

  const talk = t.match(/^(?:snakk(?: med)?|spør|si til)\s+(.+)$/);
  if (talk) {
    const who = talk[1]!;
    if (who === "rådet" || who === "radet" || who === "capital") return { kind: "talk", target: "council" };
    const civ = findCiv(scene, who);
    if (civ) return { kind: "talk", target: { civ: civ.civilizationId } };
    for (const s of scene.settlements) {
      const a = s.inhabitants.find((i) => i.label.toLowerCase() === who || i.runId === who);
      if (a) return { kind: "talk", target: { civ: s.civilizationId, runId: a.runId } };
    }
    return { kind: "unknown", text: `fant ingen «${who}»` };
  }

  const sheets: Record<string, Command> = {
    rådet: { kind: "sheet", sheet: "raadet" }, radet: { kind: "sheet", sheet: "raadet" }, saker: { kind: "sheet", sheet: "raadet" },
    arbeid: { kind: "sheet", sheet: "arbeid" }, petisjoner: { kind: "sheet", sheet: "petisjoner" }, logg: { kind: "sheet", sheet: "observert" },
    observert: { kind: "sheet", sheet: "observert" }, samtaler: { kind: "sheet", sheet: "samtaler" }, folk: { kind: "sheet", sheet: "samtaler" },
    innstillinger: { kind: "sheet", sheet: "innstillinger" }, capital: { kind: "go", civ: "__capital" }, hovedkvarter: { kind: "go", civ: "__capital" },
  };
  if (sheets[t]) return sheets[t]!;

  const go = t.replace(/^(gå til|gå|til)\s+/, "");
  const civ = findCiv(scene, go);
  if (civ) return { kind: "go", civ: civ.civilizationId };
  return { kind: "unknown", text: `forstår ikke «${raw.trim()}»` };
}

/** Live suggestions while typing: the menu that only exists when you ask for it. */
export function suggest(scene: Scene, state: DeskState, raw: string): Suggestion[] {
  const t = norm(raw);
  const open = scene.capital.matters.filter((m) => !state.decisions[m.id]).length;
  const all: Suggestion[] = [
    ...(open ? [{ text: "ja 1", hint: `godkjenn nyeste sak (${open} venter)` }, { text: "nei 1", hint: "avslå nyeste sak" }, { text: "spør 1", hint: "spør tilbake" }] : []),
    { text: "rådet", hint: "alle saker" },
    { text: "arbeid", hint: "alt som kjører" },
    { text: "petisjoner", hint: "det du har bedt om" },
    { text: "samtaler", hint: "alle du kan snakke med" },
    { text: "logg", hint: "siste observert" },
    ...scene.settlements.map((s) => ({ text: s.name.toLowerCase(), hint: s.epistemic === "observed" ? `gå til ${s.name}` : `${s.name} — aldri sett` })),
    ...scene.settlements.filter((s) => s.epistemic === "observed").map((s) => ({ text: `snakk ${s.seatName.toLowerCase()}`, hint: `setet i ${s.name}` })),
    { text: "snakk rådet", hint: "rådskammeret" },
    { text: "capital", hint: "hovedkvarteret" },
    { text: "innstillinger", hint: "flaten, aldri sannheten" },
  ];
  if (!t) return all.slice(0, 6);
  return all.filter((s) => s.text.startsWith(t) || s.text.includes(` ${t}`)).slice(0, 6);
}
