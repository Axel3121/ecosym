import { createContext, useContext, useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { civilizations, matters as fixtureMatters, type Matter } from "./fixture.ts";
import { signal, since, worldLastRead } from "./derive.ts";
import { href, nav, parse, type Route } from "./routes.ts";
import { Room, ProjectRoom } from "./room.tsx";
import { Overview, Civilizations, Projects, Agents, Council, Chronicler, Search, Settings } from "./pages.tsx";
import "./styles.css";

/* ---------- Navigasjon ---------- */

export type Go = (next: Route, options?: { transition?: boolean }) => void;
export type Link = (next: Route, transition?: boolean) => (event: MouseEvent) => void;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function useRoute(): [Route, Go] {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parse(location.hash));
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const go: Go = (next, options = {}) => {
    const apply = () => { flushSync(() => setRoute(next)); history.pushState(null, "", href(next)); window.scrollTo({ top: 0 }); };
    if (options.transition && !reducedMotion() && "startViewTransition" in document) {
      (document as Document & { startViewTransition: (cb: () => void) => unknown }).startViewTransition(apply);
    } else apply();
  };
  return [route, go];
}

/* ---------- Delt tilstand (demo) ---------- */

export type Scheme = "system" | "light" | "dark";
export interface Store {
  matters: Matter[];
  decide: (id: string, decision: "approved" | "declined") => void;
  scheme: Scheme;
  setScheme: (scheme: Scheme) => void;
}
const StoreContext = createContext<Store | null>(null);
export const useStore = () => useContext(StoreContext)!;

function readScheme(): Scheme {
  try { const saved = localStorage.getItem("ecosym-scheme"); return saved === "light" || saved === "dark" ? saved : "system"; } catch { return "system"; }
}

/* ---------- App ---------- */

export function App() {
  const [route, go] = useRoute();
  const [matters, setMatters] = useState<Matter[]>(fixtureMatters);
  const [scheme, setSchemeState] = useState<Scheme>(readScheme);

  useEffect(() => {
    if (scheme === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = scheme;
  }, [scheme]);

  const store: Store = {
    matters,
    decide: (id, decision) => setMatters((all) => all.map((m) => m.id === id ? { ...m, state: "decided", decision, recommendation: `${decision === "approved" ? "Godkjent" : "Avslått"} av deg nå. ${m.recommendation}` } : m)),
    scheme,
    setScheme: (next) => { setSchemeState(next); try { localStorage.setItem("ecosym-scheme", next); } catch { /* per-viewer convenience only */ } },
  };

  const civ = route.kind === "civ" || route.kind === "project" ? civilizations.find((c) => c.id === route.id)! : null;
  const style = { "--line-hue": civ?.hue ?? 60, "--line-c": civ?.chroma ?? 0.03, "--room-on": civ ? 1 : 0 } as CSSProperties;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLInputElement>(".topbar input")?.focus();
        return;
      }
      if (event.key !== "Escape") return;
      if ((route.kind === "civ" || route.kind === "project") && route.card) go({ ...route, card: null });
      else if (route.kind === "project") go({ kind: "civ", id: route.id, tab: "prosjekter", card: null });
      else if (route.kind === "civ") go({ kind: "overview" }, { transition: true });
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const title = route.kind === "civ" || route.kind === "project" ? civ!.name : nav.find((n) => n.kind === route.kind)?.name ?? "EcoSym";
    document.title = title === "Oversikt" ? "EcoSym" : `${title} · EcoSym`;
  }, [route, civ]);

  const link: Link = (next, transition = false) => (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    // Vasken brer seg fra der du klikket.
    document.documentElement.style.setProperty("--vt-x", `${event.clientX}px`);
    document.documentElement.style.setProperty("--vt-y", `${event.clientY}px`);
    go(next, { transition });
  };

  return (
    <StoreContext.Provider value={store}>
      <div className={`app${civ ? " in-room" : ""}`} style={style}>
        <Sidebar route={route} link={link} />
        <div className="main">
          <Topbar route={route} go={go} />
          {route.kind === "overview" && <Overview link={link} />}
          {route.kind === "civs" && <Civilizations link={link} />}
          {route.kind === "projects" && <Projects link={link} />}
          {route.kind === "agents" && <Agents link={link} />}
          {route.kind === "council" && <Council route={route} link={link} />}
          {route.kind === "chronicler" && <Chronicler />}
          {route.kind === "search" && <Search route={route} go={go} link={link} />}
          {route.kind === "settings" && <Settings />}
          {route.kind === "civ" && <Room civ={civ!} route={route} link={link} />}
          {route.kind === "project" && <ProjectRoom civ={civ!} route={route} link={link} />}
        </div>
      </div>
    </StoreContext.Provider>
  );
}

/* ---------- Sidemeny ---------- */

function Sidebar({ route, link }: { route: Route; link: Link }) {
  const { matters } = useStore();
  const open = matters.filter((m) => m.state !== "decided").length;
  const currentCiv = route.kind === "civ" || route.kind === "project" ? route.id : null;
  const inRoom = currentCiv !== null;
  return (
    <nav className="sidebar" aria-label="Hovedmeny">
      <a className="wordmark" href="#/" onClick={link({ kind: "overview" }, inRoom)}>EcoSym</a>
      <ol className="nav">
        {nav.map((item) => {
          const current = item.kind === route.kind || (inRoom && item.kind === "civs");
          return (
            <li key={item.kind}>
              <a className={`nav-item${current ? " current" : ""}`} aria-current={current ? "page" : undefined} href={item.href} onClick={link(parse(item.href), inRoom)}>
                <NavIcon kind={item.kind} /><span className="label">{item.name}</span>{item.kind === "council" && open > 0 && <span className="badge" aria-label={`${open} saker venter`}>{open}</span>}
              </a>
            </li>
          );
        })}
      </ol>
      <h2 className="sidebar-h">Linjer</h2>
      <ol className="lines-nav">
        {civilizations.map((c) => {
          const sig = signal(c);
          const current = c.id === currentCiv;
          return (
            <li key={c.id} style={{ "--line-hue": c.hue, "--line-c": c.chroma } as CSSProperties}>
              <a className={`rail-line${current ? " current" : ""}${c.mandate.status === "dissolved" ? " dissolved" : ""}`} aria-current={current ? "page" : undefined}
                href={href({ kind: "civ", id: c.id, tab: "tavle", card: null })} onClick={link({ kind: "civ", id: c.id, tab: "tavle", card: null }, true)}>
                <span className="pill small">{c.code}</span>
                <span className="rail-name">{c.name}</span>
                <span className={`rail-word ${sig.tone}`}>{sig.word}</span>
              </a>
            </li>
          );
        })}
      </ol>
      <div className="sidebar-foot">
        <span className="demo" title="Alt innhold i denne prototypen er oppdiktet.">Demo-data</span>
        <span className="dim">Ingenting her er koblet til en backend.</span>
      </div>
    </nav>
  );
}

function Topbar({ route, go }: { route: Route; go: Go }) {
  const [q, setQ] = useState(route.kind === "search" ? route.q : "");
  useEffect(() => { setQ(route.kind === "search" ? route.q : ""); }, [route]);
  const last = worldLastRead(civilizations);
  return (
    <header className="topbar">
      <form className="search" role="search" onSubmit={(event) => { event.preventDefault(); go({ kind: "search", q }); }}>
        <input type="search" value={q} onChange={(event) => setQ(event.target.value)} placeholder="Søk i alt" aria-label="Søk" />
        <kbd aria-hidden="true">⌘K</kbd>
      </form>
      <div className="readline">
        <span className="dim">Lest {since(last)}</span>
        <button type="button" className="text-button" onClick={() => location.reload()}>Les på nytt</button>
      </div>
    </header>
  );
}

/* Tegnede ikoner, 18px, én strek. */
function NavIcon({ kind }: { kind: Route["kind"] }) {
  const common = { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  switch (kind) {
    case "overview": return <svg {...common}><circle cx="10" cy="10" r="7.25" /><path d="m12.8 7.2-1.6 4-4 1.6 1.6-4z" /></svg>;
    case "civs": return <svg {...common}><circle cx="7.5" cy="8.5" r="4.75" /><circle cx="12.5" cy="12" r="4.75" /></svg>;
    case "projects": return <svg {...common}><path d="M2.75 6.25a1.5 1.5 0 0 1 1.5-1.5h3.3l1.7 1.75h6.5a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5h-11.5a1.5 1.5 0 0 1-1.5-1.5z" /></svg>;
    case "agents": return <svg {...common}><circle cx="10" cy="6.75" r="3" /><path d="M3.75 17c.6-3.2 3.1-5 6.25-5s5.65 1.8 6.25 5" /></svg>;
    case "council": return <svg {...common}><path d="M3 7.5 10 3.5l7 4" /><path d="M4.5 7.5v7M9 7.5v7M11 7.5v7M15.5 7.5v7" /><path d="M3 16.5h14" /></svg>;
    case "chronicler": return <svg {...common}><path d="M10 5.5c-1.5-1.3-3.8-1.6-6.75-1.3v11.3c2.95-.3 5.25 0 6.75 1.3 1.5-1.3 3.8-1.6 6.75-1.3V4.2C13.8 3.9 11.5 4.2 10 5.5z" /><path d="M10 5.5v11.3" /></svg>;
    case "search": return <svg {...common}><circle cx="9" cy="9" r="5.25" /><path d="m13 13 4 4" /></svg>;
    case "settings": return <svg {...common}><path d="M3 6.5h14M3 13.5h14" /><circle cx="7.5" cy="6.5" r="1.9" fill="var(--sheet)" /><circle cx="12.5" cy="13.5" r="1.9" fill="var(--sheet)" /></svg>;
    default: return null;
  }
}

export function Page({ title, sub, children, wide }: { title: ReactNode; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <main className={`page${wide ? " wide" : ""}`}>
      <header className="page-head">
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </header>
      {children}
    </main>
  );
}
