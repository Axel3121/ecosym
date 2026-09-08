import { useEffect, useRef, useState } from "react";
import { loadWorld, type WorldLoadResult } from "./world-client.ts";
import "./world.css";

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
      </aside>}
    </div>
    <footer>ECOSYM <span>Founding is a place. Evidence is not a promise.</span><span>Neutral terrain / no inferred activity</span></footer>
  </main>;
}
