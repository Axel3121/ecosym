# Product

Echosystem is a **world of civilizations**: a living, inhabited representation of the
domains one person cares about, and of the agents working inside them.

## Owns

- the user problem Echosystem exists to solve;
- durable product concepts and product invariants;
- what a civilization, an inhabitant, and the council mean at the user surface;
- product non-goals.

## Does not own

- programming language, database, model, provider, deployment, or UI framework;
- component topology, security enforcement, or development workflow;
- current implementation, runtime, external-system, or task state.

Stable system boundaries are owned by `ARCHITECTURE.md`. Security and privacy
obligations are owned by `SECURITY.md`. Development obligations are owned by
`DEVELOPMENT.md`.

## Precedence

These four documents are loaded together and in no fixed order. Where they
appear to conflict:

Security, privacy, and authority protections prevail over everything else. A
product goal never overrides a protection.

Otherwise each document governs what it declares it owns. A statement outside a
document's declared ownership is context, not authority.

Where owners genuinely conflict, or where no owner answers a load-bearing
question, stop the affected consequential action and report the gap. Do not
resolve it by picking the more convenient rule.

## Purpose

Echosystem should reduce the work required to reconstruct personal context and decide
what deserves attention — by giving that context a place rather than a report.

The thinking happens elsewhere. Echosystem reads, and gives what it finds a form.

Whatever does that thinking — an agent harness, a personal assistant, a
scheduler, a person's own scripts — connects. Echosystem names none of them and
requires none of them. A world with nothing connected is empty, not broken.

Echosystem has no execution authority and renders only state it can account for:
external state it has observed, and institutional state the user declared.
Never operational success it inferred. It may submit requests to a runtime, which
decides whether and how to act. Echosystem is therefore not read-only, and is not
described as such: a user action inside Echosystem can cause work to begin.

Observed state is not only finished outcomes. Live operation is observable and
may be shown as live; a petition's own lifecycle is observable and may be shown
as a request. What may never happen is one being dressed as another — work in
progress depicted as work completed, or a request depicted as a result.

Echosystem does, however, own what the institution *means* — which civilizations
exist, what each may do, and what must be escalated. That makes Echosystem
trust-bearing even though it executes nothing: what Echosystem holds determines what
agents are permitted to do. Echosystem cannot perform an action, and it cannot widen
its own authority; but its state is consulted before governed work is allowed to
begin, and it is protected accordingly.

The durable product hypothesis is:

> A person understands the state of their own domains faster from an inhabited
> place they can move through than from a dashboard they must interpret.

### The governing invariant

**Delightful and true at the same time.**

A representation that is pleasant but wrong is a toy. The moment a city looks
prosperous while its real work is failing, the product has failed — not
partially, but completely. Every other invariant serves this one.

## Concepts

### Civilization

A domain of the user's life or work. The user founds civilizations; the product
ships with none. Founding one requires four things and no more:

- a name and a domain;
- which sources it sees;
- what it may do alone;
- what must go to the council.

A civilization's form is derived from what it contains, never authored.

Founding is sovereign. The user founds, dissolves, and redraws the mandate of a
civilization directly, without the council: these are acts upon the world
itself, not matters arising within it. The council governs what happens between
civilizations, and does not administer the person the world belongs to.

This is what makes an empty world possible to start. It also sharpens the
border rule: the council exists so that a civilization does not expand past its
own mandate — Rome deciding it now handles money is a matter for the council.
The user deciding that money exists as a domain is not.

### Inhabitant

An agent. Agents live in the civilization whose domain they work in.

Today every inhabitant is transient: work that arrives, acts, and leaves. The
runtime has no identity that survives a process, so nothing else can honestly be
shown.

A permanent inhabitant — a durable role that persists between sessions — is a
future category, available once durable identity exists. Until then a
civilization is populated by passing work, and the difference will be observed
rather than declared.

### Active-work view

Where a civilization's current coordination is visible: the agents running now,
their lineage and delegation tree, the tools they hold, what they are doing,
what was interrupted, and the traces of what finished. All of it time-bounded
and stamped as a live operation.

This is what can honestly be shown today, and it is why it is not called a town
hall. Coordination inside a runtime exists only while a process runs.

**City hall** is reserved. The name may be used when a civilization has a
lasting institution — identity, mandate, lifecycle, and coordination that
survives any single agent or session. Until then, using it would depict
standing office where there is only a running process.

### Petition

A request the user makes from inside Echosystem — typically by addressing a
civilization's coordinator — which Echosystem forwards to whichever runtime that
civilization runs on.

Echosystem holds no credentials, executes nothing, and decides nothing. A runtime may
refuse, alter, or defer any petition. Echosystem learns what came of it only by
observing state afterward, as it observes everything else.

A petition carries the user's identity, never Echosystem's. Echosystem is the envelope, not
the sender: it has no authority of its own to lend, and a runtime weighs a petition
exactly as it would the same request made anywhere else. Echosystem having a service
identity with rights of its own would give it the authority it is defined not to
have.

Each petition has a durable identity that outlives the asking, so that an
outcome observed later can be attributed to the petition that caused it. Without
that, attribution is mere coincidence in time — the world would show work as
caused by a request that did not cause it.

Petitions are the return path the council's queue requires. Without one, the
queue is a noticeboard the user can only shout at.

A petition is visible as a petition: a thing that was asked. It is never
depicted as a thing that happened.

How that identity is established, bound to authority, scoped, expired, and
recorded is not yet designed. Until it is, no consequential petition path is
built: an unauthenticated request that starts work is the failure this product
least survives.

### The council

The world-level headquarters, distinct from any single civilization's own
coordination.

The council does not exist yet. What follows is what a council must be, not a
description of something running: it is stated here so that the requirement is
canonical, and so that nothing depicts a council until one is real.

Civilizations are autonomous inside their own territory. Anything a
civilization does that **crosses a border** — money, new agents, work outside
its own mandate — is brought to the council, which draws on context from the
other civilizations and puts a recommendation to the user.

The border rule binds civilizations, not the user: founding, dissolving, and
redrawing a mandate are sovereign acts and bypass the council entirely.

The council holds a queue of open matters. It is the reason to open Echosystem.

The council sees every civilization, but only in summary: enough to know that
something is wrong, never the detail of why. Detail lives where the work lives,
and is reached by going there. A matter brought to the council carries the
context that matter requires, and nothing more.

This mirrors the border rule. Authority is local except where it crosses a
border; information is local except in summary. It is also what allows the
council to remain readable as the world grows.

Because Echosystem has no execution authority, the council's authority is procedural:
it is where cross-border decisions are surfaced and reasoned about. It cannot
compel or prevent what a runtime does.

A civilization may need something another civilization knows. It asks the
council, the council asks the other, and the answer returns the same way: a
question between civilizations crosses a border, so it travels through the
council rather than directly.

The council carries detail without holding it. It keeps the exchange — who
asked whom, about what, and a very short summary of what came back — because
that record is the council's own, and it is how recurring dependence between
civilizations becomes visible.

That summary is a trace that an answer happened. It is never a source to answer
from. Asked again, the council asks again: detail is owned by the civilization
that holds it, and is fetched fresh every time.

### The chronicler

Echosystem's own voice. It keeps the history, and compares what was said against what
happened.

Its independence comes from standing elsewhere, not from being smarter:

- **outcomes over reports** — what actually happened, later, not what was claimed
  at the time;
- **time** — patterns across weeks: what always fails, what is always deferred,
  what was promised and never finished;
- **across borders** — that two civilizations made the same mistake.

The chronicler has no power. It only knows. Advice falls out of history rather
than opinion.

The user can address the chronicler directly. The world is the surface; asking
is available within it.

### What the chronicler remembers

Memory is what makes the chronicler worth asking: a thing that only sees the
present notices nothing. But a memory that accumulates conclusions is how a
truthful world starts lying to itself, so what it keeps is constrained.

A noticed pattern is not an observation. It is something Echosystem worked out, and it
stays marked as that for as long as it is held. It carries what it was derived
from, over which window, and by what method — so the same rule that governs a
runtime's claims governs Echosystem's own.

A conclusion whose inputs changed is stale. It is not presented as current until
it has been reworked against what is now known. Nothing that was superseded
quietly comes back as support.

A conclusion may point at what to look into. It is never the evidence itself:
where the underlying records are available, they are what an answer rests on.
This is the council's rule about its own summaries, applied to Echosystem — a trace
that a conclusion happened is not a source to conclude from.

An answer shows its footing: what kind of thing each part is, where it came
from, how fresh it is, what was missing, and how to reach the records
underneath. An answer that cannot show this says so instead.

And it forgets. Echosystem holds what it needs to remain honest about the past, not a
private archive of everything other systems own. What it keeps, for how long,
and what happens to conclusions when a source is disconnected are decisions with
an owner — not an accident of never deleting.

## How the institution becomes real

A civilization, a mandate, or a council is only real if something enforces it.
Otherwise the world depicts constitutional government over runtimes that do
as it pleases — the failure this product is least able to survive.

Three layers, each owning what it is actually good at:

**Echosystem owns meaning.** Which civilizations exist, their jurisdiction, their
mandate, the rules of authority, and the institutional state the user sees. This
is not presentation: it is the definition of what is permitted.

**A control plane inside each runtime owns admission.** It decides whether work
may begin under a current Echosystem-defined mandate, dispatches what it admits,
coordinates live work, and binds the authorized scope to concrete runtime
limits. It is authoritative to its runtime rather than adjacent to it.

**The runtime owns execution.** Agents, tools, delegation, observation, and the
final enforcement check before a tool runs.

### Any runtime, but the world shows what it can enforce

Echosystem does not name its executor. A runtime connects the way a source connects,
and more than one may be connected at once.

What a runtime must offer to carry *governed* work is a contract, not a brand:

- **Admission** before governed work begins, under a current mandate.
- **Non-bypassability** — no other path into that runtime starts governed work
  without admission.
- **Bound scope** — the mandate resolves to concrete runtime limits.
- **Observable outcome** — what happened is readable, not merely asserted.
- **Enforcement** — a refusal point before an action takes effect.
- **Attributable identity** — work traces to the mandate that admitted it.

A runtime meeting none of these can still be connected. It simply cannot carry
governed work, and the world must show that plainly rather than depicting a
border it cannot hold. What each connected runtime can enforce is itself
observed state, and is never assumed.

### Governed work requires admission

No governed work may begin in any runtime unless that runtime's control plane
has admitted it under a current Echosystem-defined mandate. Runtime paths do not
bypass that admission, and tool execution remains subject to a final
enforcement check.

No runtime is known to satisfy this. Refusing an action before it runs is
common; admitting work before it begins is not, and a final refusal proves one
action was stopped rather than that the work was ever admitted. Until a
connected runtime offers admission at every governed entry point, this
requirement stands unmet there, and nothing may be depicted as governed on the
strength of a final check alone.

Without this, a mandate is prompt text and a border is a label. An agent still
acts to the limit of its raw permissions, and the world shows governance that
does not exist.

The enforcement check is the lock, not the institution: it can refuse an action,
but it cannot say who owns a matter, carry deliberation over time, or resolve an
ambiguous mandate.

### What exists, and what does not

Real today: Echosystem's institutional semantics; a connected runtime's execution primitives —
observation, delegation, spawning, steering, stopping, per-agent tool limits,
and a pre-execution check that can block.

Required and not yet built: the authoritative control plane; a durable case
that outlives the process that opened it; a lasting city hall; council
procedure; routing and escalation between civilizations.

The substrate for durable coordination is an open implementation choice. A
connected runtime
delegation is process-local and cannot carry a matter that waits days for an
answer, so something must; which thing is not decided here, and no candidate is
canonical until it has been proven.

### The first proof

One vertical chain, end to end, before any of this is built broadly:

a petition; a jurisdiction and mandate resolved deterministically; mandatory
admission; execution in a connected runtime; the enforcement check refusing what falls
outside the mandate; the outcome observed; the case persisted; the process
stopped and restarted; the case resumed correctly.

That chain proves the state model has a physical foundation. Until it holds,
the rest is drawing.

## How anything takes form

There is no list of permitted content types. A fixed taxonomy means the world
stops growing the moment something new appears.

Instead, anything new answers three questions, and the world knows what to do
with it without new code. The questions do not compete: one decides form, the
other two decide how that form behaves in time.

**Form — is it a thing, or a condition?**

A thing can be approached: it occupies a place and can be walked up to. A
condition is felt on arrival and colours the city — light, weather, prosperity.

This question alone decides form. Nothing is both object and atmosphere, and
this is the hard rule that keeps the world from becoming undifferentiated.

**Duration — does it persist, or is it gone afterward?**

Duration does not change what something is; it changes how long it holds and
how slowly it moves. A persistent thing is architecture and remains standing; a
transient thing is activity that arrives and leaves. A persistent condition is
climate; a transient condition is a gust of weather.

**Rhythm — once, or recurring?**

Rhythm gives something a sense of time. A one-off is an event. A recurring
thing is routine: it carries an expectation of return, and its absence is
itself visible.

Because form is settled before duration and rhythm apply, a lasting condition —
months of steady revenue — is climate rather than a contradiction. The
consequence is deliberate: some state is object and some is atmosphere.
Something to walk up to; something merely felt on arrival.

## Product invariants

### The world cannot flatter

Every visible property of the world is derived: from observed state, or from
institutional state the user has declared. Prosperity, decay, activity, and
population are consequences of what is true, never decoration chosen for
appearance.

The two are not interchangeable. Institutional state says what *should* exist —
that a civilization was founded, and what its mandate is. Observed state says
what *is happening*. A city drawn from a founding is honest, and it is empty
until something is observed in it; a city may never be shown as busy, prosperous,
or decaying on the strength of its charter.

### Depiction requires existence

Echosystem does not render authority, coordination, or activity that does not exist in
the system it reads. A depicted role corresponds to a real one.

Naming obeys the same rule. A word that implies a standing institution is not
used for something that lasts only as long as a process, however well the
metaphor would fit.

### Inference is not confirmation

Chronicle, pattern, summary, and recommendation never silently become
user-confirmed truth. Their epistemic status stays visible.

### Asking is not happening

A petition changes nothing in the world. Accepted, queued, assigned, and in
progress are states of a request, never of a result: they may be shown as such,
but they never become construction, prosperity, growth, or any other depiction
of work having been done.

The world moves only when an outcome is observed.

### Observation means evidence, not assertion

That a runtime reports something happened is a claim, not an observation. The
chronicler's whole value is outcomes over reports, and that distinction cannot
survive if any downstream claim is accepted as fact.

An observation is durable, timed, and comes from a source that owns the fact.
That is the whole of the evidence test. Where only a claim exists, the world
shows a claim.

Attribution is a separate matter. Where an observation has a traceable origin,
the world may show what caused it; where it does not, the observation remains
fully valid and is shown without a cause. Most of what is true happened without
anyone asking for it — views accruing, a balance changing — and such evidence
moves the world exactly as any other does.

What attribution guards is the link to a petition specifically: an outcome is
never tied to a request on the strength of having followed it in time.

### External facts keep their external owners

Reading an observation from another system does not make Echosystem authoritative for
that fact. Echosystem preserves the observation, its source, and when it was observed.

### History and current truth are distinct

A correction does not require pretending the earlier state never existed.
Historically true and currently true remain distinguishable, and superseded
state does not silently re-enter current reasoning.

### Unknown remains unknown

Missing provenance, verification, or currentness is presented as unknown. Echosystem
does not invent certainty to make a surface look complete. A city with no data
looks unfounded, not thriving.

### Neglect is shown, not scolded

A civilization decays when its domain has gone quiet: no work done, no
observations arriving, nothing moving. Tending is life in the domain, never
attention paid to Echosystem — a city whose agents shipped work yesterday is tended
whether or not the user looked at it. Decay that measured visits would be the
world reporting on its own use, and would flatter or condemn a city for reasons
that have nothing to do with what is true of it.

The user's own neglect is real, but it lives where it happens: matters left
unanswered accumulate visibly at the council. Two signals, in the two places
they belong.

Both are reported by appearance rather than by alerting, nagging, or ranking
the user.

A quiet civilization and a broken observation path look identical from inside
the world, and must not be shown identically. Where Echosystem has stopped seeing, it
shows that it cannot see. Silence is only depicted as quiet when it is known to
be quiet.

## What good means

Echosystem is improving when real use shows that:

- the world's appearance holds up against a spot check of the underlying
  systems;
- the world shows the user something they did not already know, rather than
  only confirming what they did;
- matters in the queue get answered rather than accumulating, and the ones that
  arrive are worth deciding;
- history changes later recommendations;
- the user voluntarily returns.

These signals begin as observations, not invented target percentages.

## Founding order

The engine is general from the first day, but the first civilization is founded
on real data before the world is generalised further — not because that domain
is special, but because it proves the rules hold.

**The test:** the second civilization must be foundable without writing code.
If it cannot be, the engine was not general.

The known failure mode is building the civilization engine for weeks and never
having one city that reflects anything real.

## Non-goals

Echosystem is not initially:

- a coding harness, task runner, or workflow builder;
- a system with execution authority, or one that can compel or prevent
  execution by the systems it reads;
- a control surface that grows toward operating a runtime rather than depicting
  it: petitions exist to serve the council's queue, not to become a remote
  control;
- a multi-user or team workspace;
- a universal store for facts owned by external systems;
- a general-purpose dashboard or metrics surface;
- a game, or a world whose appearance is authored rather than derived.

Echosystem does allow the user to define their own civilizations. This is a general
mechanism by intent, and is the one sense in which Echosystem is extensible; it does
not extend to executing or orchestrating work.

New product scope must be earned by repeated use or a concrete failure of the
current slice.

## Open questions

- Which durable substrate carries a case that waits days for an answer, and can
  it do so without taking over either Echosystem's authority semantics or a runtime's
  agent runtime?
- How is jurisdiction resolved deterministically, without a model deciding
  where a matter belongs?
- How does decay appear without reading as punishment?
- How is the council's queue represented inside the world?
- What counts as a source that owns a fact, and how is a traceable origin
  carried from petition to observed outcome?
- Petitions carry the user's identity: how is that identity established at the
  Echosystem surface, and what record does a petition leave?
- How much can the council prepare a matter on its own before the user sees it,
  and could well-evidenced matters eventually decide themselves? This is a
  direction, not a decision. Any such automatic decision requires an explicit
  mandate the user granted; a runtime enforces a mandate but never creates one,
  and executing work confers no authority to decide what work is permitted.
  Note the tension: an empty queue removes the reason to open Echosystem.
