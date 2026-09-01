import { deriveScene } from "./scene.ts";
import type { Scene } from "./scene.ts";
import { fixture } from "./fixture.ts";
import { Chart, makeWalkers, stepWalkers, ZOOM_MIN, ZOOM_MAX, SETTLEMENT_ZOOM } from "./chart.ts";
import type { Hit } from "./chart.ts";
import { PLATES, PLATE_OF } from "./chart.ts";
import { opening, reply } from "./dialogue.ts";
import type { Target, Line } from "./dialogue.ts";

const scene: Scene = deriveScene(fixture);
const canvas = document.getElementById("chart") as HTMLCanvasElement;
const chart = new Chart(canvas);
const walkers = makeWalkers(scene);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
$("observed-at").textContent = new Date(scene.observedAt).toLocaleString("nb-NO", { dateStyle: "long", timeStyle: "short" });
if (scene.synthetic) $("synthetic").hidden = false;

// ---- docket -----------------------------------------------------------------
function renderDocket() {
  const d = $("docket");
  const items = scene.capital.matters
    .slice()
    .sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt))
    .map((m) => {
      const s = scene.settlements.find((x) => x.civilizationId === m.raisedBy);
      return `<li><span class="who">${s?.name ?? m.raisedBy}</span> — ${m.summary}<br><span class="when">${ago(m.raisedAt)}</span></li>`;
    })
    .join("");
  d.innerHTML = `<h2>Concilium</h2><ol>${items || '<li class="when">nothing before the council</li>'}</ol>`;
}
function ago(iso: string) {
  const m = Math.round((Date.parse(scene.observedAt) - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

// ---- camera -----------------------------------------------------------------
let target = { ...chart.camera };
let flying = false;

function flyTo(x: number, y: number, zoom: number) {
  target = { x, y, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom)) };
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
    const h = chart.hitTest(e.clientX, e.clientY);
    const hv = $("hover");
    canvas.classList.toggle("pointing", !!h);
    if (h) { hv.hidden = false; hv.style.left = `${e.clientX}px`; hv.style.top = `${e.clientY}px`; hv.innerHTML = `${h.label}${h.sub ? `<small>${h.sub}</small>` : ""}`; }
    else hv.hidden = true;
  }
});
canvas.addEventListener("pointerup", (e) => {
  dragging = false; canvas.classList.remove("dragging");
  if (moved > 6) return;
  const h = chart.hitTest(e.clientX, e.clientY);
  select(h);
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const before = chart.toWorld(e.clientX, e.clientY);
  const factor = Math.exp(-e.deltaY * 0.0014);
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, chart.camera.zoom * factor));
  chart.camera.zoom = zoom;
  const after = chart.toWorld(e.clientX, e.clientY);
  // keep the point under the pointer fixed
  chart.camera.x += before.x - after.x; chart.camera.y += before.y - after.y;
  target = { ...chart.camera }; flying = false;
}, { passive: false });
window.addEventListener("resize", () => chart.resize());
window.addEventListener("keydown", (e) => { if (e.key === "Escape") select(null); });

// ---- selection & sheet -----------------------------------------------------
let selected: Hit | null = null;

function select(h: Hit | null) {
  selected = h;
  const sheet = $("sheet");
  if (!h) { sheet.hidden = true; return; }
  const s = h.settlementId ? scene.settlements.find((x) => x.civilizationId === h.settlementId) : undefined;
  if (h.kind === "settlement" && s) {
    if (s.epistemic === "observed") flyTo(s.ground.x, s.ground.y - 40, Math.max(chart.camera.zoom, 2.4));
    else flyTo(s.ground.x, s.ground.y, Math.max(chart.camera.zoom, 1.2));
  }
  if (h.kind === "capital") flyTo(760, 470, Math.max(chart.camera.zoom, 2.2));
  sheet.hidden = false;
  sheet.innerHTML = sheetFor(h);
  sheet.querySelector<HTMLButtonElement>(".close")?.addEventListener("click", () => select(null));
  sheet.querySelectorAll<HTMLElement>("[data-go]").forEach((el) => el.addEventListener("click", () => {
    const t = scene.settlements.find((x) => x.civilizationId === el.dataset.go)!;
    select({ kind: "settlement", settlementId: t.civilizationId, label: t.name });
  }));
  sheet.querySelectorAll<HTMLElement>("[data-talk]").forEach((el) => el.addEventListener("click", () => {
    const kind = el.dataset.talk;
    if (kind === "council") return focus({ kind: "council" });
    if (!s) return;
    if (kind === "seat") return focus({ kind: "seat", settlement: s });
    const agent = s.inhabitants.find((i) => i.runId === el.dataset.run);
    if (agent) focus({ kind: "agent", settlement: s, agent });
  }));
}

function sheetFor(h: Hit): string {
  const close = `<button class="close" aria-label="close">✕</button>`;
  const syn = scene.synthetic ? `<p class="synthetic-note">synthetic — nothing on this sheet was observed</p>` : "";
  const s = h.settlementId ? scene.settlements.find((x) => x.civilizationId === h.settlementId) : undefined;
  switch (h.kind) {
    case "capital": {
      const halls = scene.capital.halls.map((x) => `<li data-go="${x.civilizationId}"><span>${x.name} <span class="seatname">${x.seatName}</span></span><span>${x.epistemic === "observed" ? `${x.live ? "at work" : "quiet"} · <span class="seal">${x.openMatters}</span>` : `<span class="bare">non observatum</span>`}</span></li>`).join("");
      return `${close}<p class="kind">the world's headquarters</p><h2>Capital</h2><h3>Halls</h3><ul class="halls">${halls}</ul><h3>Before the council</h3><ul>${scene.capital.matters.map((m) => `<li>${m.summary} <span class="muted">${ago(m.raisedAt)}</span></li>`).join("")}</ul><p class="muted">Detail lives where the work lives. Click a hall to go there.</p><button class="talk" data-talk="council">Gå inn i rådskammeret</button>${syn}`;
    }
    case "settlement": {
      if (!s) return close;
      if (s.epistemic !== "observed") return `${close}<p class="kind">civilization</p><h2>${s.name}</h2><p class="muted">non observatum. Ecosym has never seen this place; nothing is drawn because nothing is known.</p>${syn}`;
      return `${close}<p class="kind">civilization · ${s.domain}</p><h2>${s.name}</h2><p>last seen <span class="muted">${ago(s.lastSeen!)}</span> · ${s.inhabitants.length} at work · ${s.traces.length} recent traces</p><h3>Seat</h3><p class="muted">${s.seatName}</p><button class="talk" data-talk="seat">Snakk med ${s.seatName}</button><h3>Working now</h3><ul>${s.inhabitants.map((i) => `<li>${"— ".repeat(i.depth)}${i.label}${i.tool ? ` <span class="muted">(${i.tool})</span>` : ""}</li>`).join("") || '<li class="muted">nobody</li>'}</ul>${syn}`;
    }
    case "seat": {
      if (!s) return close;
      const matters = scene.capital.matters.filter((m) => m.raisedBy === s.civilizationId);
      const letters = scene.letters.filter((l) => l.toCivilizationId === s.civilizationId);
      return `${close}<p class="kind">seat of ${s.name}</p><h2>${s.seatName}</h2><h3>May do alone</h3><ul>${s.mandate.alone.map((m) => `<li>${m}</li>`).join("")}</ul><h3>Must go to the council</h3><ul>${s.mandate.council.map((m) => `<li>${m}</li>`).join("")}</ul><h3>Raised at the council</h3><ul>${matters.map((m) => `<li><span class="seal">●</span> ${m.summary}</li>`).join("") || '<li class="muted">nothing open</li>'}</ul><h3>Petitions to this seat</h3><ul>${letters.map((l) => `<li>${l.text} <span class="muted">— ${l.state}</span></li>`).join("") || '<li class="muted">none</li>'}</ul><button class="talk" data-talk="seat">Snakk med ${s.seatName}</button>${syn}`;
    }
    case "inhabitant": {
      if (!s) return close;
      const inh = s.inhabitants.find((i) => i.runId === h.runId);
      const tr = s.traces.find((t) => t.runId === h.runId);
      if (inh) {
        const children = s.inhabitants.filter((c) => c.parentRunId === inh.runId);
        return `${close}<p class="kind">transient inhabitant · running now</p><h2>${inh.label}</h2><ul><li>tool: ${inh.tool ?? "—"}</li><li>depth: ${inh.depth}${inh.parentRunId ? ` (under ${s.inhabitants.find((p) => p.runId === inh.parentRunId)?.label ?? inh.parentRunId})` : ""}</li></ul>${children.length ? `<h3>Delegated</h3><ul>${children.map((c) => `<li>${c.label}</li>`).join("")}</ul>` : ""}<p class="muted">Leaves when the work leaves. No standing office.</p><button class="talk" data-talk="agent" data-run="${inh.runId}">Snakk med den</button>${syn}`;
      }
      return `${close}<p class="kind">trace</p><h2>${h.label}</h2><p class="muted">Finished work. Fades over the retention window${tr ? ` (${Math.round(tr.freshness * 100)}% left)` : ""}.</p>${syn}`;
    }
    case "letter": {
      const l = scene.letters.find((x) => x.petitionId === h.petitionId)!;
      return `${close}<p class="kind">petition · ${l.state}</p><h2>${l.text}</h2><p>sent ${ago(l.sentAt)} to ${s?.seatName ?? l.toCivilizationId}</p><p class="muted">A thing that was asked. It is never depicted as a thing that happened.</p>${syn}`;
    }
  }
}

// ---- focus mode: leave the world, talk ---------------------------------------
let current: Target | null = null;
const app = $("app"), focusEl = $("focus"), thread = $("focus-thread");
const input = $<HTMLInputElement>("focus-input");

function push(lines: Line[]) {
  for (const l of lines) {
    const d = document.createElement("div");
    d.className = `msg ${l.who}`; d.textContent = l.text; thread.appendChild(d);
  }
  thread.scrollTop = thread.scrollHeight;
}

function focus(t: Target) {
  current = t;
  select(null);
  app.classList.add("focused"); focusEl.hidden = false; thread.innerHTML = "";
  const portrait = $("focus-portrait"); portrait.className = "portrait";
  if (t.kind === "council") {
    $("focus-name").textContent = "Rådet"; $("focus-kind").textContent = "Capital · verdens hovedkvarter";
    portrait.style.backgroundImage = `url(/art/capital.png)`; portrait.style.backgroundPosition = "50% 30%";
    $("focus-facts").innerHTML = `<b>Saker</b>${scene.capital.matters.map((m) => `${m.summary}<br>`).join("") || "ingen"}<b>Haller</b>${scene.capital.halls.map((h) => `${h.name} · ${h.epistemic === "observed" ? (h.live ? "i arbeid" : "stille") : "aldri sett"}<br>`).join("")}`;
    flyTo(760, 470, 2.4);
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
    flyTo(s.ground.x, s.ground.y - 40, 2.6);
  }
  push(opening(scene, t));
  setTimeout(() => input.focus(), 50);
}
function unfocus() { current = null; app.classList.remove("focused"); focusEl.hidden = true; }
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
  stepWalkers(walkers, dt, reduced);
  chart.draw(scene, walkers, selected);
  $("hint").textContent = chart.camera.zoom >= SETTLEMENT_ZOOM ? "scroll out to the chart · click a person or the seat · Esc closes" : "scroll to descend · click a place · drag to pan";
  requestAnimationFrame(frame);
}
renderDocket();
requestAnimationFrame(frame);

// test hook
(window as unknown as { __ecosym: unknown }).__ecosym = { scene, chart, select, flyTo, focus, unfocus };
