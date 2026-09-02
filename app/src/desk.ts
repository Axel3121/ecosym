// The desk: the work zone beside the map. The map is the place; the desk is
// the tool. Every number here comes from the scene, never from time or guess.
import type { Scene, Settlement } from "./scene.ts";

export type Decision = "ja" | "nei" | "spør";
export type Tab = "oversikt" | "raadet" | "arbeid" | "petisjoner" | "samtaler" | "folk" | "innstillinger";
/** Adding a tab = one row here + one case in renderDesk. Keys are single letters; keep them unique. */
export const TABS: Array<{ id: Tab; label: string; glyph: string; key: string; hint: string }> = [
  { id: "oversikt", label: "Oversikt", glyph: "⌂", key: "O", hint: "hva trenger deg nå" },
  { id: "raadet", label: "Rådet", glyph: "⚑", key: "R", hint: "saker som krysser en grense — du avgjør" },
  { id: "arbeid", label: "Arbeid", glyph: "⟳", key: "A", hint: "alt som kjører nå, alle sivilisasjoner" },
  { id: "petisjoner", label: "Petisjoner", glyph: "✉", key: "P", hint: "det du har bedt om, og hvor det står" },
  { id: "samtaler", label: "Samtaler", glyph: "☰", key: "S", hint: "tråder du har" },
  { id: "folk", label: "Folk", glyph: "☺", key: "F", hint: "hvem du kan snakke med" },
  { id: "innstillinger", label: "Innstillinger", glyph: "⚙", key: "I", hint: "flaten, aldri sannheten" },
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
  tab: Tab;
  /** collapsed = 44px glyph strip · side = beside the map · full = whole screen, map hidden */
  mode: DeskMode;
  threads: Record<string, Thread>;
  settings: Settings;
}

function esc(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)); }

export function ago(scene: Scene, iso: string) {
  const m = Math.round((Date.parse(scene.observedAt) - Date.parse(iso)) / 60000);
  return m < 1 ? "nå" : m < 60 ? `${m} min` : `${Math.round(m / 60)} t`;
}

/** Attention strip: what needs Axel now, in one glance. */
function attention(scene: Scene, state: DeskState) {
  const open = scene.capital.matters.filter((m) => !state.decisions[m.id]);
  const live = scene.settlements.filter((s) => s.epistemic === "observed" && s.inhabitants.length > 0);
  const quiet = scene.settlements.filter((s) => s.epistemic === "observed" && s.inhabitants.length === 0);
  const unseen = scene.settlements.filter((s) => s.epistemic !== "observed");
  const stale = scene.settlements.filter((s) => s.epistemic === "observed" && s.lastSeen && Date.parse(scene.observedAt) - Date.parse(s.lastSeen) > 6 * 3600e3);
  const rows = [
    [`${open.length}`, open.length === 1 ? "sak venter på deg" : "saker venter på deg", open.length ? "urgent" : ""],
    [`${live.length}`, "i arbeid", ""],
    [`${quiet.length}`, "stille", ""],
    [`${unseen.length}`, "aldri sett", unseen.length ? "dim" : ""],
  ];
  const warn = stale.length ? `<p class="desk-warn">${stale.map((s) => s.name).join(", ")} ikke sett på over 6 t</p>` : "";
  return `<section class="desk-attn">${rows.map(([n, l, c]) => `<div class="attn ${c}"><b>${n}</b><span>${l}</span></div>`).join("")}</section>${warn}`;
}

/** Council queue as a real worklist: decide, don't just read. */
function queue(scene: Scene, state: DeskState) {
  const items = scene.capital.matters.slice().sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
  if (!items.length) return `<section class="desk-sec"><h3>Rådet</h3><p class="muted">Ingenting venter.</p></section>`;
  const li = items.map((m) => {
    const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy);
    const d = state.decisions[m.id];
    const [what, crosses] = m.summary.split(" (crosses: ");
    const body = `<span class="q-who">${esc(s?.name ?? m.raisedBy)} <span class="q-when">${ago(scene, m.raisedAt)}</span></span><span class="q-what">${esc((what ?? m.summary).replace(/^\w+ asks to /, ""))}</span>${crosses ? `<span class="q-cross">${esc(crosses.replace(/\)$/, ""))}</span>` : ""}`;
    const act = d
      ? `<span class="q-done ${d.decision}">${d.decision === "ja" ? "✓ ja" : d.decision === "nei" ? "✗ nei" : "? spurt tilbake"} <button data-undo="${m.id}" title="angre">↶</button></span>`
      : `<span class="q-act"><button data-decide="ja" data-id="${m.id}">ja</button><button data-decide="nei" data-id="${m.id}">nei</button><button data-decide="spør" data-id="${m.id}">spør</button></span>`;
    return `<li class="q ${d ? "decided" : ""}" data-civ="${esc(m.raisedBy)}">${body}${act}</li>`;
  }).join("");
  return `<section class="desk-sec"><h3>Rådet <span class="muted">${items.filter((m) => !state.decisions[m.id]).length} åpne</span></h3><ol class="queue">${li}</ol><p class="desk-note">Avgjørelser blir petisjoner. Ikke koblet i prototypen.</p></section>`;
}

/** Civilization roster + the selected one's work. */
function roster(scene: Scene, state: DeskState) {
  const rows = scene.settlements.map((s, i) => {
    const sel = state.selectedCiv === s.civilizationId ? "sel" : "";
    const st = s.epistemic !== "observed" ? `<span class="dim">aldri sett</span>`
      : s.inhabitants.length ? `<span class="live">● ${s.inhabitants.length} i arbeid</span>` : `<span class="muted">stille · sist ${ago(scene, s.lastSeen!)}</span>`;
    const open = s.openMatters ? `<span class="seal">${s.openMatters}</span>` : "";
    return `<li class="civ ${sel}" data-civ="${esc(s.civilizationId)}"><kbd>${i + 1}</kbd><b>${esc(s.name)}</b>${st}${open}</li>`;
  }).join("");
  return `<section class="desk-sec"><h3>Sivilisasjoner</h3><ul class="roster">${rows}<li class="civ ${state.selectedCiv === "__capital" ? "sel" : ""}" data-civ="__capital"><kbd>C</kbd><b>Capital</b><span class="muted">${scene.capital.matters.length} saker</span></li></ul></section>`;
}

function capital(scene: Scene) {
  const halls = scene.capital.halls.map((h) => `<li class="hall" data-civ="${esc(h.civilizationId)}"><b>${esc(h.name)}</b> <span class="muted">${esc(h.seatName)}</span><span class="r">${h.epistemic === "observed" ? (h.live ? `<span class="live">● i arbeid</span>` : `<span class="muted">stille</span>`) : `<span class="dim">aldri sett</span>`}${h.openMatters ? ` <span class="seal">${h.openMatters}</span>` : ""}</span></li>`).join("");
  return `<section class="desk-sec"><h3><span>Capital</span><span class="muted">verdens hovedkvarter</span></h3><ul class="halls">${halls}</ul><p class="muted">Rådet ser hver sivilisasjon i sammendrag. Detaljene bor der arbeidet bor.</p><div class="desk-actions"><button data-talk-council="1" class="primary">gå inn i rådskammeret</button></div></section>`;
}

function log(scene: Scene, limit = 30) {
  type Ev = { at: string; text: string; cls: string };
  const ev: Ev[] = [];
  for (const m of scene.capital.matters) { const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy); ev.push({ at: m.raisedAt, text: `${s?.name ?? m.raisedBy} reiste sak for rådet`, cls: "seal" }); }
  for (const l of scene.letters) { const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId); ev.push({ at: l.sentAt, text: `petisjon til ${s?.seatName ?? l.toCivilizationId}: «${l.text}» — ${l.state}`, cls: "muted" }); }
  for (const s of scene.settlements) { if (s.lastSeen) ev.push({ at: s.lastSeen, text: `${s.name} sist observert`, cls: "muted" }); for (const t of s.traces) ev.push({ at: t.endedAt, text: `${s.name}: «${t.label}» ferdig`, cls: "" }); }
  ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const rows = ev.slice(0, limit).map((e) => `<li><span class="when">${ago(scene, e.at)}</span><span class="${e.cls}">${esc(e.text)}</span></li>`).join("");
  return `<section class="desk-sec"><h3><span>Siste observert</span></h3><ul class="log">${rows}</ul></section>`;
}

function workTree(s: Settlement) {
  const roots = s.inhabitants.filter((i) => i.depth === 0);
  const kids = (parent: string): string => {
    const cs = s.inhabitants.filter((i) => i.parentRunId === parent);
    return cs.length ? `<ul>${cs.map(node).join("")}</ul>` : "";
  };
  const node = (i: Settlement["inhabitants"][number]): string =>
    `<li><span class="live">●</span> ${esc(i.label)}${i.tool ? ` <span class="muted">${esc(i.tool)}</span>` : ""}${kids(i.runId)}</li>`;
  const tree = (_p: undefined, _d: number) => roots.map(node).join("");
  const running = roots.length ? `<ul class="work">${tree(undefined, 0)}</ul>` : `<p class="muted">Ingen i arbeid.</p>`;
  const traces = s.traces.length ? `<ul class="work traces">${s.traces.map((t) => `<li><span class="muted">○</span> ${esc(t.label)} <span class="dim" title="hvor mye av oppbevaringsvinduet som er igjen">blekner · ${Math.round(t.freshness * 100)}% igjen</span></li>`).join("")}</ul>` : "";
  return { running, traces };
}

function work(scene: Scene, state: DeskState) {
  if (state.selectedCiv === "__capital") return capital(scene);
  const s = scene.settlements.find((x) => x.civilizationId === state.selectedCiv);
  if (!s) return "";
  if (s.epistemic !== "observed") return `<section class="desk-sec"><h3>${esc(s.name)}</h3><p class="muted">Aldri observert. Koble en kilde for å se noe her.</p></section>`;
  const { running, traces } = workTree(s);
  return `<section class="desk-sec"><h3><span>${esc(s.name)}</span><span class="muted domain">${esc(s.domain)}</span></h3><p class="muted">sist sett ${ago(scene, s.lastSeen!)} siden</p><h4>I arbeid</h4>${running}${traces ? `<h4>Nylig ferdig</h4>${traces}` : ""}<div class="desk-actions"><button data-go="${esc(s.civilizationId)}">gå dit</button><button data-talk-civ="${esc(s.civilizationId)}" class="primary">snakk med ${esc(s.seatName)}</button></div></section>`;
}

/** Rådet tab: the whole queue, open first, decided below, with the seat's mandate for context. */
function tabRaadet(scene: Scene, state: DeskState) {
  const items = scene.capital.matters.slice().sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt));
  const open = items.filter((m) => !state.decisions[m.id]);
  const done = items.filter((m) => state.decisions[m.id]);
  const card = (m: typeof items[number]) => {
    const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy);
    const d = state.decisions[m.id];
    const [whatRaw, crosses] = m.summary.split(" (crosses: ");
    const what = (whatRaw ?? m.summary).replace(/^\w+ asks to /, "");
    const ruleRaw = crosses?.replace(/\)$/, "");
    const rule = ruleRaw && ruleRaw !== what ? ruleRaw : undefined;
    return `<li class="q big ${d ? "decided" : ""}">
      <div class="q-head"><span class="q-who">${esc(s?.name ?? m.raisedBy)} · ${esc(s?.seatName ?? "")}</span><span class="q-when">${ago(scene, m.raisedAt)}</span></div>
      <div class="q-what">«${esc(what)}»</div>
      ${rule ? `<div class="q-cross">${esc(rule)} <span class="dim">— utenfor mandatet «${esc(s?.mandate.alone.join(", ") ?? "")}»</span></div>` : ruleRaw ? `<div class="q-cross"><span class="dim">krysser mandatet «${esc(s?.mandate.alone.join(", ") ?? "")}»</span></div>` : `<div class="dim">ingen regel navngitt i saken</div>`}
      ${d ? `<span class="q-done ${d.decision}">${d.decision === "ja" ? "✓ ja" : d.decision === "nei" ? "✗ nei" : "? spurt tilbake"} <button data-undo="${m.id}" title="angre">↶</button></span>`
          : `<span class="q-act"><button data-decide="ja" data-id="${m.id}">ja</button><button data-decide="nei" data-id="${m.id}">nei</button><button data-decide="spør" data-id="${m.id}">spør tilbake</button>${s ? `<button data-go="${esc(s.civilizationId)}" class="ghost">se ${esc(s.name)}</button>` : ""}</span>`}
    </li>`;
  };
  return `<section class="desk-sec"><h3><span>Åpne</span><span class="muted">${open.length}</span></h3><ol class="queue">${open.map(card).join("") || '<li class="muted">Ingenting venter.</li>'}</ol></section>
  ${done.length ? `<section class="desk-sec"><h3><span>Avgjort denne økten</span><span class="muted">${done.length}</span></h3><ol class="queue">${done.map(card).join("")}</ol></section>` : ""}
  <p class="desk-note">⚑ = krysser sivilisasjonens mandat. Avgjørelser blir petisjoner. Ikke koblet i prototypen.</p>`;
}

/** Arbeid tab: everything running, every civilization, one screen. */
function tabArbeid(scene: Scene) {
  const secs = scene.settlements.map((s) => {
    if (s.epistemic !== "observed") return `<section class="desk-sec"><h3><span>${esc(s.name)}</span><span class="dim">aldri sett</span></h3></section>`;
    const { running, traces } = workTree(s);
    return `<section class="desk-sec"><h3><span>${esc(s.name)}</span><span class="muted">${s.inhabitants.length ? `<span class="live">● ${s.inhabitants.length}</span>` : "stille"} · ${ago(scene, s.lastSeen!)}</span></h3>${running}${traces ? `<h4>Nylig ferdig</h4>${traces}` : ""}</section>`;
  });
  const total = scene.settlements.reduce((n, s) => n + s.inhabitants.length, 0);
  return `<p class="muted">${total} i arbeid på tvers av ${scene.settlements.filter((s) => s.epistemic === "observed").length} observerte sivilisasjoner.</p>${secs.join("")}`;
}

/** Petisjoner tab: every letter and where it stands. A petition is never a result. */
function tabPetisjoner(scene: Scene) {
  const order: Record<string, number> = { sent: 0, accepted: 1, queued: 2, "in-progress": 3, refused: 4 };
  const rows = scene.letters.slice().sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt)).map((l) => {
    const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId);
    const steps = ["sent", "accepted", "queued", "in-progress"].map((st, i) => `<i class="${i <= (order[l.state] ?? 0) && l.state !== "refused" ? "on" : ""}"></i>`).join("");
    return `<li class="pet"><div class="q-head"><span class="q-who">til ${esc(s?.seatName ?? l.toCivilizationId)} · ${esc(s?.name ?? "")}</span><span class="q-when">${ago(scene, l.sentAt)}</span></div><div class="q-what">${esc(l.text)}</div><div class="pet-state"><span class="steps">${steps}</span><span class="${l.state === "refused" ? "seal" : "muted"}">${esc(l.state)}</span></div></li>`;
  });
  return `<p class="muted">Noe som ble bedt om. Vises aldri som noe som skjedde.</p><ol class="queue">${rows.join("") || '<li class="muted">Ingen petisjoner.</li>'}</ol>`;
}

/** Samtaler: only threads you actually have, newest first, grouped by where. Nothing else. */
function tabSamtaler(scene: Scene, state: DeskState) {
  const ts = Object.values(state.threads).sort((a, b) => b.lastAt - a.lastAt);
  if (!ts.length) return `<p class="muted">Ingen samtaler ennå.</p><p class="desk-note">Finn noen å snakke med under <b>Folk</b> (F), eller klikk en person eller et sete på kartet.</p>`;
  const groups = new Map<string, typeof ts>();
  for (const t of ts) { const k = t.id === "council" ? "Hovedkvarter" : t.where; groups.set(k, [...(groups.get(k) ?? []), t]); }
  const secs = [...groups].map(([where, list]) => `<section class="desk-sec"><h3><span>${esc(where)}</span><span class="muted">${list.length}</span></h3><ol class="queue">${list.map((t) => {
    const last = t.lines.filter((l) => l.who !== "note").at(-1);
    const n = t.lines.filter((l) => l.who === "you").length;
    return `<li class="thr"><div class="q-head"><span class="q-who">${esc(t.title)}</span><span class="q-when">${agoMs(t.lastAt)}</span></div>${last ? `<div class="thr-last"><span class="dim">${last.who === "you" ? "du" : esc(t.title)}:</span> ${esc(last.text.slice(0, 90))}${last.text.length > 90 ? "…" : ""}</div>` : ""}<div class="thr-meta"><span class="dim">${n} ${n === 1 ? "melding" : "meldinger"} fra deg</span><button data-resume="${esc(t.id)}">fortsett ›</button></div></li>`;
  }).join("")}</ol></section>`).join("");
  return secs + `<p class="desk-note">Svar er skriptet fra observert tilstand. Ikke koblet til en runtime i prototypen.</p>`;
}

/** Folk: who exists and can be addressed. Capital first, then each civilization's seat and its agents. */
function tabFolk(scene: Scene, state: DeskState) {
  const has = (id: string) => !!state.threads[id];
  const person = (id: string, title: string, sub: string, live: boolean, action: string, nested = false) =>
    `<li class="who ${nested ? "who-nested" : ""}"><span class="who-name">${live ? '<span class="live">●</span> ' : ""}${esc(title)}</span><span class="dim">${esc(sub)}</span><button data-resume="${esc(id)}" class="${has(id) ? "" : "ghost"}">${has(id) ? "fortsett ›" : action}</button></li>`;
  const global = `<section class="desk-sec"><h3><span>Hovedkvarter</span><span class="muted">global</span></h3><ul class="people">${person("council", "Rådet", `${scene.capital.matters.length} saker`, false, "åpne ›")}</ul></section>`;
  const civs = scene.settlements.map((s) => {
    if (s.epistemic !== "observed") return `<section class="desk-sec"><h3><span>${esc(s.name)}</span><span class="dim">aldri sett</span></h3></section>`;
    const seat = person(`seat:${s.civilizationId}`, s.seatName, "setet", false, "snakk ›");
    const agents = s.inhabitants.map((i) => person(`agent:${i.runId}`, i.label, i.tool ?? "agent", true, "spør ›", true)).join("");
    return `<section class="desk-sec"><h3><span>${esc(s.name)}</span><span class="muted domain">${esc(s.domain)}</span></h3><ul class="people">${seat}${agents}</ul></section>`;
  }).join("");
  return global + civs + `<p class="desk-note">Agenter tar ikke ordre — de svarer på spørsmål. Ordre går til setet.</p>`;
}
function agoMs(at: number) {
  const m = Math.round((Date.now() - at) / 60000);
  return m < 1 ? "nå" : m < 60 ? `${m} min` : `${Math.round(m / 60)} t`;
}

/** Innstillinger tab: switches that actually drive the surface. Nothing here changes what is true, only how it is shown. */
function tabInnstillinger(state: DeskState, scene: Scene) {
  const s = state.settings;
  const sw = (key: keyof Settings, label: string, help: string, on: boolean) =>
    `<li class="set"><label><input type="checkbox" data-set="${key}" ${on ? "checked" : ""}><span class="sw"></span><span class="set-l">${label}<small>${help}</small></span></label></li>`;
  const seg = (key: keyof Settings, label: string, opts: Array<[string, string]>, cur: string) =>
    `<li class="set"><span class="set-l">${label}</span><span class="seg">${opts.map(([v, l]) => `<button data-seg="${key}" data-val="${v}" class="${cur === v ? "on" : ""}">${l}</button>`).join("")}</span></li>`;
  const civs = scene.settlements.map((c) => `<li class="civ-row"><span>${esc(c.name)} <span class="dim">${esc(c.domain)}</span></span><span class="dim">${c.epistemic === "observed" ? "observert" : "ingen kilde"}</span></li>`).join("");
  return `
  <section class="desk-sec"><h3>Kart</h3><ul class="sets">
    ${sw("labels", "Stedsnavn på kartet", "skjul for et renere bilde; hover viser navnet uansett", s.labels)}
    ${sw("smoke", "Røyk og folk", "bevegelse der arbeid kjører — av gir stillbilde", s.smoke)}
  </ul></section>
  <section class="desk-sec"><h3>Bordet</h3><ul class="sets">
    ${seg("deskWidth", "Bredde", [["300", "smal"], ["340", "normal"], ["400", "bred"]], String(s.deskWidth))}
    ${seg("logLimit", "Logg", [["10", "10"], ["30", "30"], ["100", "100"]], String(s.logLimit))}
    ${seg("theme", "Tema", [["dark", "mørk"], ["light", "lys"], ["system", "system"]], s.theme)}
    ${seg("language", "Skallspråk", [["nb", "norsk"], ["en", "english"]], s.language)}
  </ul><p class="desk-note">Kildetekst (saker, petisjoner, kjøringer) oversettes aldri.</p></section>
  <section class="desk-sec"><h3><span>Sivilisasjoner</span><span class="muted">${scene.settlements.length}</span></h3><ul class="sets">${civs}</ul>
    <div class="desk-actions"><button disabled title="grunnlegging er en suveren handling og krever et design for identitet først">grunnlegg ny …</button></div>
    <p class="desk-note">Grunnlegging, oppløsning og mandat er brukerens suverene handlinger. Ikke bygget i prototypen.</p></section>
  <section class="desk-sec"><h3>Kilder</h3><p class="muted">Ingen koblinger. Verdenen leser en syntetisk fixture.</p><div class="desk-actions"><button disabled title="observasjonslaget eier koblinger; UI for det er ikke designet">koble kilde …</button></div></section>
  <section class="desk-sec"><h3>Tastatur</h3><ul class="keys">
    <li><kbd>1</kbd>–<kbd>4</kbd> sivilisasjon · <kbd>C</kbd> Capital</li>
    <li>${TABS.map((t) => `<kbd>${t.key}</kbd> ${t.label}`).join(" · ")}</li>
    <li><kbd>⌥B</kbd> skjul / vis bordet · <kbd>⌥F</kbd> fullskjerm · <kbd>Esc</kbd> tilbake</li>
  </ul></section>`;
}

export function renderTabs(state: DeskState): string {
  return TABS.map((t) => `<button class="tab ${state.tab === t.id ? "on" : ""}" data-tab="${t.id}" title="${t.label} (${t.key})"><span class="glyph">${t.glyph}</span><span class="lbl">${t.label}</span><span class="key">${t.key}</span></button>`).join("");
}

export function renderDesk(scene: Scene, state: DeskState): string {
  switch (state.tab) {
    case "raadet": return tabRaadet(scene, state);
    case "arbeid": return tabArbeid(scene);
    case "petisjoner": return tabPetisjoner(scene);
    case "samtaler": return tabSamtaler(scene, state);
    case "folk": return tabFolk(scene, state);
    case "innstillinger": return tabInnstillinger(state, scene);
    default: return attention(scene, state) + roster(scene, state) + work(scene, state) + queue(scene, state) + log(scene, state.settings.logLimit);
  }
}

export function civByIndex(scene: Scene, n: number): Settlement | undefined { return scene.settlements[n - 1]; }
