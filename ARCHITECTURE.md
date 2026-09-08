# Architecture

This document owns Ecosym's stable system boundaries: which concern owns which
kind of state, how information and authority may cross boundaries, and which
properties must survive replacement of current implementation choices.

## Owns

- stable component and concern boundaries;
- authoritative ownership of Ecosym-controlled information;
- trust and authority topology;
- durable dependency direction and isolation properties.

## Does not own

- current language, framework, database, model, provider, or deployment choice;
- exact schemas, APIs, state machines, prompts, or file layout;
- live configuration, runtime state, or development workflow;
- duplicated product or security policy.

Product purpose is owned by `PRODUCT.md`. Security obligations are owned by
`SECURITY.md`. Development obligations are owned by `DEVELOPMENT.md`.

## Stable concerns

```text
User
  ↓
World surface
  ↓
Ecosym application core
  ├── institution owner        — civilizations, jurisdiction, mandate, authority
  ├── observation owner        — what was seen, provenance, collection health
  ├── form boundary            — observation-derived depiction
  ├── model boundary           — reasoning over selected input
  └── petition boundary        — a request leaving for an authority
       ↓
each connected runtime, independently:
  ├── control plane            — admission of governed work
  └── execution                — agents, tools, delegation, enforcement
       ↓
External systems that remain owners of their own facts and effects
```

These are logical boundaries. They do not imply separate packages, processes,
services, repositories, or machines. Use the cheapest boundary that provides the
required property; stronger isolation is introduced when capability and blast
radius require it.

## Concern ownership

### World surface

The surface renders the world and accepts user input. It owns no durable state,
no credentials, no authority, and no external facts.

The surface never reads an external source, a raw store, another owner's internal
record, or a raw export bundle directly. This boundary is expensive to introduce
later, and it is not optional: a surface allowed to reach a source directly can
render something that was never observed.

What it renders is composed by the application core from what each owner
explicitly exposes. Institutional state comes from the institution owner as a
user-declared input, never inferred or evidence of runtime enforcement. Observed
state comes from the observation owner through the form boundary: it is derived, never
authored. Institutional state need not become an observation or pass through the
observation owner or form boundary to reach the surface, but its depiction must
still obey the same fair, uniform rules.

### Application core

The core coordinates behavior and validates requests across the boundaries
below. Model output is input to this core, never an alternative control plane.

The core composes a closed, runtime-validated world display contract from
institution-owned and observation-owned projections. Transport serializes that
already-composed contract; it does not own observation-to-depiction semantics.
Neither transport nor surface receives external source or database handles in
that contract. Institutional state is composed alongside observations, not routed
through the observation owner to make it displayable.

### Institution owner

Ecosym owns institutional semantics: which civilizations exist, their
jurisdiction, their mandate, the rules of authority, and the institutional state
the user sees. This is definitional, not presentational — what it holds
determines what work is permitted.

It therefore has one logical source of record, and it is trust-bearing. Ecosym
cannot execute an action and cannot widen its own authority, but its state is
consulted before governed work is admitted.

Mandates are resolved deterministically from owned rules. A model may not decide
jurisdiction, mandate, or authority.

### Observation owner

Ecosym-owned durable observations have one logical source of record. An
observation keeps enough source, temporal, and status information to establish
what was seen, from which owner, when, and whether it is current.

An observation is durable, timed, and attributed to a source that owns the fact.
A claim from an intermediary is stored as a claim and remains distinguishable
from an observation for as long as it is held.

Attribution to a cause is a separate property. An observation without a
traceable origin is fully valid and is held without one; a cause is never
inferred from having followed a petition in time.

No generic trusted flag may collapse provenance, epistemic status, authority,
and temporal validity into one value.

The observation owner also owns collection attempts and connection health:
whether Ecosym read a source, quietly re-read it, has never read it, or cannot
currently read it. This metadata describes Ecosym's collection process, not an
external observation or the outcome of work. Successful empty or unchanged
collection establishes quiet only in the collected picture, not domain inactivity.

The observation owner owns admitted external-source reports and their provenance,
timing, and source-reported status. Upstream verification, freshness, uncertainty,
and observation state remain distinct from Ecosym confirmation and collection
health. Public projections expose bounded report metadata and epistemically
labeled facts, not owner-private payloads or external schema objects.

### Form boundary

Depiction of observed activity is derived from observed state, never authored.
The observation-to-depiction rules are owned here. User-declared institutional
state is a distinct declared input, not an observation. Wherever either is
depicted, the rules are fair and uniform for every civilization: nothing gains
a special appearance by being important.

Absence of observation and absence of activity are distinct inputs and must
remain distinguishable at this boundary. A surface cannot recover the difference
once it has been collapsed.

No founding, a founded civilization without observations, known collection
quiet, and an unread source are distinct. Unknown, current, and historical
temporal evidence stays distinct from collection health. Missing source time
remains unknown; collection time or display time never substitutes for it.
Depicting an external recorded workflow field does not turn it into an observed
effect or a cause of civilization activity.

### Model boundary

Models perform ephemeral reasoning over application-selected input. They may
produce responses, proposed interpretations, or proposed actions. They own no
durable state, no authority, no secrets, and no effect outcomes.

Replacing a model or provider must not require redefining Ecosym's institutional
or observational semantics.

### Petition boundary

A petition is a typed request leaving Ecosym for an authority. It carries the
user's identity, never Ecosym's, and Ecosym holds no credentials to lend it.

A petition has a durable identity that outlives the asking, so that an outcome
observed later can be attributed to it. Its own lifecycle — asked, admitted,
refused, executed — is distinct from any depiction of work having happened.

## Authority topology

```text
Ecosym            defines what is permitted
  ↓ petition + authority context
control plane   admits or refuses governed work
  ↓ only if admitted
runtime agents  execute
  ↓
enforcement check   final refusal before a tool runs
```

No governed work may begin unless its runtime's control plane has admitted it under
a current Ecosym-defined mandate. Runtime paths do not bypass that admission, and
tool execution remains subject to a final enforcement check.

The enforcement check is a lock, not an institution. It can refuse an action; it
cannot say who owns a matter, carry deliberation over time, or resolve an
ambiguous mandate.

The control plane is authoritative to its runtime rather than adjacent to it. A
governance system a runtime may ignore produces ceremonial authority: the world
would depict government over a runtime that does as it pleases.

## Data and fact ownership

- Ecosym's institution store owns civilizations, mandates, jurisdiction, and
  authority rules.
- Ecosym's observation store owns observation records, admitted external-source
  reports, and their provenance, timing, and status, and separately owns
  collection-attempt and connection-health metadata.
- External systems own their current external facts and effect outcomes.
- A connected runtime owns its own state: agents, lineage, delegation, and tool
  access. Which runtimes are connected, and what each can enforce, is observed —
  never assumed, and never written into this document.
- Ecosym's observation store also owns what Ecosym concluded from what it saw: a
  derived statement is stored as derived, carrying its inputs, and is stale once
  they change. It is never stored as something observed.
- The model owns no durable fact merely because it generated text about it.
- Derived indexes, summaries, and rendered scenes are projections of owned state
  and can be rebuilt or replaced.
- Secrets are capabilities held outside ordinary context.

> Reading, caching, summarizing, embedding, ranking, or rendering information
> never transfers ownership of that information.

## Dependency direction

Dependencies flow inward toward application-owned semantics:

```text
surface / transport
  ↓
application use cases
  ↓
institution, observation, form, model, and petition boundaries
  ↓
replaceable implementation mechanisms
```

Transport, rendering, and runtime integrations may depend on domain contracts.
Domain semantics do not depend on a UI, a provider-owned object, a retrieval
index, or an external orchestration framework.

## Undecided

The substrate for durable coordination is an open implementation choice. A
matter that waits days for an answer cannot be carried by process-local
delegation, so something must carry it; no candidate is canonical until a
vertical chain has been proven end to end.

Whatever is chosen coordinates. It does not acquire Ecosym's authority semantics
or a runtime's agent execution by being the thing in the middle.

## Growth rule

One coherent application and one repository are the working default. A new
process, service, language, repository, scheduler, retrieval technology, or
security runtime must buy a concrete property that the current shape cannot
provide. Logical separation alone is not evidence for physical separation.

## Current implementation choices

These are choices, not architecture. This document does not own them; they are
recorded here so they are deliberate rather than inherited.

**TypeScript throughout**, on Node for the core and the browser for the world.

The reason is the domain, not tidiness. Mandate, provenance, epistemic status,
temporal validity, observation and claim must stay distinct, and they cross the
boundary between core and surface constantly. One type system across both makes
that distinction harder to lose by accident; two representations of the same
trust-bearing concept drift.

Types are not a security boundary. Provenance, authority, currentness and
effect safety are established at runtime, by validation and authorization at
each boundary. Static types describe shape; they prove nothing about truth.

Shared types must not become shared authority: the surface may know what an
observation looks like without gaining any power over what one means.
