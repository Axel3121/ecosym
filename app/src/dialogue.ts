// Scripted dialogue for the prototype. No backend: every answer is composed
// from the scene (observed state), never from what an agent claims. Orders
// become petitions; an order that crosses the mandate goes to the council.
import type { Scene, Settlement, Inhabitant } from "./scene.ts";

export type Target =
  | { kind: "seat"; settlement: Settlement }
  | { kind: "agent"; settlement: Settlement; agent: Inhabitant }
  | { kind: "council" };

export interface Line { who: "you" | "them" | "note"; text: string }

const ago = (scene: Scene, iso: string) => {
  const m = Math.round((Date.parse(scene.observedAt) - Date.parse(iso)) / 60000);
  return m < 1 ? "nå nettopp" : m < 60 ? `${m} min siden` : `${Math.round(m / 60)} t siden`;
};

export function opening(scene: Scene, t: Target): Line[] {
  if (t.kind === "council") {
    const n = scene.capital.matters.length;
    return [{ who: "them", text: n ? `Rådet er samlet. ${n} saker ligger på bordet. Spør om en av dem, eller si ja eller nei.` : "Rådet er samlet. Ingen saker ligger på bordet." }];
  }
  const s = t.settlement;
  if (t.kind === "agent") {
    const a = t.agent;
    const under = a.parentRunId ? s.inhabitants.find((p) => p.runId === a.parentRunId)?.label : null;
    return [{ who: "them", text: `Jeg holder på med «${a.label}»${a.tool ? ` med ${a.tool}` : ""}${under ? `, under «${under}»` : ""}. Jeg er her bare så lenge arbeidet varer. Ordrer går til ${s.seatName}, ikke til meg.` }];
  }
  return [{ who: "them", text: `${s.seatName} i ${s.name}. Sist sett ${ago(scene, s.lastSeen!)} — ${s.inhabitants.length} i arbeid, ${s.traces.length} spor. Spør, eller gi en ordre.` }];
}

const has = (t: string, ...ws: string[]) => ws.some((w) => t.includes(w));

export function reply(scene: Scene, t: Target, raw: string): Line[] {
  const q = raw.toLowerCase();

  if (t.kind === "council") {
    if (has(q, "ja", "godkjen", "yes", "approve")) return [{ who: "note", text: "Vedtak forseglet og sendt tilbake til sivilisasjonen som reiste saken." }];
    if (has(q, "nei", "avslå", "no", "deny")) return [{ who: "note", text: "Avslag ført i protokollen og sendt tilbake." }];
    const m = scene.capital.matters.find((x) => q.includes(x.raisedBy) || has(q, ...x.summary.toLowerCase().split(" ").filter((w) => w.length > 5)));
    if (m) {
      const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy)!;
      return [{ who: "them", text: `${s.name} reiste saken ${ago(scene, m.raisedAt)}: «${m.summary}». Det krysser mandatet deres — ${s.mandate.council.join(", ")} må hit. Rådet anbefaler at du spør ${s.name} hvorfor før du sier ja.` }];
    }
    return [{ who: "them", text: `Sakene: ${scene.capital.matters.map((x, i) => `${i + 1}) ${x.summary}`).join("  ")}` }];
  }

  const s = t.settlement;

  if (t.kind === "agent") {
    const a = t.agent;
    if (has(q, "hva", "what", "gjør", "jobber", "status")) return [{ who: "them", text: `«${a.label}»${a.tool ? ` med ${a.tool}` : ""}. Observert kjørende akkurat nå. Ferdig når det er ferdig — jeg kan ikke love mer enn det som er sett.` }];
    if (has(q, "hvem", "who", "under", "deleg")) {
      const kids = s.inhabitants.filter((c) => c.parentRunId === a.runId);
      return [{ who: "them", text: kids.length ? `Jeg har satt ut: ${kids.map((k) => `«${k.label}»`).join(", ")}.` : "Jeg jobber alene, har ikke delegert noe." }];
    }
    if (has(q, "stopp", "stop", "gjør", "legg", "start", "slett")) return [{ who: "them", text: `Det bestemmer ikke jeg. Ta det med ${s.seatName}.` }];
    return [{ who: "them", text: `Jeg kan bare si hva jeg gjør og hvem jeg jobber under. Spør om det.` }];
  }

  // seat
  if (has(q, "hva", "what", "driver", "jobber", "gjør dere", "status", "skjer")) {
    if (!s.inhabitants.length) return [{ who: "them", text: `Ingen i arbeid nå. Sist ferdig: ${s.traces.map((tr) => `«${labelOf(s, tr.runId)}»`).join(", ") || "ingenting nylig"}.` }];
    return [{ who: "them", text: `I arbeid nå: ${s.inhabitants.map((i) => `«${i.label}»${i.depth ? " (delegert)" : ""}`).join(", ")}. Nylig ferdig: ${s.traces.map((tr) => `«${labelOf(s, tr.runId)}»`).join(", ") || "ingenting"}.` }];
  }
  if (has(q, "hvorfor", "why")) return [{ who: "them", text: `Jeg kan bare si hva som er observert, ikke hvorfor. Det som er sett: sist ${ago(scene, s.lastSeen!)}, ${s.inhabitants.length} i arbeid, ${s.traces.length} spor. «Hvorfor» må komme fra runtimen — ikke koblet ennå.` }];
  if (has(q, "mandat", "kan du", "lov", "may", "allowed")) return [{ who: "them", text: `Alene: ${s.mandate.alone.join(", ")}. Til rådet: ${s.mandate.council.join(", ")}.` }];
  if (has(q, "råd", "council", "sak")) {
    const ms = scene.capital.matters.filter((m) => m.raisedBy === s.civilizationId);
    return [{ who: "them", text: ms.length ? `Vi har ${ms.length} sak(er) hos rådet: ${ms.map((m) => `«${m.summary}»`).join("; ")}.` : "Ingen åpne saker hos rådet." }];
  }

  // anything else is an order → petition
  const KEYS: Record<string, string[]> = {
    "spend money": ["kjøp", "betal", "penger", "buy", "spend", "pay"],
    "contact a seller": ["kontakt", "selger", "skriv til", "ring", "contact", "seller", "message"],
    "widen the taxonomy": ["taksonomi", "kategori", "utvid", "taxonomy", "category"],
    "merge to main": ["merge", "main"],
    "publish": ["publiser", "post", "publish", "legg ut"],
    "found a civilization": ["grunnlegg", "ny sivilisasjon", "found"],
    "delete a live post": ["slett", "delete", "fjern"],
    "change channel strategy": ["strategi", "strategy"],
    "speak on my behalf": ["snakk for meg", "svar for meg", "speak"],
  };
  const crossing = s.mandate.council.find((rule) => (KEYS[rule] ?? rule.toLowerCase().split(" ")).some((w) => q.includes(w)));
  if (crossing) {
    return [
      { who: "them", text: `Det krysser mandatet mitt («${crossing}»). Jeg kan ikke ta det alene — det går til rådet.` },
      { who: "note", text: `Forseglet og sendt til Capital — ligger hos rådet.` },
    ];
  }
  return [
    { who: "them", text: `Innenfor mandatet. Forseglet: «${raw.trim()}». Du ser resultatet når det er observert, ikke før.` },
    { who: "note", text: `Forseglet og sendt til ${s.name}.` },
  ];
}

function labelOf(s: Settlement, runId: string) {
  return s.traces.find((t) => t.runId === runId)?.label ?? s.inhabitants.find((i) => i.runId === runId)?.label ?? runId;
}
