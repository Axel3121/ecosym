# Axey

Axey is a world of civilizations: a living, inhabited representation of the
domains one person cares about, and of the agents working inside them.

A connected runtime is the brain and does the work. Axey reads what happens and gives it a
form — a place to walk into rather than a report to read. It must be delightful
and true at the same time; a city that looks healthy while its real work is
failing is total failure, not a cosmetic bug.

## Status

Early, and the current frontend does not conform to this specification. It
invents its own agents that no runtime knows about and attaches runs to them
by keyword matching — depiction not derived from observed state. Its backend was
archived after review found it exposed an unauthenticated endpoint that executed
arbitrary text through a runtime. Treat the frontend as prior exploration, not a
reference implementation.

The observation layer is real and verified: sources are connected by declarative
configuration, observations carry provenance, and a check command proves the
store agrees with reality.

The institutional layer described in `PRODUCT.md` — durable cases, a council,
admission of governed work — does not exist yet, and is not depicted until it
does.

The current proof target is one vertical chain: a petition, a deterministically
resolved mandate, mandatory admission, execution in the runtime, enforcement
refusing what falls outside the mandate, the outcome observed, the case
persisted, and the case resumed correctly after a restart.

## Repository knowledge

| Question | Owner |
| --- | --- |
| What is Axey for? | [`PRODUCT.md`](PRODUCT.md) |
| What stable boundaries must the system preserve? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What must Axey protect? | [`SECURITY.md`](SECURITY.md) |
| How is work developed, evidenced, reviewed, and merged? | [`DEVELOPMENT.md`](DEVELOPMENT.md) |
| How should a fresh coding agent orient itself? | [`AGENTS.md`](AGENTS.md) |

This README is navigation and current orientation. It is not a competing owner
of product, architecture, security, or development policy.

Visual form has no owner yet. An earlier design document described an
agent-monitor visualization and has been archived under `docs/archive/`; it is
superseded and must not be implemented from. Until a visual owner exists, form
follows `PRODUCT.md` and the form boundary in `ARCHITECTURE.md`.
