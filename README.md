# Ecosym

Ecosym is a world of civilizations: a living, inhabited representation of the
domains one person cares about, and of the agents working inside them.

The thinking happens elsewhere, in whatever connects. Ecosym reads what
happens and gives it a form — a place to walk into rather than a report to
read. It must be delightful and true at the same time; a city that looks
healthy while its real work is failing is total failure, not a cosmetic bug.

## Status

Early. Two layers exist. The observation layer connects declarative file
sources, collects them into a provenance-preserving store, and queries and
verifies them against their sources; its contract and commands are documented
in [`docs/observation-layer.md`](docs/observation-layer.md). The institution
layer founds, redraws, dissolves, and deterministically resolves the mandate of
a civilization. Both support export and irreversible forgetting.

A design-neutral React + TypeScript browser reads stored world declarations and evidence.
A read-only SQLite
runtime bridge collects selected external fields, and an application-composed,
runtime-validated world contract links them to declared sources. The local world
server retains that contract at `/api/world-snapshot`; a typed, React-independent
client validates it and uses the core-owned `worldForm` projection. See [`DEVELOPMENT.md`](DEVELOPMENT.md) for frontend dev, build, and
serve commands, and
[`docs/runtime-bridge.md`](docs/runtime-bridge.md#local-procedure) for explicit
local setup, collection, verification, and world startup.

No petition reaches a runtime, and no mandate enforcement is proven by this
read-only slice. `PRODUCT.md` records what is built; beyond that record, nothing
it describes exists.

An earlier frontend and backend were removed. The frontend invented agents no
runtime knew about and matched runs to them by keyword — the authority mirage
`SECURITY.md` names. The backend exposed an unauthenticated endpoint that
executed arbitrary text. Neither is a reference for what comes next.

Durable cases, a council, and admission of governed work do not exist yet, and
are not depicted until they do.

The separate governance proof target is one vertical chain: a petition, a
deterministically resolved mandate, mandatory admission, execution in a connected runtime,
enforcement refusing what falls outside the mandate, the outcome observed, the
case persisted, and the case resumed correctly after a restart.

## Repository knowledge

| Question | Owner |
| --- | --- |
| What is Ecosym for? | [`PRODUCT.md`](PRODUCT.md) |
| What stable boundaries must the system preserve? | [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| What must Ecosym protect? | [`SECURITY.md`](SECURITY.md) |
| How can a contributor build and verify it? | [`DEVELOPMENT.md`](DEVELOPMENT.md) |

This README is navigation and current orientation. It is not a competing owner
of product, architecture, security, or development policy.

Visual form has no owner yet. Until one exists, form follows `PRODUCT.md` and
the form boundary in `ARCHITECTURE.md`.
