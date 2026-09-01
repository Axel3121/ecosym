---
needs:
  - 004-accept-real-utc-instants
touches:
  - scripts/run-task
  - src/materialize.ts
  - src/store.ts
  - src/verify.ts
  - test/collection.test.ts
  - test/run-task.test.ts
  - test/store.test.ts
  - test/verify.test.ts
---
# Task 005 - Close what the automated reviewer found

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continues branch `task/001-observation-layer` at `7c9b735`. An automated
reviewer examined the whole branch and found defects four rounds of human-
directed review did not. Each is stated below with the reproduction that
demonstrates it. Confirm each one before changing anything: a finding you
cannot reproduce is a finding to report, not to fix.

## Outcome

Verification cannot report agreement it did not establish. No numeric source
time is silently truncated. Collection fails honestly rather than waiting
forever. The ordering predicate is supported by an index.

## Findings

### 1. Verification reports agreement without comparing anything

`src/verify.ts` returns `"agreement"` whenever no disagreement counter is
positive — including when nothing was compared at all.

Two paths reach it:

- a connection where `storedFacts` and `sourceFacts` are both zero;
- the top-level command when the store holds no connections at all.

Task 001 required that verification never succeed by empty comparison. It does
today. An empty store answers `agreement`, which reads as "the store was
checked and matches" when the truth is "there was nothing to check".

An empty comparison is not agreement. Give it its own outcome value, distinct
from both `agreement` and `disagreement`, carrying a reason. Apply it at both
levels: a connection that compared nothing, and a `verify` run with no
connections at all.

The exit code must not report verified success when nothing was verified. It
must also stay distinguishable from the disagreement exit code, so a caller can
tell "the store is wrong" from "there was nothing to check".

Name the outcome and reason values you chose in your report; the names are
yours, the distinction is not.

### 2. Numeric source times truncate below the millisecond

`src/materialize.ts` accepts `unix-seconds` and the other numeric formats
through arithmetic into `new Date(...)`, which silently drops sub-millisecond
precision.

Reproduce:

```sh
node -e 'const ms=1756550400.0005*1000; console.log(new Date(ms).toISOString())'
```

The stored instant is not the value the source expressed, and the source value
cannot be recovered from the store. The `iso8601` path already refuses this
exact class of input — `2026-08-30T10:00:00.1234Z` throws. The numeric formats
must follow the same rule, for the same reason.

The rule, stated so it can be checked: a numeric source time is accepted only
when converting it to whole milliseconds changes nothing. If the conversion
would discard any part of the supplied number, refuse it as malformed rather
than storing the rounded instant.

### 3. The busy-retry loop is unbounded

`ObservationStore`'s retry loop around `SQLITE_BUSY` and
`SQLITE_BUSY_SNAPSHOT` waits and retries forever. `busyTimeoutMilliseconds`
bounds each individual statement, not the loop, so a statement timing out
starts another attempt rather than surfacing the failure.

A writer that holds a transaction and does not release it makes `collect` hang
with no output and no failure. A tool that can hang indefinitely without
reporting why cannot be run unattended.

Bound it. Contention must end in a returned failure whose code names contention
as the cause — not a generic internal error, and not silence.

The bound's value is yours to choose and state. It must be short enough that a
test can hold a write lock, call `collect`, and assert that it fails within a
deadline the ordinary suite can wait for.

### 4. Verification takes two snapshots and compares neither to the other

`verifyConnection` reads a store snapshot, reads the source, then reads a
second snapshot — and the first is discarded.

If a collection commits while the source is being read, the second snapshot
holds facts the source read never saw. Those match no source version and are
reported as disagreement, even though the store and source agree.

Verification must not report disagreement caused by its own timing. Either
compare against one consistent store snapshot, or detect that the store moved
under it and say so as its own outcome — never as disagreement, and never as
agreement. Do not paper over it by ignoring facts that appeared during the
read; that would hide real disagreement too.

Scope: a store that changes during verification is what this finding covers. A
*source* that changes during the read is not in scope here — if your approach
cannot distinguish the two, say so rather than claiming it handles both.

### 5. The ordering predicate has no supporting index

The `EXISTS` subquery deciding `historical` filters on
`connection_id, fact_owner, kind, subject, epistemic_status` and compares
`source_time_key`. The existing `facts_identity_time` index omits
`connection_id` as a leading column and indexes `source_recorded_at`, which is
no longer the ordering column.

Every returned row can scan the table. Add an index matching the predicate.

Acceptance is that the plan uses an index constraining all five equality
columns and ranging on `source_time_key` — not that it matches a particular
planner string, which varies by SQLite version. Report the plan before and
after.

### 6. `payloadMismatch` can exceed the number of stored facts

In `compareFacts`, the matched branch adds the count of non-matching stored
hashes once per source fact of that version, so a version carrying two source
hashes double-counts. Observed: `storedFacts: 1`, `payloadMismatch: 2`.

Define the unit: `payloadMismatch` counts stored facts whose payload does not
match any payload the source expressed for that source version. Under that
definition it can never exceed `storedFacts`, and a regression test can assert
that relation directly.

### 7. `run-task --worktree` can run the wrong branch

`scripts/run-task` reuses an existing task worktree without checking which
branch it holds. Running the same task twice with different `--branch` values
runs the first branch while reporting the second.

The launcher must not report a branch it is not running. Fail closed: if a
worktree for that task already exists and holds a different branch than the one
requested, refuse and say what it holds. Do not switch branches under an
existing worktree — another run may be using it.

## What must be true

**A count is a quantity.** Any counter reported in the machine-readable result
counts the thing its name says, and cannot exceed the population it counts.

**Empty verification remains distinct.** A `verify` result that compared no
facts is neither `agreement` nor `disagreement`; the outcome and reason must
make the empty comparison explicit. See [PRODUCT.md's epistemic
invariant](../../PRODUCT.md#unknown-remains-unknown) for the canonical rule.

**Numeric and textual source times obey one rule.** A source time is accepted
when it can be held exactly, whatever notation the source used to express it.

**Seven findings, not eight.** An eighth was raised — that `-0` parses in
configuration but is refused by the store — and was checked and dropped: the
configuration path serialises it to `0` before it reaches the store, so the two
never disagree. It is recorded here so it is not re-raised as new.

## Evidence

Follow [DEVELOPMENT.md's implementation-and-evidence requirements](../../DEVELOPMENT.md#implementation-and-evidence)
and [independent-review requirements](../../DEVELOPMENT.md#review). For this
task, retain the finding-specific pre-fix reproduction for every numbered
finding, including the regression assertion quoted from the runner. For finding
5, record `EXPLAIN QUERY PLAN` output before and after. Once the exact candidate
is frozen, ask an independent read-only reviewer whether every finding is closed
and whether each regression test would still pass with its fix reverted; report
review as unknown if it cannot run.

Report each finding by number: what you changed, what proves it, and any you
could not reproduce.

## Constraints

Do not add dependencies. Do not weaken or delete existing tests to make new
rules pass. Do not rewrite existing stored rows.
