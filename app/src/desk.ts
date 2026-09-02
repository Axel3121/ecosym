// The desk: the work zone beside the map. The map is the place; the desk is
// the tool. Every number here comes from the scene, never from time or guess.
import type { Scene, Settlement } from "./scene.ts";

export type Decision = "ja" | "nei" | "spør";
export type Tab = "oversikt" | "raadet" | "arbeid" | "petisjoner";
export const TABS: Array<{ id: Tab; label: string; glyph: string; key: string }> = [
  { id: "oversikt", label: "Oversikt", glyph: "◫", key: "O" },
  { id: "raadet", label: "Rådet", glyph: "⚑", key: "R" },
  { id: "arbeid", label: "Arbeid", glyph: "●", key: "A" },
  { id: "petisjoner", label: "Petisjoner", glyph: "✉", key: "P" },
];
export interface DeskState {
  decisions: Record<string, { decision: Decision; at: number }>;
  selectedCiv: string | null;
  tab: Tab;
  collapsed: boolean;
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

function log(scene: Scene) {
  type Ev = { at: string; text: string; cls: string };
  const ev: Ev[] = [];
  for (const m of scene.capital.matters) { const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy); ev.push({ at: m.raisedAt, text: `${s?.name ?? m.raisedBy} reiste sak for rådet`, cls: "seal" }); }
  for (const l of scene.letters) { const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId); ev.push({ at: l.sentAt, text: `petisjon til ${s?.seatName ?? l.toCivilizationId}: «${l.text}» — ${l.state}`, cls: "muted" }); }
  for (const s of scene.settlements) { if (s.lastSeen) ev.push({ at: s.lastSeen, text: `${s.name} sist observert`, cls: "muted" }); for (const t of s.traces) ev.push({ at: t.endedAt, text: `${s.name}: «${t.label}» ferdig`, cls: "" }); }
  ev.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const rows = ev.slice(0, 8).map((e) => `<li><span class="when">${ago(scene, e.at)}</span><span class="${e.cls}">${esc(e.text)}</span></li>`).join("");
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

export function renderTabs(state: DeskState): string {
  return TABS.map((t) => `<button class="tab ${state.tab === t.id ? "on" : ""}" data-tab="${t.id}" title="${t.label} (${t.key})"><span class="glyph">${t.glyph}</span><span class="lbl">${t.label}</span></button>`).join("");
}

export function renderDesk(scene: Scene, state: DeskState): string {
  switch (state.tab) {
    case "raadet": return tabRaadet(scene, state);
    case "arbeid": return tabArbeid(scene);
    case "petisjoner": return tabPetisjoner(scene);
    default: return attention(scene, state) + roster(scene, state) + work(scene, state) + queue(scene, state) + log(scene);
  }
}

export function civByIndex(scene: Scene, n: number): Settlement | undefined { return scene.settlements[n - 1]; }
