# Architecture

This document owns Axey's stable system boundaries: which concern owns which
kind of state, how information and authority may cross boundaries, and which
properties must survive replacement of current implementation choices.

## Owns

- stable component and concern boundaries;
- authoritative ownership of Axey-controlled information;
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
Surface
  ↓
Axey application core
  ├── personal-state owner
  ├── context-selection boundary
  ├── model boundary
  └── effect boundary, only when effects exist
       ↓
External systems that remain owners of their own facts and effects
```

These are logical boundaries. They do not imply separate packages, processes,
services, repositories, or machines. Use the cheapest boundary that provides
the required property; stronger isolation is introduced when capability and
blast radius require it.

## Concern ownership

### Surface

The surface presents conversation, personal state, corrections, and outcomes.
It requests application capabilities but does not own durable state, model
credentials, authority, or external facts.

### Application core

The application core coordinates product behavior and validates requests across
the boundaries below. Model output is input to this core, never an alternative
control plane.

### Personal-state owner

Axey-owned durable personal state has one logical source of record. It preserves
enough source, interpretation, status, temporal, and history information to
support inspection, correction, supersession, export, and deletion.

That source of record is local by default. A future synchronization or remote
availability mechanism does not become authoritative merely by copying or
serving the state.

Source events and interpreted assertions are distinct concerns. A user
statement, correction, decision, or observed outcome may be durable source
evidence; an assertion derived from it remains linked to that evidence and
retains its own epistemic status.

No generic trusted flag may collapse provenance, epistemic status, authority,
and temporal validity into one value.

### Context-selection boundary

Only an Axey-owned context-selection boundary decides which personal state is
eligible to leave its authoritative store and enter a model request. Selection
is purpose-limited, sensitivity-aware, and bounded.

Active model context is a derived, replaceable projection. It is not durable
truth, and a summary or retrieved item never becomes authoritative because it
was shown to a model.

### Model boundary

Models perform ephemeral reasoning over application-selected inputs. They may
produce responses, proposed interpretations, candidate memories, or proposed
actions. They do not own personal state, migrations, secrets, authority, or
effect outcomes.

The application owns validation and persistence of every structured model
result. Replacing a model or provider must not require redefining Axey's durable
personal-state semantics.

### Effect boundary

Axey begins without model-initiated consequential external effects. When an
effect is introduced, it crosses an explicit application-owned boundary that
validates typed intent, current authority, parameters, idempotency, and observed
outcome before durable state can describe the effect as having happened.

A model may propose an effect but cannot authorize it. A separate process or
runtime is introduced only when same-process containment cannot provide the
required security property.

## Data and fact ownership

- Axey's personal-state store owns Axey-controlled durable personal state and
  its provenance, history, and correction relationships.
- External systems own their current external facts and effect outcomes.
- The model owns no durable fact merely because it generated text about it.
- Derived indexes, summaries, rankings, and context bundles are projections of
  owned state and can be rebuilt or replaced.
- Secrets are capabilities held outside ordinary personal/model context.

> Reading, caching, summarizing, embedding, ranking, or rendering information
> never transfers ownership of that information.

## Dependency direction

Dependencies flow inward toward application-owned semantics:

```text
surface / transport
  ↓
application use cases
  ↓
personal-state, context, model, and effect boundaries
  ↓
replaceable implementation mechanisms
```

Transport and model integrations may depend on domain contracts. Domain
semantics do not depend on a UI, provider-owned conversation object, retrieval
index, or external orchestration framework.

## Growth rule

One coherent application and one repository are the working default. A new
process, service, language, repository, scheduler, retrieval technology, or
security runtime must buy a concrete property that the current shape cannot
provide. Logical separation alone is not evidence for physical separation.
