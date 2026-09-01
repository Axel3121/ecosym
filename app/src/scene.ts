// Scene contract: observations in, a deterministic scene description out.
// The renderer reads only this. Nothing here touches a source or decides
// authority; it only gives observed and declared state a form.

export type Instant = string; // ISO-8601 UTC

export interface CivilizationDeclared {
  id: string;
  name: string;
  domain: string;
  /** What this civilization calls its own seat: Curia, Ting, Diet... */
  seatName: string;
  mandate: { alone: string[]; council: string[] };
  /** Position on the chart, in world units. Declared by the user at founding. */
  ground: { x: number; y: number };
}

export interface RunObserved {
  id: string;
  civilizationId: string;
  parentRunId?: string;
  label: string;
  tool?: string;
  startedAt: Instant;
  endedAt?: Instant;
  /** Set only when the run was observed running at `observedAt`. */
  live: boolean;
}

export type PetitionState = "sent" | "accepted" | "queued" | "in-progress" | "refused";

export interface PetitionObserved {
  id: string;
  toCivilizationId: string;
  text: string;
  state: PetitionState;
  sentAt: Instant;
}

export interface CouncilMatterObserved {
  id: string;
  raisedBy: string;
  summary: string;
  raisedAt: Instant;
}

export interface Observations {
  observedAt: Instant;
  civilizations: CivilizationDeclared[];
  /** Per civilization: when Ecosym last saw it. Missing = never observed. */
  lastSeen: Record<string, Instant>;
  runs: RunObserved[];
  petitions: PetitionObserved[];
  council: CouncilMatterObserved[];
  /** Retention window for finished-work traces, in ms. */
  traceWindowMs: number;
  synthetic?: boolean;
}

// ---- scene -----------------------------------------------------------------

export type Epistemic = "observed" | "unobserved";

export interface Building {
  id: string;
  kind: "seat" | "workshop";
  /** Local position inside the settlement, in settlement units (0..1). */
  at: { x: number; y: number };
  size: number; // 0..1 footprint
  runId?: string;
}

export interface Inhabitant {
  runId: string;
  label: string;
  tool?: string;
  /** The building it works from. */
  buildingId: string;
  /** Depth in the delegation tree; 0 = root. */
  depth: number;
  parentRunId?: string;
}

export interface Trace {
  runId: string;
  buildingId: string;
  /** 1 = just finished, 0 = at the retention edge. */
  freshness: number;
}

export interface Settlement {
  civilizationId: string;
  name: string;
  domain: string;
  seatName: string;
  epistemic: Epistemic;
  lastSeen?: Instant;
  ground: { x: number; y: number };
  /** Chart-level footprint radius in world units, derived from work volume. */
  radius: number;
  /** True when at least one inhabitant was observed running. */
  live: boolean;
  buildings: Building[];
  inhabitants: Inhabitant[];
  traces: Trace[];
  mandate: { alone: string[]; council: string[] };
  openMatters: number;
}

export interface Letter {
  petitionId: string;
  toCivilizationId: string;
  state: PetitionState;
  text: string;
  sentAt: Instant;
  /** 0 = at the Capital, 1 = at the seat. Derived from state, not from time. */
  progress: number;
}

export interface Route {
  from: { x: number; y: number };
  to: { x: number; y: number };
  reason: "petition" | "exchange";
}

export interface Capital {
  ground: { x: number; y: number };
  halls: Array<{
    civilizationId: string;
    name: string;
    seatName: string;
    epistemic: Epistemic;
    lastSeen?: Instant;
    openMatters: number;
    live: boolean;
  }>;
  matters: CouncilMatterObserved[];
}

export interface Scene {
  observedAt: Instant;
  synthetic: boolean;
  settlements: Settlement[];
  capital: Capital;
  letters: Letter[];
  routes: Route[];
}

// ---- derivation ------------------------------------------------------------

const CAPITAL_GROUND = { x: 760, y: 460 };

const PROGRESS: Record<PetitionState, number> = {
  sent: 0.15,
  accepted: 0.45,
  queued: 0.6,
  "in-progress": 0.85,
  refused: 0.15,
};

/** Deterministic pseudo-random in [0,1) from a string; stable across renders. */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function ms(a: Instant): number {
  const t = Date.parse(a);
  if (Number.isNaN(t)) throw new Error(`not an instant: ${a}`);
  return t;
}

export function deriveScene(obs: Observations): Scene {
  const now = ms(obs.observedAt);
  const settlements: Settlement[] = obs.civilizations.map((civ) => {
    const lastSeen = obs.lastSeen[civ.id];
    const epistemic: Epistemic = lastSeen ? "observed" : "unobserved";
    const runs = obs.runs.filter((r) => r.civilizationId === civ.id);

    // Only work that was observed can take a form. Unobserved: bare ground.
    const shown = epistemic === "observed" ? runs : [];

    // Seat first; one workshop per root run (children share the parent's).
    const buildings: Building[] = [
      { id: `${civ.id}:seat`, kind: "seat", at: { x: 0.5, y: 0.42 }, size: 0.22 },
    ];
    const roots = shown.filter((r) => !r.parentRunId);
    roots.forEach((r, i) => {
      const angle = (i / Math.max(roots.length, 1)) * Math.PI * 2 + hash01(r.id) * 0.6;
      const dist = 0.28 + hash01(r.id + "d") * 0.12;
      buildings.push({
        id: `${civ.id}:w:${r.id}`,
        kind: "workshop",
        at: { x: 0.5 + Math.cos(angle) * dist, y: 0.5 + Math.sin(angle) * dist * 0.8 },
        size: 0.07 + hash01(r.id + "s") * 0.05,
        runId: r.id,
      });
    });

    const rootOf = (r: RunObserved): RunObserved => {
      let cur = r;
      const seen = new Set<string>();
      while (cur.parentRunId && !seen.has(cur.id)) {
        seen.add(cur.id);
        const p = shown.find((x) => x.id === cur.parentRunId);
        if (!p) break;
        cur = p;
      }
      return cur;
    };
    const depthOf = (r: RunObserved): number => {
      let d = 0;
      let cur = r;
      const seen = new Set<string>();
      while (cur.parentRunId && !seen.has(cur.id)) {
        seen.add(cur.id);
        const p = shown.find((x) => x.id === cur.parentRunId);
        if (!p) break;
        cur = p;
        d++;
      }
      return d;
    };

    const inhabitants: Inhabitant[] = shown
      .filter((r) => r.live)
      .map((r) => {
        const inh: Inhabitant = {
          runId: r.id,
          label: r.label,
          buildingId: `${civ.id}:w:${rootOf(r).id}`,
          depth: depthOf(r),
        };
        if (r.tool !== undefined) inh.tool = r.tool;
        if (r.parentRunId !== undefined) inh.parentRunId = r.parentRunId;
        return inh;
      });

    const traces: Trace[] = shown
      .filter((r) => !r.live && r.endedAt)
      .map((r) => {
        const age = now - ms(r.endedAt!);
        const freshness = Math.max(0, 1 - age / obs.traceWindowMs);
        return { runId: r.id, buildingId: `${civ.id}:w:${rootOf(r).id}`, freshness };
      })
      .filter((t) => t.freshness > 0);

    const volume = roots.length + traces.length * 0.5;
    const radius = epistemic === "observed" ? 150 + Math.min(volume, 8) * 10 : 150;

    const s: Settlement = {
      civilizationId: civ.id,
      name: civ.name,
      domain: civ.domain,
      seatName: civ.seatName,
      epistemic,
      ground: civ.ground,
      radius,
      live: inhabitants.length > 0,
      buildings,
      inhabitants,
      traces,
      mandate: civ.mandate,
      openMatters: obs.council.filter((m) => m.raisedBy === civ.id).length,
    };
    if (lastSeen !== undefined) s.lastSeen = lastSeen;
    return s;
  });

  const byId = new Map(settlements.map((s) => [s.civilizationId, s]));

  const letters: Letter[] = obs.petitions
    .filter((p) => byId.has(p.toCivilizationId))
    .map((p) => ({
      petitionId: p.id,
      toCivilizationId: p.toCivilizationId,
      state: p.state,
      text: p.text,
      sentAt: p.sentAt,
      progress: PROGRESS[p.state],
    }));

  // A route exists only where something actually crossed a border.
  const routes: Route[] = [];
  const routed = new Set<string>();
  for (const l of letters) {
    if (routed.has(l.toCivilizationId)) continue;
    routed.add(l.toCivilizationId);
    routes.push({ from: CAPITAL_GROUND, to: byId.get(l.toCivilizationId)!.ground, reason: "petition" });
  }
  for (const m of obs.council) {
    if (routed.has(m.raisedBy) || !byId.has(m.raisedBy)) continue;
    routed.add(m.raisedBy);
    routes.push({ from: byId.get(m.raisedBy)!.ground, to: CAPITAL_GROUND, reason: "exchange" });
  }

  const capital: Capital = {
    ground: CAPITAL_GROUND,
    halls: settlements.map((s) => {
      const h: Capital["halls"][number] = {
        civilizationId: s.civilizationId,
        name: s.name,
        seatName: s.seatName,
        epistemic: s.epistemic,
        openMatters: s.openMatters,
        live: s.live,
      };
      if (s.lastSeen !== undefined) h.lastSeen = s.lastSeen;
      return h;
    }),
    matters: obs.council,
  };

  return {
    observedAt: obs.observedAt,
    synthetic: obs.synthetic === true,
    settlements,
    capital,
    letters,
    routes,
  };
}
