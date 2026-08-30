import { iso, rnd, type Isle } from './world'

type C = CanvasRenderingContext2D
const col = (h: number, s: number, l: number, a = 1) => `hsla(${h} ${s}% ${l}% / ${a})`

/** Havet med langsomme dønninger. */
export function sea(c: C, w: number, h: number, cam: { x: number; y: number; z: number }, t: number) {
  const g = c.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#050a12')
  g.addColorStop(1, '#0a1420')
  c.fillStyle = g
  c.fillRect(0, 0, w, h)

  c.save()
  c.globalAlpha = 0.5
  for (let i = 0; i < 90; i++) {
    const sx = ((i * 137.5) % 100) / 100
    const sy = ((i * 71.3) % 100) / 100
    const px = ((sx * w * 2 - cam.x * 0.02) % w + w) % w
    const py = ((sy * h * 2 - cam.y * 0.02) % h + h) % h
    const tw = 0.4 + 0.6 * Math.sin(t * 0.0006 + i)
    c.fillStyle = col(200, 40, 70, 0.5 * tw)
    c.fillRect(px, py, 1, 1)
  }
  c.restore()
}

/** Én isometrisk øy: fjell, kant, gress, hus. */
export function isle(c: C, o: Isle, t: number, sel: boolean, hover: boolean) {
  const { sx, sy } = iso(o.x, o.y)
  const R = o.size
  const lit = o.mood === 'jobber' ? 1 : o.mood === 'nettopp' ? 0.7 : o.mood === 'venter' ? 0.4 : 0.15
  const dim = 1 - o.cold * 0.55

  c.save()
  c.translate(sx, sy)

  // undersiden — fjell som henger under
  c.fillStyle = col(o.hue, 12, 8 * dim)
  c.beginPath()
  c.moveTo(-R, 0)
  c.lineTo(R, 0)
  c.lineTo(R * 0.2, R * 1.5)
  c.lineTo(-R * 0.3, R * 1.2)
  c.closePath()
  c.fill()

  // jordkant
  c.fillStyle = col(o.hue, 14, 14 * dim)
  c.beginPath()
  c.ellipse(0, R * 0.12, R, R * 0.55, 0, 0, Math.PI * 2)
  c.fill()

  // topp
  c.fillStyle = col(o.hue, 18, 20 * dim + lit * 4)
  c.beginPath()
  c.ellipse(0, 0, R, R * 0.5, 0, 0, Math.PI * 2)
  c.fill()

  // kant mot lys
  c.strokeStyle = col(o.hue, 45, 30 + lit * 25, 0.5 + lit * 0.4)
  c.lineWidth = 1.5
  c.stroke()

  if (sel || hover) {
    c.strokeStyle = col(o.hue, 70, 60, sel ? 0.9 : 0.45)
    c.lineWidth = 2
    c.beginPath()
    c.ellipse(0, 0, R + 6, R * 0.5 + 4, 0, 0, Math.PI * 2)
    c.stroke()
  }

  // strukturer på øya
  const n = Math.min(14, o.runs)
  for (let i = 0; i < n; i++) {
    const a = rnd(o.seed + i * 7) * Math.PI * 2
    const d = R * (0.18 + rnd(o.seed + i * 13) * 0.6)
    hut(c, Math.cos(a) * d, Math.sin(a) * d * 0.5, R * 0.17, o.hue, lit, dim, t, o.seed + i)
  }

  c.restore()
}

/** Et lite hus — lyser når agenten jobber. */
function hut(c: C, x: number, y: number, s: number, hue: number, lit: number, dim: number, t: number, seed: number) {
  c.save()
  c.translate(x, y)
  const h = s * (1.1 + rnd(seed) * 0.6)

  // vegg
  c.fillStyle = col(hue, 10, 13 * dim)
  c.fillRect(-s * 0.5, -h, s, h)
  // solside
  c.fillStyle = col(hue, 12, 18 * dim)
  c.fillRect(-s * 0.5, -h, s * 0.35, h)
  // tak
  c.fillStyle = col(hue, 20, 24 * dim)
  c.beginPath()
  c.moveTo(-s * 0.62, -h)
  c.lineTo(0, -h - s * 0.55)
  c.lineTo(s * 0.62, -h)
  c.closePath()
  c.fill()

  // vindu
  if (lit > 0.2) {
    const fl = 0.75 + 0.25 * Math.sin(t * 0.003 + seed)
    c.fillStyle = col(hue, 85, 55 + lit * 20, lit * fl)
    c.fillRect(-s * 0.16, -h * 0.66, s * 0.32, h * 0.34)
    c.shadowColor = col(hue, 90, 60, lit * 0.5)
    c.shadowBlur = 10
    c.fillRect(-s * 0.16, -h * 0.66, s * 0.32, h * 0.34)
    c.shadowBlur = 0
  }
  c.restore()
}
