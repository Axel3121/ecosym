import { deriveScene } from "./scene.ts";
import type { Scene } from "./scene.ts";
import { fixture } from "./fixture.ts";
import { Chart, makeWalkers, stepWalkers, ZOOM_MIN, ZOOM_MAX, SETTLEMENT_ZOOM, coverZoom } from "./chart.ts";
import type { Hit } from "./chart.ts";
import { renderDesk, renderTabs, civByIndex, TABS, DEFAULT_SETTINGS } from "./desk.ts";
import type { DeskState, Decision, Tab, Settings, Thread, DeskMode } from "./desk.ts";
import { PLATES, PLATE_OF } from "./chart.ts";
import { opening, reply } from "./dialogue.ts";
import type { Target, Line } from "./dialogue.ts";

const scene: Scene = deriveScene(fixture);
const canvas = document.getElementById("chart") as HTMLCanvasElement;
const chart = new Chart(canvas);
function minZoom() { return Math.max(ZOOM_MIN, coverZoom(canvas.clientWidth, canvas.clientHeight)); }
const walkers = makeWalkers(scene);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let motionOff = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$("observed-at").textContent = new Date(scene.observedAt).toLocaleString("nb-NO", { dateStyle: "long", timeStyle: "short" });
if (scene.synthetic) $("synthetic").hidden = false;

// ---- desk -------------------------------------------------------------------
const app = $("app");
const SETTINGS_KEY = "ecosym.settings";
function loadSettings(): Settings { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return { ...DEFAULT_SETTINGS }; } }
const desk: DeskState = { decisions: {}, selectedCiv: null, tab: "oversikt", mode: "side", threads: {}, settings: loadSettings() };
function applySettings() {
  const s = desk.settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  document.documentElement.style.setProperty("--desk-w", `${s.deskWidth}px`);
  app.classList.toggle("wide-desk", s.deskWidth >= 400);
  // unchanged when collapsed: the settings pane cannot be seen there
  chart.showLabels = s.labels;
  motionOff = !s.smoke;
  requestAnimationFrame(() => chart.resize()); setTimeout(() => chart.resize(), 200);
}
function renderDocket() {
  $("desk-tabs").innerHTML = renderTabs(desk);
  $("desk-body").innerHTML = renderDesk(scene, desk);
  const open = scene.capital.matters.filter((m) => !desk.decisions[m.id]).length;
  const rt = $("desk-tabs").querySelector<HTMLElement>('[data-tab="raadet"] .lbl');
  if (rt && open) rt.insertAdjacentHTML("afterend", `<span class="count">${open}</span>`);
  const nThreads = Object.keys(desk.threads).length;
  const st = $("desk-tabs").querySelector<HTMLElement>('[data-tab="samtaler"] .lbl');
  if (st && nThreads) st.insertAdjacentHTML("afterend", `<span class="count dim">${nThreads}</span>`);
  // settings + thread resume live inside the body; wire after render
  $("desk-body").querySelectorAll<HTMLInputElement>("[data-set]").forEach((el) => el.addEventListener("change", () => {
    (desk.settings as unknown as Record<string, unknown>)[el.dataset.set!] = el.checked; applySettings();
  }));
  $("desk-body").querySelectorAll<HTMLElement>("[data-seg]").forEach((el) => el.addEventListener("click", () => {
    const k = el.dataset.seg!, v = el.dataset.val!;
    (desk.settings as unknown as Record<string, unknown>)[k] = k === "language" ? v : Number(v); applySettings(); renderDocket();
  }));
  $("desk-body").querySelectorAll<HTMLElement>("[data-resume]").forEach((el) => el.addEventListener("click", () => resumeThread(el.dataset.resume!)));
}
let lastOpenMode: DeskMode = "side";
function setTab(t: Tab) { desk.tab = t; if (desk.mode === "collapsed") setMode(lastOpenMode); renderDocket(); }
function setMode(mode: DeskMode) {
  desk.mode = mode; if (mode !== "collapsed") lastOpenMode = mode;
  app.classList.toggle("collapsed", mode === "collapsed");
  app.classList.toggle("full", mode === "full");
  app.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  if (mode !== "full") { requestAnimationFrame(() => chart.resize()); setTimeout(() => chart.resize(), 200); }
}
$("desk-tabs").addEventListener("click", (e) => { const t = (e.target as HTMLElement).closest<HTMLElement>("[data-tab]"); if (t) setTab(t.dataset.tab as Tab); });
app.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => {
  const m = b.dataset.mode as DeskMode;
  setMode(desk.mode === m && m === "collapsed" ? lastOpenMode : m);
}));
$("desk-body").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-decide],[data-undo],[data-civ],[data-go],[data-talk-civ],[data-talk-council]");
  if (!t) return;
  if (t.dataset.decide) { desk.decisions[t.dataset.id!] = { decision: t.dataset.decide as Decision, at: Date.now() }; renderDocket(); return; }
  if (t.dataset.undo) { delete desk.decisions[t.dataset.undo]; renderDocket(); return; }
  if (t.dataset.go) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.go)!; select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); return; }
  if (t.dataset.talkCiv) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.talkCiv)!; focus({ kind: "seat", settlement: s }); return; }
  if (t.dataset.talkCouncil) { focus({ kind: "council" }); return; }
  if (t.dataset.civ === "__capital") { select({ kind: "capital", label: "Capital" }); return; }
  if (t.dataset.civ) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.civ)!; desk.selectedCiv = s.civilizationId; renderDocket(); flyTo(s.ground.x, s.ground.y, Math.max(chart.camera.zoom, 1.2)); }
});
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.altKey && (e.key === "b" || e.key === "∫")) { setMode(desk.mode === "collapsed" ? lastOpenMode : "collapsed"); return; }
  if (e.altKey && (e.key === "f" || e.key === "ƒ")) { setMode(desk.mode === "full" ? "side" : "full"); return; }
  if (!e.altKey && !e.metaKey && !e.ctrlKey) { const tab = TABS.find((t) => t.key.toLowerCase() === e.key.toLowerCase()); if (tab) { setTab(tab.id); return; } }
  const n = Number(e.key);
  if (n >= 1 && n <= 4) { const s = civByIndex(scene, n); if (s) select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); }
  if (e.key === "c" || e.key === "C") select({ kind: "capital", label: "Capital" });
});
function ago(iso: string) {
  const m = Math.round((Date.parse(scene.observedAt) - Date.parse(iso)) / 60000);
  return m < 1 ? "nå nettopp" : m < 60 ? `${m} min siden` : `${Math.round(m / 60)} t siden`;
}

// ---- camera -----------------------------------------------------------------
let target = { ...chart.camera };
let flying = false;

function flyTo(x: number, y: number, zoom: number) {
  if (desk.mode === "full") setMode("side");
  target = { x, y, zoom: Math.min(ZOOM_MAX, Math.max(minZoom(), zoom)) };
  flying = true;
  if (reduced) { chart.camera = { ...target }; flying = false; }
}

let dragging = false, last = { x: 0, y: 0 }, moved = 0;
canvas.addEventListener("pointerdown", (e) => { dragging = true; moved = 0; last = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add("dragging"); });
canvas.addEventListener("pointermove", (e) => {
  if (dragging) {
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    moved += Math.abs(dx) + Math.abs(dy);
    chart.camera.x -= dx / chart.camera.zoom; chart.camera.y -= dy / chart.camera.zoom;
    target = { ...chart.camera }; flying = false;
    last = { x: e.clientX, y: e.clientY };
  } else {
    const h = chart.hitTest(e.offsetX, e.offsetY);
    const hv = $("hover");
    canvas.classList.toggle("pointing", !!h);
    if (h) { hv.hidden = false; hv.style.left = `${e.offsetX}px`; hv.style.top = `${e.offsetY}px`; hv.innerHTML = `${h.label}${h.sub ? `<small>${h.sub}</small>` : ""}`; }
    else hv.hidden = true;
  }
});
canvas.addEventListener("pointerup", (e) => {
  dragging = false; canvas.classList.remove("dragging");
  if (moved > 6) return;
  const h = chart.hitTest(e.offsetX, e.offsetY);
  select(h);
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const before = chart.toWorld(e.offsetX, e.offsetY);
  const factor = Math.exp(-e.deltaY * 0.0014);
  const zoom = Math.min(ZOOM_MAX, Math.max(minZoom(), chart.camera.zoom * factor));
  chart.camera.zoom = zoom;
  const after = chart.toWorld(e.offsetX, e.offsetY);
  // keep the point under the pointer fixed
  chart.camera.x += before.x - after.x; chart.camera.y += before.y - after.y;
  target = { ...chart.camera }; flying = false;
}, { passive: false });
window.addEventListener("resize", () => chart.resize());
app.addEventListener("transitionend", () => chart.resize());
window.addEventListener("keydown", (e) => { if (e.key === "Escape") select(null); });

// ---- selection & sheet -----------------------------------------------------
let selected: Hit | null = null;

function select(h: Hit | null) {
  // The map is the place: a click goes there or starts a conversation.
  // Facts live on the desk; there is no card on top of the painting.
  selected = h;
  if (!h) return;
  const s = h.settlementId ? scene.settlements.find((x) => x.civilizationId === h.settlementId) : undefined;
  switch (h.kind) {
    case "settlement":
      if (!s) return;
      desk.selectedCiv = s.civilizationId;
      // P0 (two blind reviewers hit it): choosing a place must never land you on a tab
      // where the place has no actions. Facts and "snakk med" live on Oversikt.
      if (desk.tab === "innstillinger" || desk.tab === "petisjoner") desk.tab = "oversikt";
      renderDocket();
      if (s.epistemic === "observed") flyTo(s.ground.x, s.ground.y - 30, Math.max(chart.camera.zoom, 2.4));
      else flyTo(s.ground.x, s.ground.y, Math.max(chart.camera.zoom, 1.2));
      return;
    case "capital":
      desk.selectedCiv = "__capital";
      if (desk.tab === "innstillinger" || desk.tab === "petisjoner") desk.tab = "oversikt";
      renderDocket();
      flyTo(770, 410, Math.max(chart.camera.zoom, 1.7));
      return;
    case "seat":
      if (s) focus({ kind: "seat", settlement: s });
      return;
    case "inhabitant": {
      if (!s) return;
      const agent = s.inhabitants.find((i) => i.runId === h.runId);
      if (agent) focus({ kind: "agent", settlement: s, agent });
      else { desk.selectedCiv = s.civilizationId; renderDocket(); }
      return;
    }
    case "letter":
      desk.selectedCiv = "__capital"; renderDocket();
      return;
  }
}

// ---- focus mode: leave the world, talk ---------------------------------------
let current: Target | null = null;
const focusEl = $("focus"), thread = $("focus-thread");
const input = $<HTMLInputElement>("focus-input");

let currentThreadId: string | null = null;
function threadIdOf(t: Target): string { return t.kind === "council" ? "council" : t.kind === "seat" ? `seat:${t.settlement.civilizationId}` : `agent:${t.agent.runId}`; }
function threadFor(t: Target): Thread {
  const id = threadIdOf(t);
  return desk.threads[id] ??= {
    id,
    title: t.kind === "council" ? "Rådet" : t.kind === "seat" ? t.settlement.seatName : t.agent.label,
    where: t.kind === "council" ? "Hovedkvarter" : t.settlement.name,
    lines: [], lastAt: Date.now(),
  };
}
function resumeThread(id: string) {
  const [kind, key] = id.split(":");
  if (kind === "council") return focus({ kind: "council" });
  if (kind === "seat") { const s = scene.settlements.find((x) => x.civilizationId === key); if (s) focus({ kind: "seat", settlement: s }); return; }
  for (const s of scene.settlements) { const a = s.inhabitants.find((i) => i.runId === key); if (a) return focus({ kind: "agent", settlement: s, agent: a }); }
}
function push(lines: Line[], record = true) {
  if (record && currentThreadId) { const th = desk.threads[currentThreadId]; if (th) { th.lines.push(...lines.map((l) => ({ ...l, at: Date.now() }))); th.lastAt = Date.now(); } }
  for (const l of lines) {
    const d = document.createElement("div");
    d.className = `msg ${l.who}`; d.textContent = l.text; thread.appendChild(d);
  }
  thread.scrollTop = thread.scrollHeight;
}

function focus(t: Target) {
  if (desk.mode === "full") setMode("side");
  current = t;
  select(null);
  app.classList.add("focused"); focusEl.hidden = false; thread.innerHTML = "";
  const portrait = $("focus-portrait"); portrait.className = "portrait";
  if (t.kind === "council") {
    $("focus-name").textContent = "Rådet"; $("focus-kind").textContent = "Capital · verdens hovedkvarter";
    portrait.style.backgroundImage = `url(/art/capital.png)`; portrait.style.backgroundPosition = "50% 30%";
    $("focus-facts").innerHTML = `<b>Saker</b>${scene.capital.matters.map((m) => `${m.summary}<br>`).join("") || "ingen"}<b>Haller</b>${scene.capital.halls.map((h) => `${h.name} · ${h.epistemic === "observed" ? (h.live ? "i arbeid" : "stille") : "aldri sett"}<br>`).join("")}`;
    flyTo(770, 410, 2.2);
  } else {
    const s = t.settlement; const plate = PLATES[PLATE_OF[s.civilizationId] ?? "lake"]!;
    if (t.kind === "seat") {
      $("focus-name").textContent = s.seatName; $("focus-kind").textContent = `setet i ${s.name} · ${s.domain}`;
      portrait.style.backgroundImage = `url(${plate.img})`; portrait.style.backgroundPosition = "50% 8%";
      $("focus-facts").innerHTML = `<b>Kan alene</b>${s.mandate.alone.join("<br>")}<b>Må til rådet</b>${s.mandate.council.join("<br>")}<b>Nå</b>${s.inhabitants.length} i arbeid · ${s.traces.length} spor · ${s.openMatters} hos rådet`;
    } else {
      const a = t.agent;
      $("focus-name").textContent = a.label; $("focus-kind").textContent = `forbipasserende arbeid i ${s.name}`;
      portrait.className = "portrait agent"; portrait.style.backgroundImage = `url(/art/walkers.png)`; portrait.style.backgroundPosition = a.depth === 0 ? "8% 6%" : "8% 98%";
      $("focus-facts").innerHTML = `<b>Verktøy</b>${a.tool ?? "—"}<b>Under</b>${a.parentRunId ? s.inhabitants.find((p) => p.runId === a.parentRunId)?.label ?? a.parentRunId : "ingen (rot)"}<b>Har delegert</b>${s.inhabitants.filter((c) => c.parentRunId === a.runId).map((c) => c.label).join("<br>") || "ingenting"}`;
    }
    flyTo(s.ground.x, s.ground.y - 30, 2.4);
  }
  const th = threadFor(t); currentThreadId = th.id;
  if (th.lines.length) { push(th.lines, false); push([{ who: "note", text: "— fortsetter samtalen —" }], false); }
  else push(opening(scene, t));
  setTimeout(() => input.focus(), 50);
}
function unfocus() { current = null; currentThreadId = null; app.classList.remove("focused"); focusEl.hidden = true; if (desk.tab === "samtaler") renderDocket(); }
$("focus-back").addEventListener("click", unfocus);
$("focus-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !current) return;
  input.value = "";
  push([{ who: "you", text }]);
  const t = current;
  setTimeout(() => { if (current === t) push(reply(scene, t, text)); }, 350);
});
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && current) unfocus(); });

const chart_w = () => canvas.clientWidth, chart_h = () => canvas.clientHeight;
// ---- loop -------------------------------------------------------------------
let prev = performance.now();
function frame(now: number) {
  const dt = Math.min(64, now - prev); prev = now;
  if (flying) {
    const k = 1 - Math.pow(0.001, dt / 600);
    chart.camera.x += (target.x - chart.camera.x) * k;
    chart.camera.y += (target.y - chart.camera.y) * k;
    chart.camera.zoom += (target.zoom - chart.camera.zoom) * k;
    if (Math.abs(target.zoom - chart.camera.zoom) < 0.002 && Math.abs(target.x - chart.camera.x) < 0.3 && Math.abs(target.y - chart.camera.y) < 0.3) { chart.camera = { ...target }; flying = false; }
  }
  // the world has an edge: keep the camera on the map
  { const hw = chart_w() / 2 / chart.camera.zoom, hh = chart_h() / 2 / chart.camera.zoom;
    chart.camera.x = Math.min(Math.max(chart.camera.x, Math.min(hw, 768)), Math.max(1536 - hw, 768));
    chart.camera.y = Math.min(Math.max(chart.camera.y, Math.min(hh, 512)), Math.max(1024 - hh, 512)); }
  stepWalkers(walkers, dt, reduced || motionOff);
  if (canvas.clientWidth > 0) chart.draw(scene, walkers, selected);
  $("hint").textContent = chart.camera.zoom >= SETTLEMENT_ZOOM ? "scroll ut til kartet · klikk en person eller setet for å snakke" : "scroll for å gå ned · klikk et sted · dra for å panorere";
  requestAnimationFrame(frame);
}
applySettings();
renderDocket();
requestAnimationFrame(frame);

// test hook
(window as unknown as { __ecosym: unknown }).__ecosym = { scene, chart, select, flyTo, focus, unfocus };
