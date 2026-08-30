import { chromium } from 'playwright'

const url = process.argv[2] ?? 'http://localhost:5199/'
const out = process.argv[3] ?? '/tmp/axey.png'
const click = process.argv.includes('--click')

const b = await chromium.launch()
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', (e) => errs.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2400)

if (click) {
  // klikk der en øy faktisk ligger — les posisjonene fra canvas-treff
  const box = await page.locator('canvas').boundingBox()
  const pts = [
    [box.x + box.width * 0.36, box.y + box.height * 0.34],
    [box.x + box.width * 0.62, box.y + box.height * 0.3],
    [box.x + box.width * 0.3, box.y + box.height * 0.62],
    [box.x + box.width * 0.66, box.y + box.height * 0.66],
  ]
  for (const [x, y] of pts) {
    await page.mouse.click(x, y)
    await page.waitForTimeout(700)
    if (await page.locator('aside').count()) break
  }
  await page.waitForTimeout(2200)
}

await page.screenshot({ path: out })
const info = await page.evaluate(() => ({
  canvas: !!document.querySelector('canvas'),
  panel: !!document.querySelector('aside'),
  text: document.body.innerText.slice(0, 320),
}))
console.log(JSON.stringify({ ...info, errors: errs.slice(0, 4) }, null, 2))
await b.close()
