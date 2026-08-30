#!/usr/bin/env node
/**
 * slop.mjs — deterministisk AI-slop-sjekk.
 *
 * Metoden er Adrian Krebs' (1590 Show HN-sider, 16 DOM/CSS-mønstre).
 * Poenget er at sjekkene er deterministiske: ingen LLM dømmer, fordi en
 * LLM som vurderer AI-slop har nøyaktig den skjevheten man måler.
 *
 *   node tools/slop.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === 'dist' || f === '.git') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, acc)
    else if (['.tsx', '.ts', '.css', '.html'].includes(extname(f))) acc.push(p)
  }
  return acc
}

const src = walk(join(ROOT, 'src'))
  .concat([join(ROOT, 'index.html')])
  .map((p) => readFileSync(p, 'utf8'))
  .join('\n')

/* ---- kontrast (WCAG) ---- */
const lum = (hex) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

const tokens = Object.fromEntries(
  [...src.matchAll(/--color-(tx\d?|bg):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
)
const BG = tokens.bg ?? '#000000'
const contrast = Object.entries(tokens)
  .filter(([k]) => k !== 'bg')
  .map(([k, v]) => ({ k, v, r: ratio(v, BG) }))

const failing = contrast.filter((c) => c.r < 4.5)

/* ---- de 16 ---- */
const has = (re) => (re instanceof RegExp ? re.test(src) : src.includes(re))

const checks = [
  ['Inter som hovedfont', has(/font-sans:[^;]*Inter/i)],
  ['Space Grotesk / Instrument Serif / Geist', has(/Space Grotesk|Instrument Serif|Geist/i)],
  ['Serif italic som aksent', has(/italic/) && has(/serif/i)],
  ['«VibeCode»-lilla aksent', has(/indigo|violet|#[68-9a-f][0-9a-f]{2}[0-9a-f]{2}ff\b/i)],
  ['Permanent mørk modus', has(/#0[0-9a-f]{5}/) && !has(/prefers-color-scheme/)],
  ['Brødtekst under WCAG AA', failing.length > 0],
  ['Gradienter', has(/(background|bg-)[^;\n]*gradient/)],
  ['Farget glød / box-shadow', has(/(boxShadow|box-shadow)[^;\n]*\d+px[^;\n]*(#|rgb|\$\{)/)],
  ['Sentrert hero i generisk sans', has(/text-center[^"]*text-[45]xl/)],
  ['Badge rett over H1', has(/rounded-full[^"]*text-\[1[01]px\][^>]*>\s*\w+\s*<\/span>\s*<h1/)],
  ['Fargede kanter på kort', has(/border(Left|-l)[^;\n]*\$\{/)],
  ['Identiske ikonkort i grid', (src.match(/<Stat\b/g) ?? []).length >= 3],
  ['Nummererte 1-2-3-steg', has(/>\s*0?1\s*<[\s\S]{0,400}>\s*0?2\s*<[\s\S]{0,400}>\s*0?3\s*</)],
  ['Stat-banner-rad', has(/border-t[^"]*(from-black|bg-gradient)/)],
  ['Emoji i navigasjon', has(/[\u{1F300}-\u{1FAFF}]/u)],
  ['ALL-CAPS seksjonsetiketter', has(/uppercase/)],
]

const hits = checks.filter(([, f]) => f)

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', X = '\x1b[0m'

console.log(`\n${D}kontrast mot ${BG}${X}`)
for (const c of contrast) {
  const ok = c.r >= 4.5
  console.log(`  ${c.k.padEnd(4)} ${c.v}  ${String(c.r.toFixed(2)).padStart(5)}:1  ${ok ? G + '✓' : R + '✗ under AA'}${X}`)
}

console.log(`\n${D}16 mønstre${X}`)
checks.forEach(([label, fail], i) => {
  console.log(`  ${String(i + 1).padStart(2)}. ${label.padEnd(42)} ${fail ? R + 'SLOP' : G + 'ok'}${X}`)
})

const bucket = hits.length >= 4 ? `${R}TUNG SLOP` : hits.length >= 2 ? `${Y}mild` : `${G}ren`
console.log(`\n  ${hits.length}/16 treff  →  ${bucket}${X}\n`)

process.exit(hits.length >= 4 ? 1 : 0)
