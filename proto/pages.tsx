import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { chronicle, civilizations, events, type Civilization, type Event } from "./fixture.ts";
import { ago, attention, changedAgo, civOf, greeting, lead, matterWord, moving, projectWord, runningNow, search, signal, since } from "./derive.ts";
import { civRoute, href, parse as parseHref, projectRoute, type Route } from "./routes.ts";
import { AgentRows, ArrowRight, Empty } from "./room.tsx";
import { Page, useStore, type Go, type Link, type Scheme } from "./App.tsx";

/* ---------- Oversikt ---------- */

export function Overview({ link }: { link: Link }) {
  const { matters } = useStore();
  const hour = new Date().getHours();
  const sentence = lead(civilizations);
  const running = runningNow(civilizations);
  const waiting = attention(civilizations, matters);
  return (
    <main className="page overview">
      <header className="page-head">
        <h1>{greeting(hour)}, Axel.</h1>
        <p className="page-sub lead">{sentence.join(" ")}</p>
      </header>

      <ol className="regions" aria-label="Sivilisasjoner">
        {civilizations.map((c) => <Region key={c.id} civ={c} link={link} />)}
      </ol>

      <div className="triptych">
        <section className="col" aria-labelledby="now-h">
          <h2 id="now-h">Pågår nå</h2>
          <p className="col-sub">Agenter med en kjøring som er observert i gang.</p>
          {running.length === 0 ? <p className="dim">Ingen kjøringer observert akkurat nå.</p> : (
            <ol className="feed">
              {running.slice(0, 3).map((row) => (
                <li key={row.key} className="feed-row">
                  <span className="pill small" style={lineVars(row.civ)}>{row.civ.code}</span>
                  <span className="feed-main">
                    <span className="feed-title"><i className="live" aria-hidden="true" />{row.who}</span>
                    <a className="feed-detail inline-link" href={href(civRoute(row.civ.id, "tavle", row.taskId))} onClick={link(civRoute(row.civ.id, "tavle", row.taskId))}>{row.what}</a>
                  </span>
                  <span className="feed-when">nå</span>
                </li>
              ))}
            </ol>
          )}
          <a className="more" href="#/agenter" onClick={link({ kind: "agents" })}>Alle agenter</a>
        </section>

        <section className="col" aria-labelledby="wait-h">
          <h2 id="wait-h">Venter på deg</h2>
          <p className="col-sub">Ting ingen agent kan avgjøre alene.</p>
          {waiting.length === 0 ? <p className="dim">Ingenting venter. Verden går uten deg en stund.</p> : (
            <ol className="feed">
              {waiting.slice(0, 4).map((row) => (
                <li key={row.key} className="feed-row">
                  {row.civ ? <span className="pill small" style={lineVars(row.civ)}>{row.civ.code}</span> : <span className="pill small council">RÅD</span>}
                  <span className="feed-main">
                    <a className="feed-title inline-link" href={row.href} onClick={link(routeFromHref(row.href))}>{row.title}</a>
                    <span className="feed-detail">{row.where}</span>
                  </span>
                  <span className="feed-when">{row.agoMin === 0 ? "" : ago(row.agoMin)}</span>
                </li>
              ))}
            </ol>
          )}
          {waiting.length > 4 && <a className="more" href="#/raadet" onClick={link({ kind: "council", matter: null })}>{waiting.length - 4} til, blant annet i Rådet</a>}
        </section>

        <section className="col" aria-labelledby="events-h">
          <h2 id="events-h">Siste hendelser</h2>
          <p className="col-sub">Slik Krønikeren har lest dem.</p>
          <ol className="feed">
            {events.slice(0, 3).map((e) => <EventRow key={e.id} event={e} />)}
          </ol>
          <a className="more" href="#/kroniker" onClick={link({ kind: "chronicler" })}>Hele krøniken</a>
        </section>
      </div>

      <Ask compact />
    </main>
  );
}

/** Lenker fra avledninger er allerede fullstendige; ruteren tolker dem. */
const routeFromHref = (h: string): Route => parseHref(h);

const lineVars = (c: Civilization) => ({ "--line-hue": c.hue, "--line-c": c.chroma } as CSSProperties);

function EventRow({ event }: { event: Event }) {
  const civ = civOf(event.civ);
  return (
    <li className="feed-row">
      {civ ? <span className="pill small" style={lineVars(civ)}>{civ.code}</span> : <span className="pill small council">{event.kind === "council" ? "RÅD" : "KR"}</span>}
      <span className="feed-main">
        <span className="feed-title">{event.title}</span>
        <span className="feed-detail">{event.detail}</span>
      </span>
      <span className="feed-when">{ago(event.ago)}</span>
    </li>
  );
}

/* ---------- Regioner (oversikten) ---------- */

function Region({ civ, link }: { civ: Civilization; link: Link }) {
  const s = signal(civ);
  const row = moving(civ)[0] ?? null;
  const dissolved = civ.mandate.status === "dissolved";
  const changed = changedAgo(civ);
  return (
    <li className={`region tone-${s.tone}${dissolved ? " dissolved" : ""}`} style={lineVars(civ)}>
      <a className="region-link" href={href(civRoute(civ.id))} onClick={link(civRoute(civ.id), true)} aria-label={`Gå inn i ${civ.name}: ${s.line}`}>
        <span className="region-head"><span className="pill">{civ.code}</span><span className="region-name">{civ.name}</span></span>
        <span className="signals">
          {s.tone !== "change" && changed !== null && <span className="signal change">Noe endret {since(changed)}</span>}
          <span className={`signal ${s.tone}`}>{s.line}</span>
        </span>
        {row && (
          <span className={`region-now tone-${row.tone}`}>
            <span className="who">{row.tone === "run" ? <><i className="live" aria-hidden="true" />{row.who}</> : row.who}</span>
            <span className="when">{row.tone === "run" ? "nå" : ago(row.agoMin)}</span>
            <span className="what">{row.what}</span>
          </span>
        )}
      </a>
    </li>
  );
}

/* ---------- Bånd ---------- */

export function Band({ civ, link, compact }: { civ: Civilization; link: Link; compact?: boolean }) {
  const s = signal(civ);
  const rows = moving(civ).slice(0, compact ? 1 : 3);
  void compact;
  const dissolved = civ.mandate.status === "dissolved";
  const changed = changedAgo(civ);
  return (
    <li className={`band tone-${s.tone}${dissolved ? " dissolved" : ""}`} style={lineVars(civ)}>
      <a className="band-link" href={href(civRoute(civ.id))} onClick={link(civRoute(civ.id), true)} aria-label={`Gå inn i ${civ.name}: ${s.line}`}>
        <span className="pill">{civ.code}</span>
        <span className="band-name">
          <span className="name">{civ.name}</span>
          <span className="domain">{civ.domain}</span>
        </span>
        <span className="band-now">
          <span className="signals">
            {s.tone !== "change" && changed !== null && <span className="signal change">Noe endret {since(changed)}</span>}
            <span className={`signal ${s.tone}`}>{s.line}</span>
          </span>
          {rows.map((row) => (
            <span key={row.key} className={`now-row tone-${row.tone}`}>
              <span className="who">{row.tone === "run" ? <><i className="live" aria-hidden="true" />{row.who}</> : row.who}</span>
              <span className="what">{row.what}</span>
              <span className="when">{row.tone === "run" ? "nå" : ago(row.agoMin)}</span>
            </span>
          ))}
        </span>
      </a>
    </li>
  );
}

/* ---------- Lister ---------- */

export function Civilizations({ link }: { link: Link }) {
  const founded = civilizations.filter((c) => c.mandate.status !== "dissolved").length;
  return (
    <Page title="Sivilisasjoner" sub={`${founded} grunnlagt, ${civilizations.length - founded} oppløst. Hver er en linje med sin egen farge; du går inn i én om gangen.`} wide>
      <ol className="lines" aria-label="Sivilisasjoner">
        {civilizations.map((c) => <Band key={c.id} civ={c} link={link} />)}
      </ol>
      <p className="reserved">Å grunnlegge, omtegne og oppløse gjøres i CLI-et i dag. Flaten viser bare det som er erklært.</p>
    </Page>
  );
}

export function Projects({ link }: { link: Link }) {
  const total = civilizations.reduce((n, c) => n + c.projects.length, 0);
  return (
    <Page title="Prosjekter" sub={`${total} prosjekter på tvers av linjene. Hvert prosjekt har sin egen tavle.`} wide>
      {civilizations.filter((c) => c.projects.length > 0).map((c) => (
        <section key={c.id} className="group" style={lineVars(c)} aria-labelledby={`g-${c.id}`}>
          <h2 id={`g-${c.id}`} className="group-h"><span className="pill small">{c.code}</span><a className="row-link" href={href(civRoute(c.id))} onClick={link(civRoute(c.id), true)}>{c.name}</a></h2>
          <ol className="rows">
            {c.projects.map((p) => {
              const tasks = c.tasks.filter((t) => t.project === p.slug);
              const running = c.agents.filter((a) => a.state === "running" && tasks.some((t) => t.id === a.taskId)).length;
              return (
                <li key={p.slug} className="row">
                  <span className="row-lead"><a className="row-link" href={href(projectRoute(c.id, p.slug))} onClick={link(projectRoute(c.id, p.slug), true)}>{p.name}</a></span>
                  <span className="row-mid"><span className={`word ${p.state === "established" ? "quiet" : "waiting"}`}>{projectWord[p.state]}</span><span className="dim">{p.about}</span></span>
                  <span className="row-when">{tasks.length} oppgaver{running > 0 ? `, ${running} kjører` : ""}</span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </Page>
  );
}

export function Agents({ link }: { link: Link }) {
  const all = civilizations.flatMap((c) => c.agents);
  const running = all.filter((a) => a.state === "running").length;
  return (
    <Page title="Agenter" sub={`${all.length} agenter er observert. ${running} kjører nå. Alle er forbigående: arbeid som kommer, gjør noe og går.`} wide>
      {civilizations.filter((c) => c.agents.length > 0).map((c) => (
        <section key={c.id} className="group" style={lineVars(c)} aria-labelledby={`a-${c.id}`}>
          <h2 id={`a-${c.id}`} className="group-h"><span className="pill small">{c.code}</span><a className="row-link" href={href(civRoute(c.id))} onClick={link(civRoute(c.id), true)}>{c.name}</a></h2>
          <AgentRows civ={c} link={link} />
        </section>
      ))}
    </Page>
  );
}

/* ---------- Rådet ---------- */

export function Council({ route, link }: { route: Extract<Route, { kind: "council" }>; link: Link }) {
  const { matters, decide } = useStore();
  const open = matters.filter((m) => m.state !== "decided");
  const selected = matters.find((m) => m.id === route.matter) ?? open[0] ?? matters[0] ?? null;
  return (
    <Page title="Rådet" sub={`Det som krysser en grense mellom sivilisasjoner. ${open.length === 0 ? "Ingen saker venter." : `${open.length} ${open.length === 1 ? "sak venter" : "saker venter"} på et ord fra deg.`}`} wide>
      <div className="council">
        <ol className="rows matters" aria-label="Rådssaker">
          {matters.map((m) => {
            const from = civOf(m.from)!; const to = civOf(m.to)!;
            const current = selected?.id === m.id;
            return (
              <li key={m.id} className={`row matter${current ? " current" : ""}`}>
                <a className="row-link matter-link" href={href({ kind: "council", matter: m.id })} onClick={link({ kind: "council", matter: m.id })} aria-current={current ? "true" : undefined}>
                  <span className="matter-title">{m.title}</span>
                  <span className="row-when">{ago(m.openedAgo)}</span>
                  <span className="matter-route"><span className="pill small" style={lineVars(from)}>{from.code}</span><span className="crumb-sep"><ArrowRight /></span><span className="pill small" style={lineVars(to)}>{to.code}</span><span className={`word ${m.state}`}>{matterWord[m.state]}</span></span>
                </a>
              </li>
            );
          })}
        </ol>
        {selected && (
          <article className="matter-detail" aria-live="polite">
            <h2>{selected.title}</h2>
            <p className="dim">{civOf(selected.from)!.name} ber om noe som ligger under {civOf(selected.to)!.name}. Åpnet {since(selected.openedAgo)}.</p>
            <h3>Saken</h3>
            <p>{selected.summary}</p>
            <h3>Rådets anbefaling</h3>
            <p>{selected.recommendation}</p>
            {selected.state !== "decided" ? (
              <div className="decide">
                <button type="button" className="button" onClick={() => decide(selected.id, "approved")}>Godkjenn</button>
                <button type="button" className="button quiet" onClick={() => decide(selected.id, "declined")}>Avslå</button>
                <span className="dim">Avgjørelsen din registreres bare i denne prototypen.</span>
              </div>
            ) : <p className={`word ${selected.decision === "approved" ? "quiet" : "loss"}`}>{selected.decision === "approved" ? "Godkjent" : "Avslått"}</p>}
          </article>
        )}
      </div>
    </Page>
  );
}

/* ---------- Krønikeren ---------- */

export function Chronicler() {
  return (
    <Page title="Krønikeren" sub="EcoSyms egen stemme. Den forteller bare det som er lest, og sier fra når sikten er tapt.">
      <Ask />
      <section className="chronicle" aria-label="Dagsnotater">
        {chronicle.map((entry) => (
          <article key={entry.day} className="entry">
            <h2>{entry.day}<span className="entry-when">{since(entry.ago)}</span></h2>
            <p>{entry.text}</p>
          </article>
        ))}
      </section>
      <section className="chronicle" aria-labelledby="ev-h">
        <h2 id="ev-h" className="section-h">Alle hendelser</h2>
        <ol className="feed">{events.map((e) => <EventRow key={e.id} event={e} />)}</ol>
      </section>
    </Page>
  );
}

/** Spørrefeltet. Svarene er satt sammen av det prototypen har lest, ikke av en modell. */
export function Ask({ compact }: { compact?: boolean }) {
  const { matters } = useStore();
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: string }[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (log.length > 0) end.current?.scrollIntoView({ block: "nearest" }); }, [log]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const question = q.trim();
    if (!question) return;
    setLog((l) => [...l, { q: question, a: answer(question, matters) }]);
    setQ("");
  };
  return (
    <section className={`ask${compact ? " compact" : ""}`} aria-label="Spør Krønikeren">
      {log.length > 0 && (
        <ol className="ask-log">
          {log.map((turn, i) => (
            <li key={i}>
              <p className="ask-q">{turn.q}</p>
              <p className="ask-a">{turn.a}</p>
            </li>
          ))}
          <div ref={end} />
        </ol>
      )}
      <form onSubmit={submit}>
        <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Spør Krønikeren om hva som skjer" aria-label="Spør Krønikeren" />
        <button type="submit" className="button" disabled={q.trim().length === 0}>Spør</button>
      </form>
      <p className="ask-note dim">Demo-svar: satt sammen av det som er lest, ikke av en modell. Krønikeren er erklært, ikke bygd.</p>
    </section>
  );
}

function answer(question: string, matters: ReturnType<typeof useStore>["matters"]): string {
  const q = question.toLowerCase();
  const named = civilizations.find((c) => q.includes(c.name.toLowerCase()) || q.includes(c.id));
  if (named) {
    const s = signal(named);
    const rows = moving(named);
    const doing = rows.filter((r) => r.tone === "run").map((r) => `${r.who} kjører på «${r.what}»`).join("; ");
    return `${named.name}: ${s.line}. ${doing ? `${doing}. ` : ""}${named.sources.length} kilder erklært, sist lest ${since(Math.min(...named.sources.map((x) => x.lastReadAgo ?? Infinity)))}.`;
  }
  if (q.includes("råd") || q.includes("sak")) {
    const open = matters.filter((m) => m.state !== "decided");
    return open.length === 0 ? "Ingen rådssaker venter." : `${open.length} ${open.length === 1 ? "sak venter" : "saker venter"}: ${open.map((m) => m.title).join("; ")}.`;
  }
  if (q.includes("venter") || q.includes("meg")) {
    const rows = attention(civilizations, matters);
    return rows.length === 0 ? "Ingenting venter på deg." : `${rows.length} ting venter på deg: ${rows.map((r) => r.title).join("; ")}.`;
  }
  return `${lead(civilizations).join(" ")} Spør om en sivilisasjon ved navn for å høre mer.`;
}

/* ---------- Søk ---------- */

export function Search({ route, go, link }: { route: Extract<Route, { kind: "search" }>; go: Go; link: Link }) {
  const [q, setQ] = useState(route.q);
  useEffect(() => { setQ(route.q); }, [route.q]);
  const hits = search(q);
  return (
    <Page title="Søk" sub="Sivilisasjoner, prosjekter, oppgaver, agenter, kilder og rådssaker.">
      <form className="search big" role="search" onSubmit={(e) => { e.preventDefault(); go({ kind: "search", q }); }}>
        <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Skriv minst to tegn" aria-label="Søk" />
      </form>
      {q.trim().length >= 2 && hits.length === 0 && <Empty title="Ingen treff." body="Prøv et navn, en oppgave-ID eller et ord fra en tittel." />}
      {hits.length > 0 && (
        <ol className="rows" aria-label="Treff">
          {hits.map((h, i) => (
            <li key={i} className="row">
              <span className="row-lead">{h.civ ? <span className="pill small" style={lineVars(h.civ)}>{h.civ.code}</span> : <span className="pill small council">RÅD</span>}<a className="row-link" href={h.href} onClick={link(parseHref(h.href), h.kind === "Sivilisasjon" || h.kind === "Prosjekt")}>{h.title}</a></span>
              <span className="row-mid"><span className="dim">{h.where}</span></span>
              <span className="row-when">{h.kind}</span>
            </li>
          ))}
        </ol>
      )}
    </Page>
  );
}

/* ---------- Innstillinger ---------- */

export function Settings() {
  const { scheme, setScheme } = useStore();
  const options: { id: Scheme; name: string; body: string }[] = [
    { id: "system", name: "Følg systemet", body: "Lys om dagen, mørk om kvelden, slik maskinen din er satt." },
    { id: "light", name: "Lys", body: "Tonet papir. Linjene farger rommene svakt." },
    { id: "dark", name: "Mørk", body: "Varm grafitt. Linjene farger rommene tydelig." },
  ];
  return (
    <Page title="Innstillinger" sub="Det lille du kan stille på i flaten. Alt annet er erklært i verdenen eller lest fra kilder.">
      <fieldset className="choice">
        <legend>Fargeskjema</legend>
        {options.map((o) => (
          <label key={o.id} className={`choice-item${scheme === o.id ? " current" : ""}`}>
            <input type="radio" name="scheme" value={o.id} checked={scheme === o.id} onChange={() => setScheme(o.id)} />
            <span className="choice-name">{o.name}</span>
            <span className="dim">{o.body}</span>
          </label>
        ))}
      </fieldset>
      <section className="about-proto">
        <h2 className="section-h">Om denne prototypen</h2>
        <p>Alt innhold er demo-data. Ingenting er koblet til EcoSyms backend, Hermes eller noen agent. Det du ser er strukturen og uttrykket, ikke tilstanden i verden din.</p>
      </section>
    </Page>
  );
}
