import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2600)

// Mål bredden på den bredeste sammenhengende stripen av lys husvegg
// (sandfarget #a58256 / #cfa571) — det er ett hustak/vegg, uavhengig av øystørrelse.
const wallRun = () => p.evaluate(() => {
  const c = document.querySelector('canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const w = c.width, h = c.height
  let best = 0
  for (let y = 0; y < h; y++) {
    let run = 0
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const r = d[i], g = d[i + 1], bl = d[i + 2]
      // sandfarget vegg: r>g>b, varm, middels lys
      const wall = r > 140 && r < 225 && g > 105 && g < 185 && bl > 60 && bl < 135 && r - bl > 45
      if (wall) { run++; if (run > best) best = run } else run = 0
    }
  }
  return best
})

const zoom = () => p.evaluate(() =>
  [...document.querySelectorAll('*')].map(e => e.textContent?.trim())
    .find(t => /^\d+%$/.test(t ?? '')) ?? '?')

const a = await wallRun()
console.log('zoom', await zoom(), 'bredeste husvegg =', a, 'px')
for (let i = 0; i < 5; i++) {
  await p.getByRole('button', { name: '+', exact: true }).click()
  await p.waitForTimeout(320)
}
await p.waitForTimeout(1800)
const c2 = await wallRun()
console.log('zoom', await zoom(), 'bredeste husvegg =', c2, 'px')
console.log(Math.abs(c2 - a) <= Math.max(4, a * 0.25) ? 'FAST ✓' : 'VOKSER ✗')
await b.close()
