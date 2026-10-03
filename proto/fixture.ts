/**
 * Demo-data for designprototypen. Alt her er oppdiktet og merket som demo i flaten.
 * Tider er minutter bakover fra «nå» så bildet leser ferskt hver gang det åpnes.
 */

export type SourceStatus = "changed" | "quiet" | "unread" | "missing";
export type Column = "queue" | "doing" | "waiting" | "done";
export type AgentState = "running" | "idle" | "stopped";

export interface Source { id: string; status: SourceStatus; lastReadAgo: number | null; reason: string }
export interface Run { agentId: string; startedAgo: number; minutes: number | null; outcome: string; ok: boolean | null }
export interface Task {
  id: string; title: string; column: Column; project: string | null; agentId: string | null; outcome: string | null; updatedAgo: number;
  runs: Run[]; note?: string;
}
export interface Agent { id: string; name: string; kind: string; state: AgentState; taskId: string | null; lastRunAgo: number | null }
export interface Project { slug: string; name: string; state: "established" | "requested" | "failed"; line: string; path: string; about: string }
export interface Civilization {
  id: string; code: string; name: string; hue: number; chroma: number; domain: string;
  mandate: { status: "active" | "dissolved"; revision: string; recordedAgo: number };
  mayActAlone: string[]; mustEscalate: string[];
  sources: Source[]; agents: Agent[]; tasks: Task[]; projects: Project[];
}
export type MatterState = "waiting" | "recommended" | "decided";
export interface Matter {
  id: string; title: string; from: string; to: string; state: MatterState; openedAgo: number;
  summary: string; recommendation: string; decision?: "approved" | "declined";
}
export type EventKind = "run" | "task" | "council" | "project" | "source" | "chronicle";
export interface Event { id: string; kind: EventKind; civ: string | null; ago: number; title: string; detail: string }

export const columns: { id: Column; name: string }[] = [
  { id: "queue", name: "Kø" }, { id: "doing", name: "Pågår" }, { id: "waiting", name: "Venter på deg" }, { id: "done", name: "Ferdig" },
];

export const civilizations: Civilization[] = [
  {
    id: "utvikling", code: "UT", name: "Utvikling", hue: 192, chroma: 0.11,
    domain: "Kode, agenter og verktøyene de bruker",
    mandate: { status: "active", revision: "v3", recordedAgo: 6 * 24 * 60 },
    mayActAlone: ["Lese og endre kode i egne repoer", "Kjøre tester og bygg", "Opprette oppgaver på Hermes-brettet"],
    mustEscalate: ["Publisere til produksjon", "Kjøpe tjenester eller domener", "Endre mandatet til en annen sivilisasjon"],
    sources: [
      { id: "hermes-kanban", status: "changed", lastReadAgo: 4, reason: "nye eller endrede felt sett ved siste lesing" },
      { id: "ecosym-repo", status: "quiet", lastReadAgo: 2 * 60, reason: "lest uten nye felt" },
      { id: "jarvis-log", status: "unread", lastReadAgo: null, reason: "ikke lest i denne aktiveringen" },
    ],
    agents: [
      { id: "codex", name: "Codex", kind: "kodeagent", state: "running", taskId: "UT-41", lastRunAgo: 0 },
      { id: "claude", name: "Claude Code", kind: "kodeagent", state: "running", taskId: "UT-38", lastRunAgo: 0 },
      { id: "hermes-2", name: "Hermes worker 2", kind: "arbeider", state: "idle", taskId: null, lastRunAgo: 47 },
      { id: "jarvis", name: "Jarvis", kind: "planlegger", state: "stopped", taskId: null, lastRunAgo: 3 * 24 * 60 },
    ],
    tasks: [
      { id: "UT-41", title: "Runtime-broen leser Hermes-brettet som kilde", column: "doing", project: "ecosym", agentId: "codex", outcome: "3 filer endret, tester grønne", updatedAgo: 4,
        runs: [
          { agentId: "codex", startedAgo: 4, minutes: null, outcome: "kjører: skriver adapter for kanban.db", ok: null },
          { agentId: "codex", startedAgo: 38, minutes: 11, outcome: "3 filer endret, 12 tester grønne", ok: true },
          { agentId: "hermes-2", startedAgo: 2 * 60 + 15, minutes: 6, outcome: "leste skjema, la igjen notat", ok: true },
        ] },
      { id: "UT-38", title: "Playwright-capture av begge flatene i CI", column: "doing", project: "ecosym", agentId: "claude", outcome: "venter på nettleser-bygg", updatedAgo: 1,
        runs: [
          { agentId: "claude", startedAgo: 1, minutes: null, outcome: "kjører: installerer chromium i runner", ok: null },
          { agentId: "claude", startedAgo: 55, minutes: 9, outcome: "feilet: mangler libnss3 i bildet", ok: false },
        ] },
      { id: "UT-36", title: "Petisjonsidentitet: velg første bevisprofil", column: "waiting", project: "ecosym", agentId: "jarvis", outcome: "to forslag ligger klare", updatedAgo: 26 * 60,
        note: "Jarvis har lagt fram passkey mot lokal nøkkel. Avgjørelsen er din; ingen agent kan velge dette alene.",
        runs: [{ agentId: "jarvis", startedAgo: 26 * 60, minutes: 22, outcome: "skrev to forslag med risikonotat", ok: true }] },
      { id: "UT-35", title: "Godkjenn ny mandat-revisjon v4 for Utvikling", column: "waiting", project: null, agentId: null, outcome: "utkast fra Hermes worker 2", updatedAgo: 47,
        runs: [{ agentId: "hermes-2", startedAgo: 47, minutes: 4, outcome: "utkast skrevet; to nye punkter under må eskaleres", ok: true }] },
      { id: "UT-44", title: "Fjern gammel world.css og døde tokens", column: "queue", project: "ecosym", agentId: null, outcome: null, updatedAgo: 3 * 60, runs: [] },
      { id: "UT-45", title: "Skjemaversjon 3 for world-snapshot: agenter og kjøringer", column: "queue", project: "ecosym", agentId: null, outcome: null, updatedAgo: 5 * 60, runs: [] },
      { id: "UT-46", title: "Dokumenter runtime-broen i docs/runtime-bridge.md", column: "queue", project: "ecosym", agentId: null, outcome: null, updatedAgo: 26 * 60, runs: [] },
      { id: "UT-47", title: "Jarvis: planlegg neste ukes kjøringer fra kalenderen", column: "queue", project: "jarvis", agentId: null, outcome: null, updatedAgo: 2 * 24 * 60, runs: [] },
      { id: "UT-33", title: "Selvhostede fonter under CSP default-src 'self'", column: "done", project: "ecosym", agentId: "codex", outcome: "merget", updatedAgo: 22 * 60,
        runs: [{ agentId: "codex", startedAgo: 23 * 60, minutes: 14, outcome: "woff2 lagt inn, CSP-test grønn", ok: true }] },
      { id: "UT-31", title: "Retry-nøkler for prosjektopprettelse", column: "done", project: "ecosym", agentId: "claude", outcome: "merget", updatedAgo: 2 * 24 * 60,
        runs: [{ agentId: "claude", startedAgo: 2 * 24 * 60, minutes: 31, outcome: "idempotente nøkler, 9 nye tester", ok: true }] },
      { id: "UT-29", title: "Jarvis leser Hermes-loggen uten å skrive", column: "done", project: "jarvis", agentId: "hermes-2", outcome: "notat levert", updatedAgo: 4 * 24 * 60,
        runs: [{ agentId: "hermes-2", startedAgo: 4 * 24 * 60, minutes: 18, outcome: "187 oppgaver, 321 kjøringer lest", ok: true }] },
    ],
    projects: [
      { slug: "ecosym", name: "ecosym", state: "established", line: "registrert i Hermes", path: "~/projects/ecosym", about: "Verdenen selv: leser kilder og gir dem en form. Registrert i Hermes 2. september." },
      { slug: "jarvis", name: "jarvis", state: "established", line: "registrert i Hermes", path: "~/projects/jarvis", about: "Planleggeren som leser kalender og logger og foreslår neste kjøringer." },
    ],
  },
  {
    id: "handel", code: "HA", name: "Handel", hue: 345, chroma: 0.12,
    domain: "Kjøp, salg og jakten på finn.no",
    mandate: { status: "active", revision: "v1", recordedAgo: 19 * 24 * 60 },
    mayActAlone: ["Overvåke annonser og priser", "Lage prisvarsler"],
    mustEscalate: ["Kontakte selger", "Bruke penger"],
    sources: [
      { id: "finn-scraper", status: "unread", lastReadAgo: 3 * 60, reason: "siste lesing feilet; lagrede felt beviser ingen fersk lesing" },
      { id: "finn-listings", status: "missing", lastReadAgo: null, reason: "ingen aktiv registrert tilkobling med denne ID-en" },
    ],
    agents: [{ id: "finnbot", name: "Finnbot", kind: "innsamler", state: "stopped", taskId: "HA-12", lastRunAgo: 3 * 60 }],
    tasks: [
      { id: "HA-12", title: "Hent nye sykkelannonser i Oslo under 6 000 kr", column: "doing", project: "finnflip", agentId: "finnbot", outcome: "feilet: kilden svarer ikke", updatedAgo: 3 * 60,
        runs: [{ agentId: "finnbot", startedAgo: 3 * 60, minutes: 2, outcome: "feilet: 403 fra finn-scraper", ok: false }] },
      { id: "HA-14", title: "Prisvarsel for Brompton-modeller", column: "queue", project: "finnflip", agentId: null, outcome: null, updatedAgo: 26 * 60, runs: [] },
      { id: "HA-9", title: "Selg skrivebordet: skriv annonsetekst", column: "done", project: null, agentId: "finnbot", outcome: "utkast levert", updatedAgo: 6 * 24 * 60,
        runs: [{ agentId: "finnbot", startedAgo: 6 * 24 * 60, minutes: 3, outcome: "utkast på 120 ord", ok: true }] },
    ],
    projects: [{ slug: "finnflip", name: "finnflip", state: "requested", line: "opprettelse påbegynt, ikke registrert i Hermes", path: "~/projects/finnflip", about: "Kjøp billig, selg dyrere. Overvåker sykler og møbler i Oslo." }],
  },
  {
    id: "husholdning", code: "HU", name: "Husholdning", hue: 128, chroma: 0.1,
    domain: "Hjem, regninger og avtaler",
    mandate: { status: "active", revision: "v2", recordedAgo: 40 * 24 * 60 },
    mayActAlone: ["Lese kalender og e-post fra faste avsendere", "Minne om frister"],
    mustEscalate: ["Bytte leverandør", "Signere noe"],
    sources: [
      { id: "kalender", status: "quiet", lastReadAgo: 3 * 24 * 60, reason: "lest uten nye felt" },
      { id: "bank-eksport", status: "quiet", lastReadAgo: 24 * 60, reason: "lest uten nye felt" },
    ],
    agents: [{ id: "hushjelp", name: "Hushjelp", kind: "planlegger", state: "idle", taskId: null, lastRunAgo: 24 * 60 }],
    tasks: [
      { id: "HU-7", title: "Sammenlign tre strømavtaler før 1. oktober", column: "queue", project: null, agentId: "hushjelp", outcome: "tilbud hentet", updatedAgo: 24 * 60,
        runs: [{ agentId: "hushjelp", startedAgo: 24 * 60, minutes: 7, outcome: "tre tilbud lagret som notat", ok: true }] },
      { id: "HU-8", title: "Tannlegetime: finn ledig uke i november", column: "queue", project: null, agentId: null, outcome: null, updatedAgo: 3 * 24 * 60, runs: [] },
      { id: "HU-5", title: "Årsavregning fjernvarme: sjekk beløp", column: "done", project: null, agentId: "hushjelp", outcome: "stemmer med faktura", updatedAgo: 9 * 24 * 60,
        runs: [{ agentId: "hushjelp", startedAgo: 9 * 24 * 60, minutes: 2, outcome: "beløp lest fra bank-eksport", ok: true }] },
    ],
    projects: [],
  },
  {
    id: "laering", code: "LÆ", name: "Læring", hue: 292, chroma: 0.1,
    domain: "Kurs, lesing og det du vil kunne",
    mandate: { status: "active", revision: "v1", recordedAgo: 12 * 24 * 60 },
    mayActAlone: ["Samle kilder og lage sammendrag", "Foreslå leseplan"],
    mustEscalate: ["Melde på kurs", "Kjøpe bøker"],
    sources: [
      { id: "notion-notater", status: "quiet", lastReadAgo: 5 * 60, reason: "lest uten nye felt" },
    ],
    agents: [{ id: "leser", name: "Leseren", kind: "forsker", state: "running", taskId: "LÆ-3", lastRunAgo: 0 }],
    tasks: [
      { id: "LÆ-3", title: "Sammendrag av tre artikler om view transitions", column: "doing", project: "frontend-kurs", agentId: "leser", outcome: "to av tre lest", updatedAgo: 12,
        runs: [{ agentId: "leser", startedAgo: 12, minutes: null, outcome: "kjører: leser artikkel 3", ok: null }, { agentId: "leser", startedAgo: 40, minutes: 19, outcome: "to sammendrag lagret i Notion", ok: true }] },
      { id: "LÆ-4", title: "Leseplan for oktober", column: "queue", project: "frontend-kurs", agentId: null, outcome: null, updatedAgo: 2 * 24 * 60, runs: [] },
    ],
    projects: [{ slug: "frontend-kurs", name: "frontend-kurs", state: "established", line: "registrert i Hermes", path: "~/projects/frontend-kurs", about: "Et kurs du setter sammen selv: artikler, notater og små øvelser." }],
  },
  {
    id: "arkiv", code: "AR", name: "Arkiv", hue: 70, chroma: 0.02,
    domain: "Oppløst 2. september",
    mandate: { status: "dissolved", revision: "v1", recordedAgo: 15 * 24 * 60 },
    mayActAlone: [], mustEscalate: [],
    sources: [], agents: [], tasks: [], projects: [],
  },
];

/** Rådssaker: det som krysser en grense mellom sivilisasjoner. */
export const matters: Matter[] = [
  { id: "R-7", title: "Budsjett til prisvarsel for Brompton", from: "handel", to: "husholdning", state: "waiting", openedAgo: 2 * 60,
    summary: "Handel vil bruke 49 kr/mnd på en varslingstjeneste. Penger er utenfor Handels mandat.",
    recommendation: "Rådet anbefaler å godkjenne for tre måneder, med tak på 150 kr, og vurdere igjen 1. desember." },
  { id: "R-6", title: "Handel vil låne Utviklings kodeagent", from: "handel", to: "utvikling", state: "recommended", openedAgo: 5 * 60,
    summary: "Finnbot feiler mot finn-scraper. Handel ber om at Codex ser på innsamleren.",
    recommendation: "Rådet anbefaler én avgrenset kjøring: Codex leser og foreslår, Handel avgjør om det tas i bruk." },
  { id: "R-5", title: "Ny agent i Læring", from: "laering", to: "utvikling", state: "decided", openedAgo: 26 * 60, decision: "approved",
    summary: "Læring ønsket en egen leseagent. Nye agenter må innom rådet.",
    recommendation: "Godkjent av deg i går. Leseren kjører nå på frontend-kurs." },
];

/** Hendelser slik Krønikeren har lest dem. Observert, aldri antatt. */
export const events: Event[] = [
  { id: "e1", kind: "run", civ: "utvikling", ago: 4, title: "Codex kjører på UT-41", detail: "Runtime-broen leser Hermes-brettet som kilde" },
  { id: "e2", kind: "source", civ: "utvikling", ago: 4, title: "hermes-kanban lest: endret", detail: "nye felt på tre kort" },
  { id: "e3", kind: "run", civ: "laering", ago: 12, title: "Leseren kjører på LÆ-3", detail: "to av tre artikler lest" },
  { id: "e4", kind: "task", civ: "utvikling", ago: 47, title: "Ny oppgave venter på deg", detail: "Godkjenn ny mandat-revisjon v4 for Utvikling" },
  { id: "e5", kind: "run", civ: "utvikling", ago: 55, title: "Claude Code feilet på UT-38", detail: "mangler libnss3 i bildet" },
  { id: "e6", kind: "council", civ: null, ago: 2 * 60, title: "Rådssak opprettet", detail: "Budsjett til prisvarsel for Brompton, Handel → Husholdning" },
  { id: "e7", kind: "source", civ: "handel", ago: 3 * 60, title: "finn-scraper: lesing feilet", detail: "403 fra kilden; sikten er tapt" },
  { id: "e8", kind: "council", civ: null, ago: 5 * 60, title: "Rådet har en anbefaling", detail: "Handel vil låne Utviklings kodeagent" },
  { id: "e9", kind: "task", civ: "utvikling", ago: 22 * 60, title: "UT-33 ferdig", detail: "Selvhostede fonter under CSP, merget av Codex" },
  { id: "e10", kind: "project", civ: "handel", ago: 26 * 60, title: "Prosjekt finnflip påbegynt", detail: "mappe opprettet, ikke registrert i Hermes" },
  { id: "e11", kind: "council", civ: null, ago: 26 * 60, title: "Rådssak avgjort", detail: "Ny agent i Læring: godkjent" },
  { id: "e12", kind: "chronicle", civ: null, ago: 24 * 60, title: "Krønikeren skrev dagsnotat", detail: "Tre sivilisasjoner i arbeid, én med tapt sikt." },
];

/** Krønikerens dagsnotater, én per dag. Skrevet av demo, ikke av en modell. */
export const chronicle: { day: string; ago: number; text: string }[] = [
  { day: "I dag", ago: 4, text: "Utvikling er travlest: Codex og Claude Code kjører på hver sin oppgave i ecosym, og hermes-kanban ble lest for få minutter siden med nye felt. Rådet godkjente Lærings leseagent i går. Leseren kjører nå på frontend-kurs. Handel har fortsatt tapt sikt: finn-listings mangler og finn-scraper svarte 403 i formiddag. To ting venter på deg i Utvikling, og én rådssak om penger venter på et ord fra deg." },
  { day: "I går", ago: 24 * 60, text: "Rådet behandlet Lærings ønske om en egen leseagent og du godkjente. Husholdning var stille; kalenderen ble lest uten nytt. Handel begynte på finnflip, men registreringen i Hermes ble ikke bekreftet." },
  { day: "Mandag", ago: 2 * 24 * 60, text: "Claude Code merget retry-nøkler for prosjektopprettelse i ecosym. Jarvis stoppet etter planleggingen sin og har ikke kjørt siden." },
];
