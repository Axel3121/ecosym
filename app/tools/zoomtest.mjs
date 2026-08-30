import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
await p.waitForTimeout(2500)

const zoomText = () => p.evaluate(() =>
  [...document.querySelectorAll('span,div')].map(e => e.textContent?.trim())
    .find(t => /^\d+%$/.test(t ?? '')) ?? '?')

const lit = () => p.evaluate(() => {
  const c = document.querySelector('canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 0; i < d.length; i += 4 * 7)
    if (d[i] + d[i + 1] + d[i + 2] > 190) n++
  return n
})

console.log('start   zoom=' + await zoomText(), 'lyse=' + await lit())

// klikk + -knappen 4 ganger (ekte React-event)
for (let i = 0; i < 4; i++) {
  await p.getByRole('button', { name: '+', exact: true }).click()
  await p.waitForTimeout(350)
}
await p.waitForTimeout(1500)
console.log('etter + zoom=' + await zoomText(), 'lyse=' + await lit())
await p.screenshot({ path: '/tmp/zoomtest.png' })
await b.close()
