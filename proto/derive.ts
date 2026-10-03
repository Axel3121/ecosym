import { civilizations, columns, matters, type Agent, type Civilization, type Column, type Matter, type Project, type Task } from "./fixture.ts";

/** Kort tid til høyrekolonnen: «nå», «4 min», «2 t», «3 d». */
export function ago(minutes: number | null): string {
  if (minutes === null) return "aldri";
  if (minutes < 1) return "nå";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} t`;
  return `${Math.round(minutes / (24 * 60))} d`;
}

/** Løpende tid til setninger: «for 4 min siden», «nå», «aldri». */
export function since(minutes: number | null): string {
  if (minutes === null) return "aldri";
  if (minutes < 1) return "nå";
  return `for ${ago(minutes)} siden`;
}

/** Hilsen etter klokka. Klokka er ikke tilstand; den sier bare hva slags time det er. */
export function greeting(hour: number): string {
  if (hour < 5) return "God natt";
  if (hour < 10) return "God morgen";
  if (hour < 13) return "God formiddag";
  if (hour < 18) return "God ettermiddag";
  return "God kveld";
}

export type Tone = "change" | "loss" | "waiting" | "quiet";
export interface Signal { tone: Tone; word: string; line: string }

/** Én ærlig linje per sivilisasjon. Tap vinner over alt; stille får ingen farge. */
export function signal(c: Civilization): Signal {
  if (c.mandate.status === "dissolved") return { tone: "quiet", word: "oppløst", line: "Oppløst. Ingen kilder, ingen agenter." };
  const missing = c.sources.filter((s) => s.status === "missing");
  const failed = c.sources.filter((s) => s.status === "unread" && s.lastReadAgo !== null);
  if (missing.length > 0) return { tone: "loss", word: "sikt tapt", line: `Sikt tapt: ${missing.map((s) => s.id).join(", ")} mangler` };
  if (failed.length > 0) return { tone: "loss", word: "sikt tapt", line: `Sikt tapt: lesing av ${failed.map((s) => s.id).join(", ")} feilet` };
  const waiting = waitingCount(c);
  if (waiting > 0) return { tone: "waiting", word: "venter på deg", line: `${waiting === 1 ? "Én ting venter" : `${waiting} ting venter`} på deg` };
  const changed = changedAgo(c);
  if (changed !== null) return { tone: "change", word: "endret", line: `Noe endret ${since(changed)}` };
  const last = lastRead(c);
  return { tone: "quiet", word: "stille", line: last === null ? "Ingen kilder lest ennå" : `Stille. Sist lest ${since(last)}` };
}

export function changedAgo(c: Civilization): number | null {
  const reads = c.sources.filter((s) => s.status === "changed").map((s) => s.lastReadAgo ?? Infinity);
  return reads.length === 0 ? null : Math.min(...reads);
}

export function lastRead(c: Civilization): number | null {
  const reads = c.sources.map((s) => s.lastReadAgo).filter((m): m is number => m !== null);
  return reads.length === 0 ? null : Math.min(...reads);
}

export function worldLastRead(all: Civilization[]): number | null {
  const reads = all.map(lastRead).filter((m): m is number => m !== null);
  return reads.length === 0 ? null : Math.min(...reads);
}

/** Hva som venter på Axel i én sivilisasjon: oppgaver i Venter-kolonnen og prosjekter som ikke er registrert. */
export function waitingCount(c: Civilization): number {
  return c.tasks.filter((t) => t.column === "waiting").length + c.projects.filter((p) => p.state !== "established").length;
}

export function runningCount(c: Civilization): number {
  return c.agents.filter((a) => a.state === "running").length;
}

const numberWord = ["Ingen", "Én", "To", "Tre", "Fire", "Fem", "Seks", "Sju", "Åtte", "Ni"];

/** Ledesetningen øverst i Oversikt, satt sammen av det som faktisk er observert. */
export function lead(all: Civilization[]): string[] {
  const parts: string[] = [];
  const founded = all.filter((c) => c.mandate.status !== "dissolved").length;
  parts.push(`${numberWord[founded] ?? founded} sivilisasjoner.`);
  const running = all.reduce((sum, c) => sum + runningCount(c), 0);
  if (running > 0) parts.push(`${numberWord[running] ?? running} ${running === 1 ? "agent kjører" : "agenter kjører"} nå.`);
  const lost = all.filter((c) => signal(c).tone === "loss");
  if (lost.length > 0) parts.push(`Sikten er tapt i ${lost.map((c) => c.name).join(" og ")}.`);
  const waiting = all.reduce((sum, c) => sum + waitingCount(c), 0) + matters.filter((m) => m.state !== "decided").length;
  if (waiting > 0) parts.push(`${waiting === 1 ? "Én ting venter" : `${numberWord[waiting] ?? waiting} ting venter`} på deg.`);
  return parts;
}

export function agentOf(c: Civilization, id: string | null): Agent | null {
  return id === null ? null : c.agents.find((a) => a.id === id) ?? null;
}

export function civOf(id: string | null): Civilization | null {
  return id === null ? null : civilizations.find((c) => c.id === id) ?? null;
}

export function projectOf(c: Civilization, slug: string | null): Project | null {
  return slug === null ? null : c.projects.find((p) => p.slug === slug) ?? null;
}

export function tasksIn(c: Civilization, column: Column, project?: string | null): Task[] {
  return c.tasks.filter((t) => t.column === column && (project === undefined || t.project === project)).sort((a, b) => a.updatedAgo - b.updatedAgo);
}

export function columnName(column: Column): string {
  return columns.find((entry) => entry.id === column)!.name;
}

/** Det som beveger seg på linjen akkurat nå, til båndet i Oversikt. Maks tre rader. */
export interface Moving { key: string; who: string; what: string; tone: Tone | "run"; agoMin: number; civ: Civilization; taskId: string | null }
export function moving(c: Civilization): Moving[] {
  const rows: Moving[] = [];
  for (const a of c.agents) {
    if (a.state !== "running" || a.taskId === null) continue;
    const task = c.tasks.find((t) => t.id === a.taskId);
    if (task) rows.push({ key: `run:${a.id}`, who: a.name, what: task.title, tone: "run", agoMin: task.updatedAgo, civ: c, taskId: task.id });
  }
  for (const t of c.tasks) {
    if (t.column === "waiting") rows.push({ key: `wait:${t.id}`, who: "Venter på deg", what: t.title, tone: "waiting", agoMin: t.updatedAgo, civ: c, taskId: t.id });
  }
  for (const p of c.projects) {
    if (p.state !== "established") rows.push({ key: `proj:${p.slug}`, who: "Venter på deg", what: `Prosjektet ${p.name}: ${p.line}`, tone: "waiting", agoMin: 0, civ: c, taskId: null });
  }
  if (rows.length === 0) {
    for (const t of c.tasks) {
      if (t.column === "done" && rows.length < 2) rows.push({ key: `done:${t.id}`, who: agentOf(c, t.agentId)?.name ?? "Ferdig", what: t.title, tone: "quiet", agoMin: t.updatedAgo, civ: c, taskId: t.id });
    }
  }
  return rows.slice(0, 3);
}

/** Alt som kjører nå, på tvers av linjene. */
export function runningNow(all: Civilization[]): Moving[] {
  return all.flatMap((c) => moving(c).filter((row) => row.tone === "run"));
}

/** Alt som venter på Axel, på tvers: oppgaver, prosjekter og rådssaker. */
export interface Attention { key: string; title: string; where: string; civ: Civilization | null; agoMin: number; href: string; kind: "task" | "project" | "matter" }
export function attention(all: Civilization[], allMatters: Matter[]): Attention[] {
  const rows: Attention[] = [];
  for (const c of all) {
    for (const t of c.tasks) if (t.column === "waiting") rows.push({ key: t.id, title: t.title, where: c.name, civ: c, agoMin: t.updatedAgo, href: `#/s/${c.id}/tavle/${t.id}`, kind: "task" });
    for (const p of c.projects) if (p.state !== "established") rows.push({ key: p.slug, title: `Prosjektet ${p.name}: ${p.line}`, where: c.name, civ: c, agoMin: 0, href: `#/s/${c.id}/p/${p.slug}/om`, kind: "project" });
  }
  for (const m of allMatters) {
    if (m.state === "decided") continue;
    rows.push({ key: m.id, title: m.title, where: `Rådet: ${civOf(m.from)?.name} → ${civOf(m.to)?.name}`, civ: null, agoMin: m.openedAgo, href: `#/raadet/${m.id}`, kind: "matter" });
  }
  return rows.sort((a, b) => a.agoMin - b.agoMin);
}

export const stateWord: Record<Agent["state"], string> = { running: "kjører", idle: "ledig", stopped: "stoppet" };
export const sourceWord = { changed: "endret", quiet: "stille", unread: "ulest", missing: "mangler" } as const;
export const projectWord = { established: "registrert", requested: "påbegynt", failed: "mislyktes" } as const;
export const matterWord: Record<Matter["state"], string> = { waiting: "venter på deg", recommended: "anbefaling klar", decided: "avgjort" };

/** Enkelt søk over alt prototypen kjenner. */
export interface Hit { kind: "Sivilisasjon" | "Prosjekt" | "Oppgave" | "Agent" | "Kilde" | "Rådssak"; title: string; where: string; href: string; civ: Civilization | null }
export function search(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  const has = (...parts: (string | null | undefined)[]) => parts.some((p) => p?.toLowerCase().includes(q));
  for (const c of civilizations) {
    if (has(c.name, c.domain, c.code)) hits.push({ kind: "Sivilisasjon", title: c.name, where: c.domain, href: `#/s/${c.id}`, civ: c });
    for (const p of c.projects) if (has(p.name, p.about)) hits.push({ kind: "Prosjekt", title: p.name, where: c.name, href: `#/s/${c.id}/p/${p.slug}`, civ: c });
    for (const t of c.tasks) if (has(t.title, t.id, t.outcome)) hits.push({ kind: "Oppgave", title: t.title, where: `${c.name}${t.project ? `, ${t.project}` : ""}`, href: `#/s/${c.id}/tavle/${t.id}`, civ: c });
    for (const a of c.agents) if (has(a.name, a.kind)) hits.push({ kind: "Agent", title: a.name, where: `${c.name}, ${stateWord[a.state]}`, href: `#/s/${c.id}/agenter`, civ: c });
    for (const s of c.sources) if (has(s.id)) hits.push({ kind: "Kilde", title: s.id, where: `${c.name}, ${sourceWord[s.status]}`, href: `#/s/${c.id}/kilder`, civ: c });
  }
  for (const m of matters) if (has(m.title, m.summary)) hits.push({ kind: "Rådssak", title: m.title, where: matterWord[m.state], href: `#/raadet/${m.id}`, civ: null });
  return hits.slice(0, 30);
}
