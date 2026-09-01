// Chart renderer. Reads a Scene, draws vellum + ink on a canvas with one
// continuous camera. Settlement and inhabitant detail is crossed by zoom.
import type { Scene, Settlement, Inhabitant } from "./scene.ts";
import { hash01 } from "./scene.ts";

export interface Camera { x: number; y: number; zoom: number }

export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 9;
export const SETTLEMENT_ZOOM = 1.6; // >= this: settlement detail
const SPRITE_PX = 38; // fixed logical size for a person once settlement level is reached

export interface Hit {
  kind: "settlement" | "seat" | "inhabitant" | "capital" | "letter";
  settlementId?: string;
  runId?: string;
  petitionId?: string;
  label: string;
  sub?: string;
}

const INK = "#3b2a1a";
const INK_FAINT = "#8a7452";
const SEAL = "#9c3524";
const TIDE = "#7f8c86";
const WASH_LIVE = "#b89a4a";
const VELLUM = "#d9c49a";
const VELLUM_EDGE = "#c7ad7c";

// ---- coastline: deterministic wobble around each settlement --------------

function coastPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, seed: string) {
  const n = 36;
  const lobes = 2 + Math.floor(hash01(seed + "lobes") * 4); // 2..5
  const amp = 0.12 + hash01(seed + "amp") * 0.16;
  const jag = 0.18 + hash01(seed + "jag") * 0.22;
  const phase = hash01(seed) * Math.PI * 2;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ii = i % n;
    const w = 1 + (hash01(seed + ii) - 0.5) * jag + Math.sin(a * lobes + phase) * amp + Math.sin(a * (lobes * 2 + 1) + phase * 2) * amp * 0.3;
    const x = cx + Math.cos(a) * r * w;
    const y = cy + Math.sin(a) * r * w * 0.82;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// ---- persons ----------------------------------------------------------------

export interface Walker {
  runId: string;
  settlementId: string;
  /** Path endpoints in settlement units. */
  from: { x: number; y: number };
  to: { x: number; y: number };
  t: number; // 0..1 along path
  dir: 1 | -1;
  speed: number;
  depth: number;
  label: string;
}

export function makeWalkers(scene: Scene): Walker[] {
  const out: Walker[] = [];
  for (const s of scene.settlements) {
    if (s.epistemic !== "observed") continue;
    const seat = s.buildings.find((b) => b.kind === "seat")!;
    for (const inh of s.inhabitants) {
      const home = s.buildings.find((b) => b.id === inh.buildingId) ?? seat;
      // root walks seat<->workshop; children walk short loops beside the workshop
      // children each get their own short errand around the workshop
      const sibs = s.inhabitants.filter((c) => c.parentRunId === inh.parentRunId && c.depth === inh.depth);
      const idx = sibs.findIndex((c) => c.runId === inh.runId);
      const ang = (idx / Math.max(sibs.length, 1)) * Math.PI * 2 + hash01(inh.runId + "a") * 0.8;
      const from = inh.depth === 0
        ? seat.at
        : { x: home.at.x + Math.cos(ang) * 0.16, y: home.at.y + 0.06 + Math.abs(Math.sin(ang)) * 0.14 };
      const to = inh.depth === 0
        ? { x: home.at.x, y: home.at.y + 0.08 }
        : { x: home.at.x + Math.cos(ang + 2.4) * 0.14, y: home.at.y + 0.1 + Math.abs(Math.sin(ang + 2.4)) * 0.1 };
      out.push({
        runId: inh.runId,
        settlementId: s.civilizationId,
        from,
        to,
        t: hash01(inh.runId),
        dir: hash01(inh.runId + "dir") > 0.5 ? 1 : -1,
        speed: 0.05 + hash01(inh.runId + "v") * 0.04,
        depth: inh.depth,
        label: inh.label,
      });
    }
  }
  return out;
}

export function stepWalkers(walkers: Walker[], dtMs: number, reduced: boolean) {
  if (reduced) return;
  for (const w of walkers) {
    w.t += (w.dir * w.speed * dtMs) / 1000;
    if (w.t > 1) { w.t = 1; w.dir = -1; }
    if (w.t < 0) { w.t = 0; w.dir = 1; }
  }
}

// ---- drawing ------------------------------------------------------------------

export class Chart {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private hits: Array<Hit & { x: number; y: number; r: number }> = [];

  constructor(private canvas: HTMLCanvasElement, public camera: Camera = { x: 0, y: 40, zoom: 0.9 }) {
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth;
    this.h = this.canvas.clientHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
  }

  toScreen(wx: number, wy: number) {
    return {
      x: this.w / 2 + (wx - this.camera.x) * this.camera.zoom,
      y: this.h / 2 + (wy - this.camera.y) * this.camera.zoom,
    };
  }
  toWorld(sx: number, sy: number) {
    return {
      x: (sx - this.w / 2) / this.camera.zoom + this.camera.x,
      y: (sy - this.h / 2) / this.camera.zoom + this.camera.y,
    };
  }

  hitTest(sx: number, sy: number): Hit | null {
    // last drawn wins (drawn on top)
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      const dx = sx - h.x, dy = sy - h.y;
      if (dx * dx + dy * dy <= h.r * h.r) return h;
    }
    return null;
  }

  draw(scene: Scene, walkers: Walker[], selected: Hit | null) {
    const { ctx } = this;
    const z = this.camera.zoom;
    this.hits = [];
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // vellum with raking light
    const g = ctx.createRadialGradient(this.w * 0.3, this.h * 0.2, 40, this.w * 0.5, this.h * 0.55, Math.max(this.w, this.h) * 0.9);
    g.addColorStop(0, VELLUM);
    g.addColorStop(1, VELLUM_EDGE);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    this.grain();

    // sea: rhumb lines from the Capital, and wave ticks scattered in world space
    if (z < SETTLEMENT_ZOOM * 1.4) {
      const c0 = this.toScreen(scene.capital.ground.x, scene.capital.ground.y);
      ctx.save();
      ctx.strokeStyle = INK_FAINT;
      ctx.globalAlpha = 0.22 * Math.min(1, 1.6 / z);
      ctx.lineWidth = 0.8;
      const L = Math.hypot(this.w, this.h) * 1.2;
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c0.x + Math.cos(a) * L, c0.y + Math.sin(a) * L); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = TIDE;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    const cell = 46;
    for (let gx = Math.floor(tl.x / cell); gx <= Math.ceil(br.x / cell); gx++) {
      for (let gy = Math.floor(tl.y / cell); gy <= Math.ceil(br.y / cell); gy++) {
        const k = `${gx},${gy}`;
        if (hash01("w" + k) > 0.42) continue;
        // never inside a coast
        const wx = gx * cell + hash01("wx" + k) * cell, wy = gy * cell + hash01("wy" + k) * cell;
        if (scene.settlements.some((s) => Math.hypot(wx - s.ground.x, (wy - s.ground.y) / 0.82) < s.radius * 1.25)) continue;
        if (Math.hypot(wx, wy) < 110) continue;
        const p = this.toScreen(wx, wy);
        const len = 7 * Math.min(z, 2);
        ctx.beginPath();
        ctx.moveTo(p.x - len, p.y); ctx.quadraticCurveTo(p.x - len / 2, p.y - len * 0.5, p.x, p.y); ctx.quadraticCurveTo(p.x + len / 2, p.y + len * 0.5, p.x + len, p.y);
        ctx.stroke();
      }
    }
    ctx.restore();

    // routes (ink only where a border was crossed)
    for (const r of scene.routes) {
      const a = this.toScreen(r.from.x, r.from.y);
      const b = this.toScreen(r.to.x, r.to.y);
      ctx.save();
      ctx.strokeStyle = r.reason === "petition" ? SEAL : INK_FAINT;
      ctx.globalAlpha = r.reason === "petition" ? 0.55 : 0.5;
      ctx.lineWidth = Math.max(1, 1.2 * Math.min(z, 2));
      ctx.setLineDash([6 * Math.min(z, 2), 5 * Math.min(z, 2)]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }

    // settlements
    for (const s of scene.settlements) this.drawSettlement(s, walkers.filter((w) => w.settlementId === s.civilizationId), selected);

    // capital
    this.drawCapital(scene, selected);

    // letters on their routes
    for (const l of scene.letters) {
      const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId);
      if (!s) continue;
      const a = this.toScreen(scene.capital.ground.x, scene.capital.ground.y);
      const b = this.toScreen(s.ground.x, s.ground.y);
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
      const t = l.progress;
      const x = (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x;
      const y = (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y;
      const sz = 9 * Math.min(Math.max(z, 0.8), 2);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(b.y - a.y, b.x - a.x));
      ctx.fillStyle = "#efe2c2";
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.fillRect(-sz, -sz * 0.65, sz * 2, sz * 1.3);
      ctx.strokeRect(-sz, -sz * 0.65, sz * 2, sz * 1.3);
      ctx.beginPath(); ctx.moveTo(-sz, -sz * 0.65); ctx.lineTo(0, 0.1 * sz); ctx.lineTo(sz, -sz * 0.65); ctx.stroke();
      ctx.fillStyle = SEAL;
      ctx.beginPath(); ctx.arc(0, sz * 0.25, sz * 0.28, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      this.hits.push({ kind: "letter", petitionId: l.petitionId, settlementId: s.civilizationId, label: `petition · ${l.state}`, sub: l.text, x, y, r: sz * 1.4 });
    }

    // plate mark
    ctx.save();
    ctx.strokeStyle = INK_FAINT;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.strokeRect(14.5, 14.5, this.w - 29, this.h - 29);
    ctx.restore();
  }

  private grain() {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = INK;
    // sparse deterministic speckle in screen space (cheap, stable)
    for (let i = 0; i < 900; i++) {
      const x = hash01("gx" + i) * this.w, y = hash01("gy" + i) * this.h;
      ctx.fillRect(x, y, 1, 1);
    }
    ctx.restore();
  }

  private drawSettlement(s: Settlement, walkers: Walker[], selected: Hit | null) {
    const { ctx } = this;
    const z = this.camera.zoom;
    const c = this.toScreen(s.ground.x, s.ground.y);
    const R = s.radius * z;
    const isSel = selected?.settlementId === s.civilizationId && selected.kind === "settlement";
    const seed = s.civilizationId;

    // coast + a second, offset shoreline for the engraved look
    ctx.save();
    coastPath(ctx, c.x, c.y, R, seed);
    if (s.epistemic === "observed") {
      ctx.fillStyle = s.live ? WASH_LIVE : "#cfb987";
      ctx.globalAlpha = s.live ? 0.42 : 0.3;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = isSel ? 2.4 : 1.6;
    ctx.setLineDash(s.epistemic === "observed" ? [] : [3, 4]);
    // at settlement level the wall is the line; the coast is only ground
    if (z < SETTLEMENT_ZOOM || s.epistemic !== "observed") ctx.stroke();
    ctx.restore();
    if (s.epistemic === "observed" && z < SETTLEMENT_ZOOM) {
      ctx.save();
      ctx.strokeStyle = TIDE;
      ctx.lineWidth = 1;
      for (let k = 1; k <= 3; k++) {
        ctx.globalAlpha = 0.4 - k * 0.1;
        coastPath(ctx, c.x, c.y, R * (1 + k * 0.045), seed);
        ctx.stroke();
      }
      ctx.restore();
    }

    this.hits.push({ kind: "settlement", settlementId: s.civilizationId, label: s.name, sub: s.epistemic === "observed" ? s.domain : "non observatum", x: c.x, y: c.y, r: R });

    if (s.epistemic !== "observed") {
      ctx.save();
      ctx.fillStyle = INK_FAINT;
      ctx.font = `italic ${Math.max(12, 14 * Math.min(z, 1.6))}px "IM Fell English", serif`;
      ctx.textAlign = "center";
      ctx.fillText("non observatum", c.x, c.y + 4);
      ctx.fillText(s.name, c.x, c.y - R - 8);
      ctx.restore();
      return;
    }

    // settlement-local coordinates: (0..1)^2 mapped into the coast
    const local = (p: { x: number; y: number }) => ({ x: c.x + (p.x - 0.5) * R * 1.5, y: c.y + (p.y - 0.5) * R * 1.25 });
    const seat = s.buildings.find((b) => b.kind === "seat")!;
    const sp = local(seat.at);
    const workshops = s.buildings.filter((b) => b.kind === "workshop");

    if (z < SETTLEMENT_ZOOM) {
      // CHART LEVEL: an engraved skyline. Seat as the tall silhouette,
      // one roof per workshop, a few filler roofs derived from volume.
      const n = workshops.length + s.traces.length;
      const filler = Math.min(9, 2 + n + Math.floor(hash01(seed + "sky") * 3));
      const roofs: Array<{ x: number; y: number; h: number; occ: boolean }> = [];
      for (let i = 0; i < filler; i++) {
        const a = hash01(seed + "f" + i) * Math.PI * 2, d = 0.18 + hash01(seed + "fd" + i) * 0.5;
        roofs.push({ x: 0.5 + Math.cos(a) * d * 0.5, y: 0.55 + Math.sin(a) * d * 0.4, h: 0.07 + hash01(seed + "fh" + i) * (0.06 + hash01(seed + "tall") * 0.12), occ: false });
      }
      for (const b of workshops) roofs.push({ x: b.at.x, y: b.at.y, h: 0.12 + b.size, occ: s.inhabitants.some((i) => i.buildingId === b.id) });
      roofs.sort((p, q) => p.y - q.y);
      for (const r of roofs) { const p = local(r); this.roof(p.x, p.y, R * r.h * 1.6, r.occ); }
      this.spire(sp.x, sp.y + R * 0.05, R * 0.42);
      // orchards / fields outside the walls: short hatch groups
      ctx.save();
      ctx.strokeStyle = INK_FAINT; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.8;
      for (let i = 0; i < 5; i++) {
        const a = hash01(seed + "o" + i) * Math.PI * 2, d = 0.72 + hash01(seed + "od" + i) * 0.15;
        const px = c.x + Math.cos(a) * R * d, py = c.y + Math.sin(a) * R * d * 0.82;
        ctx.beginPath();
        for (let k = -2; k <= 2; k++) { ctx.moveTo(px + k * 3 * z, py - 3 * z); ctx.lineTo(px + k * 3 * z, py + 3 * z); }
        ctx.stroke();
      }
      ctx.restore();
      // name in the chart's hand
      ctx.save();
      ctx.fillStyle = INK;
      ctx.font = `${Math.round(Math.max(13, 15 * Math.min(z, 1.6)))}px "IM Fell English", serif`;
      ctx.textAlign = "center";
      ctx.fillText(s.name, c.x, c.y + R * 0.95 + 14);
      ctx.restore();
      return;
    }

    // SETTLEMENT LEVEL: one wall, gate, lanes, buildings, people.
    ctx.save();
    coastPath(ctx, c.x, c.y, R * 0.8, seed + "wall");
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
    // crenellations: ticks along the wall
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const w = 1 + (hash01(seed + "wall" + Math.round(i * 28 / 40)) - 0.5) * 0.34;
      const rx = R * 0.8 * w, ry = R * 0.8 * w * 0.82;
      ctx.moveTo(c.x + Math.cos(a) * rx, c.y + Math.sin(a) * ry);
      ctx.lineTo(c.x + Math.cos(a) * (rx + 5), c.y + Math.sin(a) * (ry + 5));
    }
    ctx.stroke();
    ctx.restore();
    // gate toward the Capital
    {
      const cap = this.toScreen(0, 0);
      const a = Math.atan2(cap.y - c.y, cap.x - c.x);
      const gx = c.x + Math.cos(a) * R * 0.8, gy = c.y + Math.sin(a) * R * 0.8 * 0.82;
      ctx.save();
      ctx.fillStyle = VELLUM; ctx.strokeStyle = INK; ctx.lineWidth = 1.6;
      ctx.fillRect(gx - 7, gy - 9, 14, 18); ctx.strokeRect(gx - 7, gy - 9, 14, 18);
      ctx.beginPath(); ctx.arc(gx, gy + 3, 4, Math.PI, 0); ctx.lineTo(gx + 4, gy + 9); ctx.lineTo(gx - 4, gy + 9); ctx.closePath(); ctx.fillStyle = INK; ctx.fill();
      ctx.restore();
    }

    // lanes seat -> workshops, worn by traces
    for (const b of workshops) {
      const p = local(b.at);
      const t = s.traces.find((x) => x.buildingId === b.id);
      ctx.save();
      ctx.strokeStyle = INK_FAINT;
      ctx.lineWidth = 4 + (t ? 3 * t.freshness : 0);
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(sp.x, sp.y + R * 0.14); ctx.quadraticCurveTo((sp.x + p.x) / 2 + (p.y - sp.y) * 0.15, (sp.y + p.y) / 2, p.x, p.y + R * 0.02); ctx.stroke();
      ctx.restore();
    }

    // dwellings: form derived from observed volume, not authored
    const volume = workshops.length + s.traces.length;
    const dwellings = Math.min(14, 3 + volume * 2);
    for (let i = 0; i < dwellings; i++) {
      const a = hash01(seed + "dw" + i) * Math.PI * 2, d = 0.2 + hash01(seed + "dd" + i) * 0.36;
      const at = { x: 0.5 + Math.cos(a) * d * 0.9, y: 0.5 + Math.sin(a) * d * 0.8 };
      // keep clear of the seat and the workshops
      if (Math.hypot(at.x - seat.at.x, at.y - seat.at.y) < 0.2) continue;
      if (workshops.some((b) => Math.hypot(at.x - b.at.x, at.y - b.at.y) < 0.14)) continue;
      const pt = local(at);
      this.house(pt.x, pt.y, R * (0.07 + hash01(seed + "ds" + i) * 0.04), false);
    }
    // draw back to front
    const order = [...workshops].sort((a, b) => a.at.y - b.at.y);
    let seatDrawn = false;
    for (const b of order) {
      if (!seatDrawn && b.at.y > seat.at.y) { this.seat(sp.x, sp.y, R * 0.3, selected?.kind === "seat" && selected.settlementId === s.civilizationId); seatDrawn = true; }
      const p = local(b.at);
      const occupied = s.inhabitants.some((i) => i.buildingId === b.id);
      this.house(p.x, p.y, R * (0.16 + b.size * 1.1), occupied);
      const run = s.inhabitants.find((i) => i.runId === b.runId);
      this.hits.push({ kind: "inhabitant", settlementId: s.civilizationId, runId: b.runId!, label: run?.label ?? "finished work", sub: occupied ? "running now" : "trace", x: p.x, y: p.y, r: R * 0.14 });
    }
    if (!seatDrawn) this.seat(sp.x, sp.y, R * 0.3, selected?.kind === "seat" && selected.settlementId === s.civilizationId);
    this.hits.push({ kind: "seat", settlementId: s.civilizationId, label: s.seatName, sub: `${s.name} · ${s.openMatters} open at the council`, x: sp.x, y: sp.y - R * 0.1, r: R * 0.28 });

    // people (fixed logical size, always on top)
    for (const w of walkers) {
      const a = local(w.from), b = local(w.to);
      const x = a.x + (b.x - a.x) * w.t, y = a.y + (b.y - a.y) * w.t;
      this.person(x, y, w.dir * Math.sign(b.x - a.x || 1), w.depth);
      this.hits.push({ kind: "inhabitant", settlementId: s.civilizationId, runId: w.runId, label: w.label, sub: "running now", x, y, r: SPRITE_PX * 0.7 });
    }

    ctx.save();
    ctx.fillStyle = INK;
    ctx.font = `${Math.round(24 * Math.min(z / SETTLEMENT_ZOOM, 1.4))}px "IM Fell English", serif`;
    ctx.textAlign = "center";
    ctx.fillText(s.name.toUpperCase(), c.x, c.y - R * 0.98);
    ctx.font = `italic ${Math.round(14 * Math.min(z / SETTLEMENT_ZOOM, 1.4))}px "IM Fell English", serif`;
    ctx.fillStyle = INK_FAINT;
    ctx.fillText(s.domain, c.x, c.y - R * 0.98 + 18);
    ctx.restore();
  }

  private drawCapital(scene: Scene, selected: Hit | null) {
    const { ctx } = this;
    const z = this.camera.zoom;
    const c = this.toScreen(scene.capital.ground.x, scene.capital.ground.y);
    const R = 78 * z;
    const isSel = selected?.kind === "capital";
    ctx.save();
    ctx.translate(c.x, c.y);
    // island under the citadel
    coastPath(ctx, 0, 0, R * 1.15, "capital");
    ctx.fillStyle = "#d2bb8b"; ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = isSel ? 2.4 : 1.6; ctx.stroke();
    // star-fort walls
    ctx.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 === 0 ? R * 0.82 : R * 0.62;
      const x = Math.cos(a) * r, y = Math.sin(a) * r * 0.85;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = VELLUM; ctx.fill(); ctx.lineWidth = 2; ctx.stroke();
    // compass rose in the court
    ctx.lineWidth = 1;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const len = i % 4 === 0 ? R * 0.5 : i % 2 === 0 ? R * 0.34 : R * 0.22;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * R * 0.08, Math.sin(a) * R * 0.08); ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.85); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.08, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill();
    // one hall per civilization on the bastions
    const halls = scene.capital.halls;
    halls.forEach((h, i) => {
      const a = -Math.PI / 2 + (i / halls.length) * Math.PI * 2;
      const hx = Math.cos(a) * R * 0.6, hy = Math.sin(a) * R * 0.6 * 0.85;
      const s = Math.max(6, R * 0.13);
      ctx.save();
      ctx.translate(hx, hy);
      ctx.fillStyle = h.epistemic === "observed" ? (h.live ? "#ecdcb0" : VELLUM) : "transparent";
      ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
      ctx.setLineDash(h.epistemic === "observed" ? [] : [2, 2]);
      ctx.fillRect(-s, -s * 0.2, s * 2, s * 0.9); ctx.strokeRect(-s, -s * 0.2, s * 2, s * 0.9);
      ctx.beginPath(); ctx.moveTo(-s * 1.1, -s * 0.2); ctx.lineTo(0, -s * 0.9); ctx.lineTo(s * 1.1, -s * 0.2); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (h.openMatters > 0) { ctx.setLineDash([]); ctx.fillStyle = SEAL; ctx.beginPath(); ctx.arc(s * 0.9, -s * 0.9, Math.max(2.5, s * 0.25), 0, Math.PI * 2); ctx.fill(); }
      if (z >= 1.2) {
        ctx.fillStyle = INK; ctx.textAlign = "center";
        ctx.font = `italic ${Math.max(9, s * 0.9)}px "IM Fell English", serif`;
        ctx.fillText(h.seatName, 0, s * 1.4);
      }
      ctx.restore();
    });
    ctx.fillStyle = INK;
    ctx.font = `${Math.max(12, 16 * Math.min(z, 1.8))}px "IM Fell English", serif`;
    ctx.textAlign = "center";
    ctx.fillText("CAPITAL", 0, R * 1.15 + 16 * Math.min(z, 1.8));
    ctx.restore();
    this.hits.push({ kind: "capital", label: "Capital", sub: `${scene.capital.matters.length} matters before the council`, x: c.x, y: c.y, r: R * 0.9 });
  }

  // ---- glyphs ---------------------------------------------------------------

  private spire(x: number, y: number, h: number) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = INK; ctx.fillStyle = VELLUM; ctx.lineWidth = 1.3;
    const w = h * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - w, y + h * 0.35); ctx.lineTo(x - w, y - h * 0.1); ctx.lineTo(x - w * 0.5, y - h * 0.1);
    ctx.lineTo(x - w * 0.5, y - h * 0.45); ctx.lineTo(x, y - h); ctx.lineTo(x + w * 0.5, y - h * 0.45);
    ctx.lineTo(x + w * 0.5, y - h * 0.1); ctx.lineTo(x + w, y - h * 0.1); ctx.lineTo(x + w, y + h * 0.35); ctx.closePath();
    ctx.fill(); ctx.stroke();
    // hatching
    ctx.beginPath();
    for (let i = 1; i < 5; i++) { const yy = y - h * 0.1 + (h * 0.45 * i) / 5; ctx.moveTo(x - w * 0.9, yy); ctx.lineTo(x - w * 0.5, yy); ctx.moveTo(x + w * 0.5, yy); ctx.lineTo(x + w * 0.9, yy); }
    ctx.stroke();
    ctx.restore();
  }

  private roof(x: number, y: number, s: number, occupied: boolean) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = INK; ctx.fillStyle = occupied ? "#e9d9ae" : VELLUM; ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y + s * 0.35); ctx.lineTo(x - s * 0.5, y); ctx.lineTo(x, y - s * 0.4); ctx.lineTo(x + s * 0.5, y); ctx.lineTo(x + s * 0.5, y + s * 0.35); ctx.closePath();
    ctx.fill(); ctx.stroke();
    if (occupied) { ctx.beginPath(); ctx.moveTo(x + s * 0.28, y - s * 0.15); ctx.lineTo(x + s * 0.28, y - s * 0.5); ctx.stroke(); }
    ctx.restore();
  }

  private house(x: number, y: number, s: number, occupied: boolean) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = 1.4;
    // wall
    ctx.fillStyle = occupied ? "#ecdcb0" : VELLUM;
    ctx.fillRect(x - s * 0.5, y - s * 0.1, s, s * 0.55);
    ctx.strokeRect(x - s * 0.5, y - s * 0.1, s, s * 0.55);
    // roof with hatch
    ctx.fillStyle = "#cbb283";
    ctx.beginPath(); ctx.moveTo(x - s * 0.58, y - s * 0.1); ctx.lineTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.58, y - s * 0.1); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { const t = i / 4; ctx.moveTo(x - s * 0.58 * (1 - t), y - s * 0.1 - s * 0.45 * t); ctx.lineTo(x + s * 0.58 * (1 - t), y - s * 0.1 - s * 0.45 * t); }
    ctx.stroke();
    // door + window
    ctx.fillStyle = INK;
    ctx.fillRect(x - s * 0.08, y + s * 0.15, s * 0.16, s * 0.3);
    ctx.strokeRect(x + s * 0.2, y + s * 0.05, s * 0.16, s * 0.16);
    if (occupied) { // smoke
      ctx.strokeStyle = INK_FAINT; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x + s * 0.32, y - s * 0.4); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.6, x + s * 0.3, y - s * 0.75); ctx.stroke();
    }
    ctx.restore();
  }

  private seat(x: number, y: number, s: number, selected: boolean) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineWidth = selected ? 2.2 : 1.6;
    ctx.fillStyle = "#e4d3a7";
    // plinth + hall + tower
    ctx.fillRect(x - s * 0.7, y, s * 1.4, s * 0.42); ctx.strokeRect(x - s * 0.7, y, s * 1.4, s * 0.42);
    ctx.fillRect(x - s * 0.55, y - s * 0.4, s * 1.1, s * 0.4); ctx.strokeRect(x - s * 0.55, y - s * 0.4, s * 1.1, s * 0.4);
    ctx.beginPath(); ctx.moveTo(x - s * 0.62, y - s * 0.4); ctx.lineTo(x, y - s * 0.75); ctx.lineTo(x + s * 0.62, y - s * 0.4); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillRect(x - s * 0.12, y - s * 1.05, s * 0.24, s * 0.35); ctx.strokeRect(x - s * 0.12, y - s * 1.05, s * 0.24, s * 0.35);
    ctx.beginPath(); ctx.moveTo(x - s * 0.16, y - s * 1.05); ctx.lineTo(x, y - s * 1.3); ctx.lineTo(x + s * 0.16, y - s * 1.05); ctx.closePath(); ctx.fill(); ctx.stroke();
    // colonnade
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) { ctx.moveTo(x + i * s * 0.22, y); ctx.lineTo(x + i * s * 0.22, y + s * 0.42); }
    ctx.stroke();
    // door
    ctx.fillStyle = INK;
    ctx.fillRect(x - s * 0.09, y - s * 0.3, s * 0.18, s * 0.3);
    ctx.restore();
  }

  private person(x: number, y: number, facing: number, depth: number) {
    const { ctx } = this;
    const p = SPRITE_PX;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing || 1, 1);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = INK; ctx.lineWidth = 2;
    // shadow
    ctx.globalAlpha = 0.22; ctx.fillStyle = INK;
    ctx.beginPath(); ctx.ellipse(0, p * 0.36, p * 0.3, p * 0.08, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // legs mid-stride
    ctx.beginPath(); ctx.moveTo(-p * 0.04, -p * 0.05); ctx.lineTo(-p * 0.2, p * 0.33); ctx.moveTo(p * 0.04, -p * 0.05); ctx.lineTo(p * 0.22, p * 0.3); ctx.stroke();
    // cloak/body: root inked solid, delegated left as vellum
    ctx.fillStyle = depth === 0 ? INK : "#efe2c2";
    ctx.beginPath(); ctx.moveTo(-p * 0.2, -p * 0.05); ctx.lineTo(-p * 0.14, -p * 0.5); ctx.lineTo(p * 0.14, -p * 0.5); ctx.lineTo(p * 0.2, -p * 0.05); ctx.closePath(); ctx.fill(); ctx.stroke();
    // arm + bundle carried in front
    ctx.beginPath(); ctx.moveTo(p * 0.08, -p * 0.4); ctx.lineTo(p * 0.34, -p * 0.28); ctx.stroke();
    ctx.fillStyle = "#c9ad78";
    ctx.beginPath(); ctx.rect(p * 0.26, -p * 0.44, p * 0.26, p * 0.22); ctx.fill(); ctx.stroke();
    // head with a hood
    ctx.fillStyle = "#efe2c2";
    ctx.beginPath(); ctx.arc(0, -p * 0.7, p * 0.19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.arc(0, -p * 0.7, p * 0.19, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
    // eye toward travel
    ctx.beginPath(); ctx.arc(p * 0.08, -p * 0.66, p * 0.03, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
