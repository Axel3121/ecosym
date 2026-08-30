import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Run = {
  id: string
  goal: string
  state: string
  dur: number | null
  model: string | null
  started?: number
}

export type Totals = {
  tin: number; tout: number; calls: number; messages: number; sessions: number
}

/** En agent er Axeys eget domene. Hermes vet ikke at de finnes. */
export type Track = {
  id: string
  name: string
  hue: number
  /** ord som knytter kjøringer hit automatisk */
  match: string[]
  runIds: string[]
}

type Store = {
  tracks: Track[]
  add: (name: string, match?: string) => void
  seed: () => void
  ingest: (runs: Run[]) => void
  runsFor: (id: string, runs: Run[]) => Run[]
}

const words = (s: string) =>
  s.toLowerCase().split(/[\s,/-]+/).filter((w) => w.length > 2)

export const useTracks = create<Store>()(
  persist(
    (set, get) => ({
      tracks: [],

      add: (name, match) =>
        set((s) => ({
          tracks: [...s.tracks, {
            id: crypto.randomUUID(),
            name,
            hue: (s.tracks.length * 67 + 190) % 360,
            match: [...words(name), ...words(match ?? '')],
            runIds: [],
          }],
        })),

      /** Førstegangsoppsett: øyer utledet av arbeidet som faktisk er gjort. */
      seed: () =>
        set((s) => {
          if (s.tracks.length) return s
          const mk = (name: string, kw: string) => ({
            id: crypto.randomUUID(),
            name,
            hue: 0,
            match: words(kw),
            runIds: [] as string[],
          })
          return {
            tracks: [
              mk('manus', 'manus script shorts pacing scriptet creepy stories letsnotmeet transcribe emotional'),
              mk('produksjon', 'produksjon production tts visual visuals treatments ffmpeg edit editing pipeline audio'),
              mk('kanal', 'kanal channel youtube tiktok distribution niches operate solo analytics'),
              mk('research', 'research stack stacks frontend hermes routing power users'),
              mk('arkitektur', 'arkitektur architecture langgraph axey autonomt system veier independent'),
            ],
          }
        }),

      /** Nye kjøringer kobles til agenten hvis målet nevner navnet dens. */
      ingest: (runs) =>
        set((s) => ({
          tracks: s.tracks.map((t) => {
            const hits = runs
              .filter((r) => !t.runIds.includes(r.id))
              .filter((r) => {
                const g = r.goal.toLowerCase()
                return t.match.some((w) => g.includes(w))
              })
              .map((r) => r.id)
            return hits.length ? { ...t, runIds: [...t.runIds, ...hits] } : t
          }),
        })),

      runsFor: (id, runs) => {
        const t = get().tracks.find((x) => x.id === id)
        return t ? runs.filter((r) => t.runIds.includes(r.id)) : []
      },
    }),
    { name: 'axey.crew' },
  ),
)
