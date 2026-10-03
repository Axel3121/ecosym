import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { loadWorld, type WorldLoadResult } from "./world-client.ts";
import { PROJECT_ERROR_CODES, type WorldProjectSnapshot } from "../src/project-types.ts";
import { validateWorldProjectSnapshot } from "../src/world-snapshot.ts";
import type { WorldForm, WorldPlaceForm } from "../src/world-form.ts";
import { gap, latestRead, meaningOf, readLine, sectors, sectorWord, signal } from "./timing.ts";
import { angularOrder, arcPath, bodyState, brightnessLevel, isDense, LATTICE_BOTTOM, LATTICE_TOP, placeBodies, tickArc, wrapLine, type Body, type Field as SkyField } from "./sky.ts";
import "./app.css";

const genericProjectError = "Prosjektet kunne ikke behandles. Prøv igjen.";
const projectErrorMessages: Record<(typeof PROJECT_ERROR_CODES)[number], string> = {
  invalid_name: "Skriv et gyldig prosjektnavn.",
  slug_underivable: "Prosjektnavnet kan ikke brukes.",
  slug_taken: "Et prosjekt med dette navnet finnes allerede.",
  path_taken: "Prosjektmappa brukes allerede.",
  civilization_unknown: "Sivilisasjonen finnes ikke.",
  civilization_dissolved: "Sivilisasjonen er oppløst.",
  root_invalid: "Prosjektmappa kan ikke brukes.",
  directory_exists: "Prosjektmappa finnes allerede.",
  containment_violation: "Prosjektmappa kan ikke brukes.",
  not_a_directory: "Prosjektmappa kan ikke brukes.",
  filesystem_denied: "Prosjektmappa kunne ikke opprettes.",
  harness_unavailable: "Hermes er ikke tilgjengelig.",
  harness_refused: "Hermes avslo registreringen.",
  harness_timeout: "Registreringen i Hermes tok for lang tid.",
  readback_ambiguous: "Registreringen i Hermes kunne ikke bekreftes.",
  readback_too_large: "Registreringen i Hermes kunne ikke bekreftes.",
  request_key_conflict: "Innsendingen kan ikke gjentas.",
  retry_in_progress: "Et nytt forsøk pågår allerede.",
  busy: "Prosjektet er opptatt. Prøv igjen.",
  invalid_request: genericProjectError,
  forbidden_origin: genericProjectError,
};

function projectErrorMessage(code: unknown): string {
  return typeof code === "string" && PROJECT_ERROR_CODES.some((known) => known === code)
    ? projectErrorMessages[code as (typeof PROJECT_ERROR_CODES)[number]]
    : genericProjectError;
}

function randomUUID(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const projectStateWord: Record<WorldProjectSnapshot["state"], string> = {
  requested: "påbegynt", "directory-created": "mappe opprettet", "external-unknown": "registrering ukjent", established: "registrert", failed: "mislyktes",
};

function projectMark(project: WorldProjectSnapshot): string {
  const binding = project.harness;
  if (project.state === "established" && binding) {
    return `Observert registrert i hermes (${binding.externalSlug}, ${binding.externalId}) ${binding.observedAt}. Erklært sted, ikke bevis på arbeid.${binding.externalArchived ? ` Registreringen var arkivert i hermes ved siste observasjon ${binding.observedAt}.` : ""}`;
  }
  if (project.state === "external-unknown") return "Harness-registrering ukjent; ikke bevis på at den mislyktes. Mappa fantes ved forsøket.";
  if (project.state === "failed") return `Opprettelse mislyktes. ${projectErrorMessage(project.reason)}`;
  return "Opprettelse påbegynt.";
}

function Projects({ place, projects, reload }: { place: WorldPlaceForm; projects: WorldProjectSnapshot[]; reload: () => void }) {
  const civilizationId = place.id;
  const canCreate = place.institution === "active";
  const [name, setName] = useState("");
  const [requestKey, setRequestKey] = useState(() => randomUUID());
  const failedCreateName = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const restoreFocus = useRef<HTMLElement | null>(null);
  const panel = useRef<HTMLElement>(null);

  // A disabled control drops focus to <body>; keep the keyboard inside the team panel while a write is in flight.
  useEffect(() => {
    const active = document.activeElement;
    if (sending) {
      if (active === document.body || active === restoreFocus.current) {
        panel.current?.closest<HTMLElement>(".plate")?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      }
      return;
    }
    if (active === document.body) {
      if (restoreFocus.current?.isConnected && !(restoreFocus.current as HTMLButtonElement).disabled) restoreFocus.current.focus();
      else panel.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus();
    }
    restoreFocus.current = null;
  }, [sending]);

  const send = async (project?: WorldProjectSnapshot) => {
    if (pending.current) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    pending.current = true;
    setSending(true);
    setError(null);
    if (project && !retryKeys.current.has(project.projectId)) retryKeys.current.set(project.projectId, randomUUID());
    try {
      const response = await fetch(project ? `/api/projects/${encodeURIComponent(project.projectId)}/retry`
        : `/api/civilizations/${encodeURIComponent(civilizationId)}/projects`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(project ? { requestKey: retryKeys.current.get(project.projectId) } : { requestKey, name, harness: "hermes" }),
        signal: AbortSignal.timeout(30000),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (!project) failedCreateName.current = name;
        const code = typeof body === "object" && body !== null && "error" in body ? body.error : null;
        setError(projectErrorMessage(code));
        return;
      }
      const result = validateWorldProjectSnapshot(body);
      if (result.civilizationId !== civilizationId || (project && result.projectId !== project.projectId)) throw new Error("Invalid project link");
      if (project) retryKeys.current.delete(project.projectId);
      else { failedCreateName.current = null; setRequestKey(randomUUID()); setName(""); }
      reload();
    } catch {
      if (!project) failedCreateName.current = name;
      setError(genericProjectError);
    } finally { pending.current = false; setSending(false); }
  };

  return <section className="projects" aria-label="Prosjekter" ref={panel}>
    <h3>Prosjekter</h3>
    {projects.length === 0
      ? <p className="empty">Ingen prosjekter</p>
      : <ul className="project-list">{projects.map((project) => <li key={project.projectId} data-state={project.state}>
        <div className="project-head"><h4>{project.name}</h4><span className="project-state">{projectStateWord[project.state]}</span></div>
        <p className="project-mark">{projectMark(project)}</p>
        <p className="project-path">{project.workspacePath}</p>
        {project.state !== "established" && <button type="button" className="btn" disabled={sending} onClick={() => void send(project)}>Pr&oslash;v igjen</button>}
      </li>)}</ul>}
    {canCreate && <form className="project-form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label className="field"><span>Prosjektnavn</span><input name="name" required autoComplete="off" value={name} disabled={sending} onChange={(event) => {
        if (failedCreateName.current !== null && event.target.value !== failedCreateName.current) {
          setRequestKey(randomUUID());
          failedCreateName.current = null;
        }
        setName(event.target.value);
      }} /></label>
      <label className="field" htmlFor="project-harness"><span>Harness</span></label>
      <select id="project-harness" name="harness" disabled={sending} defaultValue="hermes"><option value="hermes">hermes</option></select>
      <button className="btn btn-primary" disabled={sending} type="submit">Opprett</button>
    </form>}
    {!canCreate && <p className="empty">{place.institution === "dissolved" ? "Oppløste sivilisasjoner kan ikke opprette prosjekter." : "Erklæringen kan ikke leses; ingen prosjekter kan opprettes."}</p>}
    {error && <p role="alert" className="alert">{error}</p>}
  </section>;
}

function SourceRows({ place, now }: { place: WorldPlaceForm; now: number }) {
  const strip = sectors(place);
  if (place.institution === "unreadable") return <p className="empty">Erklæringen kan ikke leses, så ingen kilder kan knyttes til laget.</p>;
  if (strip.length === 0) return <p className="empty">Ingen kilder erklært. Det sier ingenting om aktivitet.</p>;
  return <ul className="source-list">{strip.map((sector) => <li key={sector.connectionId} data-kind={sector.kind}>
    <code className="id">{sector.connectionId}</code>
    <span className="status" data-kind={sector.kind}>{sectorWord[sector.kind]}{sector.attempt ? " · lesing pågår" : ""}{sector.blind ? " · kilden melder tapt sikt" : ""}</span>
    <span className="gap">{gap(sector.lastAttemptAt, now)}</span>
    <span className="meaning">{meaningOf(sector)}</span>
  </li>)}</ul>;
}

function Evidence({ place }: { place: WorldPlaceForm }) {
  const rows = place.sourcePicture.sources.flatMap((source) => [...source.observations, ...source.claims].map((fact) => ({ source: source.connectionId, fact })));
  if (rows.length === 0) return null;
  return <table className="evidence">
    <caption>Lagrede felt</caption>
    <thead><tr><th scope="col">Status</th><th scope="col">Felt</th><th scope="col">Eier</th><th scope="col">Tid</th></tr></thead>
    <tbody>{rows.map(({ source, fact }) => <tr key={`${source}:${fact.id}`} data-epistemic={fact.epistemicStatus} data-temporal={fact.temporalStatus}>
      <td><span className="epistemic" data-kind={fact.epistemicStatus}>{fact.epistemicStatus === "claim" ? "påstand" : "observasjon"}</span></td>
      <td>{fact.kind} <span className="dim">for</span> {fact.subject}<br /><code className="id">{source}</code></td>
      <td>{fact.factOwner}</td>
      <td><span className="temporal" data-kind={fact.temporalStatus}>{fact.temporalStatus === "current" ? "nåværende" : fact.temporalStatus === "historical" ? "historisk" : "tid ukjent"}</span></td>
    </tr>)}</tbody>
  </table>;
}


/** The reading plate: everything the snapshot holds about one civilization, opened by approaching its body. */
function Plate({ place, projects, now, close, reload }: { place: WorldPlaceForm; projects: WorldProjectSnapshot[]; now: number; close: () => void; reload: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeButton.current?.focus({ preventScroll: true }); }, [place.id]);
  const { tone, line } = signal(place, projects);
  const declaration = place.declaration;
  const readable = declaration.bodyReadable;
  const mandate = declaration.mandate;
  return <section className="plate" key={place.id} aria-label={`Sivilisasjon: ${place.name}`} data-tone={tone}>
    <header className="plate-head">
      <div>
        <h1>{place.name}</h1>
        <p className="domain">{place.domain}</p>
        <p className="signal" data-tone={tone}>{line}</p>
      </div>
      <button ref={closeButton} type="button" className="btn btn-quiet" onClick={close}>Lukk</button>
    </header>
    <section className="block" aria-label="Mandat">
      <h2>Mandat</h2>
      <p className="dim">{mandate.status === "unreadable" ? "Mandatet kan ikke leses." : `${mandate.status === "active" ? "Aktivt" : "Oppløst"}, revisjon ${mandate.revision}, registrert for ${gap(mandate.recordedAt, now)} siden`}</p>
      <div className="mandate">
        <div><h3>Kan gjøre alene</h3>{!readable ? <p className="empty">ukjent</p> : declaration.mayActAlone.length === 0 ? <p className="empty">ingenting erklært</p> : <ul>{declaration.mayActAlone.map((item) => <li key={item}>{item}</li>)}</ul>}</div>
        <div><h3>Må eskaleres</h3>{!readable ? <p className="empty">ukjent</p> : declaration.mustEscalate.length === 0 ? <p className="empty">ingenting erklært</p> : <ul>{declaration.mustEscalate.map((item) => <li key={item}>{item}</li>)}</ul>}</div>
      </div>
    </section>
    <section className="block" aria-label="Kilder">
      <h2>Kilder</h2>
      <SourceRows place={place} now={now} />
      <Evidence place={place} />
    </section>
    <Projects key={place.id} place={place} projects={projects} reload={reload} />
    <details className="record">
      <summary>Hele posten <span className="dim">{place.inspection.length} felt, slik de er lagret</span></summary>
      <div className="record-body">{place.inspection.map((field, index) => <section key={index} className="record-field"><h3>{field.label}</h3>{field.values.map((value, valueIndex) => <p key={valueIndex}>{value}</p>)}</section>)}</div>
    </details>
  </section>;
}

const RING = 56;

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** One body per civilization. Nothing here moves, grows, or lights without a snapshot field behind it. */
function BodyMark({ place, body, projects, now, selected, narrow, dense, fieldWidth, open, register }: {
  place: WorldPlaceForm; body: Body; projects: WorldProjectSnapshot[]; now: number; selected: boolean; narrow: boolean; dense: boolean; fieldWidth: number;
  open: () => void; register: (node: SVGGElement | null) => void;
}) {
  const state = bodyState(place, projects, now);
  const level = brightnessLevel[state.brightness];
  const core = state.dissolved ? 0 : 18 + 10 * level;
  const { line: signalLine, tone } = signal(place, projects);
  const reading = readLine(place.sourcePicture.sources, now);
  // Under the name: the gap since the latest read; a body without sight says so in words instead.
  const line = tone === "loss" ? signalLine : state.dissolved ? "oppløst" : reading;
  const compact = narrow || dense;
  const ring = compact ? 40 : RING;
  const waitingLabel = state.waiting === 0 ? null : state.waiting === 1
    ? `${projects.find((project) => project.state !== "established")!.name} venter på deg`
    : `${state.waiting} prosjekter venter på deg`;
  // One register: the label sits right of the ring; it goes under the body only when it cannot fit, never to the left.
  const lines = wrapLine(line, compact ? 30 : 28);
  const waitLines = waitingLabel ? wrapLine(waitingLabel, compact ? 30 : 28) : [];
  const charWidth = compact ? 6.2 : 6.6;
  const widest = Math.max(place.name.length * (compact ? 8 : 11.5), ...lines.map((part) => part.length * charWidth), ...waitLines.map((part) => part.length * charWidth));
  const below = narrow || dense || body.x + ring + 16 + widest > fieldWidth - 8;
  const clampX = (x: number) => Math.min(Math.max(x, widest / 2 + 8), fieldWidth - widest / 2 - 8);
  const labelX = below ? clampX(body.x) : body.x + ring + 16;
  const anchor = below ? "middle" : "start";
  const labelY = below ? body.y + ring + 22 : body.y + 2;
  const step = below ? 16 : 20;
  const described = `${signalLine}. ${sentence(reading)}.${waitingLabel ? ` ${waitingLabel}.` : ""}`;
  return <g className="body" role="button" tabIndex={0} ref={register} aria-label={`Åpne ${place.name}`} aria-description={described}
    aria-current={selected ? "page" : undefined} data-brightness={state.brightness} data-occluded={state.occluded || undefined}
    data-dissolved={state.dissolved || undefined} data-waiting={state.waiting || undefined} data-tone={tone}
    onClick={open} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } }}>
    <rect className="hit-box" x={below ? labelX - widest / 2 - 4 : body.x - ring - 4} y={body.y - ring - 4}
      width={below ? Math.max(widest + 8, ring * 2 + 8) : widest + ring + 24} height={below ? ring + (labelY - body.y) + 24 + (lines.length + waitLines.length) * 16 : Math.max(ring * 2 + 8, ring + 26 + (lines.length + waitLines.length) * 16 + 8)} />
    <circle className="hit" cx={body.x} cy={body.y} r={ring + 4} />
    {!state.dissolved && level > 0 && <circle className="glow" cx={body.x} cy={body.y} r={core * 2.4} style={{ opacity: 0.22 * level }} />}
    {!state.dissolved && <circle className="core" cx={body.x} cy={body.y} r={core} style={{ opacity: level === 0 ? 0 : 0.25 + 0.75 * level }} />}
    {!state.dissolved && level === 0 && <circle className="core-outline" cx={body.x} cy={body.y} r={18} />}
    <circle className="ring" cx={body.x} cy={body.y} r={ring} />
    {state.ticks.map((sector, index) => {
      const { from, to } = tickArc(index, state.ticks.length, sector.kind);
      const d = arcPath(body.x, body.y, ring, from, to);
      return sector.kind === "missing"
        ? <g key={sector.connectionId} className="tick" data-kind="missing"><path className="gap-bar" d={d} /><path className="gap-rim" d={d} /></g>
        : <path key={sector.connectionId} className="tick" data-kind={sector.kind} data-attempt={sector.attempt || undefined} d={d} />;
    })}
    {state.occluded && <circle className="occluder" cx={body.x + 12} cy={body.y - 6} r={Math.max(core, 18) + 6} />}
    <text className="name" x={labelX} y={labelY} textAnchor={anchor}>{place.name}</text>
    <text className="line" x={labelX} y={labelY + step} textAnchor={anchor} data-tone={tone}>
      {lines.map((part, index) => <tspan key={index} x={labelX} dy={index === 0 ? 0 : 16}>{part}</tspan>)}
    </text>
    {waitingLabel && <>
      <circle className="bloom-halo" cx={body.x - ring + 6} cy={body.y - ring + 6} r={22} />
      <circle className="bloom" cx={body.x - ring + 6} cy={body.y - ring + 6} r={3.2} />
      <text className="wait" x={labelX} y={labelY + step + lines.length * 16 + 2} textAnchor={anchor}>
        {waitLines.map((part, index) => <tspan key={index} x={labelX} dy={index === 0 ? 0 : 16}>{part}</tspan>)}
      </text>
    </>}
  </g>;
}

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => { const rect = node.getBoundingClientRect(); setSize({ width: Math.round(rect.width), height: Math.round(rect.height) }); };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function Field({ form, now, selected, open }: { form: WorldForm; now: number; selected: string | null; open: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(wrap);
  const narrow = width < 600;
  const projects = form.snapshot.projects ?? [];
  const ids = useMemo(() => form.places.map((place) => place.id), [form]);
  // Beside-the-ring labels need 370px of horizontal or 130px of vertical clearance (ring plus label band).
  const sparse: SkyField = { width, height, minDx: 370, minDy: 130, labelReserve: RING + 16 + 230 + 8 };
  const dense = !narrow && isDense(ids.length, sparse);
  // A crowded sky shows smaller bodies on a tighter lattice; a narrow one is a single scrolling column.
  const sky: SkyField = narrow ? { width, height, minDx: width, minDy: 190, lattice: true } : dense ? { width, height, minDx: 300, minDy: 150, lattice: true } : sparse;
  const bodies = useMemo(() => width > 0 ? placeBodies(ids, sky) : [], [ids, width, height, narrow]);
  const nodes = useRef(new Map<string, SVGGElement>());
  const travel = (event: KeyboardEvent<SVGSVGElement>) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    const active = document.activeElement;
    const currentId = [...nodes.current.entries()].find(([, node]) => node === active)?.[0];
    if (!currentId) return;
    event.preventDefault();
    const order = event.key === "ArrowLeft" || event.key === "ArrowRight" ? angularOrder(bodies, { width, height }).map((body) => body.id) : ids;
    const index = order.indexOf(currentId);
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    nodes.current.get(order[(index + (forward ? 1 : order.length - 1)) % order.length]!)?.focus();
  };
  // A narrow sky grows with its bodies and scrolls, rather than crowding them.
  const tall = narrow ? Math.max(440, LATTICE_TOP + LATTICE_BOTTOM + (ids.length - 1) * 190) : undefined;
  return <div className="field-wrap" ref={wrap} style={tall === undefined ? undefined : { minHeight: tall }}>
    <svg className="field" width={width} height={height} role="group" aria-label="Verden" data-compact={narrow || dense || undefined} onKeyDown={travel}>
      <defs>
        <filter id="glow" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="16" /></filter>
        <radialGradient id="halo"><stop offset="0" stopColor="#4d9eff" stopOpacity="0.55" /><stop offset="0.55" stopColor="#4d9eff" stopOpacity="0.16" /><stop offset="1" stopColor="#4d9eff" stopOpacity="0" /></radialGradient>
      </defs>
      {bodies.map((body) => {
        const place = form.places.find((candidate) => candidate.id === body.id)!;
        return <BodyMark key={body.id} place={place} body={body} projects={projects.filter((project) => project.civilizationId === body.id)} now={now}
          selected={selected === body.id} narrow={narrow} dense={dense} fieldWidth={width} open={() => open(body.id)}
          register={(node) => { if (node) nodes.current.set(body.id, node); else nodes.current.delete(body.id); }} />;
      })}
    </svg>
  </div>;
}

function Notice({ load, empty }: { load: WorldLoadResult | { kind: "loading" }; empty: boolean }) {
  const heading = load.kind === "loading" ? "Leser verden" : load.kind === "failure"
    ? load.reason === "invalid-response" ? "Ukjent verdensbilde"
      : load.reason === "http" ? `Verden utilgjengelig / HTTP ${load.status}` : "Ingen forbindelse til verden"
    : "Ingen sivilisasjoner grunnlagt";
  const body = load.kind === "loading" ? "Venter på det validerte bildet. Ingen steder antas."
    : load.kind === "failure" ? "Ingen verdensbilde vises. Dette er ikke en tom eller stille verden. Prøv å lese på nytt."
      : "En sivilisasjon begynner med en erklæring. Ingenting er grunnlagt ennå.";
  const kind = load.kind === "loading" ? "loading" : load.kind === "failure" ? "failure" : empty ? "empty" : "loaded";
  return <div className="field-wrap"><section className="notice" role="status" data-kind={kind}>
    <span className="notice-ring" aria-hidden="true" />
    <div><h1>{heading}</h1><p>{body}</p></div>
  </section></div>;
}

export function App() {
  const [load, setLoad] = useState<WorldLoadResult | { kind: "loading" }>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorld({ signal: controller.signal }).then((result) => {
      if (controller.signal.aborted || result.kind === "cancelled") return;
      setNow(Date.now());
      setLoad(result);
    });
    return () => controller.abort();
  }, [revision]);

  // Gap times are read against the clock, not the picture: keep them honest while the page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const form = load.kind === "loaded" ? load.form : null;
  const places = form?.places ?? [];
  const projects = form?.snapshot.projects ?? [];
  const current = places.find((place) => place.id === selected) ?? null;
  const sources = places.flatMap((place) => place.sourcePicture.sources);
  const latest = latestRead(sources);
  const reload = () => { setSelected(null); setLoad({ kind: "loading" }); setRevision((value) => value + 1); };
  const close = () => {
    if (selected !== null) main.current?.querySelector<SVGGElement>(`.body[aria-label="Åpne ${CSS.escape(current?.name ?? "")}"]`)?.focus();
    setSelected(null);
  };

  return <main className="sky" aria-label="EcoSym" ref={main} data-open={current !== null || undefined} onKeyDown={(event) => {
    if (event.key === "Escape" && selected !== null) { event.preventDefault(); close(); }
  }}>
    <header className="wordmark"><span>EcoSym</span></header>
    {form === null || places.length === 0
      ? <Notice load={load} empty={places.length === 0} />
      : <Field form={form} now={now} selected={selected} open={(id) => setSelected(id)} />}
    {current !== null && <Plate place={current} projects={projects.filter((project) => project.civilizationId === current.id)} now={now} close={close} reload={() => setRevision((value) => value + 1)} />}
    <footer className="foot">
      <p><span className="gap">{form === null ? "Ingen lesing ennå" : sources.length === 0 ? "Ingen erklærte kilder"
        : latest === null ? sentence(readLine(sources, now)) : `Sist lest for ${gap(latest, now)} siden`}</span> <button type="button" className="link" onClick={reload} disabled={load.kind === "loading"}>Les på nytt</button></p>
      {form?.snapshot.observationsTruncated && <p className="dim">Observasjoner er avkortet på tvers av tilkoblinger; tomhet per kilde er ukjent.</p>}
      {form?.snapshot.claimsTruncated && <p className="dim">Påstander er avkortet på tvers av tilkoblinger; tomhet per kilde er ukjent.</p>}
      <p className="dim">Kronikeren, koordinatorene og rådet er ikke koblet til ennå.</p>
    </footer>
  </main>;
}
