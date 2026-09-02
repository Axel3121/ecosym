import { deriveScene } from "./scene.ts";
import type { Scene } from "./scene.ts";
import { fixture } from "./fixture.ts";
import { Chart, makeWalkers, stepWalkers, ZOOM_MIN, ZOOM_MAX, fitZoom, WORLD_W, WORLD_H } from "./chart.ts";
import { quarterOf, HALL } from "./town.ts";
import type { Hit } from "./chart.ts";
import { renderSheet, renderStrip, renderSamtaler, renderInnstillinger, civByIndex, DEFAULT_SETTINGS } from "./desk.ts";
import type { DeskState, Decision, Settings, Thread } from "./desk.ts";
import type { Sheet } from "./desk.ts";
import { parse, suggest } from "./command.ts";
import { seatFaceFor, agentFaceFor } from "./looks.ts";
import { opening, reply } from "./dialogue.ts";
import type { Target, Line } from "./dialogue.ts";

const scene: Scene = deriveScene(fixture);
const canvas = document.getElementById("chart") as HTMLCanvasElement;
const chart = new Chart(canvas);
const STRIP_H = 84;
function minZoom() { return Math.max(ZOOM_MIN, fitZoom(canvas.clientWidth, canvas.clientHeight - STRIP_H) * 0.96); }
const walkers = makeWalkers(scene);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
let motionOff = false;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- the shell: map navigates; a strip says the world; a sheet comes and goes ----
const app = $("app");
const SETTINGS_KEY = "ecosym.settings";
function loadSettings(): Settings { try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") }; } catch { return { ...DEFAULT_SETTINGS }; } }
const desk: DeskState = { decisions: {}, selectedCiv: null, view: "log", section: "oversikt", lastPage: "samtaler", mode: "side", threads: {}, settings: loadSettings() };
type Open = Sheet | "samtaler" | "innstillinger";
let openSheet: Open | null = null;

function applySettings() {
  const s = desk.settings;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  document.documentElement.style.setProperty("--sheet-w", `${s.deskWidth}px`);
  const dark = s.theme === "dark" || (s.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  chart.showLabels = s.labels;
  motionOff = !s.smoke;
  requestAnimationFrame(() => chart.resize());
}

const SHEET_TITLES: Record<Open, string> = { place: "", raadet: "Rådet", arbeid: "Arbeid", petisjoner: "Petisjoner", observert: "Observert", samtaler: "Samtaler", innstillinger: "Innstillinger" };

function renderDocket() {
  $("strip-text").innerHTML = renderStrip(scene, desk);
  $("strip-text").querySelectorAll<HTMLElement>("[data-sheet]").forEach((a) => a.classList.toggle("on", a.dataset.sheet === openSheet));
  const sheet = $("sheet");
  if (!openSheet) { sheet.hidden = true; return; }
  sheet.hidden = false;
  const civ = scene.settlements.find((x) => x.civilizationId === desk.selectedCiv);
  $("sheet-title").textContent = openSheet === "place" ? (desk.selectedCiv === "__capital" ? "Capital" : civ?.name ?? "") : SHEET_TITLES[openSheet];
  const body = $("sheet-body");
  body.innerHTML = openSheet === "samtaler" ? renderSamtaler(scene, desk)
    : openSheet === "innstillinger" ? renderInnstillinger(scene, desk)
    : renderSheet(scene, desk, openSheet);
  wireBody(body);
}
function show(sheet: Open | null) { openSheet = sheet; renderDocket(); }
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
function deskClick(e: Event) {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-decide],[data-undo],[data-civ],[data-go],[data-talk-civ],[data-talk-council]");
  if (!t) return;
  e.preventDefault();
  if (t.dataset.decide) { desk.decisions[t.dataset.id!] = { decision: t.dataset.decide as Decision, at: Date.now() }; renderDocket(); return; }
  if (t.dataset.undo) { delete desk.decisions[t.dataset.undo]; renderDocket(); return; }
  const civId = t.dataset.go ?? t.dataset.civ;
  if (civId === "__capital") { select({ kind: "capital", label: "Capital" }); return; }
  if (civId) { const s = scene.settlements.find((x) => x.civilizationId === civId)!; select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); return; }
  if (t.dataset.talkCiv) { const s = scene.settlements.find((x) => x.civilizationId === t.dataset.talkCiv)!; focus({ kind: "seat", settlement: s }); return; }
  if (t.dataset.talkCouncil) { focus({ kind: "council" }); return; }
}
$("sheet-body").addEventListener("click", deskClick);
$("sheet-close").addEventListener("click", () => { desk.selectedCiv = null; show(null); });
$("strip").addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-sheet]");
  if (!t) return;
  e.preventDefault();
  const s = t.dataset.sheet as Open;
  show(openSheet === s ? null : s);
  t.closest("details")?.removeAttribute("open");
});

// ---- the command line ----------------------------------------------------------
const cmdInput = $<HTMLInputElement>("cmd-input"), cmdList = $("cmd-suggest");
let sugIndex = -1;
function renderSuggest() {
  const items = suggest(scene, desk, cmdInput.value);
  sugIndex = Math.min(sugIndex, items.length - 1);
  cmdList.hidden = document.activeElement !== cmdInput || items.length === 0;
  cmdList.innerHTML = items.map((s, i) => `<li data-text="${s.text}" class="${i === sugIndex ? "on" : ""}"><span>${s.text}</span><span class="hint">${s.hint}</span></li>`).join("");
}
function runCommand(raw: string) {
  const c = parse(scene, desk, raw);
  switch (c.kind) {
    case "decide": desk.decisions[c.matterId] = { decision: c.decision, at: Date.now() }; if (!openSheet) show("raadet"); else renderDocket(); break;
    case "go": if (c.civ === "__capital") select({ kind: "capital", label: "Capital" }); else { const s = scene.settlements.find((x) => x.civilizationId === c.civ)!; select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); } break;
    case "sheet": show(c.sheet); break;
    case "talk":
      if (c.target === "council") focus({ kind: "council" });
      else { const tgt = c.target; const s = scene.settlements.find((x) => x.civilizationId === tgt.civ)!; const rid = "runId" in tgt ? tgt.runId : undefined; const a = rid ? s.inhabitants.find((i) => i.runId === rid) : undefined; focus(a ? { kind: "agent", settlement: s, agent: a } : { kind: "seat", settlement: s }); }
      break;
    case "help": show("innstillinger"); break;
    case "unknown": if (c.text) { cmdInput.value = ""; cmdInput.placeholder = c.text; setTimeout(() => { cmdInput.placeholder = "/ for å skrive: ja · nei · spør · snakk curia · roma"; }, 2200); return; } break;
  }
  cmdInput.value = ""; cmdInput.blur(); cmdList.hidden = true;
}
$("cmd").addEventListener("submit", (e) => { e.preventDefault(); const pick = cmdList.querySelector<HTMLElement>("li.on"); runCommand(pick && !cmdList.hidden ? pick.dataset.text! : cmdInput.value); });
cmdInput.addEventListener("input", () => { sugIndex = 0; renderSuggest(); });
cmdInput.addEventListener("focus", () => { sugIndex = 0; renderSuggest(); });
cmdInput.addEventListener("blur", () => setTimeout(() => { cmdList.hidden = true; }, 120));
cmdInput.addEventListener("keydown", (e) => {
  const n = cmdList.children.length;
  if (e.key === "ArrowUp") { e.preventDefault(); sugIndex = (sugIndex - 1 + n) % n; renderSuggest(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); sugIndex = (sugIndex + 1) % n; renderSuggest(); }
  else if (e.key === "Escape") { cmdInput.value = ""; cmdInput.blur(); }
  e.stopPropagation();
});
cmdList.addEventListener("mousedown", (e) => { const li = (e.target as HTMLElement).closest<HTMLElement>("li"); if (li) { e.preventDefault(); runCommand(li.dataset.text!); } });

// keyboard: digits pick a civilization in order, C the Capital, / the command line, Esc closes
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  if (e.altKey || e.metaKey || e.ctrlKey) return;
  if (e.key === "/") { e.preventDefault(); cmdInput.focus(); return; }
  const n = e.key === "0" ? 10 : Number(e.key);
  if (Number.isInteger(n) && n >= 1) { const s = civByIndex(scene, n); if (s) select({ kind: "settlement", settlementId: s.civilizationId, label: s.name }); }
  if (e.key === "c" || e.key === "C") select({ kind: "capital", label: "Capital" });
});

// ---- camera -----------------------------------------------------------------
let target = { ...chart.camera };
let flying = false;

function flyTo(x: number, y: number, zoom: number) {
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
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && !current && (e.target as HTMLElement).tagName !== "INPUT") { desk.selectedCiv = null; show(null); } });

// ---- selection & sheet -----------------------------------------------------
let selected: Hit | null = null;

function select(h: Hit | null) {
  // The map is the navigation. A place opens its sheet; a person or seat opens a conversation.
  selected = h;
  if (!h) return;
  const s = h.settlementId ? scene.settlements.find((x) => x.civilizationId === h.settlementId) : undefined;
  switch (h.kind) {
    case "settlement":
      if (!s) return;
      desk.selectedCiv = s.civilizationId; show("place");
      { const q = quarterOf(scene, s); const cx = (q.box.x1 + q.box.x2) / 2, cy = (q.box.y1 + q.box.y2) / 2;
        flyTo(cx, cy, Math.max(chart.camera.zoom, s.epistemic === "observed" ? 2.0 : 1.2)); }
      return;
    case "capital":
      desk.selectedCiv = "__capital"; show("place");
      flyTo(770, 410, Math.max(chart.camera.zoom, 1.7));
      return;
    case "seat":
      if (s) focus({ kind: "seat", settlement: s });
      return;
    case "inhabitant": {
      if (!s) return;
      const agent = s.inhabitants.find((i) => i.runId === h.runId);
      if (agent) focus({ kind: "agent", settlement: s, agent });
      else { desk.selectedCiv = s.civilizationId; show("place"); }
      return;
    }
    case "letter":
      show("petisjoner");
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
  renderDocket(); // the strip may now say "1 venter på svar"
}

function focus(t: Target) {
  current = t;
  select(null);
  app.classList.add("focused"); focusEl.hidden = false; thread.innerHTML = "";
  const portrait = $("focus-portrait"); portrait.className = "portrait";
  if (t.kind === "council") {
    $("focus-name").textContent = "Rådet"; $("focus-kind").textContent = "Capital · verdens hovedkvarter";
    portrait.className = "portrait face-big"; portrait.style.backgroundImage = `url(/art/faces/0.png)`; portrait.style.backgroundPosition = "50% 50%";
    $("focus-facts").innerHTML = `<b>Saker</b>${scene.capital.matters.map((m) => `${m.summary}<br>`).join("") || "ingen"}<b>Haller</b>${scene.capital.halls.map((h) => `${h.name} · ${h.epistemic === "observed" ? (h.live ? "i arbeid" : "stille") : "aldri sett"}<br>`).join("")}`;
    flyTo((HALL.box.x1 + HALL.box.x2) / 2, HALL.box.y2 - 40, 2.2);
  } else {
    const s = t.settlement;
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
    { const q = quarterOf(scene, s); flyTo(q.seat.x, q.seat.y + 20, 2.4); }
  }
  const th = threadFor(t); currentThreadId = th.id;
  if (th.lines.length) { push(th.lines, false); push([{ who: "note", text: "— fortsetter samtalen —" }], false); }
  else push(opening(scene, t));
  setTimeout(() => input.focus(), 50);
}
function unfocus() { current = null; currentThreadId = null; app.classList.remove("focused"); focusEl.hidden = true; renderDocket(); }
$("focus-back").addEventListener("click", unfocus);
$("focus-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim(); if (!text || !current) return;
  input.value = "";
  push([{ who: "you", text }]);
  const t = current;
  thread.dataset.waiting = t.kind === "council" ? "Rådet" : t.kind === "seat" ? t.settlement.seatName : t.agent.label;
  setTimeout(() => { if (current === t) { delete thread.dataset.waiting; push(reply(scene, t, text)); } }, 350);
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
  // the town has an edge: keep the camera on it. When the whole town fits, centre it in the
  // space above the strip instead of letting the strip cover the south quarter.
  { const z = chart.camera.zoom; const hw = chart_w() / 2 / z, hh = chart_h() / 2 / z;
    const cx = WORLD_W / 2, cy = WORLD_H / 2 + (STRIP_H / 2) / z;
    chart.camera.x = Math.min(Math.max(chart.camera.x, Math.min(hw, cx)), Math.max(WORLD_W - hw, cx));
    chart.camera.y = Math.min(Math.max(chart.camera.y, Math.min(hh, cy)), Math.max(WORLD_H - hh + STRIP_H / z, cy)); }
  stepWalkers(walkers, dt, reduced || motionOff);
  if (canvas.clientWidth > 0) chart.draw(scene, walkers, selected);
  // no hint bar: the strip's placeholder carries the one line of help
  requestAnimationFrame(frame);
}
applySettings();
renderDocket();
requestAnimationFrame(() => { chart.resize(); chart.camera = { x: WORLD_W / 2, y: WORLD_H / 2, zoom: minZoom() }; target = { ...chart.camera }; });
requestAnimationFrame(frame);

// test hook
(window as unknown as { __ecosym: unknown }).__ecosym = { scene, chart, select, flyTo, focus, unfocus, show, runCommand, desk };
