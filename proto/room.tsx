import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { columns, type Civilization, type Column, type Project, type Task } from "./fixture.ts";
import { ago, agentOf, columnName, projectOf, projectWord, runningCount, signal, since, sourceWord, stateWord, tasksIn } from "./derive.ts";
import { civRoute, civTabs, href, projectRoute, projectTabs, type Route } from "./routes.ts";
import type { Link } from "./App.tsx";

type CivRoute = Extract<Route, { kind: "civ" }>;
type ProjRoute = Extract<Route, { kind: "project" }>;

/* ---------- Sivilisasjon ---------- */

export function Room({ civ, route, link }: { civ: Civilization; route: CivRoute; link: Link }) {
  const s = signal(civ);
  const card = route.card ? civ.tasks.find((t) => t.id === route.card) ?? null : null;
  const running = runningCount(civ);
  const counts: Partial<Record<string, number>> = { tavle: civ.tasks.length, prosjekter: civ.projects.length, agenter: civ.agents.length, kilder: civ.sources.length };
  return (
    <div className={`room${card ? " has-card" : ""}`}>
      <div className="room-body">
        <header className="room-head">
          <span className="pill large">{civ.code}</span>
          <div className="room-title">
            <h1 className="name">{civ.name}</h1>
            <p className="domain">{civ.domain}</p>
          </div>
          <dl className="room-facts">
            <div><dt>Mandat</dt><dd><a href={href(civRoute(civ.id, "mandat"))} onClick={link(civRoute(civ.id, "mandat"))}>{civ.mandate.status === "active" ? `aktivt, ${civ.mandate.revision}` : "oppløst"}</a></dd></div>
            <div><dt>Agenter</dt><dd><a href={href(civRoute(civ.id, "agenter"))} onClick={link(civRoute(civ.id, "agenter"))}>{civ.agents.length === 0 ? "ingen" : `${running} av ${civ.agents.length} kjører`}</a></dd></div>
            <div><dt>Sikt</dt><dd className={s.tone === "loss" ? "loss" : undefined}><a href={href(civRoute(civ.id, "kilder"))} onClick={link(civRoute(civ.id, "kilder"))}>{s.tone === "loss" ? s.line.replace(/^Sikt tapt: /, "") : civ.sources.length === 0 ? "ingen kilder" : `${civ.sources.length} kilder, sist lest ${since(Math.min(...civ.sources.map((x) => x.lastReadAgo ?? Infinity)))}`}</a></dd></div>
          </dl>
        </header>

        <Tabs tabs={civTabs} active={route.tab} counts={counts} hrefOf={(t) => civRoute(civ.id, t as typeof route.tab)} link={link} resetKey={civ.id} />

        <section className="tab-body">
          {route.tab === "tavle" && <Board civ={civ} project={undefined} cardRoute={(id) => civRoute(civ.id, "tavle", id)} open={route.card} link={link} showProject />}
          {route.tab === "prosjekter" && <ProjectList civ={civ} link={link} />}
          {route.tab === "agenter" && <AgentRows civ={civ} link={link} />}
          {route.tab === "kilder" && <Sources civ={civ} />}
          {route.tab === "mandat" && <Mandate civ={civ} />}
        </section>
      </div>
      {card && <CardPanel civ={civ} task={card} close={link(civRoute(civ.id, "tavle"))} link={link} />}
    </div>
  );
}

/* ---------- Prosjekt ---------- */

export function ProjectRoom({ civ, route, link }: { civ: Civilization; route: ProjRoute; link: Link }) {
  const project = projectOf(civ, route.slug)!;
  const card = route.card ? civ.tasks.find((t) => t.id === route.card && t.project === project.slug) ?? null : null;
  const tasks = civ.tasks.filter((t) => t.project === project.slug);
  const runningHere = civ.agents.filter((a) => a.state === "running" && tasks.some((t) => t.id === a.taskId)).length;
  const counts: Partial<Record<string, number>> = { tavle: tasks.length };
  return (
    <div className={`room${card ? " has-card" : ""}`}>
      <div className="room-body">
        <p className="crumbs"><a href={href(civRoute(civ.id))} onClick={link(civRoute(civ.id), true)}><span className="pill small">{civ.code}</span>{civ.name}</a><span className="crumb-sep" aria-hidden="true">/</span><a href={href(civRoute(civ.id, "prosjekter"))} onClick={link(civRoute(civ.id, "prosjekter"))}>Prosjekter</a></p>
        <header className="room-head project-head">
          <div className="room-title">
            <h1 className="name">{project.name}</h1>
            <p className="domain">{project.about}</p>
          </div>
          <dl className="room-facts">
            <div><dt>Registrering</dt><dd className={project.state === "established" ? undefined : "waiting"}>{projectWord[project.state]}, {project.line}</dd></div>
            <div><dt>Agenter</dt><dd>{runningHere === 0 ? "ingen kjører her nå" : `${runningHere} kjører her nå`}</dd></div>
            <div><dt>Mappe</dt><dd>{project.path}</dd></div>
          </dl>
        </header>

        <Tabs tabs={projectTabs} active={route.tab} counts={counts} hrefOf={(t) => projectRoute(civ.id, project.slug, t as typeof route.tab)} link={link} resetKey={project.slug} />

        <section className="tab-body">
          {route.tab === "tavle" && <Board civ={civ} project={project.slug} cardRoute={(id) => projectRoute(civ.id, project.slug, "tavle", id)} open={route.card} link={link} />}
          {route.tab === "om" && <About civ={civ} project={project} />}
        </section>
      </div>
      {card && <CardPanel civ={civ} task={card} close={link(projectRoute(civ.id, project.slug))} link={link} />}
    </div>
  );
}

function About({ civ, project }: { civ: Civilization; project: Project }) {
  const tasks = civ.tasks.filter((t) => t.project === project.slug);
  const done = tasks.filter((t) => t.column === "done").length;
  return (
    <div className="about">
      <p>{project.about}</p>
      <dl className="facts-list">
        <div><dt>Tilstand</dt><dd>{projectWord[project.state]}. {project.line}.</dd></div>
        <div><dt>Mappe</dt><dd>{project.path}</dd></div>
        <div><dt>Oppgaver</dt><dd>{tasks.length} på tavla, {done} ferdig</dd></div>
        <div><dt>Sivilisasjon</dt><dd>{civ.name}. Prosjektet arver mandatet: kan {civ.mayActAlone.length} ting alene, må eskalere {civ.mustEscalate.length}.</dd></div>
      </dl>
      <p className="dim">Erklært sted, ikke bevis på arbeid. Det som er gjort, står på tavla og i kjøringene.</p>
    </div>
  );
}

/* ---------- Faner ---------- */

function Tabs<T extends string>({ tabs, active, counts, hrefOf, link, resetKey }: { tabs: { id: T; name: string }[]; active: T; counts: Partial<Record<string, number>>; hrefOf: (tab: T) => Route; link: Link; resetKey: string }) {
  const list = useRef<HTMLDivElement>(null);
  const [ink, setInk] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setInk({ x: el.offsetLeft, w: el.offsetWidth });
  }, [active, resetKey]);
  return (
    <div className="tabs" role="tablist" ref={list} aria-label="Funksjoner">
      {tabs.map((t) => (
        <a key={t.id} role="tab" aria-selected={t.id === active} className="tab" href={href(hrefOf(t.id))} onClick={link(hrefOf(t.id))}>
          {t.name}{counts[t.id] !== undefined && <span className="count">{counts[t.id]}</span>}
        </a>
      ))}
      {ink && <span className="tabs-ink" style={{ transform: `translateX(${ink.x}px) scaleX(${ink.w})` }} aria-hidden="true" />}
    </div>
  );
}

/* ---------- Tavle ---------- */

function Board({ civ, project, cardRoute, open, link, showProject }: { civ: Civilization; project: string | null | undefined; cardRoute: (id: string) => Route; open: string | null; link: Link; showProject?: boolean | undefined }) {
  const all = project === undefined ? civ.tasks : civ.tasks.filter((t) => t.project === project);
  if (all.length === 0) {
    return <Empty title="Ingen oppgaver på tavla." body={civ.mandate.status === "dissolved" ? "Sivilisasjonen er oppløst. Tavla står tom som et spor." : "Oppgaver kommer fra brettet sivilisasjonen leser. Ingen er lest for dette ennå."} />;
  }
  return (
    <div className="board" aria-label="Tavle">
      {columns.map((col) => {
        const tasks = tasksIn(civ, col.id, project);
        return (
          <section key={col.id} className={`column col-${col.id}`} aria-label={col.name}>
            <h2 className="column-head"><span>{col.name}</span><span className="count">{tasks.length}</span></h2>
            <ol className="cards">
              {tasks.map((t) => <Card key={t.id} civ={civ} task={t} column={col.id} open={t.id === open} route={cardRoute(t.id)} link={link} showProject={showProject} />)}
              {tasks.length === 0 && <li className="column-empty">Tomt</li>}
            </ol>
          </section>
        );
      })}
    </div>
  );
}

function Card({ civ, task, column, open, route, link, showProject }: { civ: Civilization; task: Task; column: Column; open: boolean; route: Route; link: Link; showProject?: boolean | undefined }) {
  const agent = agentOf(civ, task.agentId);
  const running = agent?.state === "running" && agent.taskId === task.id;
  const failed = task.runs[0]?.ok === false;
  return (
    <li>
      <a className={`card${open ? " open" : ""}${column === "done" ? " done" : ""}`} aria-current={open ? "true" : undefined} href={href(route)} onClick={link(route)}>
        <span className="card-title">{task.title}</span>
        <span className="card-meta">
          {agent ? <span className={`agent${running ? " running" : ""}`}>{running && <i className="live" aria-hidden="true" />}{agent.name}</span> : <span className="agent none">Ingen agent</span>}
          {showProject && task.project ? <span className="card-project">{task.project}</span> : <span />}
          <span className="when">{running ? "nå" : ago(task.updatedAgo)}</span>
          {task.outcome && <span className={`outcome${failed ? " failed" : ""}${column === "waiting" ? " waiting" : ""}`}>{task.outcome}</span>}
        </span>
      </a>
    </li>
  );
}

function CardPanel({ civ, task, close, link }: { civ: Civilization; task: Task; close: (event: MouseEvent) => void; link: Link }) {
  const agent = agentOf(civ, task.agentId);
  const project = projectOf(civ, task.project);
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { panel.current?.focus(); }, [task.id]);
  return (
    <aside className="panel" ref={panel} tabIndex={-1} aria-label={`Oppgave: ${task.title}`}>
      <div className="panel-head">
        <button type="button" className="icon-button" onClick={close} aria-label="Lukk"><Cross /></button>
      </div>
      <h2 className="panel-title">{task.title}</h2>
      <p className="panel-agent">
        {columnName(task.column)}. {agent ? <>{agent.name} {agent.taskId === task.id && agent.state === "running" ? "kjører på denne nå" : `er ${stateWord[agent.state]}`}.</> : "Ingen agent har tatt oppgaven."}
        {project && <> I prosjektet <a className="inline-link" href={href(projectRoute(civ.id, project.slug))} onClick={link(projectRoute(civ.id, project.slug))}>{project.name}</a>.</>}
      </p>
      {task.note && <p className="panel-note">{task.note}</p>}

      <h3 className="panel-h">Kjøringer</h3>
      {task.runs.length === 0 ? <p className="dim">Ingen kjøringer observert.</p> : (
        <ol className="runs">
          {task.runs.map((run, index) => (
            <li key={index} className={`run-item${run.ok === false ? " failed" : ""}${run.ok === null ? " live-run" : ""}`}>
              <span className="run-who">{agentOf(civ, run.agentId)?.name ?? run.agentId}</span>
              <span className="run-what">{run.outcome}</span>
              <span className="run-when">{run.ok === null ? "kjører" : `${since(run.startedAgo)}${run.minutes !== null ? `, ${run.minutes} min` : ""}`}</span>
            </li>
          ))}
        </ol>
      )}

      <h3 className="panel-h">Melding til worker</h3>
      <form className="petition" onSubmit={(event) => event.preventDefault()}>
        <textarea rows={3} placeholder="Skriv til agenten som eier oppgaven" aria-label="Melding til worker" disabled />
        <div className="petition-foot">
          <span className="dim">Ikke koblet til ennå. Meldingen blir en petisjon når backenden bærer den.</span>
          <button type="submit" className="button" disabled>Send</button>
        </div>
      </form>
    </aside>
  );
}

/* ---------- Lister inne i rommet ---------- */

function ProjectList({ civ, link }: { civ: Civilization; link: Link }) {
  if (civ.projects.length === 0) return <Empty title="Ingen prosjekter." body="Prosjekter opprettes fra Hermes og vises her med registreringstilstanden sin." />;
  const loose = civ.tasks.filter((t) => t.project === null).length;
  return (
    <>
      <ol className="rows" aria-label="Prosjekter">
        {civ.projects.map((p) => {
          const tasks = civ.tasks.filter((t) => t.project === p.slug);
          const running = civ.agents.filter((a) => a.state === "running" && tasks.some((t) => t.id === a.taskId)).length;
          return (
            <li key={p.slug} className="row">
              <span className="row-lead"><a className="row-link" href={href(projectRoute(civ.id, p.slug))} onClick={link(projectRoute(civ.id, p.slug))}>{p.name}</a></span>
              <span className="row-mid"><span className={`word ${p.state === "established" ? "quiet" : "waiting"}`}>{projectWord[p.state]}</span><span className="dim">{p.about}</span></span>
              <span className="row-when">{tasks.length} oppgaver{running > 0 ? `, ${running} kjører` : ""}</span>
            </li>
          );
        })}
      </ol>
      {loose > 0 && <p className="dim note">{loose} {loose === 1 ? "oppgave" : "oppgaver"} på tavla hører ikke til noe prosjekt.</p>}
    </>
  );
}

export function AgentRows({ civ, link, withCiv }: { civ: Civilization; link: Link; withCiv?: boolean }) {
  if (civ.agents.length === 0) return withCiv ? null : <Empty title="Ingen agenter observert." body="Agenter dukker opp her når en kjøring er lest fra en kilde. En tom liste er ikke bevis på at ingen jobber." />;
  return (
    <ol className="rows" aria-label={`Agenter i ${civ.name}`}>
      {civ.agents.map((a) => {
        const task = a.taskId ? civ.tasks.find((t) => t.id === a.taskId) : null;
        return (
          <li key={a.id} className="row">
            <span className="row-lead">{withCiv && <span className="pill small" style={{ "--line-hue": civ.hue, "--line-c": civ.chroma } as CSSProperties}>{civ.code}</span>}<span>{a.state === "running" && <i className="live" aria-hidden="true" />}{a.name}<span className="dim">, {a.kind}</span></span></span>
            <span className="row-mid">
              <span className={`word ${a.state}`}>{stateWord[a.state]}</span>
              {task ? <a className="inline-link" href={href(civRoute(civ.id, "tavle", task.id))} onClick={link(civRoute(civ.id, "tavle", task.id))}>{task.title}</a> : <span className="dim">ingen oppgave</span>}
            </span>
            <span className="row-when">{a.state === "running" ? "nå" : since(a.lastRunAgo)}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Sources({ civ }: { civ: Civilization }) {
  if (civ.sources.length === 0) return <Empty title="Ingen kilder erklært." body="En sivilisasjon uten kilder kan ikke ses. Det sier ingenting om hva som skjer i domenet." />;
  return (
    <ol className="rows" aria-label="Kilder">
      {civ.sources.map((s) => (
        <li key={s.id} className="row">
          <span className="row-lead">{s.id}</span>
          <span className="row-mid"><span className={`word ${s.status}`}>{sourceWord[s.status]}</span><span className="dim">{s.reason}</span></span>
          <span className="row-when">{since(s.lastReadAgo)}</span>
        </li>
      ))}
    </ol>
  );
}

function Mandate({ civ }: { civ: Civilization }) {
  return (
    <div className="mandate">
      <p className="mandate-line">{civ.mandate.status === "active" ? <>Aktivt mandat, revisjon {civ.mandate.revision}, registrert {since(civ.mandate.recordedAgo)}.</> : <>Oppløst {since(civ.mandate.recordedAgo)}. Mandatet er ikke lenger i kraft.</>} Erklært av deg, ikke bevis på arbeid.</p>
      <div className="mandate-cols">
        <section><h2>Kan gjøre alene</h2>{civ.mayActAlone.length === 0 ? <p className="dim">Ingenting.</p> : <ul>{civ.mayActAlone.map((x) => <li key={x}>{x}</li>)}</ul>}</section>
        <section><h2>Må eskaleres</h2>{civ.mustEscalate.length === 0 ? <p className="dim">Ingenting.</p> : <ul>{civ.mustEscalate.map((x) => <li key={x}>{x}</li>)}</ul>}</section>
      </div>
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return <div className="empty"><p className="empty-title">{title}</p><p className="dim">{body}</p></div>;
}

export function ArrowRight() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 3.5 11 8l-4.5 4.5M11 8H3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export function Cross() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}
