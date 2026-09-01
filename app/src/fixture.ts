// SYNTHETIC fixture. Every value here is authored so the surface has something
// to give form to. Nothing in it was observed. The UI says so.
import type { Observations } from "./scene.ts";

const T = "2026-09-01T20:30:00Z";
const min = (n: number) => new Date(Date.parse(T) - n * 60_000).toISOString();

export const fixture: Observations = {
  observedAt: T,
  synthetic: true,
  traceWindowMs: 6 * 60 * 60 * 1000,
  civilizations: [
    {
      id: "roma",
      name: "Roma",
      domain: "finnflip — arbitrage on FINN Torget",
      seatName: "Curia",
      voice: "Roman magistrate: terse, numbers first, slightly impatient.",
      mandate: {
        alone: ["read watchlist and settings", "score listings", "write reports"],
        council: ["spend money", "contact a seller", "widen the taxonomy"],
      },
      ground: { x: 230, y: 220 },
    },
    {
      id: "midgard",
      name: "Midgard",
      domain: "ecosym — the world itself",
      seatName: "Ting",
      voice: "Norse lawspeaker: calm, dry, short declaratives.",
      mandate: {
        alone: ["read the repository", "run tests", "commit on a branch"],
        council: ["merge to main", "publish", "found a civilization"],
      },
      ground: { x: 1160, y: 150 },
    },
    {
      id: "edo",
      name: "Edo",
      domain: "social — shorts pipeline",
      seatName: "Bakufu",
      voice: "Edo-period official: courteous, formal, apologises for delays.",
      mandate: {
        alone: ["draft scripts", "render", "schedule"],
        council: ["publish", "delete a live post", "change channel strategy"],
      },
      ground: { x: 1260, y: 560 },
    },
    {
      id: "thule",
      name: "Thule",
      domain: "jarvis — voice",
      seatName: "Moot",
      mandate: { alone: ["listen", "transcribe"], council: ["speak on my behalf"] },
      ground: { x: 280, y: 760 },
    },
  ],
  lastSeen: {
    roma: min(2),
    midgard: min(0),
    edo: min(47),
    // thule: never observed
  },
  runs: [
    // Roma — one live tree, one finished
    { id: "r1", civilizationId: "roma", label: "sweep watchlist", tool: "browser", startedAt: min(11), live: true },
    { id: "r1a", civilizationId: "roma", parentRunId: "r1", label: "price 14 listings", tool: "python", startedAt: min(6), live: true },
    { id: "r1b", civilizationId: "roma", parentRunId: "r1", label: "compare survival", startedAt: min(3), live: true },
    { id: "r0", civilizationId: "roma", label: "nightly report", startedAt: min(300), endedAt: min(240), live: false },
    // Midgard — live now
    { id: "m1", civilizationId: "midgard", label: "world surface prototype", tool: "opencode", startedAt: min(40), live: true },
    { id: "m1a", civilizationId: "midgard", parentRunId: "m1", label: "typecheck", tool: "tsc", startedAt: min(1), live: true },
    { id: "m0", civilizationId: "midgard", label: "review #6", startedAt: min(400), endedAt: min(120), live: false },
    { id: "m00", civilizationId: "midgard", label: "ci fix", startedAt: min(500), endedAt: min(330), live: false },
    // Edo — nothing running, two traces
    { id: "e0", civilizationId: "edo", label: "render short 041", tool: "ffmpeg", startedAt: min(200), endedAt: min(180), live: false },
    { id: "e1", civilizationId: "edo", label: "schedule 041", startedAt: min(170), endedAt: min(168), live: false },
    // Thule — has runs but is unobserved: they must not appear
    { id: "t0", civilizationId: "thule", label: "listen", startedAt: min(30), live: true },
  ],
  petitions: [
    { id: "p1", toCivilizationId: "roma", text: "Add PS5 controllers to the watchlist", state: "in-progress", sentAt: min(25) },
    { id: "p2", toCivilizationId: "edo", text: "Hold publishing until Friday", state: "queued", sentAt: min(60) },
  ],
  council: [
    { id: "c1", raisedBy: "roma", summary: "Roma asks to contact a seller (crosses: contact a seller)", raisedAt: min(8) },
    { id: "c2", raisedBy: "edo", summary: "Edo asks to delete short 039 (crosses: delete a live post)", raisedAt: min(90) },
    { id: "c3", raisedBy: "roma", summary: "Roma asks to widen taxonomy to 'gaming'", raisedAt: min(140) },
  ],
};
