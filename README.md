# Echosystem

Echosystem is a world of civilizations: a living, inhabited representation of the
domains one person cares about, and of the agents working inside them.

A connected runtime is the brain and does the work. Echosystem reads what happens and gives it a
form — a place to walk into rather than a report to read. It must be delightful
and true at the same time; a city that looks healthy while its real work is
failing is total failure, not a cosmetic bug.

## Status

Early. Nothing is implemented: the repository holds specifications and one open
work item. An earlier attempt was built and removed — it worked, but was written
in the wrong language from specifications that told the implementer what to type
rather than what to achieve. What it taught is in `docs/tasks/`, not in code.

An earlier frontend and backend were removed. The frontend invented agents no
runtime knew about and matched runs to them by keyword — the authority mirage
`SECURITY.md` names. The backend exposed an unauthenticated endpoint that
executed arbitrary text. Neither is a reference for what comes next.

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
| What is Echosystem for? | [`PRODUCT.md`](PRODUCT.md) |
| What stable boundaries must the system preserve? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What must Echosystem protect? | [`SECURITY.md`](SECURITY.md) |
| How is work developed, evidenced, reviewed, and merged? | [`DEVELOPMENT.md`](DEVELOPMENT.md) |
| How should a fresh coding agent orient itself? | [`AGENTS.md`](AGENTS.md) |

This README is navigation and current orientation. It is not a competing owner
of product, architecture, security, or development policy.

Visual form has no owner yet. Until one exists, form follows `PRODUCT.md` and
the form boundary in `ARCHITECTURE.md`.
