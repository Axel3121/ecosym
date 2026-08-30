import { iso } from './world'

type C = CanvasRenderingContext2D
const col = (h: number, s: number, l: number, a = 1) => `hsla(${h} ${s}% ${l}% / ${a})`
const CY = 186

/** Hovedøya: fyrtårnet der Axey står. */
export function home(c: C, t: number, busy: boolean) {
  const { sx, sy } = iso(0, 0)
  const R = 88
  c.save()
  c.translate(sx, sy)

  // fjell under
  c.fillStyle = col(CY, 14, 7)
  c.beginPath()
  c.moveTo(-R, 0)
  c.lineTo(R, 0)
  c.lineTo(R * 0.25, R * 1.9)
  c.lineTo(-R * 0.35, R * 1.5)
  c.closePath()
  c.fill()

  // kant + topp
  c.fillStyle = col(CY, 16, 13)
  c.beginPath()
  c.ellipse(0, R * 0.14, R, R * 0.55, 0, 0, Math.PI * 2)
  c.fill()
  c.fillStyle = col(CY, 20, 19)
  c.beginPath()
  c.ellipse(0, 0, R, R * 0.5, 0, 0, Math.PI * 2)
  c.fill()
  c.strokeStyle = col(CY, 55, 40, 0.7)
  c.lineWidth = 1.5
  c.stroke()

  tower(c, 0, -4, t, busy)
  axey(c, 20, 8, t, busy)
  c.restore()
}

/** Fyrtårnet — strålen sveiper når noe kjører. */
function tower(c: C, x: number, y: number, t: number, busy: boolean) {
  c.save()
  c.translate(x, y)
  const H = 76
  const W = 20

  c.fillStyle = col(CY, 10, 15)
  c.beginPath()
  c.moveTo(-W, 0)
  c.lineTo(-W * 0.6, -H)
  c.lineTo(W * 0.6, -H)
  c.lineTo(W, 0)
  c.closePath()
  c.fill()
  c.fillStyle = col(CY, 12, 21)
  c.beginPath()
  c.moveTo(-W, 0)
  c.lineTo(-W * 0.6, -H)
  c.lineTo(-W * 0.1, -H)
  c.lineTo(-W * 0.3, 0)
  c.closePath()
  c.fill()

  // lanterne
  const p = busy ? 0.8 + 0.2 * Math.sin(t * 0.006) : 0.45
  c.fillStyle = col(CY, 90, 62, p)
  c.fillRect(-W * 0.75, -H - 13, W * 1.5, 13)
  c.shadowColor = col(CY, 95, 65, p * 0.8)
  c.shadowBlur = 26
  c.fillRect(-W * 0.75, -H - 13, W * 1.5, 13)
  c.shadowBlur = 0

  // sveipende stråle
  if (busy) {
    const a = (t * 0.0009) % (Math.PI * 2)
    c.save()
    c.globalCompositeOperation = 'lighter'
    c.translate(0, -H - 6)
    c.rotate(a)
    const g = c.createLinearGradient(0, 0, 340, 0)
    g.addColorStop(0, col(CY, 90, 60, 0.28))
    g.addColorStop(1, col(CY, 90, 60, 0))
    c.fillStyle = g
    c.beginPath()
    c.moveTo(0, 0)
    c.lineTo(340, -34)
    c.lineTo(340, 34)
    c.closePath()
    c.fill()
    c.restore()
  }
  c.restore()
}

/** Axey selv — kappe, visir, drone. */
function axey(c: C, x: number, y: number, t: number, busy: boolean) {
  c.save()
  c.translate(x, y)
  const s = 1.5
  const br = Math.sin(t * (busy ? 0.004 : 0.0018)) * 0.6

  // kappe
  c.fillStyle = '#14181f'
  c.beginPath()
  c.moveTo(-4 * s, -2)
  c.lineTo(-3 * s, -13 * s + br)
  c.lineTo(3 * s, -13 * s + br)
  c.lineTo(4 * s, -2)
  c.closePath()
  c.fill()
  // cyan kant
  c.strokeStyle = col(CY, 80, 55, 0.8)
  c.lineWidth = 1
  c.stroke()

  // hode + visir
  c.fillStyle = '#1b2129'
  c.fillRect(-2.6 * s, -19 * s + br, 5.2 * s, 6 * s)
  c.fillStyle = col(CY, 95, 62, busy ? 0.95 : 0.6)
  c.fillRect(-2 * s, -17.5 * s + br, 4 * s, 2 * s)
  c.shadowColor = col(CY, 95, 62, 0.7)
  c.shadowBlur = 8
  c.fillRect(-2 * s, -17.5 * s + br, 4 * s, 2 * s)
  c.shadowBlur = 0

  // drone
  const dx = Math.cos(t * 0.0015) * 9 * s
  const dy = -22 * s + Math.sin(t * 0.0022) * 3
  c.fillStyle = col(CY, 70, 45)
  c.fillRect(dx - 1.6, dy, 3.2, 2.2)
  c.fillStyle = col(CY, 95, 65)
  c.fillRect(dx - 0.5, dy + 0.6, 1, 1)
  c.restore()
}

/** Bru fra en øy inn til hovedøya. Forfaller med kulde. */
export function bridge(c: C, ix: number, iy: number, hue: number, cold: number, live: boolean, t: number) {
  const a = iso(ix, iy)
  const b = iso(0, 0)
  const seg = 26
  const pt = (k: number) => ({
    x: a.sx + (b.sx - a.sx) * k,
    y: a.sy + (b.sy - a.sy) * k - Math.sin(k * Math.PI) * 22,
  })
  c.save()

  // taukabler
  c.strokeStyle = col(hue, 30, 26, 0.5 - cold * 0.35)
  c.lineWidth = 1
  for (const off of [-4, 4]) {
    c.beginPath()
    for (let i = 0; i <= seg; i++) {
      const p = pt(i / seg)
      i ? c.lineTo(p.x, p.y + off - 5) : c.moveTo(p.x, p.y + off - 5)
    }
    c.stroke()
  }

  // planker med tydelig mellomrom
  for (let i = 0; i < seg; i++) {
    const k = (i + 0.15) / seg
    if (cold > 0.55 && i % 3 === 1) continue
    const p = pt(k)
    const q = pt((i + 0.72) / seg)
    const ang = Math.atan2(q.y - p.y, q.x - p.x)
    const len = Math.hypot(q.x - p.x, q.y - p.y)
    c.save()
    c.translate(p.x, p.y)
    c.rotate(ang)
    // skygge under planken
    c.fillStyle = 'rgba(0,0,0,0.55)'
    c.fillRect(0, -5, len, 11)
    // selve planken, lys nok til å skille seg fra havet
    c.fillStyle = col(hue, 30, 42 - cold * 16, 0.95 - cold * 0.35)
    c.fillRect(0, -4.5, len, 9)
    // lys overkant
    c.fillStyle = col(hue, 45, 60 - cold * 20, 0.8 - cold * 0.3)
    c.fillRect(0, -4.5, len, 2.5)
    c.restore()
  }

  // lykter langs brua når agenten jobber
  if (live) {
    for (let i = 2; i < seg; i += 6) {
      const p = pt(i / seg)
      const fl = 0.6 + 0.4 * Math.sin(t * 0.004 + i)
      c.fillStyle = col(hue, 90, 68, fl)
      c.shadowColor = col(hue, 95, 70, 0.8)
      c.shadowBlur = 10
      c.beginPath()
      c.arc(p.x, p.y - 8, 1.8, 0, Math.PI * 2)
      c.fill()
      c.shadowBlur = 0
    }
    const k = (t * 0.0004) % 1
    const p = pt(k)
    c.fillStyle = col(hue, 95, 75)
    c.shadowColor = col(hue, 95, 75, 0.9)
    c.shadowBlur = 14
    c.beginPath()
    c.arc(p.x, p.y - 7, 3, 0, Math.PI * 2)
    c.fill()
    c.shadowBlur = 0
  }
  c.restore()
}
