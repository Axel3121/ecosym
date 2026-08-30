# Task 001 — The observation layer

## Outcome

Axey can hold what it has seen, with provenance, and prove it against the
source. Nothing renders. This task ends at a queryable store and a verification
command.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, and `DEVELOPMENT.md`
first — all four are relevant here, and all are canonical. This task does not
override them. `DEVELOPMENT.md` governs how the work is evidenced and reviewed;
`SECURITY.md` governs provenance and what may not leak into logs or test
artifacts.

## Where this sits

This is **not** the first proof described in `PRODUCT.md`. That proof is a
vertical chain — petition, mandate, admission, enforcement, observed outcome,
durable case, restart, resume — and this task deliberately excludes most of it.

This is the observation sub-slice of that chain: the part that can be built
honestly today, because it depends on nothing that does not yet exist. It does
not establish the canonical first proof and must not be reported as doing so.

## Why this piece first

Every later part of Axey — cities, cases, the council — depends on observations
being trustworthy. The hardest requirement in the product is that the world
cannot lie, and that requirement is discovered too late if depiction is built
first. The surface-to-observation boundary is also the one boundary
`ARCHITECTURE.md` names as expensive to introduce later.

## The boundary that must exist

From `ARCHITECTURE.md`: **nothing above the observation layer reads a source
directly.** Sources are reached by adapters; everything else reads the store.
This is the one boundary that is expensive to introduce later, and it is not
optional.

## What an observation is

Durable, timed, and attributed to a source that owns the fact.

- **source** — which owner the fact came from, specifically enough to go back to it
- **observed_at** — when Axey saw it
- **source_time** — when the fact itself is true of, where the source provides one
- **status** — whether this is current, superseded, or of unknown currency
- **kind** — what sort of thing was seen (free-form; do not build a fixed taxonomy)
- **subject** — a stable identifier for the thing observed, so repeated looks at
  the same thing are recognisable as the same thing
- **payload** — the observed values

A **claim** is a report from an intermediary rather than the fact's owner. Claims
are stored, but stay distinguishable from observations for as long as they are
held. Never silently promoted.

**Attribution to a cause is a separate, optional property.** An observation with
no traceable origin is fully valid and is stored without one. A cause is never
inferred from having followed something in time.

## Sources for this slice

Two real ones, deliberately different in shape.

**1. Hermes runtime** — `~/.hermes/state.db`, opened **read-only**, and
`~/.hermes/cron/executions.db`. Axey owns nothing here and must never write.
Delegations and cron executions are real, timed, and owned by Hermes.

Note: `backend/axey.py` already reads state.db read-only. Its approach to
opening the database is sound and worth keeping. Its output shape is not — it
serves raw rows with no provenance, and it aggregates token and API-call counts,
which are vanity telemetry and out of scope. Do not carry that forward.

**2. Shorts outcomes** — under `~/shorts-content/`:
- `output/reports/uploads.jsonl` — published videos; note `deleted: true` marks
  history, not absence
- `output/reports/daily_snapshots.jsonl` — view counts over time
- `output/reports/analytics_*.json` — per-video metrics
- `scripts_data/learning_log.jsonl` — note `day7_stats: null`, an outcome not yet
  observable

These are outcomes nobody requested — views accrue on their own. They are the
common case, and they must move through the layer without a cause.

## What must be demonstrably true when this is done

Each of these needs a test that fails when the property is broken.

### Decisions already made — do not re-decide these

**Adapters.** Four, not two: Hermes sessions (`state.db`), Hermes cron
(`executions.db`), Shorts uploads (`uploads.jsonl` plus `learning_log.jsonl`),
Shorts metrics (`daily_snapshots.jsonl` plus `analytics_*.json`). Two families,
four adapters. Every "per adapter" requirement below means these four.

**Changing values are a time series, never a replacement.** A view count rising
from 7 to 12 is two observations of the same subject at different times, both
kept. Nothing already observed is overwritten or deleted when the source
changes. `PRODUCT.md` requires that historical and current truth stay
distinguishable, and superseding would destroy the trend data the chronicler
exists to read.

**A Hermes report that work finished is a claim, not an observed outcome.**
Hermes owns its own runtime state — that a delegation exists, its lineage, that
a process is running or exited. It does not own the external effect that work
claims to have produced. Store delegation state as observation of the runtime;
store any assertion about an external effect as a claim.

**Source version** is whatever the source itself offers as a stable marker of
its own revision — a row id, a file offset, a record's own timestamp. It is not
collection time and not a payload hash of the whole file, because a legitimate
rewrite would then look like corruption.

**A source is *quiet*** only when the most recent collection attempt for that
adapter completed successfully and returned nothing new. It is *unread* whenever
the last attempt failed, was skipped, or has never run. Coverage is per adapter,
and the store records every attempt with its outcome, not just successes.

**Evidence** means a record the query layer will return as an observation.
Claims are storable and retrievable, but a query for observations must not
return them. That is what "does not enter the store as evidence" means, and it
is checkable.

### What must be demonstrably true

**1. Identity — repeated collection does not duplicate.**

Decide, per adapter, which source fields form a stable observation key, and
write that decision down. Collecting twice from an unchanged source adds
nothing; collecting after a real change adds a new observation in the series.
Deletion or rewrite at the source must not erase what was already observed —
`uploads.jsonl` already marks removed videos `deleted: true` rather than
dropping them, and that is the behaviour to preserve.

**2. Claim and observation are distinguishable.**

Name the durable fields that carry the distinction. Include a fixture of a real
intermediary claim — Hermes reporting that work completed is a claim, not an
observed external outcome — and prove it does not enter the store as evidence.

**3. Absence of observation and absence of activity are different states.**

Two separate tests: one proving a successful empty collection reads as quiet,
one proving a failed or never-run collection reads as unread. An empty result
from a broken adapter must never surface as quiet. This is the property most
likely to be lost by accident — do not collapse it into a null.

**4. Verification reports real disagreement.**

Disagreement is one of: a record the store expected that the source no longer
has, a payload differing at the same source version, or a record present at the
source that was never collected. A newer view count is not a disagreement — it
is the next point in the series.

The command runs against the real sources and exits non-zero on disagreement.
A source that is absent, locked, or malformed is *unread*, not disagreement, and
exits zero with that state reported — the check reports what it could not see
rather than inventing a verdict. Include a deliberately corrupted-store fixture
proving it fails, and run it for real.

**5. Ownership is decided per adapter.**

A local JSONL file does not own YouTube's view counts — it is a local record of a
platform fact, and its provenance must say so. Hermes does own its own runtime
and delegation state. Write down, per adapter, who owns the fact and what the
local file actually is.

## Constraints

- Python, matching the existing `backend/`. Local store; SQLite is fine.
- No web framework, no HTTP layer, no UI, no LangGraph, no orchestration.
- Never write to anything under `~/.hermes/` or `~/shorts-content/`.
- Do not touch `app/` — the existing frontend is non-conformant and out of scope.
- Tests use synthetic fixtures, never the user's real stores. No source content
  or personal data in logs, test output, or committed artifacts.
- Adding a source later must not require changing the store or the query layer.
  If it does, the boundary is in the wrong place.
- Keep source-specific rules — what an adapter's key is, how it reads its own
  source version — inside that adapter. The store stays generic; source
  semantics embedded in it get expensive to change later.
- One ordinary check entry point that runs everything (tests plus the
  verification command), runnable without an agent, per `DEVELOPMENT.md`.
- `SECURITY.md` requires that Axey-owned state be inspectable, correctable,
  exportable, and deletable. This slice need not implement any of that, but the
  store must not be shaped so those become impossible later.

## Out of scope

Cities, mandates, jurisdiction, cases, the council, petitions, admission,
rendering, and anything visual. If the design seems to need one of these, stop
and say so rather than inventing it.

## Report back

What was built, the shape of the store, the two decisions left to you — each
adapter's observation key, and who owns each adapter's facts — the check entry
point and its real output including the corrupted fixture failing, and anything
in the canonical documents that turned out to be unimplementable as written.

This work touches a trust-bearing boundary: provenance and the claim/observation
distinction. Expect independent review before it is accepted.
