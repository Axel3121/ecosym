# Product

Axey is a **learning personal operating partner**: a long-running assistant that
helps one person understand, remember, decide, and act across life and work.

## Owns

- the user problem Axey exists to solve;
- durable product concepts and product invariants;
- what useful learning means at the user surface;
- product non-goals.

## Does not own

- programming language, database, model, provider, deployment, or UI framework;
- component topology, security enforcement, or development workflow;
- current implementation, runtime, external-system, or task state.

Stable system boundaries are owned by `ARCHITECTURE.md`. Security and privacy
obligations are owned by `SECURITY.md`. Development obligations are owned by
`DEVELOPMENT.md`.

## Purpose

Axey should reduce the work required to reconstruct personal context and decide
what deserves attention. It should become more useful through use without
becoming more confidently wrong.

The durable product hypothesis is:

> What Axey correctly learns from experience, explicit corrections, observed
> outcomes, and evidenced mistakes should improve its later behavior in a way
> the user can inspect and correct.

Learning means changed future usefulness, not merely storing more text. It does
not require model training.

## First proving loop

The first product slice is a repeated operating review:

1. The user tells Axey what is happening and receives help with the immediate
   question.
2. Axey may propose a small number of durable learnings.
3. The user can inspect, confirm, correct, or delete what Axey remembers.
4. Later, Axey uses relevant current context to explain what appears to matter.
5. The user can see why prior context was used and correct Axey's understanding.
6. The correction changes later behavior while historically true information
   may remain identifiable as history.

The user-facing concepts for this loop are:

- **Today** — the current conversation and immediate situation;
- **What Axey remembers** — inspectable durable personal state;
- **What matters** — a current review informed by relevant prior context;
- **Corrections** — confirmation, correction, supersession, or deletion.

## Product invariants

### Personal state remains understandable

For durable Axey-owned personal state, the user must be able to determine:

- what Axey believes;
- why it believes it;
- whether it came from the user, an observation, or an inference;
- whether it is current, historical, superseded, or unknown;
- how to correct, export, or delete it.

### Inference is not confirmation

Model inference, summaries, reflections, and recommendations never silently
become user-confirmed truth. They may be useful proposals or derived context,
but their epistemic status remains visible.

### History and current truth are distinct

A correction does not require pretending the earlier state never existed.
Historically true and currently true remain distinguishable, and superseded
state does not silently re-enter current reasoning.

### External facts keep their external owners

Remembering an observation from another system does not make Axey authoritative
for that external fact. Axey may preserve the observation, its source, and when
it was observed.

### Unknown remains unknown

Missing provenance, authority, verification, or currentness is presented as
unknown. Axey does not invent certainty to make a surface look complete.

## What good means

Axey is improving when real use shows that:

- remembered items are relevant enough to keep;
- corrections prevent stale or incorrect state from affecting later answers;
- useful prior context is recalled without flooding the model context;
- the user can understand and trust why context was used;
- decisions and outcomes improve later recommendations;
- the user voluntarily returns because the operating review is useful.

These signals begin as observations, not invented target percentages.

## Non-goals

Axey is not initially:

- a generic agent framework, coding harness, or workflow builder;
- a multi-user or team workspace;
- a universal store for facts owned by external systems;
- an autonomous external-action system;
- a grand personal ontology;
- a system that equates more stored context with better memory.

New product scope must be earned by repeated use or a concrete failure of the
current slice.
