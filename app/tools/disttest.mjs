import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

// mål bredden på den grønne øya nærmest midten — den klippes ikke av kanten
const measure = async () => await p.evaluate(() => {
  const c = document.querySelector('canvas')
  const x = c.getContext('2d')
  const W = c.width, H = c.height
  const d = x.getImageData(0, 0, W, H).data
  // tell grønne piksler per rad i midtbåndet, ta bredeste sammenhengende
  let best = 0
  for (let y = (H * 0.35) | 0; y < (H * 0.65) | 0; y++) {
    let run = 0
    for (let px = 0; px < W; px++) {
      const i = (y * W + px) * 4
      const r = d[i], g = d[i + 1], bb = d[i + 2]
      if (g > 90 && g < 215 && r > 85 && r < 205 && bb < 115 && g > bb + 40) {
        run++
        if (run > best) best = run
      } else run = 0
    }
  }
  const z = document.body.innerText.match(/(\d+)%/)?.[1]
  return { zoom: +z, oybredde: best }
})

const a1 = await measure()
console.log('start ', JSON.stringify(a1))
// bruk +-knappen: treffer React-handleren sikkert
const plus = p.locator('button', { hasText: /^\+$/ }).first()
await plus.click()
await p.waitForTimeout(1200)
await plus.click()
await p.waitForTimeout(1600)
const a2 = await measure()
console.log('etter ', JSON.stringify(a2))

const zf = a2.zoom / a1.zoom
const of_ = a2.oybredde / a1.oybredde
console.log(`zoom x${zf.toFixed(2)}  øy x${of_.toFixed(2)}  ${Math.abs(zf - of_) < 0.35 ? 'FØLGER ✓' : 'AVVIK ✗'}`)
await p.screenshot({ path: '/tmp/dist.png' })
await b.close()
