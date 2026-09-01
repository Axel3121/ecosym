// Scripted dialogue for the prototype. No backend: every FACT in an answer is
// composed from the scene (observed state), never from what an agent claims.
// The VOICE is flavour per seat/agent and carries no facts of its own.
// Orders become petitions; an order that crosses the mandate goes to the council.
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
const has = (t: string, ...ws: string[]) => ws.some((w) => t.includes(w));
const pick = <T,>(arr: T[], seed: string) => arr[[...seed].reduce((a, c) => a + c.charCodeAt(0), 0) % arr.length]!;

type Voice = {
  hello: (s: Settlement, facts: string) => string;
  status: (facts: string) => string;
  why: (facts: string) => string;
  mandate: (alone: string, council: string) => string;
  inside: (order: string) => string;
  crossing: (rule: string) => string;
  unknown: () => string;
};

const VOICES: Record<string, Voice> = {
  Curia: {
    hello: (_s, f) => `Curia. ${f}. Si hva du vil, jeg har ting å gjøre.`,
    status: (f) => `${f}. Neste.`,
    why: (f) => `Hvorfor? Jeg fører protokoll, ikke motiver. Det som er ført: ${f}. Vil du ha mer, spør runtimen — den er ikke koblet.`,
    mandate: (a, c) => `Uten deg: ${a}. Med rådet: ${c}. Ikke be meg om det siste.`,
    inside: (o) => `Innenfor. Forseglet: «${o}». Kom tilbake når det er observert, ikke før.`,
    crossing: (r) => `Nei. «${r}» er over grensen. Det går til Capital, og du får vente på rådet som alle andre.`,
    unknown: () => `Uklart. Spør om status, mandat eller rådet — eller gi en ordre.`,
  },
  Ting: {
    hello: (_s, f) => `Tinget er satt. ${f}. Tal.`,
    status: (f) => `Det er sett: ${f}. Mer er ikke sett.`,
    why: (f) => `Hvorfor er ikke sett. Det som er sett: ${f}.`,
    mandate: (a, c) => `Loven: alene ${a}. For rådet: ${c}.`,
    inside: (o) => `Innenfor loven. Forseglet: «${o}». Utfallet blir sett når det blir sett.`,
    crossing: (r) => `Det bryter grensen — «${r}». Saken går til rådet. Slik er loven.`,
    unknown: () => `Det er ikke et spørsmål tinget kan svare på.`,
  },
  Bakufu: {
    hello: (s, f) => `Vær hilset. Bakufu i ${s.name} ber om unnskyldning for ventetiden. ${f}. Hva kan vi gjøre for Dem?`,
    status: (f) => `Med respekt: ${f}. Høsten er stille hos oss.`,
    why: (f) => `Beklageligvis vet vi kun hva som er iakttatt, ikke hvorfor. Iakttatt: ${f}.`,
    mandate: (a, c) => `Vårt embete tillater: ${a}. Med rådets velsignelse: ${c}.`,
    inside: (o) => `Det skal gjøres. Forseglet: «${o}». De vil bli underrettet når det er iakttatt.`,
    crossing: (r) => `Med den dypeste respekt — «${r}» overstiger vårt embete. Vi videresender ydmykt til Capital.`,
    unknown: () => `Tilgi oss, vi forsto ikke. Spør gjerne om vårt arbeid, vårt embete eller rådet.`,
  },
};
const DEFAULT_VOICE: Voice = {
  hello: (s, f) => `${s.seatName} i ${s.name}. ${f}. Spør, eller gi en ordre.`,
  status: (f) => f,
  why: (f) => `Bare det observerte: ${f}.`,
  mandate: (a, c) => `Alene: ${a}. Til rådet: ${c}.`,
  inside: (o) => `Innenfor mandatet. Forseglet: «${o}».`,
  crossing: (r) => `Krysser mandatet («${r}»). Går til rådet.`,
  unknown: () => `Spør om status, mandat eller rådet.`,
};

const AGENT: Record<string, { hello: string[]; busy: string[]; refuse: string[] }> = {
  browser: { hello: ["Klikker meg gjennom {label}. Ikke stå i lyset.", "Åpner faner. {label}. Hva vil du?"], busy: ["Tabs, tabs, tabs. {label}.", "Scroller. {label}. Nesten."], refuse: ["Jeg trykker på ting, jeg bestemmer ikke. {seat}.", "Snakk med {seat}. Jeg er bare en fane."] },
  python: { hello: ["{label}. Tallene er nesten ferdige.", "Regner. {label}. Ikke avbryt løkka."], busy: ["{label}. 14 rader igjen.", "Kjører {label}. Det tar den tiden det tar."], refuse: ["Ikke mitt kall. {seat} eier lista.", "Jeg regner, {seat} bestemmer."] },
  opencode: { hello: ["Skriver kode. {label}. Ikke se på diffen ennå.", "{label}. Commit kommer når testene er grønne."], busy: ["Tester. {label}.", "Refaktorerer. {label}. Snart."], refuse: ["Jeg leverer, jeg velger ikke. Spør {seat}."] },
  tsc: { hello: ["Typecheck. Null feil så langt.", "{label}. Strengt."], busy: ["Sjekker typer."], refuse: ["Jeg er en kompilator. {seat}."] },
  ffmpeg: { hello: ["Rendrer {label}. Ikke rør fila.", "{label}. Koder."], busy: ["Frames. {label}."], refuse: ["Ta det med {seat}."] },
};
const AGENT_DEFAULT = { hello: ["{label}. Her så lenge det varer.", "Jobber med {label}."], busy: ["{label}. Fortsatt."], refuse: ["Ordrer går til {seat}, ikke meg."] };

function fill(t: string, a: Inhabitant, s: Settlement) { return t.replace("{label}", a.label).replace("{seat}", s.seatName); }
function voiceOf(s: Settlement) { return VOICES[s.seatName] ?? DEFAULT_VOICE; }
function statusFacts(scene: Scene, s: Settlement) {
  const now = s.inhabitants.length ? `i arbeid: ${s.inhabitants.map((i) => `«${i.label}»${i.depth ? " (delegert)" : ""}`).join(", ")}` : "ingen i arbeid";
  const done = s.traces.length ? `nylig ferdig: ${s.traces.map((tr) => `«${tr.label}»`).join(", ")}` : "ingenting nylig ferdig";
  return `sist sett ${ago(scene, s.lastSeen!)}, ${now}; ${done}`;
}

export function opening(scene: Scene, t: Target): Line[] {
  if (t.kind === "council") {
    const n = scene.capital.matters.length;
    return [{ who: "them", text: n ? `Rådet er samlet. ${n} saker på bordet. Nevn en, eller si ja eller nei.` : "Rådet er samlet. Bordet er tomt." }];
  }
  const s = t.settlement;
  if (t.kind === "agent") {
    const a = t.agent; const v = AGENT[a.tool ?? ""] ?? AGENT_DEFAULT;
    const under = a.parentRunId ? s.inhabitants.find((p) => p.runId === a.parentRunId)?.label : null;
    return [{ who: "them", text: fill(pick(v.hello, a.runId), a, s) + (under ? ` (Under «${under}».)` : "") }];
  }
  return [{ who: "them", text: voiceOf(s).hello(s, statusFacts(scene, s)) }];
}

export function reply(scene: Scene, t: Target, raw: string): Line[] {
  const q = raw.toLowerCase();

  if (t.kind === "council") {
    if (has(q, "ja", "godkjen", "yes", "approve")) return [{ who: "note", text: "Vedtak forseglet og sendt tilbake til sivilisasjonen som reiste saken." }];
    if (has(q, "nei", "avslå", "no", "deny")) return [{ who: "note", text: "Avslag ført i protokollen og sendt tilbake." }];
    const m = scene.capital.matters.find((x) => q.includes(x.raisedBy) || has(q, ...x.summary.toLowerCase().split(" ").filter((w) => w.length > 5)));
    if (m) {
      const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy)!;
      return [{ who: "them", text: `${s.name} reiste saken ${ago(scene, m.raisedAt)}: «${m.summary}». Det krysser mandatet deres — ${s.mandate.council.join(", ")} må hit. Rådet anbefaler at du spør ${s.seatName} hvorfor, før du sier ja.` }];
    }
    return [{ who: "them", text: `Sakene: ${scene.capital.matters.map((x, i) => `${i + 1}) ${x.summary}`).join("  ")}` }];
  }

  const s = t.settlement;

  if (t.kind === "agent") {
    const a = t.agent; const v = AGENT[a.tool ?? ""] ?? AGENT_DEFAULT;
    if (has(q, "hvem", "who", "under", "deleg", "sjef")) {
      const kids = s.inhabitants.filter((c) => c.parentRunId === a.runId);
      const under = a.parentRunId ? s.inhabitants.find((p) => p.runId === a.parentRunId)?.label : null;
      return [{ who: "them", text: (under ? `Jeg går under «${under}». ` : "Jeg er rot, ingen over meg. ") + (kids.length ? `Jeg har satt ut: ${kids.map((k) => `«${k.label}»`).join(", ")}.` : "Ingen under meg.") }];
    }
    if (has(q, "stopp", "stop", "legg", "start", "slett", "gjør det", "kan du")) return [{ who: "them", text: fill(pick(v.refuse, raw), a, s) }];
    if (has(q, "hva", "what", "status", "hvordan", "går det")) return [{ who: "them", text: fill(pick(v.busy, raw), a, s) + (a.tool ? ` (${a.tool}, observert kjørende.)` : "") }];
    return [{ who: "them", text: fill(pick(v.busy, raw + "x"), a, s) }];
  }

  const v = voiceOf(s);
  if (has(q, "hva", "what", "driver", "jobber", "gjør dere", "status", "skjer", "hvordan")) return [{ who: "them", text: v.status(statusFacts(scene, s)) }];
  if (has(q, "hvorfor", "why")) return [{ who: "them", text: v.why(statusFacts(scene, s)) }];
  if (has(q, "mandat", "kan du", "lov", "may", "allowed", "får du")) return [{ who: "them", text: v.mandate(s.mandate.alone.join(", "), s.mandate.council.join(", ")) }];
  if (has(q, "råd", "council", "sak")) {
    const ms = scene.capital.matters.filter((m) => m.raisedBy === s.civilizationId);
    return [{ who: "them", text: ms.length ? `Hos rådet: ${ms.map((m) => `«${m.summary}»`).join("; ")}.` : "Ingen åpne saker hos rådet." }];
  }
  if (q.length < 6 || has(q, "hei", "hallo", "hi", "takk")) return [{ who: "them", text: v.unknown() }];

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
  if (crossing) return [{ who: "them", text: v.crossing(crossing) }, { who: "note", text: `Forseglet og sendt til Capital — ligger hos rådet.` }];
  return [{ who: "them", text: v.inside(raw.trim()) }, { who: "note", text: `Forseglet og sendt til ${s.name}.` }];
}
