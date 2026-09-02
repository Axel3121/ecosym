// The desk: a logbook you page through, not a control panel you operate.
// One continuous document (Oversikt / Rådet / Arbeid / Petisjoner / Folk are
// anchors inside it, jumped to like Vim marks or a Notion outline — never
// separate views). Samtaler and Innstillinger are the two exceptions that
// leave the document, the same way Focus already leaves the map.
// Colour is never a box, a badge, or a border: green is the word "ja"/"live",
// red is the word "nei"/"krysser mandatet", one red dot marks a line that
// needs you. Everything else is cream and grey.
import type { Scene, Settlement } from "./scene.ts";
import { seatFaceFor, agentFaceFor } from "./looks.ts";

export type Decision = "ja" | "nei" | "spør";

/** Anchors inside the one scrolling document. Adding one = a row here + a case in renderLog. */
export type Section = "oversikt" | "raadet" | "arbeid" | "petisjoner";
export const SECTIONS: Array<{ id: Section; label: string; key: string; hint: string }> = [
  { id: "oversikt", label: "Oversikt", key: "O", hint: "hva trenger deg nå" },
  { id: "raadet", label: "Rådet", key: "R", hint: "saker som krysser en grense — du avgjør" },
  { id: "arbeid", label: "Arbeid", key: "A", hint: "alt som kjører nå, alle sivilisasjoner" },
  { id: "petisjoner", label: "Petisjoner", key: "P", hint: "det du har bedt om, og hvor det står" },
];

/** The two exceptions that leave the document, like Focus leaves the map. */
export type Page = "samtaler" | "innstillinger";
export const PAGES: Array<{ id: Page; label: string; key: string; hint: string }> = [
  { id: "samtaler", label: "Samtaler", key: "S", hint: "alle du kan snakke med" },
];

export interface ThreadLine { who: "you" | "them" | "note"; text: string; at: number }
export interface Thread {
  /** Stable key: seat:<civ> | agent:<runId> | council */
  id: string;
  title: string;
  where: string;
  lines: ThreadLine[];
  lastAt: number;
}
export interface Settings {
  labels: boolean;         // place labels on the map
  smoke: boolean;          // smoke + walkers (motion)
  logLimit: number;        // rows in the observed-activity log
  deskWidth: 300 | 340 | 400;
  language: "nb" | "en";   // shell language; source text is never translated
  theme: "dark" | "light" | "system";
}
export const DEFAULT_SETTINGS: Settings = { labels: true, smoke: true, logLimit: 30, deskWidth: 340, language: "nb", theme: "dark" };
export type DeskMode = "collapsed" | "side" | "full";
export interface DeskState {
  decisions: Record<string, { decision: Decision; at: number }>;
  selectedCiv: string | null;
  /** "log" = viewing the scrolling document; else one of the two page exceptions. */
  view: "log" | Page;
  /** Which anchor to scroll the document to when view === "log". */
  section: Section;
  /** Remembered so full mode's right-hand page has something to show when view === "log". */
  lastPage: Page;
  mode: DeskMode;
  threads: Record<string, Thread>;
  settings: Settings;
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }

export function ago(scene: Scene, iso: string) {
  const m = Math.round((Date.parse(scene.observedAt) - Date.parse(iso)) / 60000);
  return m < 1 ? "nå" : m < 60 ? `${m} min` : `${Math.round(m / 60)} t`;
}
function agoMs(at: number) {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? "nå" : m < 60 ? `${m} min` : `${Math.round(m / 60)} t`;
}

/** One plain sentence, not a row of stat-cards. */
function attention(scene: Scene, state: DeskState) {
  const open = scene.capital.matters.filter((m) => !state.decisions[m.id]);
  const live = scene.settlements.filter((s) => s.epistemic === "observed" && s.inhabitants.length > 0);
  const quiet = scene.settlements.filter((s) => s.epistemic === "observed" && s.inhabitants.length === 0);
  const unseen = scene.settlements.filter((s) => s.epistemic !== "observed");
  const stale = scene.settlements.filter((s) => s.epistemic === "observed" && s.lastSeen && Date.parse(scene.observedAt) - Date.parse(s.lastSeen) > 6 * 3600e3);
  const warn = stale.length ? ` — <span class="seal">${esc(stale.map((s) => s.name).join(", "))} ikke sett på over 6 t</span>` : "";
  return `<p class="attention"><span class="n${open.length ? " seal" : ""}">${open.length}</span> ${open.length === 1 ? "sak venter på deg" : "saker venter på deg"} · <span class="n">${live.length}</span> ${live.length === 1 ? "sivilisasjon" : "sivilisasjoner"} i arbeid · <span class="n dim">${quiet.length}</span> stille · <span class="n faint">${unseen.length}</span> aldri sett${warn}</p>`;
}

function workTree(s: Settlement) {
  const roots = s.inhabitants.filter((i) => i.depth === 0);
  const kids = (parent: string): string => {
    const cs = s.inhabitants.filter((i) => i.parentRunId === parent);
    return cs.length ? `<div class="indent">${cs.map(node).join("")}</div>` : "";
  };
  const node = (i: Settlement["inhabitants"][number]): string =>
    `<p class="work-row">${esc(i.label)}${i.tool ? ` <span class="mono tool">${esc(i.tool)}</span>` : ""}</p>${kids(i.runId)}`;
  const running = roots.length ? roots.map(node).join("") : `<p class="dim">Ingen i arbeid.</p>`;
  const traces = s.traces.length ? s.traces.map((t) => `<p class="trace-row">${esc(t.label)}, ferdig <span class="mono dim" title="hvor mye av oppbevaringsvinduet som er igjen">blekner · ${Math.round(t.freshness * 100)}% igjen</span></p>`).join("") : "";
  return { running, traces };
}

/** The selected civilization's own entry: name, domain, work, actions to go there or talk. */
function civEntry(scene: Scene, state: DeskState) {
  if (state.selectedCiv === "__capital") return capitalEntry(scene);
  const s = scene.settlements.find((x) => x.civilizationId === state.selectedCiv);
  if (!s) return `<p class="dim">Velg en sivilisasjon — tallene på tastaturet, eller under Sivilisasjoner.</p>`;
  if (s.epistemic !== "observed") return `<p class="civ-name faint">${esc(s.name)}</p><p class="dim">Aldri observert. Koble en kilde for å se noe her.</p>`;
  const { running, traces } = workTree(s);
  return `<p class="civ-name">${esc(s.name)}</p><p class="civ-sub">${esc(s.domain)} — observert <span class="mono">${ago(scene, s.lastSeen!)}</span> siden</p>
    <div class="work-tree">${running}${traces}</div>
    <p class="actions-line"><a href="#" data-go="${esc(s.civilizationId)}">gå dit</a><span class="sep">·</span><a href="#" data-talk-civ="${esc(s.civilizationId)}">snakk med ${esc(s.seatName)}</a></p>`;
}
function capitalEntry(scene: Scene) {
  const halls = scene.capital.halls.map((h) => `<p class="hall-row" data-civ="${esc(h.civilizationId)}"><b>${esc(h.name)}</b> <span class="dim">${esc(h.seatName)}</span> — ${h.epistemic === "observed" ? (h.live ? `<span class="live">live</span>` : `<span class="dim">stille</span>`) : `<span class="faint">aldri sett</span>`}${h.openMatters ? ` <span class="seal">${h.openMatters}</span>` : ""}</p>`).join("");
  return `<p class="civ-name">Capital</p><p class="civ-sub">verdens hovedkvarter</p>${halls}<p class="dim">Rådet ser hver sivilisasjon i sammendrag. Detaljene bor der arbeidet bor.</p><p class="actions-line"><a href="#" data-talk-council="1">gå inn i rådskammeret</a></p>`;
}

/** One council matter, as a flowing entry. big=true adds the crossed rule and the "se X" link (full Rådet section). */
function matterEntry(scene: Scene, state: DeskState, m: Scene["capital"]["matters"][number], big: boolean) {
  const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy);
  const d = state.decisions[m.id];
  const [whatRaw, crosses] = m.summary.split(" (crosses: ");
  const what = (whatRaw ?? m.summary).replace(/^\w+ asks to /, "");
  const rule = crosses?.replace(/\)$/, "");
  const decideRow = d
    ? `<p class="matter-decide"><span class="${d.decision === "ja" ? "live" : d.decision === "nei" ? "seal" : "dim"}">${d.decision === "ja" ? "✓ ja" : d.decision === "nei" ? "✗ nei" : "spurt tilbake"}</span> <a href="#" class="undo" data-undo="${m.id}">angre</a></p>`
    : `<p class="matter-decide"><a href="#" class="live" data-decide="ja" data-id="${m.id}">ja</a><span class="sep">·</span><a href="#" class="seal" data-decide="nei" data-id="${m.id}">nei</a><span class="sep">·</span><a href="#" class="dim" data-decide="spør" data-id="${m.id}">spør</a>${big && s ? `<a href="#" class="go" data-go="${esc(s.civilizationId)}">se ${esc(s.name)}</a>` : ""}</p>`;
  return `<div class="matter">
    <p class="matter-meta"><span>${esc(s?.name ?? m.raisedBy)} · ${esc(s?.seatName ?? "")}</span><span class="mono dim">${ago(scene, m.raisedAt)}</span></p>
    <p class="matter-title">«${esc(what)}»</p>
    ${rule ? `<p class="matter-quote">krysser mandatet «${esc(rule)}»</p>` : `<p class="matter-quote dim">ingen regel navngitt i saken</p>`}
    ${decideRow}
  </div>`;
}

/** Sivilisasjoner: the roster, no boxes, no icon badges — key letter at the same weight as the row. */
function roster(scene: Scene, state: DeskState) {
  const rows = scene.settlements.map((s, i) => {
    const sel = state.selectedCiv === s.civilizationId ? " sel" : "";
    const status = s.epistemic !== "observed" ? `<span class="roster-status faint">aldri sett</span>`
      : s.inhabitants.length ? `<span class="roster-status">${s.inhabitants.length} i arbeid</span>`
      : `<span class="roster-status dim">stille · sist ${ago(scene, s.lastSeen!)}</span>`;
    const open = s.openMatters ? ` <span class="seal">${s.openMatters}</span>` : "";
    return `<p class="roster-row${sel}" data-civ="${esc(s.civilizationId)}"><span class="mono roster-key">${i + 1}</span><span class="roster-name">${esc(s.name)}</span>${status}${open}</p>`;
  }).join("");
  const capSel = state.selectedCiv === "__capital" ? " sel" : "";
  return `<p class="label">Sivilisasjoner</p>${rows}<p class="roster-row${capSel}" data-civ="__capital"><span class="mono roster-key">C</span><span class="roster-name">Capital</span><span class="roster-status">${scene.capital.matters.length} saker</span></p>`;
}

function observedLog(scene: Scene, limit: number) {
  type Ev = { at: string; text: string; cls: string };
  const ev: Ev[] = [];
  for (const m of scene.capital.matters) { const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy); ev.push({ at: m.raisedAt, text: `${s?.name ?? m.raisedBy} reiste sak for rådet`, cls: "seal" }); }
  for (const l of scene.letters) { const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId); ev.push({ at: l.sentAt, text: `petisjon til ${s?.seatName ?? l.toCivilizationId}: «${l.text}» — ${l.state}`, cls: "dim" }); }
  for (const s of scene.settlements) { if (s.lastSeen) ev.push({ at: s.lastSeen, text: `${s.name} sist observert`, cls: "dim" }); for (const t of s.traces) ev.push({ at: t.endedAt, text: `${s.name}: «${t.label}» ferdig`, cls: "" }); }
  ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return ev.slice(0, limit).map((e) => `<p class="log-row"><span class="mono log-time">${ago(scene, e.at)}</span><span class="log-text ${e.cls}">${esc(e.text)}</span></p>`).join("");
}

/** Folk: who exists and can be addressed — Capital first, then each civilization's seat and agents. */
function folkSection(scene: Scene, state: DeskState) {
  const has = (id: string) => !!state.threads[id];
  const person = (id: string, title: string, sub: string, live: boolean, action: string, nested = false) =>
    `<p class="who-row${nested ? " indent" : ""}"><span class="who-name">${live ? '<span class="live-dot"></span> ' : ""}${esc(title)}</span><span class="dim mono">${esc(sub)}</span><a href="#" data-resume="${esc(id)}">${has(id) ? "fortsett ›" : action}</a></p>`;
  const global = `<p class="label">Hovedkvarter</p>${person("council", "Rådet", `${scene.capital.matters.length} saker`, false, "åpne ›")}`;
  const civs = scene.settlements.map((s) => {
    if (s.epistemic !== "observed") return `<p class="label">${esc(s.name)} <span class="faint">aldri sett</span></p>`;
    const seat = person(`seat:${s.civilizationId}`, s.seatName, "setet", false, "snakk ›");
    const agents = s.inhabitants.map((i) => person(`agent:${i.runId}`, i.label, i.tool ?? "agent", true, "spør ›", true)).join("");
    return `<p class="label">${esc(s.name)} <span class="dim">${esc(s.domain)}</span></p>${seat}${agents}`;
  }).join("");
  return global + civs + `<p class="dim note">Agenter tar ikke ordre — de svarer på spørsmål. Ordre går til setet.</p>`;
}

/** The whole logbook: one continuous document. Section anchors let O R A P F jump inside it. */
export function renderLog(scene: Scene, state: DeskState): string {
  const openMatters = scene.capital.matters.filter((m) => !state.decisions[m.id]);
  const decided = scene.capital.matters.filter((m) => state.decisions[m.id]);
  const allMatters = scene.capital.matters.slice().sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));

  const oversikt = `<section id="sec-oversikt" class="logsec">
    ${attention(scene, state)}
    <div class="civ-block">${civEntry(scene, state)}</div>
    ${openMatters.length ? `<p class="label">Rådet</p>${openMatters.slice().sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt)).map((m) => matterEntry(scene, state, m, false)).join("")}` : ""}
    ${roster(scene, state)}
  </section>`;

  const raadet = `<section id="sec-raadet" class="logsec">
    <p class="label">Rådet</p>
    ${allMatters.length ? allMatters.map((m) => matterEntry(scene, state, m, true)).join("") : `<p class="dim">Ingenting venter.</p>`}
    <p class="dim note">Krysser mandatet = utenfor det sivilisasjonen kan alene. Avgjørelser blir petisjoner. Ikke koblet i prototypen.</p>
  </section>`;

  const arbeid = `<section id="sec-arbeid" class="logsec">
    <p class="label">Arbeid</p>
    ${scene.settlements.map((s) => {
      if (s.epistemic !== "observed") return `<p class="civ-name faint">${esc(s.name)} <span class="dim">aldri sett</span></p>`;
      const { running, traces } = workTree(s);
      return `<p class="civ-name">${esc(s.name)} <span class="dim">${s.inhabitants.length ? `${s.inhabitants.length} i arbeid` : "stille"} · <span class="mono">${ago(scene, s.lastSeen!)}</span></span></p><div class="work-tree">${running}${traces}</div>`;
    }).join("")}
  </section>`;

  const petisjoner = `<section id="sec-petisjoner" class="logsec">
    <p class="label">Petisjoner</p>
    ${scene.letters.length ? scene.letters.slice().sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map((l) => {
      const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId);
      const steps = ["sendt", "akseptert", "i kø", "pågår"];
      const order: Record<string, number> = { sent: 0, accepted: 1, queued: 2, "in-progress": 3, refused: 3 };
      const cur = order[l.state] ?? 0;
      const trail = l.state === "refused" ? `<span class="seal">avslått</span>` : steps.map((st, i) => i === cur ? `<b>${st}</b>` : st).join(" → ");
      return `<div class="matter"><p class="matter-meta"><span>til ${esc(s?.seatName ?? l.toCivilizationId)} · ${esc(s?.name ?? "")}</span><span class="mono dim">${ago(scene, l.sentAt)}</span></p><p class="matter-title">${esc(l.text)}</p><p class="dim">${trail}</p></div>`;
    }).join("") : `<p class="dim">Ingen petisjoner.</p>`}
    <p class="dim note">Noe som ble bedt om. Vises aldri som noe som skjedde.</p>
  </section>`;

  const observert = `<section id="sec-observert" class="logsec">
    <p class="label">Observert</p>
    ${observedLog(scene, state.settings.logLimit)}
  </section>`;

  return [oversikt, raadet, arbeid, petisjoner, observert].join('<hr class="chapter">');
}

/** A single sheet: what the map click or the strip number asked for. Nothing else. */
export type Sheet = "place" | "raadet" | "arbeid" | "petisjoner" | "observert";
export function renderSheet(scene: Scene, state: DeskState, sheet: Sheet): string {
  const sorted = scene.capital.matters.slice().sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
  switch (sheet) {
    case "place": {
      const s = scene.settlements.find((x) => x.civilizationId === state.selectedCiv);
      const own = s ? sorted.filter((m) => m.raisedBy === s.civilizationId && !state.decisions[m.id]) : [];
      const matters = own.length ? `<p class="label">Venter på deg</p>${own.map((m) => matterEntry(scene, state, m, false)).join("")}` : "";
      return `<div class="civ-block">${civEntry(scene, state)}</div>${matters}`;
    }
    case "raadet":
      return `<p class="label">Rådet</p>${sorted.length ? sorted.map((m) => matterEntry(scene, state, m, true)).join("") : `<p class="dim">Ingenting venter.</p>`}<p class="dim note">Krysser mandatet = utenfor det sivilisasjonen kan alene. Et vedtak er ikke en petisjon; petisjoner vises først når de er sendt.</p>`;
    case "arbeid":
      return `<p class="label">Arbeid</p>${scene.settlements.map((s) => {
        if (s.epistemic !== "observed") return `<p class="civ-name faint">${esc(s.name)} <span class="dim">aldri sett</span></p>`;
        const { running, traces } = workTree(s);
        return `<p class="civ-name"><a href="#" data-go="${esc(s.civilizationId)}">${esc(s.name)}</a> <span class="dim">${s.inhabitants.length ? `${s.inhabitants.length} i arbeid` : "stille"} · <span class="mono">${ago(scene, s.lastSeen!)}</span></span></p><div class="work-tree">${running}${traces}</div>`;
      }).join("")}`;
    case "petisjoner":
      return `<p class="label">Petisjoner</p>${scene.letters.length ? scene.letters.slice().sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map((l) => {
        const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId);
        const word: Record<string, string> = { sent: "sendt — venter på observasjon", accepted: "akseptert", queued: "i kø", "in-progress": "pågår", refused: "avslått" };
        const st = l.state === "refused" ? `<span class="seal">avslått</span>` : `<b>${word[l.state] ?? l.state}</b>`;
        return `<div class="matter"><p class="matter-meta"><span>til ${esc(s?.seatName ?? l.toCivilizationId)} · ${esc(s?.name ?? "")}</span><span class="mono dim">${ago(scene, l.sentAt)}</span></p><p class="matter-title">${esc(l.text)}</p><p class="dim">${st}</p></div>`;
      }).join("") : `<p class="dim">Ingen petisjoner.</p>`}<p class="dim note">Noe som ble bedt om. Bare observert tilstand vises; aldri et resultat.</p>`;
    case "observert":
      return `<p class="label">Observert</p>${observedLog(scene, state.settings.logLimit)}`;
  }
}

/** The strip: the whole world in one sentence. Each number is a link to its sheet. */
export function renderStrip(scene: Scene, state: DeskState): string {
  const open = scene.capital.matters.filter((m) => !state.decisions[m.id]).length;
  const live = scene.settlements.filter((s) => s.epistemic === "observed" && s.inhabitants.length > 0).length;
  const quiet = scene.settlements.filter((s) => s.epistemic === "observed" && s.inhabitants.length === 0).length;
  const unseen = scene.settlements.filter((s) => s.epistemic !== "observed").length;
  const waiting = Object.values(state.threads).filter((t) => t.lines.length && t.lines[t.lines.length - 1]!.who === "you").length;
  const part = (n: number, word: string, sheet: string, cls = "") => `<a href="#" data-sheet="${sheet}" class="strip-part"><span class="n ${n ? cls : "faint"}">${n}</span> ${word}</a>`;
  return [
    part(open, open === 1 ? "sak venter" : "saker venter", "raadet", "seal"),
    part(live, "i arbeid", "arbeid", "live"),
    part(quiet, "stille", "arbeid"),
    part(unseen, "aldri sett", "arbeid"),
    part(scene.letters.length, "petisjoner", "petisjoner"),
    `<a href="#" data-sheet="samtaler" class="strip-part">${waiting ? `<span class="n live">${waiting}</span> venter på svar` : "samtaler"}</a>`,
  ].join('<span class="sep">·</span>');
}

/** Samtaler: the one page-exception that is a roster of faces, Stardew-journal style.
 *  Everyone you can talk to — not just threads that already exist — grouped by place:
 *  Hovedkvarter (Rådet) first, then each civilization's seat and its live agents. A
 *  thread's last line shows as the preview once a conversation has started. */
export function renderSamtaler(scene: Scene, state: DeskState): string {
  // Every face is a portrait plate from /art/faces. Looks are derived from identity
  // (looks.ts), never from a per-id table, so any number of civilizations works.
  const face = (n: number, cls = "") => `<img class="face${cls ? ` ${cls}` : ""}" src="/art/faces/${n}.png" alt="">`;
  const row = (id: string, title: string, defaultSub: string, faceImg: string) => {
    const th = state.threads[id];
    const last = th?.lines.filter((l) => l.who !== "note").at(-1);
    const waiting = !!th && th.lines.length > 0 && th.lines[th.lines.length - 1]!.who === "you";
    const preview = last ? `${esc(last.text.slice(0, 70))}${last.text.length > 70 ? "…" : ""}` : esc(defaultSub);
    const meta = th ? `${agoMs(th.lastAt)}${waiting ? '<span class="live-dot"></span>' : ""}` : "";
    return `<p class="face-row" data-resume="${esc(id)}">${faceImg}<span class="face-info"><span class="face-name">${esc(title)}</span><span class="face-preview">${preview}</span></span><span class="mono face-tool">${meta}</span></p>`;
  };

  const openMatters = scene.capital.matters.filter((m) => !state.decisions[m.id]).length;
  const global = `<p class="group-label">Hovedkvarter</p>${row("council", "Rådet", openMatters ? `${openMatters} ${openMatters === 1 ? "sak" : "saker"} på bordet` : "bordet er tomt", face(0, "council"))}`;

  const civs = scene.settlements.map((s, idx) => {
    if (s.epistemic !== "observed") return `<p class="group-label">${esc(s.name)} <span class="faint">aldri sett</span></p>`;
    const seat = row(`seat:${s.civilizationId}`, s.seatName, "setet", face(seatFaceFor(idx, true)));
    const agents = s.inhabitants.map((i) => row(`agent:${i.runId}`, i.label, i.tool ?? "agent", face(agentFaceFor(i.runId, i.tool)))).join("");
    return `<p class="group-label">${esc(s.name)}</p>${seat}${agents}`;
  }).join("");

  return `<p class="page-title">Samtaler</p>${global}${civs}<p class="dim note">Svar er skriptet fra observert tilstand. Ikke koblet til en runtime i prototypen.</p>`;
}

/** Innstillinger: a plain list of choices, never a form in boxes. */
export function renderInnstillinger(scene: Scene, state: DeskState): string {
  const s = state.settings;
  const sw = (key: keyof Settings, label: string, help: string, on: boolean) =>
    `<p class="set-row"><a href="#" class="set-l ${on ? "live" : "dim"}" data-set="${key}">${label}: ${on ? "på" : "av"}</a><small>${help}</small></p>`;
  const seg = (key: keyof Settings, label: string, opts: Array<[string, string]>, cur: string) =>
    `<p class="set-row"><span class="set-l">${label}: ${opts.map(([v, l]) => v === cur ? `<b>${l}</b>` : `<a href="#" data-seg="${key}" data-val="${v}">${l}</a>`).join(" · ")}</span></p>`;
  const civs = scene.settlements.map((c) => `<p class="set-row"><span>${esc(c.name)} <span class="dim">${esc(c.domain)}</span></span><span class="dim">${c.epistemic === "observed" ? "observert" : "ingen kilde"}</span></p>`).join("");
  const allKeys = [...SECTIONS, ...PAGES];
  return `<p class="page-title">Innstillinger</p>
  <p class="label">Kart</p>
  ${sw("labels", "Stedsnavn på kartet", "skjul for et renere bilde; hover viser navnet uansett", s.labels)}
  ${sw("smoke", "Røyk og folk", "bevegelse der arbeid kjører — av gir stillbilde", s.smoke)}
  <p class="label">Bordet</p>
  ${seg("deskWidth", "Bredde", [["300", "smal"], ["340", "normal"], ["400", "bred"]], String(s.deskWidth))}
  ${seg("logLimit", "Logg", [["10", "10"], ["30", "30"], ["100", "100"]], String(s.logLimit))}
  ${seg("theme", "Tema", [["dark", "mørk"], ["light", "lys"], ["system", "system"]], s.theme)}
  ${seg("language", "Skallspråk", [["nb", "norsk"], ["en", "english"]], s.language)}
  <p class="dim note">Kildetekst (saker, petisjoner, kjøringer) oversettes aldri.</p>
  <p class="label">Sivilisasjoner <span class="dim">${scene.settlements.length}</span></p>
  ${civs}
  <p class="dim note">Grunnlegging, oppløsning og mandat er brukerens suverene handlinger. Ikke bygget i prototypen.</p>
  <p class="label">Kilder</p>
  <p class="dim">Ingen koblinger. Verdenen leser en syntetisk fixture.</p>
  <p class="label">Tastatur</p>
  <p class="dim"><kbd>1</kbd>–<kbd>9</kbd> sivilisasjon i rekkefølge (<kbd>0</kbd> = den tiende) · <kbd>C</kbd> Capital</p>
  <p class="dim">${allKeys.map((t) => `<kbd>${t.key}</kbd> ${t.label}`).join(" · ")}</p>
  <p class="dim"><kbd>⌥B</kbd> skjul / vis bordet · <kbd>⌥F</kbd> fullskjerm · <kbd>Esc</kbd> tilbake</p>`;
}

export function civByIndex(scene: Scene, n: number): Settlement | undefined { return scene.settlements[n - 1]; }
