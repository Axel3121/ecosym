import { Pix, P, TINT } from './pix'

/** Ekte pixel-art-sprites, tegnet direkte i buffer-oppløsning. */
const SP: Record<string, HTMLImageElement> = {}
export function loadSprites(done: () => void) {
  let n = 2
  for (const k of ['axey', 'crew']) {
    const im = new Image()
    im.onload = () => { if (--n === 0) done() }
    im.src = `/${k}.png`
    SP[k] = im
  }
}
/** Tegn en sprite inn i pikselbufferen, hardkantet. */
function sprite(p: Pix, k: string, x: number, y: number, S: number, dim = 1) {
  const im = SP[k]
  if (!im?.complete || !im.naturalWidth) return
  const w = Math.max(1, Math.round(im.naturalWidth * S))
  const h = Math.max(1, Math.round(im.naturalHeight * S))
  p.c.imageSmoothingEnabled = false
  p.flush()
  p.c.globalAlpha = dim
  p.c.drawImage(im, Math.round(x - w / 2), Math.round(y - h), w, h)
  p.c.globalAlpha = 1
  p.img = p.c.getImageData(0, 0, p.img.width, p.img.height)
  p.d = p.img.data
}

/** Isometrisk projeksjon i pikselrommet. */
export const iso = (x: number, y: number) => ({ sx: (x - y) * 0.86, sy: (x + y) * 0.5 })

export const rnd = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Stjernehimmel med parallakse. */
export function sky(p: Pix, camx: number, camy: number, t: number) {
  const W = p.img.width, H = p.img.height

  // himmelgradient — dithret piksel for piksel, ingen synlige bånd
  const hex = (c: string) => [parseInt(c.slice(1,3),16), parseInt(c.slice(3,5),16), parseInt(c.slice(5,7),16)]
  const A = hex(P.void0), B = hex(P.void1), C = hex(P.void2)
  for (let y = 0; y < H; y++) {
    const k = y / H
    // interpoler i to trinn: topp -> midt -> horisont
    const f = k < 0.55 ? k / 0.55 : (k - 0.55) / 0.45
    const c0 = k < 0.55 ? A : B
    const c1 = k < 0.55 ? B : C
    const r = c0[0] + (c1[0] - c0[0]) * f
    const g = c0[1] + (c1[1] - c0[1]) * f
    const b = c0[2] + (c1[2] - c0[2]) * f
    for (let x = 0; x < W; x++) {
      const th = (((x * 73856093) ^ (y * 19349663)) % 997) / 997 - 0.5
      const rr = Math.max(0, Math.min(255, Math.round(r + th * 9)))
      const gg = Math.max(0, Math.min(255, Math.round(g + th * 9)))
      const bb = Math.max(0, Math.min(255, Math.round(b + th * 9)))
      p.rgb(x, y, rr, gg, bb)
    }
  }

  // skylag som driver sakte — parallakse mot kameraet
  const puff = (px: number, py: number, r: number, tone: string, hi: string) => {
    for (let dy = -r; dy <= r * 0.6; dy++) {
      const w = Math.round(Math.sqrt(Math.max(0, r * r - dy * dy)) * 1.9)
      for (let dx = -w; dx <= w; dx++) {
        const yy = py + dy
        const top = dy < -r * 0.25
        p.px(px + dx, yy, top ? hi : tone, 0.42)
      }
    }
  }

  for (let layer = 0; layer < 3; layer++) {
    const depth = 0.15 + layer * 0.22
    const yBase = H * (0.18 + layer * 0.26)
    const drift = t * (0.004 + layer * 0.003)
    for (let i = 0; i < 5; i++) {
      const seed = layer * 97 + i * 31
      const sx = ((rnd(seed) * W * 2 + drift * 40 - camx * depth) % (W * 1.6)) - W * 0.3
      const sy = yBase + rnd(seed + 5) * H * 0.12 - camy * depth * 0.4
      const r = (4 + rnd(seed + 9) * 7) * (0.6 + layer * 0.4)
      const tone = layer === 0 ? P.cloudDark : layer === 1 ? P.cloud : P.cloudLit
      const hi = layer === 0 ? P.cloud : P.cloudLit
      puff(sx | 0, sy | 0, r | 0, tone, hi)
      puff((sx + r * 1.6) | 0, (sy + r * 0.3) | 0, (r * 0.75) | 0, tone, hi)
      puff((sx - r * 1.4) | 0, (sy + r * 0.4) | 0, (r * 0.6) | 0, tone, hi)
    }
  }
}


type Isle = {
  hue: number; runs: number; cold: number; size: number; seed: number
  mood: string
}

/** Én øy i piksler: fjell under, dithret jord, gresskant, hus. */
export function isle(p: Pix, cx: number, cy: number, o: Isle, t: number, sel: boolean, S = 1) {
  const T = TINT[o.hue % TINT.length]
  const R = Math.max(6, o.size | 0)
  const ry = Math.max(3, (R * 0.5) | 0)
  const lit = o.mood === 'jobber' ? 1 : o.mood === 'nettopp' ? 0.6 : o.mood === 'venter' ? 0.3 : 0.1

  // klippen under: vertikale sprukne søyler som ender i spisser
  const shape = o.seed % 3
  const deep = ((R * (shape === 0 ? 2.0 : shape === 1 ? 1.2 : 1.55)) | 0)
  // hver søyle har sin egen lengde -> taggete silhuett nederst
  const cols = Math.max(5, (R / 3) | 0)
  const colEnd: number[] = []
  for (let c = 0; c < cols; c++) {
    const n = rnd(o.seed * 3 + c * 41)
    colEnd.push(0.55 + n * 0.45)
  }
  for (let j = 0; j < deep; j++) {
    const k = j / deep
    const grip = Math.min(1, j / Math.max(2, ry * 0.85))
    const taper = shape === 0 ? 1 - k * 0.92
                : shape === 1 ? 1 - k * k * 0.68
                : 1 - Math.round(k * 4) / 4.4
    const wf = 1 - (1 - taper) * grip
    const w = Math.max(1, ((R * wf) | 0))
    const y = cy + j
    for (let x = -w; x <= w; x++) {
      // hvilken søyle er dette
      const ci = Math.min(cols - 1, (((x + w) / Math.max(1, w * 2)) * cols) | 0)
      if (k > colEnd[ci]) continue          // søylen har tatt slutt -> hull i silhuetten
      const seam = ((x + o.seed) % 7 === 0)  // vertikal sprekk
      const west = x < -w * 0.28
      if (seam) p.px(cx + x, y, P.night, 0.75)
      else p.dith(cx + x, y, west ? P.rock1 : P.rock0, west ? P.rock2 : P.rock1, west ? 0.5 : 0.26)
    }
    // lys steinkant på vestsiden, mørk kontur på østsiden
    if (k < colEnd[0]) p.px(cx - w, y, P.stoneLit, 0.55)
    if (k < colEnd[cols - 1]) p.px(cx + w, y, P.ink2, 0.8)
  }

  // jordkanten
  for (let j = 0; j < 3; j++) {
    const w = ((R * (1 - j * 0.05)) | 0)
    for (let x = -w; x <= w; x++)
      p.dith(cx + x, cy - 1 + j, j === 0 ? P.stoneLit : P.rock1, j === 0 ? P.rock2 : P.rock0, 0.5)
  }

  // toppflaten: olivengrønt gress med uregelmessig kant
  for (let dy = -ry; dy <= ry; dy++) {
    const f = 1 - (dy * dy) / (ry * ry)
    if (f <= 0) continue
    const base = Math.sqrt(f) * R
    // hakk i kanten så silhuetten ikke er en perfekt ellipse
    const notch = (rnd(o.seed + dy * 17) - 0.5) * R * 0.13
    const w = Math.max(1, (base + notch) | 0)
    for (let x = -w; x <= w; x++) {
      const north = dy < -ry * 0.15
      p.dith(cx + x, cy + dy, north ? P.grassLit : P.grass,
             north ? P.grass : P.grassDark, 0.42 + lit * 0.18)
    }
    // lys kant i nord, mørk kontur i sør
    p.px(cx - w, cy + dy, P.grassLit, 0.5)
    p.px(cx + w, cy + dy, P.ink2, 0.55)
  }
  // valgt øy får en lys ring
  if (sel) p.discEdge(cx, cy, R + 2, ry + 1, T.l)

  // øyas farge som jordflekker/sti, ikke som hele bakken
  for (let i = 0; i < 5; i++) {
    const a = rnd(o.seed + i * 23) * Math.PI * 2
    const d = 0.25 + rnd(o.seed + i * 29) * 0.45
    const px = (cx + Math.cos(a) * R * d) | 0
    const py = (cy + Math.sin(a) * ry * d) | 0
    for (let q = 0; q < 3; q++) p.px(px + q, py, T.m, 0.3)
  }

  // palisade rundt landsbyen
  palisade(p, cx, cy, R, ry, o.hue, S)

  // langhusene — sortert bakfra og frem så de stables riktig
  const n = Math.min(4, Math.ceil(o.runs / 3))
  const spots: { x: number; y: number; seed: number }[] = []
  for (let i = 0; i < n; i++) {
    const a = rnd(o.seed + i * 7) * Math.PI * 2
    const d = 0.52 + rnd(o.seed + i * 13) * 0.26
    spots.push({
      x: (cx + Math.cos(a) * R * d) | 0,
      y: (cy + Math.sin(a) * ry * d) | 0,
      seed: o.seed + i,
    })
  }
  spots.sort((a, b) => a.y - b.y)
  for (const sp of spots) hut(p, sp.x, sp.y, o.hue, lit, t, sp.seed, S)

  // langskip fortøyd i sør når øya er i bruk
  if (o.runs > 2) ship(p, (cx - R * 0.15) | 0, (cy + ry * 0.82) | 0, o.hue, S)

  // beboeren står midt på øya, tegnet sist så hun aldri havner bak et hus
  crew(p, cx, (cy + ry * 0.2) | 0, o.hue, lit, o.mood, t, o.seed, S)
}

/** Beboeren på øya — ekte sprite. Dempet når hun sover. */
function crew(p: Pix, x: number, y: number, _hue: number, lit: number, mood: string, t: number, seed: number, _S = 1) {
  const sleep = mood === 'sover' || mood === 'ny'
  const bob = Math.sin(t * (mood === 'jobber' ? 0.005 : 0.0016) + seed) > 0 ? 0 : 1
  sprite(p, 'crew', x, y - bob, 0.3, sleep ? 0.55 : 0.8 + lit * 0.2)
}

/** Vikinglanghus: buet torvtak, dragehode på mønet, tjærebrune vegger. */
function hut(p: Pix, x: number, y: number, hue: number, lit: number, t: number, seed: number, S = 1) {
  void t
  const big = seed % 3 === 0
  void S
  const u = 1
  const w = big ? 11 : 8
  const h = big ? 5 : 4
  const roof = big ? 6 : 5
  const x0 = Math.round(x - w / 2)
  const y0 = Math.round(y - h)

  // skygge
  p.rect(x0 + u, y, w, u, P.night, 0.4)

  // tjærebrune plankevegger med vertikal maserring
  p.rect(x0, y0, w, h, P.wall)
  for (let k = 0; k < w; k += Math.max(2, 2))
    p.rect(x0 + k, y0, 1, h, P.night, 0.22)
  p.rect(x0, y0, u, h, P.woodLit)

  // buet torvtak — bredere enn veggen, henger ut
  const over = Math.max(1, 2)
  for (let r = 0; r < roof; r++) {
    const f = r / roof
    const bulge = Math.round(Math.sin((1 - f) * Math.PI * 0.5) * over)
    const ins = Math.round(f * f * w * 0.34)
    const ry = y0 - roof + r
    const rw = w - ins * 2 + bulge * 2
    const rx = x0 + ins - bulge
    // torv: mørk grønnbrun nederst, øyas farge øverst
    p.rect(rx, ry, rw, 1, f > 0.55 ? P.rock1 : TINT[hue].m)
    if (r === roof - 1) p.rect(rx, ry, rw, 1, TINT[hue].d)
  }

  // mønekam
  const mx = x0 + Math.round(w / 2)
  p.rect(mx - u, y0 - roof, u * 2, u, TINT[hue].l, 0.75)

  // dragehoder på hver ende av mønet
  const dy = y0 - roof - 2
  for (const side of [-1, 1]) {
    const dx = mx + side * Math.round(w * 0.42)
    p.rect(dx, dy + 2, u, Math.round(3 * S), TINT[hue].d)
    p.rect(dx - (side < 0 ? u : 0), dy, u * 2, u, TINT[hue].m)
    p.rect(dx + side * u, dy - u, u, u, TINT[hue].l, 0.8)
  }

  // dør med karm
  const dw = Math.max(2, 2)
  const dh = Math.max(2, Math.round(h * 0.62))
  const ddx = x0 + Math.round(w * 0.5) - Math.round(dw / 2)
  p.rect(ddx - 1, y0 + h - dh - 1, dw + 2, dh + 1, TINT[hue].d, 0.55)
  p.rect(ddx, y0 + h - dh, dw, dh, P.night)

  // ildlys fra glugger når det er arbeid her
  const on = lit > 0.35
  const gs = 1
  for (const gx of [0.22, 0.74]) {
    const wx = x0 + Math.round(w * gx)
    const wy = y0 + Math.round(h * 0.3)
    p.rect(wx, wy, gs, gs, on ? '#ffc46b' : P.night, on ? 1 : 0.7)
    if (on) p.rect(wx - 1, wy - 1, gs + 2, gs + 2, '#ff9a3c', 0.22)
  }
}

/** Palisade av spisse stokker rundt landsbyen. */
function palisade(p: Pix, cx: number, cy: number, rx: number, ry: number, hue: number, _S: number) {
  const u = 1
  const hgt = 4
  const n = Math.max(10, Math.round(rx / 2.4))
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    const px = Math.round(cx + Math.cos(a) * rx * 0.92)
    const py = Math.round(cy + Math.sin(a) * ry * 0.92)
    if (Math.sin(a) < -0.35) continue
    p.rect(px, py - hgt, u, hgt, P.rock2, 0.85)
    p.rect(px, py - hgt - u, u, u, TINT[hue].d, 0.7)
  }
}

/** Langskip fortøyd ved stranden. */
function ship(p: Pix, x: number, y: number, hue: number, _S: number) {
  const u = 1
  const L = 14
  const x0 = Math.round(x - L / 2)
  // skrog
  for (let r = 0; r < 3; r++) {
    const ins = Math.round(r * L * 0.1)
    p.rect(x0 + ins, y + r, L - ins * 2, 1, r === 0 ? P.wallLit : P.wall)
  }
  // stevn i begge ender
  p.rect(x0, y - u * 2, u, u * 2, P.wall)
  p.rect(x0 + L - u, y - u * 2, u, u * 2, P.wall)
  p.rect(x0, y - u * 3, u, u, TINT[hue].m)
  // mast og seil
  const mx = x0 + Math.round(L / 2)
  p.rect(mx, y - 7, u, 7, P.rock2)
  p.rect(mx - 3, y - 6, 5, 4, TINT[hue].m, 0.85)
  p.rect(mx - 3, y - 6, 5, u, TINT[hue].l, 0.6)
}

/** Hovedøya med fyrtårnet der Axey står. */
export function home(p: Pix, cx: number, cy: number, t: number, busy: boolean, S = 1) {
  const T = TINT[0]
  const R = 30, ry = 15

  // klippen: samme språk som agentøyene — sprukne søyler, taggete bunn
  const deep = 52
  const cols = 20
  const colEnd: number[] = []
  for (let c = 0; c < cols; c++) colEnd.push(0.52 + rnd(7000 + c * 37) * 0.48)
  for (let j = 0; j < deep; j++) {
    const k = j / deep
    const grip = Math.min(1, j / (ry * 0.85))
    const taper = 1 - k * k * 0.72
    const wf = 1 - (1 - taper) * grip
    const w = Math.max(1, ((R * wf) | 0))
    const y = cy + j
    for (let x = -w; x <= w; x++) {
      const ci = Math.min(cols - 1, (((x + w) / Math.max(1, w * 2)) * cols) | 0)
      if (k > colEnd[ci]) continue
      const seam = ((x + 3) % 8 === 0)
      const west = x < -w * 0.28
      if (seam) p.px(cx + x, y, P.night, 0.72)
      else p.dith(cx + x, y, west ? P.rock1 : P.rock0, west ? P.rock2 : P.rock1, west ? 0.5 : 0.26)
    }
    if (k < colEnd[0]) p.px(cx - w, y, P.stoneLit, 0.55)
    if (k < colEnd[cols - 1]) p.px(cx + w, y, P.ink2, 0.8)
  }

  // jordlag mellom gress og stein
  for (let j = 0; j < 4; j++) {
    const w = ((R * (1 - j * 0.04)) | 0)
    for (let x = -w; x <= w; x++)
      p.dith(cx + x, cy - 1 + j, j === 0 ? P.stoneLit : P.rock1, j === 0 ? P.rock2 : P.rock0, 0.5)
  }

  // gresstopp med uregelmessig kant — som agentøyene
  for (let dy = -ry; dy <= ry; dy++) {
    const f = 1 - (dy * dy) / (ry * ry)
    if (f <= 0) continue
    const notch = (rnd(7700 + dy * 19) - 0.5) * R * 0.12
    const w = Math.max(1, (Math.sqrt(f) * R + notch) | 0)
    for (let x = -w; x <= w; x++) {
      const north = dy < -ry * 0.15
      p.dith(cx + x, cy + dy, north ? P.grassLit : P.grass, north ? P.grass : P.grassDark, 0.5)
    }
    p.px(cx - w, cy + dy, P.grassLit, 0.5)
    p.px(cx + w, cy + dy, P.ink2, 0.55)
  }

  // varm sti rundt fyret
  for (let i = 0; i < 7; i++) {
    const a = rnd(7100 + i * 31) * Math.PI * 2
    const d = 0.3 + rnd(7200 + i * 17) * 0.4
    const px = (cx + Math.cos(a) * R * d) | 0
    const py = (cy + Math.sin(a) * ry * d) | 0
    for (let q = 0; q < 4; q++) p.px(px + q, py, T.m, 0.28)
  }

  tower(p, cx - 2, cy - 3, t, busy)
  axey(p, cx + 16, cy + 5, t, busy, S)
}

/** Fyrtårnet — 13 piksler bredt, lanterne som pulser. */
function tower(p: Pix, x: number, y: number, t: number, busy: boolean) {
  const T = TINT[0]
  const H = 26
  for (let j = 0; j < H; j++) {
    const w = 6 - ((j / H) * 2.2) | 0
    for (let i = -w; i <= w; i++) {
      // vestsiden lysere, striper hver 6. rad
      const stripe = (j % 7 === 0 || j % 7 === 1) && j > 3
      p.px(x + i, y - j, stripe ? (i < 0 ? P.rock2 : P.rock1) : i < -w * 0.3 ? P.rock2 : P.rock1)
    }
  }
  // lanterne
  const on = busy ? (Math.sin(t * 0.005) > -0.4 ? T.g : T.l) : T.m
  for (let j = 0; j < 5; j++) for (let i = -4; i <= 4; i++) p.px(x + i, y - H - j, on)
  for (let i = -5; i <= 5; i++) p.px(x + i, y - H - 5, P.rock2)
  // tak
  for (let j = 0; j < 3; j++) {
    const w = 5 - j * 2
    for (let i = -w; i <= w; i++) p.px(x + i, y - H - 6 - j, P.rock0)
  }
  // strålen
  if (busy) {
    const a = (t * 0.0009) % (Math.PI * 2)
    for (let r = 8; r < 120; r += 2) {
      const px = x + Math.cos(a) * r
      const py = y - H - 2 + Math.sin(a) * r * 0.5
      if (r % 6 < 3) p.px(px, py, T.l, 0.35 * (1 - r / 120))
    }
  }
}

/** Axey — ekte sprite ved foten av fyrtårnet. */
function axey(p: Pix, x: number, y: number, t: number, busy: boolean, _S = 1) {
  const bob = Math.sin(t * (busy ? 0.004 : 0.0018)) > 0 ? 0 : 1
  sprite(p, 'axey', x, y - bob, 0.42, busy ? 1 : 0.92)
}

/** Hengebru med planker som forfaller når øya blir kald. */
export function bridge(
  p: Pix, ax: number, ay: number, bx: number, by: number,
  hue: number, cold: number, live: boolean, t: number,
) {
  const T = TINT[hue % TINT.length]
  const seg = 22
  const pt = (k: number) => ({
    x: ax + (bx - ax) * k,
    y: ay + (by - ay) * k - Math.sin(k * Math.PI) * 9,
  })
  for (let i = 0; i < seg; i++) {
    if (cold > 0.6 && i % 3 === 1) continue
    const a = pt(i / seg)
    const b = pt((i + 0.62) / seg)
    p.line(a.x, a.y, b.x, b.y, cold > 0.4 ? T.d : T.m)
    p.line(a.x, a.y - 1, b.x, b.y - 1, cold > 0.4 ? T.m : T.l)
  }
  if (live) {
    const k = (t * 0.0004) % 1
    const q = pt(k)
    p.px(q.x, q.y - 2, T.g)
    p.px(q.x + 1, q.y - 2, T.l)
    p.px(q.x, q.y - 3, T.l)
  }
}

/** Bro mellom to øyer: fundament, buet gangbane med planker, rekkverk. */
export function span(
  p: Pix, ax: number, ay: number, bx: number, by: number,
  hue: number, cold: number, live: boolean, t: number,
) {
  const T = TINT[hue % TINT.length]
  const dx = bx - ax, dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 4) return
  const n = Math.max(8, (len / 3) | 0)
  const sag = Math.min(26, len * 0.09)

  const at = (k: number) => ({
    x: ax + dx * k,
    y: ay + dy * k + Math.sin(k * Math.PI) * sag,
  })

  // brofester der broen møter øyene
  for (const [fx, fy] of [[ax, ay], [bx, by]] as const) {
    p.rect(fx - 4, fy - 2, 9, 5, P.rock1)
    p.rect(fx - 4, fy - 3, 9, 1, P.stoneLit, 0.6)
    p.rect(fx - 3, fy + 3, 7, 2, P.ink2, 0.7)
  }

  // gangbane: planker på tvers, med mellomrom
  for (let i = 0; i <= n; i++) {
    const k = i / n
    const c = at(k)
    const x = Math.round(c.x), y = Math.round(c.y)
    // forfall: manglende planker når øya er kald
    if (cold > 0.5 && i % 3 === 1 && i > 1 && i < n - 1) continue

    const w = 4
    // skygge under
    p.rect(x - w, y + 1, w * 2 + 1, 1, P.ink2, 0.55)
    // planke
    for (let q = -w; q <= w; q++) {
      const edge = Math.abs(q) >= w - 1
      p.px(x + q, y, edge ? P.wall : P.woodLit, edge ? 0.9 : 0.75 - cold * 0.25)
    }
    // rekkverksstolper med jevne mellomrom
    if (i % 3 === 0) {
      p.px(x - w, y - 2, P.wall, 0.85)
      p.px(x - w, y - 1, P.wall, 0.85)
      p.px(x + w, y - 2, P.wall, 0.85)
      p.px(x + w, y - 1, P.wall, 0.85)
    }
    // håndlist
    p.px(x - w, y - 3, P.woodLit, 0.5 - cold * 0.2)
    p.px(x + w, y - 3, P.woodLit, 0.5 - cold * 0.2)
  }

  // lykt som vandrer over broen når agenten jobber
  if (live) {
    const k = ((t * 0.00018) % 1)
    const c = at(k)
    const x = Math.round(c.x), y = Math.round(c.y) - 4
    p.px(x, y, T.l, 1)
    p.px(x - 1, y, T.m, 0.6)
    p.px(x + 1, y, T.m, 0.6)
    p.px(x, y - 1, T.m, 0.5)
  }
}
