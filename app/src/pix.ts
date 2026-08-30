/**
 * Pikselmotor. Alt tegnes på en liten buffer (ca. 400x225) og skaleres
 * opp med harde kanter. Ingen anti-aliasing, ingen gradienter — bare piksler
 * fra en fast palett.
 */

export const PW = 440
export const PH = 260

/** Fast palett. Begrenset med vilje — det er det som gjør pixel-art lesbar. */
export const P = {
  void0: '#277abb',
  void1: '#5aa3d2',
  void2: '#9ed2e6',
  cloud: '#b4d4df',
  cloudLit: '#f4f1da',
  cloudDark: '#83b6d0',
  ink2: '#2b2119',
  stoneLit: '#99a3a0',
  woodLit: '#be8d42',
  grass: '#81902b',
  grassLit: '#bac451',
  grassDark: '#3f4e21',
  star: '#e8dcc4',
  rock0: '#283337',
  rock1: '#3d4b4c',
  rock2: '#665038',
  ink: '#050709',
  tx: '#f0e8dc',
  night: '#1d2b31',
  wall: '#4a321d',
  wallLit: '#825a2a',
  tx2: '#b5a894',
}

/** Fem øyfarger: mørk, mid, lys, glød. */
export const TINT = [
  { d: '#4a2a10', m: '#9c5a1e', l: '#e8963c', g: '#ffc87a' },  // rav — Axey
  { d: '#4a1a1a', m: '#96382f', l: '#d9634f', g: '#f0a08c' },  // rust
  { d: '#3a3410', m: '#7a6c1c', l: '#c9b544', g: '#e8dc92' },  // messing
  { d: '#2d1a3a', m: '#5c3a72', l: '#a37cc4', g: '#cfb5e0' },  // plomme
  { d: '#14351f', m: '#2d6b3f', l: '#6fb87c', g: '#a8dcb0' },  // mose
  { d: '#3a2410', m: '#7a4c1e', l: '#c98a4a', g: '#e8bb92' },  // kobber
]

/** 4x4 Bayer — brukes til dithering mellom to farger. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]

export class Pix {
  d: Uint8ClampedArray
  img: ImageData
  c: CanvasRenderingContext2D
  constructor(c: CanvasRenderingContext2D) {
    this.c = c
    this.img = c.createImageData(PW, PH)
    this.d = this.img.data
  }

  clear(hex: string) {
    const [r, g, b] = rgb(hex)
    for (let i = 0; i < this.d.length; i += 4) {
      this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255
    }
  }

  /** Én piksel. Alt annet bygger på denne. */
  px(x: number, y: number, hex: string, a = 1) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= PW || y >= PH) return
    const i = (y * PW + x) * 4
    const [r, g, b] = rgb(hex)
    if (a >= 1) {
      this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b
    } else {
      this.d[i] += (r - this.d[i]) * a
      this.d[i + 1] += (g - this.d[i + 1]) * a
      this.d[i + 2] += (b - this.d[i + 2]) * a
    }
    this.d[i + 3] = 255
  }

  /** Piksel med dithering — to farger blandet via Bayer-mønster. */
  dith(x: number, y: number, a: string, b: string, mix: number) {
    const t = BAYER[(y | 0) & 3][(x | 0) & 3] / 16
    this.px(x, y, mix > t ? b : a)
  }

  rgb(x: number, y: number, r: number, g: number, b: number) {
    if (x < 0 || y < 0 || x >= this.img.width || y >= this.img.height) return
    const i = ((y | 0) * this.img.width + (x | 0)) * 4
    this.d[i] = r; this.d[i + 1] = g; this.d[i + 2] = b; this.d[i + 3] = 255
  }

  rect(x: number, y: number, w: number, h: number, hex: string, a = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, hex, a)
  }

  /** Isometrisk ellipse fylt linje for linje — grunnformen for en øy. */
  disc(cx: number, cy: number, rx: number, ry: number, hex: string) {
    for (let y = -ry; y <= ry; y++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)))
      for (let x = -w; x <= w; x++) this.px(cx + x, cy + y, hex)
    }
  }

  /** Samme, men dithret mot en annen farge — gir tekstur i stedet for flatt fyll. */
  discDith(cx: number, cy: number, rx: number, ry: number, a: string, b: string, mix: number) {
    for (let y = -ry; y <= ry; y++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)))
      for (let x = -w; x <= w; x++) this.dith(cx + x, cy + y, a, b, mix)
    }
  }

  /** Kanten av en ellipse — 1px, hard. */
  discEdge(cx: number, cy: number, rx: number, ry: number, hex: string) {
    let prev = -1
    for (let y = -ry; y <= ry; y++) {
      const w = Math.floor(rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2)))
      this.px(cx - w, cy + y, hex)
      this.px(cx + w, cy + y, hex)
      if (prev >= 0 && Math.abs(w - prev) > 1) {
        const lo = Math.min(w, prev), hi = Math.max(w, prev)
        for (let k = lo; k <= hi; k++) {
          this.px(cx - k, cy + y, hex)
          this.px(cx + k, cy + y, hex)
        }
      }
      prev = w
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, hex: string) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
    let e = dx - dy
    for (;;) {
      this.px(x0, y0, hex)
      if (x0 === x1 && y0 === y1) break
      const e2 = 2 * e
      if (e2 > -dy) { e -= dy; x0 += sx }
      if (e2 < dx) { e += dx; y0 += sy }
    }
  }

  flush() {
    this.c.putImageData(this.img, 0, 0)
  }
}

const cache: Record<string, [number, number, number]> = {}
function rgb(hex: string): [number, number, number] {
  const c = cache[hex]
  if (c) return c
  const n = parseInt(hex.slice(1), 16)
  return (cache[hex] = [(n >> 16) & 255, (n >> 8) & 255, n & 255])
}
