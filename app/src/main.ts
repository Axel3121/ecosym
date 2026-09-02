import { deriveScene } from "./scene.ts";
import type { Scene } from "./scene.ts";
import { fixture } from "./fixture.ts";
import { Chart, makeWalkers, stepWalkers, ZOOM_MIN, ZOOM_MAX, SETTLEMENT_ZOOM, coverZoom } from "./chart.ts";
import type { Hit } from "./chart.ts";
import { renderLog, renderSamtaler, renderInnstillinger, civByIndex, SECTIONS, PAGES, DEFAULT_SETTINGS } from "./desk.ts";
import type { DeskState, Decision, Section, Page, Settings, Thread, DeskMode } from "./desk.ts";
import { PLATES } from "./chart.ts";
import { plateKeyFor, seatFaceFor, agentFaceFor } from "./looks.ts";
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

// ---- the desk: a logbook you page through --------------------------------
const app = $("app");
const SETTINGS_KEY = "ecosym.settings";
function loadSettings(): Settings { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return { ...DEFAULT_SETTINGS }; } }
const desk: DeskState = { decisions: {}, selectedCiv: null, view: "log", section: "oversikt", lastPage: "samtaler", mode: "side", threads: {}, settings: loadSettings() };
function applySettings() {
  const s = desk.settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  document.documentElement.style.setProperty("--desk-w", `${s.deskWidth}px`);
  app.classList.toggle("wide-desk", s.deskWidth >= 400);
  const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  chart.showLabels = s.labels;
  motionOff = !s.smoke;
  requestAnimationFrame(() => chart.resize()); setTimeout(() => chart.resize(), 200);
}

function pageBody(page: Page): string {
  return page === "samtaler" ? renderSamtaler(scene, desk) : renderInnstillinger(scene, desk);
}
function wireBody(el: HTMLElement) {
  el.querySelectorAll<HTMLElement>("[data-set]").forEach((e) => e.addEventListener("click", (ev) => {
    ev.preventDefault();
    const key = e.dataset.set! as keyof Settings;
    (desk.settings as unknown as Record<string, unknown>)[key] = !(desk.settings as unknown as Record<string, unknown>)[key];
    applySettings(); renderDocket();
  }));
  el.querySelectorAll<HTMLElement>("[data-seg]").forEach((e) => e.addEventListener("click", (ev) => {
    ev.preventDefault();
    const k = e.dataset.seg!, v = e.dataset.val!;
    (desk.settings as unknown as Record<string, unknown>)[k] = k === "language" || k === "theme" ? v : Number(v);
    applySettings(); renderDocket();
  }));
  el.querySelectorAll<HTMLElement>("[data-resume]").forEach((e) => e.addEventListener("click", (ev) => { ev.preventDefault(); resumeThread(e.dataset.resume!); }));
}

function renderDocket() {
  // Table of contents: sticky, scrolls the one document to an anchor; never a page change.
  const toc = $("desk-toc");
  const openMatters = scene.capital.matters.filter((m) => !desk.decisions[m.id]).length;
  const nThreads = Object.keys(desk.threads).length;
  const secItem = (t: { id: Section; label: string; key: string }) =>
    `<a href="#" class="toc-item${desk.view === "log" && desk.section === t.id ? " on" : ""}" data-anchor="${t.id}" title="${t.key}"><span class="tlabel">${t.label}</span></a>`;
  const pageItem = (t: { id: Page; label: string; key: string }) =>
    `<a href="#" class="toc-item${desk.view === t.id ? " on" : ""}" data-page="${t.id}" title="${t.key}"><span class="tlabel">${t.label}</span></a>`;
  toc.innerHTML = SECTIONS.map(secItem).join("") + `<span class="toc-rule"></span>` + PAGES.map(pageItem).join("");

  // Collapsed spine: bare book back, letters only, one count for matters waiting.
  const spine = $("desk-spine");
  spine.innerHTML = `<button class="spine-open" data-spine-open title="Vis loggboken">›</button>`
    + scene.settlements.map((s, i) => `<a href="#" class="spine-key${desk.selectedCiv === s.civilizationId ? " sel" : ""}" data-civ="${s.civilizationId}">${i + 1}</a>`).join("")
    + `<a href="#" class="spine-key${desk.selectedCiv === "__capital" ? " sel" : ""}" data-civ="__capital">C</a>`
    + (openMatters ? `<span class="spine-count">${openMatters}</span>` : "");

  // Side/collapsed mode shows one page: the left slot carries whatever is active.
  // Full mode is the book open: left is always the log, right is the other page —
  // literal pages of a book, never panels that change size.
  const left = $("desk-left"), right = $("desk-right");
  const full = desk.mode === "full";
  const activeBody = desk.view === "log" ? renderLog(scene, desk) : pageBody(desk.view);
  left.innerHTML = full ? renderLog(scene, desk) : activeBody;
  right.innerHTML = full ? pageBody(desk.lastPage) : "";
  wireBody(left); if (full) wireBody(right);
  if (desk.view === "log") scrollToSection(desk.section, false);
}

/** Jump inside the one document — never a view change. Smooth unless `first`. */
function scrollToSection(id: Section, smooth = true) {
  desk.section = id;
  const target = $("desk-left").querySelector<HTMLElement>(`#sec-${id}`);
  if (target) target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
}

let lastOpenMode: DeskMode = "side";
function setMode(mode: DeskMode) {
  desk.mode = mode; if (mode !== "collapsed") lastOpenMode = mode;
  app.classList.toggle("collapsed", mode === "collapsed");
  app.classList.toggle("full", mode === "full");
  app.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
  renderDocket();
  if (mode !== "full") { requestAnimationFrame(() => chart.resize()); setTimeout(() => chart.resize(), 200); }
}
function goSection(id: Section) {
  desk.view = "log";
  if (desk.mode === "collapsed") setMode(lastOpenMode);
  renderDocket();
  scrollToSection(id);
}
function goPage(id: Page) {
  desk.view = id; desk.lastPage = id;
  if (desk.mode === "collapsed") setMode(lastOpenMode);
  renderDocket();
}
$("desk-toc").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-anchor],[data-page]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.anchor) goSection(t.dataset.anchor as Section);
  else if (t.dataset.page) goPage(t.dataset.page as Page);
});
$("desk-spine").addEventListener("click", (e) => {
  const el = e.target as HTMLElement;
  if (el.closest("[data-spine-open]")) { e.preventDefault(); setMode(lastOpenMode); return; }
  const t = el.closest<HTMLElement>("[data-civ]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.civ === "__capital") { select({ kind: "capital", label: "Capital" }); return; }
  const s = scene.settlements.find((x) => x.civilizationId === t.dataset.civ)!;
  select({ kind: "settlement", settlementId: s.civilizationId, label: s.name });
});
app.querySelectorAll<HTMLElement>("[data-mode]").forEach((b) => b.addEventListener("click", () => {
  const m = b.dataset.mode as DeskMode;
  setMode(desk.mode === m && m === "collapsed" ? lastOpenMode : m);
  b.closest("details")?.removeAttribute("open");
}));
app.querySelector<HTMLElement>("[data-open-settings]")?.addEventListener("click", (e) => {
  e.preventDefault();
  goPage("innstillinger");
  (e.currentTarget as HTMLElement).closest("details")?.removeAttribute("open");
});
function deskClick(e: Event) {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-decide],[data-undo],[data-civ],[data-go],[data-talk-civ],[data-talk-council]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.decide) { desk.decisions[t.dataset.id!] = { decision: t.dataset.decide as Decision, at: Date.now() }; renderDocket(); return; }
  if (t.dataset.undo) { delete desk.decisions[t.dataset.undo]; renderDocket(); return; }
  if (t.dataset.go) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.go)!; select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); return; }
  if (t.dataset.talkCiv) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.talkCiv)!; focus({ kind: "seat", settlement: s }); return; }
  if (t.dataset.talkCouncil) { focus({ kind: "council" }); return; }
  if (t.dataset.civ === "__capital") { select({ kind: "capital", label: "Capital" }); return; }
  if (t.dataset.civ) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.civ)!; desk.selectedCiv = s.civilizationId; renderDocket(); flyTo(s.ground.x, s.ground.y, Math.max(chart.camera.zoom, 1.2)); }
}
$("desk-left").addEventListener("click", deskClick);
$("desk-right").addEventListener("click", deskClick);
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.altKey && (e.key === "b" || e.key === "∫")) { setMode(desk.mode === "collapsed" ? lastOpenMode : "collapsed"); return; }
  if (e.altKey && (e.key === "f" || e.key === "ƒ")) { setMode(desk.mode === "full" ? "side" : "full"); return; }
  if (!e.altKey && !e.metaKey && !e.ctrlKey) {
    const sec = SECTIONS.find((s) => s.key.toLowerCase() === e.key.toLowerCase());
    if (sec) { goSection(sec.id); return; }
    const pg = PAGES.find((p) => p.key.toLowerCase() === e.key.toLowerCase());
    if (pg) { goPage(pg.id); return; }
    if (e.key.toLowerCase() === "i") { goPage("innstillinger"); return; }
  }
  // Digits select a civilization in declaration order; 0 is the tenth. No upper bound.
  const n = e.key === "0" ? 10 : Number(e.key);
  if (Number.isInteger(n) && n >= 1) { const s = civByIndex(scene, n); if (s) select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); }
  if (e.key === "c" || e.key === "C") select({ kind: "capital", label: "Capital" });
});

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
      // P0 (two blind reviewers hit it): choosing a place must never land you on a
      // page where the place has no actions. Facts and "snakk med" live in Oversikt.
      desk.view = "log"; desk.section = "oversikt";
      renderDocket();
      if (s.epistemic === "observed") flyTo(s.ground.x, s.ground.y - 30, Math.max(chart.camera.zoom, 2.4));
      else flyTo(s.ground.x, s.ground.y, Math.max(chart.camera.zoom, 1.2));
      return;
    case "capital":
      desk.selectedCiv = "__capital";
      desk.view = "log"; desk.section = "oversikt";
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
    portrait.className = "portrait face-big"; portrait.style.backgroundImage = `url(/art/faces/0.png)`; portrait.style.backgroundPosition = "50% 50%";
    $("focus-facts").innerHTML = `<b>Saker</b>${scene.capital.matters.map((m) => `${m.summary}<br>`).join("") || "ingen"}<b>Haller</b>${scene.capital.halls.map((h) => `${h.name} · ${h.epistemic === "observed" ? (h.live ? "i arbeid" : "stille") : "aldri sett"}<br>`).join("")}`;
    flyTo(770, 410, 2.2);
  } else {
    const s = t.settlement; const plate = PLATES[plateKeyFor(s.civilizationId)]!;
    const idx = scene.settlements.indexOf(s);
    if (t.kind === "seat") {
      $("focus-name").textContent = s.seatName; $("focus-kind").textContent = `setet i ${s.name} · ${s.domain}`;
      portrait.className = "portrait face-big"; portrait.style.backgroundImage = `url(/art/faces/${seatFaceFor(idx, s.epistemic === "observed")}.png)`; portrait.style.backgroundPosition = "50% 50%";
      $("focus-facts").innerHTML = `<b>Kan alene</b>${s.mandate.alone.join("<br>")}<b>Må til rådet</b>${s.mandate.council.join("<br>")}<b>Nå</b>${s.inhabitants.length} i arbeid · ${s.traces.length} spor · ${s.openMatters} hos rådet`;
    } else {
      const a = t.agent;
      $("focus-name").textContent = a.label; $("focus-kind").textContent = `forbipasserende arbeid i ${s.name}`;
      portrait.className = "portrait face-big"; portrait.style.backgroundImage = `url(/art/faces/${agentFaceFor(a.runId, a.tool)}.png)`; portrait.style.backgroundPosition = "50% 50%";
      $("focus-facts").innerHTML = `<b>Verktøy</b>${a.tool ?? "—"}<b>Under</b>${a.parentRunId ? s.inhabitants.find((p) => p.runId === a.parentRunId)?.label ?? a.parentRunId : "ingen (rot)"}<b>Har delegert</b>${s.inhabitants.filter((c) => c.parentRunId === a.runId).map((c) => c.label).join("<br>") || "ingenting"}`;
    }
    flyTo(s.ground.x, s.ground.y - 30, 2.4);
  }
  const th = threadFor(t); currentThreadId = th.id;
  if (th.lines.length) { push(th.lines, false); push([{ who: "note", text: "— fortsetter samtalen —" }], false); }
  else push(opening(scene, t));
  setTimeout(() => input.focus(), 50);
}
function unfocus() { current = null; currentThreadId = null; app.classList.remove("focused"); focusEl.hidden = true; if (desk.view === "samtaler") renderDocket(); }
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
