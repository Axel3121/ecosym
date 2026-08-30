import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useTracks, type Run } from './store'
import { type Isle, type Mood } from './world'
import { Pix, PW, PH } from './pix'
import { iso, sky, isle, home, span, loadSprites } from './scene'

const dur = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}t ${Math.round((s % 3600) / 60)}m`)
const ago = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min siden` : s < 86400 ? `${Math.round(s / 3600)} t siden` : `${Math.round(s / 86400)} d siden`)

/** Forteller hva som har skjedd på øya, i stedet for å ramse opp tall. */
function tell(rs: Run[]) {
  if (!rs.length) return 'ingen har bodd her ennå'
  const live = rs.filter((r) => r.state === 'running').length
  const t = rs.reduce((s, r) => s + (r.dur ?? 0), 0)
  const last = Math.max(...rs.map((r) => (r.started ?? 0) + (r.dur ?? 0)))
  const since = Date.now() / 1000 - last
  if (live) return `${live} i arbeid akkurat nå · ${dur(t)} totalt`
  return `${rs.length} kjøringer · ${dur(t)} · sist ${ago(since)}`
}

export default function App() {
  const cv = useRef<HTMLCanvasElement>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  useEffect(() => { hovRef.current = hover }, [hover])
  const [adding, setAdding] = useState(false)
  const { tracks, add, runsFor, ingest, seed } = useTracks()

  const hovRef = useRef<string | null>(null)
  const cam = useRef({ x: 0, y: 0, z: 1, tx: 0, ty: 0, tz: 1, fly: false })
  const drag = useRef<{ on: boolean; px: number; py: number }>({ on: false, px: 0, py: 0 })
  const isles = useRef<Isle[]>([])

  useEffect(() => {
    const load = () =>
      fetch('/api/state')
        .then((r) => r.json())
        .then((d) => { setRuns(d.runs ?? []); seed(); ingest(d.runs ?? []) })
        .catch(() => {})
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [ingest, seed])

  // bygg/oppdater øyene fra ekte tilstand
  useEffect(() => {
    const now = Date.now() / 1000
    isles.current = tracks.map((tr, i) => {
      const rs = runsFor(tr.id, runs)
      const live = rs.some((r) => r.state === 'running')
      const last = Math.max(0, ...rs.map((r) => (r.started ?? 0) + (r.dur ?? 0)))
      const since = last ? now - last : Infinity
      const mood: Mood = live ? 'jobber'
        : !rs.length ? 'ny'
        : since < 3600 ? 'nettopp'
        : since < 86400 ? 'venter'
        : 'sover'
      const cold = !rs.length ? 0.8 : Math.min(1, since / (86400 * 3))
      const dist = 160 + cold * 95
      const angle = (i / Math.max(1, tracks.length)) * Math.PI * 2 - Math.PI / 2
      const prev = isles.current.find((o) => o.id === tr.id)
      const tx = Math.cos(angle) * dist
      const ty = Math.sin(angle) * dist
      return {
        id: tr.id, name: tr.name, hue: 0, hueIdx: i % 6, mood,
        runs: rs.length, cold, dist, angle,
        x: prev?.x ?? tx, y: prev?.y ?? ty, tx, ty,
        size: 34 + Math.min(18, rs.length * 1.5), seed: i * 977 + 13,
      }
    })
  }, [tracks, runs, runsFor])

  // verdensmotoren
  useEffect(() => {
    const el = cv.current!
    const c = el.getContext('2d')!
    let raf = 0
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches

    loadSprites(() => {})
    let pix: Pix | null = null
    let buf: HTMLCanvasElement | null = null

    const tick = (t: number) => {
      const W = el.clientWidth, H = el.clientHeight
      if (el.width !== W || el.height !== H) { el.width = W; el.height = H }

      if (!buf) {
        buf = document.createElement('canvas')
        buf.width = PW; buf.height = PH
        pix = new Pix(buf.getContext('2d')!)
      }
      const p = pix!

      const k = cam.current
      k.z += (k.tz - k.z) * 0.14
      if (Math.abs(k.tz - k.z) < 0.01) k.z = k.tz
      if (k.fly) {
        k.x += (k.tx - k.x) * 0.09
        k.y += (k.ty - k.y) * 0.09
        if (Math.hypot(k.tx - k.x, k.ty - k.y) < 1.5 && Math.abs(k.tz - k.z) < 0.02) k.fly = false
      }

      const tt = calm ? 0 : t
      sky(p, k.x, k.y, tt)

      // verdenskoordinat -> pikselbuffer
      const ox = PW / 2 + (k.x * PW) / W
      const oy = PH / 2 + (k.y * PH) / H
      const s = k.z
      const put = (wx: number, wy: number) => {
        const q = iso(wx, wy)
        return { x: ox + q.sx * s, y: oy + q.sy * s }
      }

      const list = [...isles.current].sort((a, b) => iso(a.x, a.y).sy - iso(b.x, b.y).sy)
      for (const o of list) {
        o.x += (o.tx - o.x) * 0.04
        o.y += (o.ty - o.y) * 0.04
      }

      const hp = put(0, 0)
      const busyNow = isles.current.some((o) => o.mood === 'jobber')

      // bruer bak — tegnet i piksler så de hører til verdenen
      for (const o of list) {
        const q = put(o.x, o.y)
        span(p, q.x, q.y, hp.x, hp.y, o.hueIdx, o.cold, o.mood === 'jobber', tt)
      }
      home(p, hp.x, hp.y, tt, busyNow, 1)
      for (const o of list) {
        const q = put(o.x, o.y)
        isle(p, q.x, q.y, { ...o, hue: o.hueIdx, size: o.size * s }, tt, sel === o.id, 1)
      }
      p.flush()

      // skaler opp med harde kanter
      c.imageSmoothingEnabled = false
      c.clearRect(0, 0, W, H)
      const fit = Math.max(1, Math.floor(Math.min(W / PW, H / PH)))
      const dw = PW * fit, dh = PH * fit
      c.drawImage(buf, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh)

      // navn vises bare på øya du peker på eller har valgt
      c.font = '600 12px ui-monospace, monospace'
      c.textAlign = 'center'
      for (const o of list) {
        if (o.id !== sel && o.id !== hovRef.current) continue
        const q = put(o.x, o.y)
        c.fillStyle = 'rgba(240,232,220,.92)'
        c.fillText(o.name, (q.x / PW) * W, (q.y / PH) * H + o.size * s * (H / PH) * 0.5 + 20)
      }

      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [sel, hover])

  // fly kameraet inn til valgt øy
  useEffect(() => {
    const k = cam.current
    if (!sel) return
    const o = isles.current.find((i) => i.id === sel)
    if (!o) return
    const p = iso(o.tx, o.ty)
    const z = 3
    // sikt litt til venstre så panelet ikke dekker øya
    Object.assign(k, { tx: -p.sx * z - 120, ty: -p.sy * z + 40, tz: z, fly: true })
  }, [sel])

  // pek/dra/zoom
  const hit = (mx: number, my: number) => {
    const el = cv.current!
    const W = el.clientWidth, H = el.clientHeight
    const wx = (mx - W / 2 - cam.current.x) / cam.current.z
    const wy = (my - H / 2 - cam.current.y) / cam.current.z
    for (const o of isles.current) {
      const p = iso(o.x, o.y)
      if (Math.hypot(wx - p.sx, (wy - p.sy) * 2) < o.size) return o.id
    }
    return null
  }

  const picked = tracks.find((t) => t.id === sel) ?? null
  const pr = picked ? runsFor(picked.id, runs) : []
  const busy = isles.current.filter((o) => o.mood === 'jobber').length

  return (
    <div className="h-screen flex flex-col bg-bg text-tx overflow-hidden select-none">
      <header className="flex items-center gap-3 px-5 py-3 border-b border-line z-10">
        <span className="text-[22px] font-semibold tracking-tight">axey</span>
        <span className="text-[11px] text-tx3">
          {!tracks.length ? 'ingen øyer ennå'
            : busy ? `${busy} i arbeid`
            : `${tracks.length} øyer · alt stille`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => { cam.current.fly = false; cam.current.tz = Math.max(1, Math.round(cam.current.tz) - 1) }}
            className="w-7 h-7 rounded border border-line hover:border-white/25 text-[13px]">−</button>
          <span className="text-[11px] font-mono text-tx3 w-10 text-center">
            {Math.round(cam.current.z * 100)}%
          </span>
          <button onClick={() => { cam.current.fly = false; cam.current.tz = Math.min(4, Math.round(cam.current.tz) + 1) }}
            className="w-7 h-7 rounded border border-line hover:border-white/25 text-[13px]">+</button>
          <button onClick={() => { setSel(null); Object.assign(cam.current, { tx: 0, ty: 0, tz: 1, fly: true }) }}
            className="ml-1 px-2.5 h-7 rounded border border-line hover:border-white/25 text-[11px]">hjem</button>
          <button onClick={() => setAdding(true)}
            className="ml-2 px-3 h-7 rounded bg-cy/15 border border-cy/40 text-cy text-[11px] hover:bg-cy/25">
            + ny øy
          </button>
        </div>
      </header>

      <div className="flex-1 relative">
        <canvas
          ref={cv}
          className="absolute inset-0 w-full h-full"
          style={{ cursor: hover ? 'pointer' : drag.current.on ? 'grabbing' : 'grab' }}
          onPointerDown={(e) => { drag.current = { on: true, px: e.clientX, py: e.clientY } }}
          onPointerUp={(e) => {
            const moved = Math.hypot(e.clientX - drag.current.px, e.clientY - drag.current.py)
            drag.current.on = false
            if (moved < 4) {
              const r = cv.current!.getBoundingClientRect()
              setSel(hit(e.clientX - r.left, e.clientY - r.top))
            }
          }}
          onPointerLeave={() => { drag.current.on = false; setHover(null) }}
          onPointerMove={(e) => {
            const r = cv.current!.getBoundingClientRect()
            if (drag.current.on) {
              cam.current.x += e.clientX - drag.current.px
              cam.current.y += e.clientY - drag.current.py
              drag.current.px = e.clientX
              drag.current.py = e.clientY
            } else setHover(hit(e.clientX - r.left, e.clientY - r.top))
          }}
          onWheel={(e) => {
            const k = cam.current
            const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
            const mx = e.clientX - r.left - r.width / 2
            const my = e.clientY - r.top - r.height / 2
            const z0 = k.tz
            const z1 = Math.max(1, Math.min(4, Math.round(z0) + (e.deltaY < 0 ? 1 : -1)))
            if (z1 === z0) return
            // hold punktet under pekeren i ro mens verdenen vokser
            const f = z1 / z0
            k.fly = true
            k.tz = z1
            k.tx = mx - (mx - k.x) * f
            k.ty = my - (my - k.y) * f
          }}
        />

        {!tracks.length && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <p className="text-[13px] text-tx3">havet er tomt — lag din første øy</p>
          </div>
        )}

        <AnimatePresence>
          {picked && (
            <motion.aside
              initial={{ y: 18, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 18, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 32 }}
              className="absolute right-5 bottom-5 w-[250px] flex flex-col">

              <div className="rounded-xl border border-line bg-bg/80 backdrop-blur-md p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-[26px] font-semibold lowercase leading-none">{picked.name}</h2>
                    <p className="text-[11px] text-tx3 mt-1">{tell(pr)}</p>
                  </div>
                  <button onClick={() => setSel(null)}
                    className="text-tx3 hover:text-tx text-[13px] -mt-0.5">✕</button>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-line bg-bg/80 backdrop-blur-md p-4">
                <p className="text-[10px] uppercase tracking-widest text-tx3 mb-2">sist herfra</p>
                {!pr.length && <p className="text-[12px] text-tx3">Ingenting ennå. Øya er ubebodd.</p>}
                {pr.slice(0, 2).map((r) => (
                  <div key={r.id} className="py-2 border-b border-line/40 last:border-0">
                    <p className="text-[12px] text-tx2 leading-snug line-clamp-2">{r.goal}</p>
                    <p className="text-[10px] text-tx3 mt-1 font-mono">
                      {dur(r.dur ?? 0)}{r.started ? ` · ${ago(Date.now() / 1000 - r.started)}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>

      {adding && (
        <div className="absolute inset-0 bg-black/70 grid place-items-center z-30" onClick={() => setAdding(false)}>
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault()
              const f = new FormData(e.currentTarget)
              const n = String(f.get('n') ?? '').trim()
              if (n) add(n, String(f.get('m') ?? ''))
              setAdding(false)
            }}
            className="bg-panel border border-line rounded-xl p-6 w-[360px]">
            <h3 className="text-[15px] font-medium mb-4">Ny øy</h3>
            <input name="n" autoFocus placeholder="navn"
              className="w-full bg-black/40 border border-line rounded px-3 py-2 text-[13px] mb-3 outline-none focus:border-cy/50" />
            <input name="m" placeholder="nøkkelord, komma-separert"
              className="w-full bg-black/40 border border-line rounded px-3 py-2 text-[12px] mb-2 outline-none focus:border-cy/50" />
            <p className="text-[11px] text-tx3 mb-4">Kjøringer som nevner ordene knyttes hit automatisk.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setAdding(false)}
                className="px-3 py-1.5 text-[12px] text-tx3 hover:text-tx">avbryt</button>
              <button className="px-4 py-1.5 bg-cy/15 border border-cy/40 text-cy rounded text-[12px]">lag øy</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
