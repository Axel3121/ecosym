// World renderer: real pixel art as the world, code as camera and truth layer.
// The scene decides what may appear; this file only gives it a place.
import type { Scene, Settlement } from "./scene.ts";
import { hash01 } from "./scene.ts";

export interface Camera { x: number; y: number; zoom: number }
export const ZOOM_MIN = 0.3; // hard floor; the real floor is coverZoom()
export const ZOOM_MAX = 5;
export const SETTLEMENT_ZOOM = 2.2; // plate fully in by here
export const WORLD_W = 1536, WORLD_H = 1024;
/** Smallest zoom at which the painting still covers the whole viewport. */
export function coverZoom(w: number, h: number) { return Math.max(w / WORLD_W, h / WORLD_H); }


export interface Hit {
  kind: "settlement" | "seat" | "inhabitant" | "capital" | "letter";
  settlementId?: string; runId?: string; petitionId?: string;
  label: string; sub?: string;
}

/** Which plate a civilization is drawn on, and where things stand on it (0..1). */
export const PLATES: Record<string, { img: string; aspect: number; seat: P; well: P; slots: P[] }> = {
  harbor:  { img: "/art/harbor.png",  aspect: 1122 / 1402, seat: { x: 0.5, y: 0.2 }, well: { x: 0.5, y: 0.42 }, slots: [{ x: 0.22, y: 0.38 }, { x: 0.78, y: 0.4 }, { x: 0.3, y: 0.66 }, { x: 0.72, y: 0.68 }] },
  hill:    { img: "/art/hill.png",    aspect: 1122 / 1402, seat: { x: 0.5, y: 0.2 }, well: { x: 0.5, y: 0.44 }, slots: [{ x: 0.2, y: 0.4 }, { x: 0.8, y: 0.42 }, { x: 0.28, y: 0.7 }, { x: 0.74, y: 0.68 }] },
  orchard: { img: "/art/orchard.png", aspect: 1122 / 1402, seat: { x: 0.5, y: 0.2 }, well: { x: 0.5, y: 0.44 }, slots: [{ x: 0.2, y: 0.4 }, { x: 0.78, y: 0.4 }, { x: 0.25, y: 0.7 }, { x: 0.75, y: 0.7 }] },
  lake:    { img: "/art/lake.png",    aspect: 1122 / 1402, seat: { x: 0.5, y: 0.2 }, well: { x: 0.5, y: 0.44 }, slots: [{ x: 0.2, y: 0.36 }, { x: 0.8, y: 0.4 }, { x: 0.25, y: 0.68 }, { x: 0.76, y: 0.68 }] },
};
type P = { x: number; y: number };
import { plateKeyFor } from "./looks.ts";
const CAPITAL = { x: 770, y: 400, r: 130 };

// sprite sheet cells
export const WCOLS = [100, 400, 660, 960], WROWS = [60, 360, 660, 940], WCELL = { w: 200, h: 240 };

function plateRect(s: Settlement) {
  const key = plateKeyFor(s.civilizationId);
  const p = PLATES[key]!;
  const w = s.radius * 2.3, h = w / p.aspect;
  return { p, x: s.ground.x - w / 2, y: s.ground.y - h * 0.5, w, h };
}
export function plateLocalToWorld(s: Settlement, l: P): P {
  const r = plateRect(s);
  return { x: r.x + l.x * r.w, y: r.y + l.y * r.h };
}

// ---- walkers -----------------------------------------------------------------
export interface Walker { runId: string; settlementId: string; from: P; to: P; t: number; dir: 1 | -1; speed: number; depth: number; label: string; }

export function makeWalkers(scene: Scene): Walker[] {
  const out: Walker[] = [];
  for (const s of scene.settlements) {
    if (s.epistemic !== "observed") continue;
    const { p } = plateRect(s);
    const roots = s.buildings.filter((b) => b.kind === "workshop");
    for (const inh of s.inhabitants) {
      const slot = p.slots[roots.findIndex((b) => b.id === inh.buildingId) % p.slots.length] ?? p.slots[0]!;
      const k = hash01(inh.runId);
      const from = inh.depth === 0 ? p.well : { x: slot.x + (k - 0.5) * 0.18, y: slot.y + 0.08 + k * 0.06 };
      const to = inh.depth === 0 ? slot : { x: slot.x + (0.5 - k) * 0.14, y: slot.y - 0.04 + k * 0.04 };
      out.push({ runId: inh.runId, settlementId: s.civilizationId, from, to, t: k, dir: k > 0.5 ? 1 : -1, speed: 0.06 + hash01(inh.runId + "v") * 0.05, depth: inh.depth, label: inh.label });
    }
  }
  return out;
}
export function stepWalkers(ws: Walker[], dtMs: number, reduced: boolean) {
  if (reduced) return;
  for (const w of ws) {
    w.t += (w.dir * w.speed * dtMs) / 1000;
    if (w.t > 1) { w.t = 1; w.dir = -1; }
    if (w.t < 0) { w.t = 0; w.dir = 1; }
  }
}

// ---- chart ---------------------------------------------------------------------
export class Chart {
  public showLabels = true;
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private hits: Array<Hit & { x: number; y: number; r: number }> = [];
  private img = new Map<string, HTMLImageElement>();
  private t0 = performance.now();

  constructor(private canvas: HTMLCanvasElement, public camera: Camera = { x: 700, y: 512, zoom: 1 }) {
    this.ctx = canvas.getContext("2d")!;
    for (const src of ["/art/world.png", "/art/capital.png", "/art/walkers.png", "/art/smoke.png", "/art/fog.png", ...Object.values(PLATES).map((p) => p.img)]) {
      const im = new Image(); im.src = src; this.img.set(src, im);
    }
    this.resize();
  }
  private im(src: string) { const i = this.img.get(src); return i && i.complete && i.naturalWidth > 0 ? i : null; }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.floor(this.w * this.dpr); this.canvas.height = Math.floor(this.h * this.dpr);
  }
  toScreen(wx: number, wy: number) { return { x: this.w / 2 + (wx - this.camera.x) * this.camera.zoom, y: this.h / 2 + (wy - this.camera.y) * this.camera.zoom }; }
  toWorld(sx: number, sy: number) { return { x: (sx - this.w / 2) / this.camera.zoom + this.camera.x, y: (sy - this.h / 2) / this.camera.zoom + this.camera.y }; }
  hitTest(sx: number, sy: number): Hit | null {
    for (let i = this.hits.length - 1; i >= 0; i--) { const h = this.hits[i]!; if ((sx - h.x) ** 2 + (sy - h.y) ** 2 <= h.r * h.r) return h; }
    return null;
  }

  draw(scene: Scene, walkers: Walker[], selected: Hit | null) {
    const { ctx } = this; const z = this.camera.zoom;
    this.hits = [];
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#1e2a1c"; ctx.fillRect(0, 0, this.w, this.h);

    // one painted world. The map has an edge; beyond it is nothing.
    const world = this.im("/art/world.png");
    const o = this.toScreen(0, 0);
    if (world) ctx.drawImage(world, o.x, o.y, WORLD_W * z, WORLD_H * z);
    const plateAlpha = Math.max(0, Math.min(1, (z - 1.5) / (SETTLEMENT_ZOOM - 1.5)));
    const now = (performance.now() - this.t0) / 1000;
    if (plateAlpha > 0) {
      ctx.globalAlpha = plateAlpha;
      const cap = this.im("/art/capital.png");
      if (cap) { const w = CAPITAL.r * 2.3; const a = this.toScreen(CAPITAL.x - w / 2, CAPITAL.y - w / 2); ctx.drawImage(cap, a.x, a.y, w * z, w * z); }
      for (const s of scene.settlements) {
        if (s.epistemic !== "observed") continue;
        const r = plateRect(s); const im = this.im(r.p.img); if (!im) continue;
        const a = this.toScreen(r.x, r.y); ctx.drawImage(im, a.x, a.y, r.w * z, r.h * z);
      }
      ctx.globalAlpha = 1;
    }

    // truth layer per settlement
    for (const s of scene.settlements) {
      const c = this.toScreen(s.ground.x, s.ground.y);
      const R = s.radius * z;
      this.hits.push({ kind: "settlement", settlementId: s.civilizationId, label: s.name, sub: s.epistemic === "observed" ? s.domain : "aldri observert", x: c.x, y: c.y, r: R });
      if (s.epistemic !== "observed") { this.fog(s, now); continue; }

      const r = plateRect(s);
      const seat = plateLocalToWorld(s, r.p.seat);
      const sp = this.toScreen(seat.x, seat.y);

      // smoke only where something runs — over occupied workshop slots
      const roots = s.buildings.filter((b) => b.kind === "workshop");
      roots.forEach((b, i) => {
        if (!s.inhabitants.some((x) => x.buildingId === b.id)) return;
        const slot = r.p.slots[i % r.p.slots.length]!;
        const w = plateLocalToWorld(s, { x: slot.x + 0.03, y: slot.y - 0.06 });
        this.smoke(this.toScreen(w.x, w.y), z, now + i);
        const sc = this.toScreen(w.x, w.y + r.h * 0.05);
        this.hits.push({ kind: "inhabitant", settlementId: s.civilizationId, runId: b.runId!, label: s.inhabitants.find((x) => x.runId === b.runId)?.label ?? "arbeid", sub: "kjører nå", x: sc.x, y: sc.y, r: Math.max(14, r.w * 0.06 * z) });
      });

      // walkers
      for (const wk of walkers) {
        if (wk.settlementId !== s.civilizationId) continue;
        const a = plateLocalToWorld(s, wk.from), b = plateLocalToWorld(s, wk.to);
        const wx = a.x + (b.x - a.x) * wk.t, wy = a.y + (b.y - a.y) * wk.t;
        const p = this.toScreen(wx, wy);
        const dx = (b.x - a.x) * wk.dir, dy = (b.y - a.y) * wk.dir;
        this.walker(p, z, dx, dy, wk.depth, now + hash01(wk.runId) * 3);
        this.hits.push({ kind: "inhabitant", settlementId: s.civilizationId, runId: wk.runId, label: wk.label, sub: "kjører nå", x: p.x, y: p.y, r: Math.max(14, 10 * z) });
      }

      // pennants for council matters, above the seat
      if (s.openMatters > 0) this.marker(sp, s.openMatters, "seal");
      this.hits.push({ kind: "seat", settlementId: s.civilizationId, label: s.seatName, sub: `${s.name} · ${s.openMatters} åpne for rådet`, x: sp.x, y: sp.y + 10 * z, r: Math.max(18, r.w * 0.12 * z) });

      // name at world level
      if (plateAlpha < 1 && this.showLabels) this.label(c.x, c.y + R * 0.8, s.name, 1 - plateAlpha);
    }

    // capital
    {
      const c = this.toScreen(CAPITAL.x, CAPITAL.y);
      this.hits.push({ kind: "capital", label: "Capital", sub: `${scene.capital.matters.length} saker for rådet`, x: c.x, y: c.y, r: CAPITAL.r * 0.7 * z });
      if (scene.capital.matters.length > 0) this.marker({ x: c.x, y: c.y - CAPITAL.r * 0.45 * z }, scene.capital.matters.length, "seal");
      if (plateAlpha < 1 && this.showLabels) this.label(c.x, c.y - CAPITAL.r * 0.75 * z, "Capital", 1 - plateAlpha);
    }

    // letters on the way from the capital
    for (const l of scene.letters) {
      const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId); if (!s) continue;
      const a = this.toScreen(CAPITAL.x, CAPITAL.y), b = this.toScreen(s.ground.x, s.ground.y);
      const x = a.x + (b.x - a.x) * l.progress, y = a.y + (b.y - a.y) * l.progress - 6 * z;
      this.marker({ x, y: y + 16 }, 1, "letter");
      const sz = 8;
      this.hits.push({ kind: "letter", petitionId: l.petitionId, settlementId: s.civilizationId, label: `petisjon · ${l.state}`, sub: l.text, x, y, r: sz * 1.5 });
    }
  }

  private label(x: number, y: number, text: string, alpha: number) {
    const { ctx } = this;
    ctx.save(); ctx.globalAlpha = alpha; ctx.font = `500 12px "Plex Mono", monospace`; ctx.textAlign = "center";
    const w = ctx.measureText(text).width + 18;
    ctx.fillStyle = "rgba(29,26,21,0.9)"; ctx.fillRect(x - w / 2, y - 12, w, 20);
    ctx.strokeStyle = "#5a5040"; ctx.lineWidth = 1; ctx.strokeRect(x - w / 2 + 0.5, y - 11.5, w - 1, 19);
    ctx.fillStyle = "#e6dcc3"; ctx.fillText(text, x, y + 3); ctx.restore();
  }

  private fog(s: Settlement, now: number) {
    const fog = this.im("/art/fog.png"); if (!fog) return;
    const z = this.camera.zoom; const r = s.radius;
    const drift = Math.sin(now * 0.3) * 6;
    const a = this.toScreen(s.ground.x - r * 1.7 + drift, s.ground.y - r * 1.2);
    const b = this.toScreen(s.ground.x - r * 1.3 - drift, s.ground.y - r * 0.7);
    this.ctx.globalAlpha = 0.95; this.ctx.drawImage(fog, a.x, a.y, r * 3.4 * z, r * 2.3 * z);
    this.ctx.globalAlpha = 0.7; this.ctx.drawImage(fog, b.x, b.y, r * 2.6 * z, r * 1.7 * z);
    this.ctx.globalAlpha = 1;
    this.label(this.toScreen(s.ground.x, s.ground.y).x, this.toScreen(s.ground.x, s.ground.y).y, `${s.name} · aldri observert`, 1);
  }

  private smoke(p: P, z: number, t: number) {
    const im = this.im("/art/smoke.png"); if (!im) return;
    // frames 0-2 only (3-5 are sparkle residue); the puff rises and thins
    const f = Math.floor((t * 2.5) % 3); const sw = 90, sh = 150, sx = 10 + f * 107, sy = 55;
    const s = Math.max(0.22, 0.2 * z);
    const rise = ((t * 0.6) % 1) * 12 * z;
    this.ctx.globalAlpha = 0.85 - f * 0.2;
    this.ctx.drawImage(im, sx, sy, sw, sh, p.x - sw * s * 0.5, p.y - sh * s - rise, sw * s, sh * s);
    this.ctx.globalAlpha = 1;
  }

  private walker(p: P, z: number, dx: number, dy: number, depth: number, t: number) {
    const im = this.im("/art/walkers.png"); if (!im) return;
    const side = Math.abs(dx) >= Math.abs(dy);
    const row = side ? (depth === 0 ? 2 : 3) : dy > 0 ? 0 : 1;
    const frame = Math.floor((t * 5) % 4);
    const hpx = Math.max(26, Math.min(96, 24 * z)); const s = hpx / WCELL.h;
    const flip = side && dx > 0;
    const { ctx } = this;
    ctx.save(); ctx.translate(p.x, p.y); if (flip) ctx.scale(-1, 1);
    ctx.globalAlpha = 0.25; ctx.fillStyle = "#000"; ctx.beginPath(); ctx.ellipse(0, 0, hpx * 0.28, hpx * 0.08, 0, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.drawImage(im, WCOLS[frame]!, WROWS[row]!, WCELL.w, WCELL.h, -WCELL.w * s / 2, -hpx, WCELL.w * s, hpx);
    ctx.restore();
  }

  /** One etched marker per place — never a marker per matter. dot: red = needs a decision,
   *  cream = a petition on its way. A count only when n > 1. */
  private marker(p: P, n: number, dot: "seal" | "letter") {
    const { ctx } = this; const w = 12, x = Math.round(p.x - w / 2), y = Math.round(p.y - w - 10);
    ctx.fillStyle = "rgba(20,18,14,0.82)"; ctx.fillRect(x, y, w, w);
    ctx.strokeStyle = "#c4b99f"; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, w - 1);
    if (dot === "seal") { ctx.fillStyle = "#e8735c"; ctx.fillRect(x + 4, y + 4, 4, 4); }
    else { ctx.strokeStyle = "#f3e7c8"; ctx.strokeRect(x + 3.5, y + 3.5, 5, 5); }
    if (n > 1) { ctx.save(); ctx.font = `500 10px "Plex Mono", monospace`; ctx.textBaseline = "middle"; ctx.fillStyle = "#eee6d2"; ctx.fillText(String(n), x + w + 4, y + w / 2 + 0.5); ctx.restore(); }
  }
}
