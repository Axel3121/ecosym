/** Øyverdenen. Axey i midten, agentøyer rundt. Alt fra ekte kjøringer. */

export type Mood = 'jobber' | 'nettopp' | 'venter' | 'sover' | 'ny'

export type Isle = {
  id: string
  name: string
  hue: number
  hueIdx: number
  mood: Mood
  runs: number
  /** 0 = nettopp aktiv, 1 = lenge siden */
  cold: number
  /** avstand fra sentrum i verdensenheter */
  dist: number
  angle: number
  /** posisjon, glir mot mål */
  x: number
  y: number
  tx: number
  ty: number
  size: number
  seed: number
}

export const HUES = [186, 315, 265, 44, 150, 20, 220, 95]

/** Isometrisk projeksjon. */
export const iso = (x: number, y: number) => ({ sx: (x - y) * 0.86, sy: (x + y) * 0.5 })

/** Deterministisk støy fra et heltall — samme øy ser alltid lik ut. */
export const rnd = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}
