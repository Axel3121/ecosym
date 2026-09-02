import type { Scene, Settlement } from "./scene.ts";
import { TOWN_W, TOWN_H, QUARTERS, SQUARE, HALL, queueSpot, quarterOf, unfoundedQuarters } from "./town.ts";
import type { Quarter } from "./town.ts";

export interface Camera { x: number; y: number; zoom: number }
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 5;
export const SETTLEMENT_ZOOM = 2.2;
export const WORLD_W = TOWN_W, WORLD_H = TOWN_H;
/** Smallest zoom at which the painting still covers the whole viewport. */
export function coverZoom(w: number, h: number) { return Math.max(w / WORLD_W, h / WORLD_H); }
/** Zoom at which the whole town fits inside the viewport (the opening view). */
export function fitZoom(w: number, h: number) { return Math.min(w / WORLD_W, h / WORLD_H); }

export interface Hit {
  kind: "settlement" | "seat" | "inhabitant" | "capital" | "letter";
  settlementId?: string; runId?: string; petitionId?: string;
  label: string; sub?: string;
}

type P = { x: number; y: number };
function hash01(id: string) { let h = 2166136261; for (const ch of id) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 1000) / 1000; }
export const WCOLS = [100, 400, 660, 960], WROWS = [60, 360, 660, 940], WCELL = { w: 200, h: 240 };

// ---- walkers -----------------------------------------------------------------
export interface Walker { runId: string; settlementId: string; from: P; to: P; t: number; dir: 1 | -1; speed: number; depth: number; label: string; }

export function makeWalkers(scene: Scene): Walker[] {
  const out: Walker[] = [];
  for (const s of scene.settlements) {
    if (s.epistemic !== "observed") continue;
    const q = quarterOf(scene, s);
    const roots = s.buildings.filter((b) => b.kind === "workshop");
    for (const inh of s.inhabitants) {
      const ch = q.chimneys[Math.max(0, roots.findIndex((b) => b.id === inh.buildingId)) % q.chimneys.length]!;
      const k = hash01(inh.runId);
      const home = { x: ch.x, y: ch.y + 26 };                       // the cottage door, below its chimney
      const seat = { x: q.seat.x + (k - 0.5) * 30, y: q.seat.y + 30 }; // the seat's forecourt
      const from = inh.depth === 0 ? seat : { x: home.x + (k - 0.5) * 20, y: home.y + 10 };
      const to = inh.depth === 0 ? home : { x: home.x + (0.5 - k) * 16, y: home.y - 6 };
      out.push({ runId: inh.runId, settlementId: s.civilizationId, from, to, t: k, dir: k > 0.5 ? 1 : -1, speed: 0.05 + hash01(inh.runId + "v") * 0.04, depth: inh.depth, label: inh.label });
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

  constructor(private canvas: HTMLCanvasElement, public camera: Camera = { x: TOWN_W / 2, y: TOWN_H / 2, zoom: 0.7 }) {
    this.ctx = canvas.getContext("2d")!;
    for (const src of ["/art/town.png", "/art/walkers.png", "/art/smoke.png", "/art/fog.png"]) {
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

    // one painted town. It has an edge; beyond it is nothing.
    const town = this.im("/art/town.png");
    const o = this.toScreen(0, 0);
    if (town) ctx.drawImage(town, o.x, o.y, TOWN_W * z, TOWN_H * z);
    const labelAlpha = 1 - Math.max(0, Math.min(1, (z - 1.5) / (SETTLEMENT_ZOOM - 1.5)));
    const now = (performance.now() - this.t0) / 1000;

    // quarters nobody has founded: fog. Not painted over, not invented — covered.
    for (const q of unfoundedQuarters(scene)) this.fogBox(q, now);

    // truth layer per founded quarter
    for (const s of scene.settlements) {
      const q = quarterOf(scene, s);
      const c = this.toScreen((q.box.x1 + q.box.x2) / 2, (q.box.y1 + q.box.y2) / 2);
      const R = Math.max(q.box.x2 - q.box.x1, q.box.y2 - q.box.y1) / 2 * z;
      this.hits.push({ kind: "settlement", settlementId: s.civilizationId, label: s.name, sub: s.epistemic === "observed" ? s.domain : "aldri observert", x: c.x, y: c.y, r: R });
      if (s.epistemic !== "observed") { this.fogBox(q, now, `${s.name} · aldri observert`); continue; }

      // smoke only where something runs — over that workshop's chimney
      const roots = s.buildings.filter((b) => b.kind === "workshop");
      roots.forEach((b, i) => {
        if (!s.inhabitants.some((x) => x.buildingId === b.id)) return;
        const ch = q.chimneys[i % q.chimneys.length]!;
        const sp = this.toScreen(ch.x, ch.y);
        this.smoke(sp, z, now + i);
        this.hits.push({ kind: "inhabitant", settlementId: s.civilizationId, runId: b.runId!, label: s.inhabitants.find((x) => x.runId === b.runId)?.label ?? "arbeid", sub: "kjører nå", x: sp.x, y: sp.y + 14 * z, r: Math.max(14, 16 * z) });
      });

      // walkers
      for (const wk of walkers) {
        if (wk.settlementId !== s.civilizationId) continue;
        const wx = wk.from.x + (wk.to.x - wk.from.x) * wk.t, wy = wk.from.y + (wk.to.y - wk.from.y) * wk.t;
        const p = this.toScreen(wx, wy);
        const dx = (wk.to.x - wk.from.x) * wk.dir, dy = (wk.to.y - wk.from.y) * wk.dir;
        this.walker(p, z, dx, dy, wk.depth, now + hash01(wk.runId) * 3);
        this.hits.push({ kind: "inhabitant", settlementId: s.civilizationId, runId: wk.runId, label: wk.label, sub: "kjører nå", x: p.x, y: p.y, r: Math.max(14, 10 * z) });
      }

      // the seat: the quarter's largest building
      const sp = this.toScreen(q.seat.x, q.seat.y);
      this.hits.push({ kind: "seat", settlementId: s.civilizationId, label: s.seatName, sub: `${s.name} · ${s.openMatters} åpne for rådet`, x: sp.x, y: sp.y, r: Math.max(18, 34 * z) });
      if (this.showLabels && labelAlpha > 0) this.label(sp.x, sp.y + 34 * z, s.name, labelAlpha);
    }

    // the town hall: matters waiting stand at the door, one body per matter. The queue IS the count.
    {
      const d = this.toScreen(HALL.door.x, HALL.door.y);
      const hx = (HALL.box.x1 + HALL.box.x2) / 2, hy = (HALL.box.y1 + HALL.box.y2) / 2;
      const hc = this.toScreen(hx, hy);
      this.hits.push({ kind: "capital", label: "Rådhuset", sub: scene.capital.matters.length ? `${scene.capital.matters.length} saker venter på svar` : "ingenting venter", x: hc.x, y: hc.y, r: Math.max(24, 70 * z) });
      scene.capital.matters.forEach((m, i) => {
        const p = this.toScreen(queueSpot(i).x, queueSpot(i).y);
        this.walker(p, z, 0, -1, 1, 0); // standing, facing the door
        this.hits.push({ kind: "letter", petitionId: m.id, label: m.summary, sub: "venter på svar", x: p.x, y: p.y - 8, r: Math.max(12, 10 * z) });
      });
      if (this.showLabels && labelAlpha > 0) this.label(d.x, d.y + 44 * z, "Rådhuset", labelAlpha);
    }

    // petitions on their way: a messenger walks from the quarter's gate to the hall door
    for (const l of scene.letters) {
      const s = scene.settlements.find((x) => x.civilizationId === l.toCivilizationId); if (!s) continue;
      const q = quarterOf(scene, s);
      const a = q.gate, b = HALL.door;
      const wx = a.x + (b.x - a.x) * (1 - l.progress), wy = a.y + (b.y - a.y) * (1 - l.progress);
      const p = this.toScreen(wx, wy);
      this.walker(p, z, b.x - a.x, b.y - a.y, 1, now + hash01(l.petitionId) * 3);
      this.hits.push({ kind: "letter", petitionId: l.petitionId, settlementId: s.civilizationId, label: `petisjon · ${l.state}`, sub: l.text, x: p.x, y: p.y - 8, r: Math.max(12, 10 * z) });
    }
    void selected;
  }

  private label(x: number, y: number, text: string, alpha: number) {
    const { ctx } = this;
    ctx.save(); ctx.globalAlpha = alpha; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `500 11px "Plex Mono", monospace`;
    ctx.lineJoin = "round"; ctx.lineWidth = 4; ctx.strokeStyle = "rgba(22,18,12,0.75)"; ctx.strokeText(text.toUpperCase(), x, y);
    ctx.fillStyle = "#f1e8d6"; ctx.fillText(text.toUpperCase(), x, y);
    ctx.restore();
  }

  private fogBox(q: Quarter, now: number, text?: string) {
    const { ctx } = this;
    const a = this.toScreen(q.box.x1, q.box.y1), b = this.toScreen(q.box.x2, q.box.y2);
    const w = b.x - a.x, h = b.y - a.y, cx = a.x + w / 2, cy = a.y + h / 2;
    const breathe = 0.9 + Math.sin(now * 0.4 + q.box.x1) * 0.04;
    // a soft dusk over the quarter: darkening, slightly cool, feathered — not a white blob
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.62 * breathe);
    g.addColorStop(0, "rgba(38,44,58,0.72)");
    g.addColorStop(0.7, "rgba(38,44,58,0.55)");
    g.addColorStop(1, "rgba(38,44,58,0)");
    ctx.fillStyle = g; ctx.fillRect(a.x - w * 0.3, a.y - h * 0.3, w * 1.6, h * 1.6);
    if (text && this.showLabels) this.label(cx, cy, text, 0.9);
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

}
