import { useEffect, useRef, useState } from "react";
import { loadWorld, type WorldLoadResult } from "./world-client.ts";
import { PROJECT_ERROR_CODES, type WorldProjectSnapshot } from "../src/project-types.ts";
import { validateWorldProjectSnapshot } from "../src/world-snapshot.ts";
import "./world.css";

const genericProjectError = "Prosjektet kunne ikke behandles. Pr\u00f8v igjen.";
const projectErrorMessages: Record<(typeof PROJECT_ERROR_CODES)[number], string> = {
  invalid_name: "Skriv et gyldig prosjektnavn.",
  slug_underivable: "Prosjektnavnet kan ikke brukes.",
  slug_taken: "Et prosjekt med dette navnet finnes allerede.",
  path_taken: "Prosjektmappa brukes allerede.",
  civilization_unknown: "Sivilisasjonen finnes ikke.",
  civilization_dissolved: "Sivilisasjonen er oppl\u00f8st.",
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
  retry_in_progress: "Et nytt fors\u00f8k p\u00e5g\u00e5r allerede.",
  busy: "Prosjektet er opptatt. Pr\u00f8v igjen.",
  invalid_request: genericProjectError,
  forbidden_origin: genericProjectError,
};

function projectErrorMessage(code: unknown): string {
  return typeof code === "string" && PROJECT_ERROR_CODES.some((known) => known === code)
    ? projectErrorMessages[code as (typeof PROJECT_ERROR_CODES)[number]]
    : genericProjectError;
}

function Projects({ civilizationId, projects, canCreate, reload }: {
  civilizationId: string; projects: WorldProjectSnapshot[]; canCreate: boolean; reload: () => void;
}) {
  const [name, setName] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const retryKeys = useRef(new Map<string, string>());
  const restoreFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (sending) {
      if (document.activeElement === document.body || document.activeElement === restoreFocus.current) {
        restoreFocus.current?.closest("aside")?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
      }
      return;
    }
    if (document.activeElement === document.body && restoreFocus.current?.isConnected) restoreFocus.current.focus();
    restoreFocus.current = null;
  }, [sending]);
  const send = async (project?: WorldProjectSnapshot) => {
    if (pending.current) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;
    pending.current = true;
    setSending(true);
    setError(null);
    if (project && !retryKeys.current.has(project.projectId)) retryKeys.current.set(project.projectId, crypto.randomUUID());
    try {
      const response = await fetch(project ? `/api/projects/${encodeURIComponent(project.projectId)}/retry`
        : `/api/civilizations/${encodeURIComponent(civilizationId)}/projects`, {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(project ? { requestKey: retryKeys.current.get(project.projectId) } : { requestKey, name, harness: "hermes" }),
        signal: AbortSignal.timeout(30000),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const code = typeof body === "object" && body !== null && "error" in body ? body.error : null;
        setError(projectErrorMessage(code));
        return;
      }
      const result = validateWorldProjectSnapshot(body);
      if (result.civilizationId !== civilizationId || (project && result.projectId !== project.projectId)) throw new Error("Invalid project link");
      if (project) retryKeys.current.delete(project.projectId);
      else { setRequestKey(crypto.randomUUID()); setName(""); }
      reload();
    } catch {
      setError(genericProjectError);
    } finally { pending.current = false; setSending(false); }
  };
  return <section className="projects" aria-label="Prosjekter">
    <h3>Prosjekter</h3>
    {projects.length === 0 ? <p>Ingen prosjekter</p> : <ul>{projects.map((project) => {
      const binding = project.harness;
      const mark = project.state === "established" && binding
        ? `Observert registrert i hermes (${binding.externalSlug}, ${binding.externalId}) ${binding.observedAt}. Erkl\u00e6rt sted, ikke bevis p\u00e5 arbeid.${binding.externalArchived ? ` Registreringen var arkivert i hermes ved siste observasjon ${binding.observedAt}.` : ""}`
        : project.state === "external-unknown" ? "Harness-registrering ukjent; ikke bevis p\u00e5 at den mislyktes. Mappa finnes."
          : project.state === "failed" ? `Opprettelse mislyktes. ${projectErrorMessage(project.reason)}` : "Opprettelse p\u00e5begynt.";
      return <li key={project.projectId}><h4>{project.name}</h4><p>{mark}</p><p>{project.workspacePath}</p>
        {project.state !== "established" && <button disabled={sending} onClick={() => void send(project)}>Pr&oslash;v igjen</button>}
      </li>;
    })}</ul>}
    {canCreate && <form onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label>Prosjektnavn<input name="name" required value={name} disabled={sending} onChange={(event) => setName(event.target.value)} /></label>
      <label htmlFor="project-harness">Harness</label>
      <select id="project-harness" name="harness" disabled={sending} defaultValue="hermes"><option value="hermes">hermes</option></select>
      <button disabled={sending} type="submit">Opprett</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export function App() {
  const [load, setLoad] = useState<WorldLoadResult | { kind: "loading" }>({ kind: "loading" });
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [height, setHeight] = useState(1000);
  const painting = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const places = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadWorld({ signal: controller.signal }).then((result) => {
      if (!controller.signal.aborted && result.kind !== "cancelled") setLoad(result);
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (selected !== null) {
      places.current.get(selected)?.scrollIntoView({ block: "nearest", inline: "nearest" });
      close.current?.focus({ preventScroll: true });
    }
  }, [selected]);

  const form = load.kind === "loaded" ? load.form : null;
  // CSS lays out the actual hit targets. Only the scroll extent needs measurement.
  useEffect(() => {
    const node = painting.current!;
    const observer = new ResizeObserver(() => setHeight(node.offsetHeight));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const inspected = form?.places.find((place) => place.id === selected);
  const changeZoom = (delta: number) => setZoom((value) => Math.max(0.6, Math.min(1.6, Math.round((value + delta) * 10) / 10)));
  const resetView = () => { setZoom(1); scene.current?.scrollTo(0, 0); };
  const dismiss = () => {
    if (selected !== null) places.current.get(selected)?.focus();
    setSelected(null);
  };
  const reload = () => {
    setSelected(null);
    setLoad({ kind: "loading" });
    setRevision((value) => value + 1);
  };
  const message = load.kind === "loading" ? "Reading the world" : load.kind === "failure"
    ? load.reason === "invalid-response" ? "Unrecognized world picture"
      : load.reason === "http" ? `World unavailable / HTTP ${load.status}` : "World connection failed"
    : "No civilizations founded";

  return <main aria-label="EcoSym" onKeyDown={(event) => {
    if (event.key === "Escape" && selected !== null) { event.preventDefault(); dismiss(); }
  }}>
    <header className="masthead"><div><span className="eyebrow">A world of civilizations</span><h1>EcoSym<span className="edition"> / field atlas</span></h1></div>
      <button onClick={reload} disabled={load.kind === "loading"}>Read again</button>
    </header>
    <div className="world-layout">
      <section className="map-region" aria-label="World terrain">
        <div className="map-heading"><span>THE WORLD</span><span>Declared places, recorded evidence</span></div>
        <div className="scene" ref={scene} tabIndex={0} aria-label="Explore world" aria-describedby="navigation-help"
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
            const viewport = event.currentTarget;
            drag.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
            viewport.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current) return;
            event.currentTarget.scrollLeft = drag.current.left - (event.clientX - drag.current.x);
            event.currentTarget.scrollTop = drag.current.top - (event.clientY - drag.current.y);
          }}
          onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
          onKeyDown={(event) => {
            const movement: Record<string, [number, number]> = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] };
            const delta = movement[event.key];
            if (delta) { event.preventDefault(); scene.current?.scrollBy({ left: delta[0], top: delta[1] }); }
            if (event.key === "+" || event.key === "=" || event.key === "-") { event.preventDefault(); changeZoom(event.key === "-" ? -0.1 : 0.1); }
            if (event.key === "Home") { event.preventDefault(); resetView(); }
          }}>
          <div className="world-size" style={{ width: 1600 * zoom, height: height * zoom }}>
            <div className="painted-world" ref={painting} style={{ transform: `scale(${zoom})` }}>
              <svg className="terrain" width="1600" height={height} aria-hidden="true">
                <defs><pattern id="grain" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M4 9h4 M30 35h7 M15 27h3" stroke="#b9a779" strokeWidth="2" /></pattern></defs>
                <rect width="1600" height={height} fill="#c8ba8a" />
                <path d={`M0 130 Q240 20 420 170 T900 130 T1600 160 V${height} H0Z`} fill="#b6ad7f" />
                <path d={`M0 520 Q240 350 450 560 T980 540 T1600 580 V${height} H0Z`} fill="#a5a17a" />
                <path d={`M1320 -50 Q1030 200 1250 440 T1190 850 T1350 ${height + 80}`} fill="none" stroke="#d7c798" strokeWidth="132" />
                <path d={`M1320 -50 Q1030 200 1250 440 T1190 850 T1350 ${height + 80}`} fill="none" stroke="#718f8b" strokeWidth="86" />
                <path d={`M1310 -50 Q1020 200 1240 440 T1180 850 T1340 ${height + 80}`} fill="none" stroke="#98aaa0" strokeWidth="8" strokeDasharray="36 19 9 23" />
                <path d="M-40 720 Q180 640 330 750 T680 700 M80 70 Q330 0 600 90 M650 920 Q850 800 1040 890" fill="none" stroke="#929474" strokeWidth="12" />
                <rect width="1600" height={height} fill="url(#grain)" />
                {Array.from({ length: 80 }, (_, index) => <path key={index} d={`M${(index * 193 + 48) % 1560} ${(index * 137 + 40) % height} h8 v-4 h8 v8 h-16Z`} fill={index % 2 ? "#969574" : "#d3c597"} />)}
              </svg>
              {(form?.places ?? []).map((place) => <button key={place.id} className="place" data-institution={place.institution}
                aria-label={`Inspect ${place.name}`} aria-expanded={place.id === selected}
                ref={(node) => { if (node) places.current.set(place.id, node); else places.current.delete(place.id); }}
                onFocus={(event) => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" })}
                onClick={() => setSelected(place.id)}>
                <span className="place-ground" aria-hidden="true"><span className="foundation"><i /><b /></span></span>
                <span className="place-name">{place.name}</span><span className="place-domain">{place.domain}</span>
                <span className="marks">{place.marks.map((mark, index) => <span key={index} className="mark" data-axis={mark.axis} data-kind={mark.kind} aria-label={mark.label} title={mark.label}>{mark.axis}: {mark.kind}</span>)}</span>
              </button>)}
            </div>
          </div>
        </div>
        {(!form || form.places.length === 0) && <div className={`world-message ${load.kind}`} role="status"><span className="eyebrow">{load.kind === "loaded" ? "Unwritten terrain" : "World read"}</span><h2>{message}</h2><p>{load.kind === "loaded" ? "A place begins with a declaration. Nothing has been placed here." : load.kind === "loading" ? "Waiting for the validated picture. No places are assumed." : "No world picture is displayed. This is not an empty or quiet world. Try reading again."}</p></div>}
        <nav className="map-controls" aria-label="World navigation"><button aria-label="Zoom out" onClick={() => changeZoom(-0.1)} disabled={zoom <= 0.6}>-</button><output aria-label="Zoom level">{Math.round(zoom * 100)}%</output><button aria-label="Zoom in" onClick={() => changeZoom(0.1)} disabled={zoom >= 1.6}>+</button><button onClick={resetView}>Home</button></nav>
        <p id="navigation-help">Drag to explore. Tab to places; Enter to inspect. Arrow keys pan, +/- zoom, Escape closes.</p>
      </section>
      {inspected && <aside className="inspection" aria-label={`Inspection: ${inspected.name}`}>
        <div className="inspection-heading"><span className="eyebrow">Place / inspection</span><button ref={close} onClick={dismiss}>Close inspection</button></div>
        <h2>{inspected.name}</h2><p className="domain">{inspected.domain}</p>
        <ul className="evidence-key">{inspected.marks.map((mark, index) => <li key={index} data-axis={mark.axis} data-kind={mark.kind}>{mark.label}</li>)}</ul>
        {inspected.inspection.map((field, index) => <section key={index} className="inspection-field"><h3>{field.label}</h3>{field.values.map((value, valueIndex) => <p key={valueIndex}>{value}</p>)}</section>)}
        <Projects key={inspected.id} civilizationId={inspected.id} canCreate={inspected.institution === "active"}
          projects={(form!.snapshot.projects ?? []).filter((project) => project.civilizationId === inspected.id)}
          reload={() => setRevision((value) => value + 1)} />
      </aside>}
    </div>
    <footer>ECOSYM <span>Founding is a place. Evidence is not a promise.</span><span>Neutral terrain / no inferred activity</span></footer>
  </main>;
}
