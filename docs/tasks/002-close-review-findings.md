---
needs:
  - 001-observation-layer
touches:
  - docs/tasks/002-close-review-findings.md
  - src/collect.ts
  - src/config.ts
  - src/materialize.ts
  - src/readers.ts
  - src/store.ts
  - src/verify.ts
  - test/cli.test.ts
  - test/collection.test.ts
  - test/config.test.ts
  - test/csv-cli.test.ts
  - test/fifth-source.test.ts
  - test/store.test.ts
  - test/verify.test.ts
  - test/fixtures/fifth-source/habitat-survey.csv
  - test/fixtures/verification/corrupted.jsonl
  - test/fixtures/verification/original.jsonl
  - test/helpers/interrupted-collection-worker.ts
---
# Task 002 - Close what three independent reviews found

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` at the
repository root first.

This task continues branch `task/001-observation-layer`, which is open as PR #3.
Work on that branch. Do not open a new branch and do not merge anything.

## Outcome

Every finding below is either fixed with a regression test that fails without
the fix, or explicitly rejected in the final report with evidence for why the
finding is wrong. A finding that is merely acknowledged is not closed.

## Why this exists

Three independent reviews - the Greptile CLI, a code-quality review, and a
specification-compliance review - each found defects the others missed. The
full check suite passed throughout. The tests are not the problem being fixed;
the gap between what the tests assert and what the product promises is.

Four of these defects are the same failure wearing different clothes: Ecosym
stores something the source did not say. `PRODUCT.md` makes the opposing
promise - the world cannot lie about what it has seen. Treat them as one class
of defect, not four unrelated bugs.

The most serious consequence is that `verify` compares the store against the
source using the same parser that wrote the store. Where the parser transforms
input, both sides agree on the same wrong value and verification reports
agreement. The command that exists to detect corruption can currently bless it.

## Findings to close

Each was reproduced. The reproduction is given so you can confirm the defect
before changing anything, and confirm it is gone afterwards.

### 1. Temporal currentness leaks across connections

`src/store.ts` around line 617. The subquery that marks a fact `historical`
compares fact owner, kind, subject, epistemic status and source time, but not
the connection. A later record collected through an unrelated connection can
mark another connection's fact historical.

Reproduce it before changing anything: register two connections with different
ids that share `factOwner`, fact `kind` and subject. Collect a fact through
connection A with an earlier `recordedAt`, then a fact through connection B with
a later one. Query connection A. Its fact is reported `historical` even though
nothing in connection A superseded it.

Whether connection id alone is the missing partition key, or source identity and
source version also participate, is for you to determine from the schema. The
observable requirement: a fact is only ever made historical by something that
supersedes it *within its own connection*.

The existing isolation test uses equal timestamps, so it never exercises this
predicate. Found independently by two reviewers.

### 2. CSV accepts characters after a closing quote

`src/readers.ts`, `parseCsv`. A field encoded `"abc"x` is accepted and stored
as `abcx`.

```
RECORD: {"id":"1","title":"abcx"}
VERDIKT: godtatt (ingen feil kastet)
```

RFC 4180 does not permit this. The source said `abc` followed by malformed
text; the store now holds a value the source never expressed.

### 3. A `__proto__` CSV header silently discards its column

`src/readers.ts`, CSV record construction. Headers are assigned onto an
ordinary object literal, so a `__proto__` header invokes the inherited setter
instead of creating a field.

```
headers: id,__proto__,title
record keys: ["id","title"]
VERDIKT: FELT FORSVANT
```

The header passes the uniqueness and non-empty checks, so the source is
accepted and the column vanishes without an error.

### 4. Invalid calendar dates are normalised into valid ones

`src/materialize.ts`, `materializeTime`. Parsing relies on `Date.parse` and
only checks the result is finite. JavaScript normalises impossible dates.

```
2026-02-30 -> 2026-03-02T00:00:00.000Z
2026-02-29 -> 2026-03-01T00:00:00.000Z
2026-13-01 -> NaN (avvist)
```

A malformed source time becomes a different, apparently valid source time. That
value participates in source-version identity and in the historical/current
ordering, so a fabricated timestamp can reorder real observations.

### 5. A valid top-level JSON array cannot be collected

`src/config.ts` accepts `recordsPath: ""` for a JSON reader, and
`src/readers.ts` has a branch intended to treat the parsed document itself as
the record array. That branch is unreachable: `requireRecord(parsed)` runs
first and rejects an array.

Reproduced against a top-level array with `recordsPath: ""`:

```
VERDIKT: avvist -> source malformed
```

A configuration the parser accepts cannot be collected, and the source reads as
unreadable rather than as a configuration error.

### 6. The store's admission boundary is not closed

`ObservationStore.collect` accepts arbitrary scalar `FactInput` from a caller.
The regular collector only ever submits projected fields, so the product rule
holds in practice - but it holds by convention, not by enforcement.

**This is decided, not open: the store enforces the rule.** A fact submitted
through `ObservationStore.collect` carrying a field the active connection's
configuration did not name is rejected, and the collection attempt fails rather
than silently ignoring the fact. Convention is not enforcement, and `PRODUCT.md`
states the rule as a property of the store rather than of one caller.

Enforce it against the connection's own declared configuration - the registered
selectors for that connection id. The store must not acquire knowledge of any
particular source: it compares a submitted fact against what that connection
declared, never against a list of fields known to the product. Preserving that
distinction is the point; a per-source allowlist in the core would violate
`ARCHITECTURE.md` even though it would pass the same test.

Prove it with a test that submits an undeclared field directly to the store,
bypassing the collector, and asserts the attempt fails and nothing is stored.

### 7. Two tests are named for what they do not prove

`test/fifth-source.test.ts` is named for connecting a source of a different
kind without a product-code adapter, but its fixture is CSV - a shape already
supported and already covered elsewhere. It asserts CLI behaviour only, and
makes no assertion about which files changed.

`test/collection.test.ts` claims unselected personal fields never reach the
store. It proves two chosen fields are absent for one SQLite mapping. That is a
sample, not the rule.

Make each test either prove its name or say plainly what it covers. A test that
overstates its own reach is worse than an absent one, because it retires a
question that is still open.

### 8. Minor findings

Close these if they are genuine; reject them with evidence if they are not.

- Expected source failures are reported as `internal_error` rather than an
  actionable source error: `readCsv` maps open failures but not post-open read
  failures, and a finite but out-of-range Unix timestamp reaches `toISOString`
  and throws `RangeError`.
- `INSERT OR IGNORE` in `ObservationStore.collect` suppresses every constraint
  violation, not only the intended duplicate-fact conflict. An unexpected
  integrity violation should fail the attempt.
- Collection, verification and JSON discovery each buffer their whole input
  before proceeding, with no size bound. Treat this as a **recorded risk, not a
  defect to close in this task**: report where the buffering happens and what
  would bound it, and do not invent a size limit. A threshold is product policy
  and nobody has set one. Adding an arbitrary limit would be worse than the
  documented risk, because it would look like a decision.

## What must be true when you finish

Fix the defect, not the symptom line. Several of these share a cause: input is
transformed on the way in rather than rejected. Prefer rejecting a malformed
source over repairing it - an unread source is honest, a repaired one is not.

Every behavioural fix carries a regression test that fails without it. For the
two mis-named tests, the evidence is the corrected name and coverage itself; do
not manufacture a test to prove a rename. Whether an insufficient test is
strengthened in place or replaced by a clearer one beside it is your call - what
matters is that no test is left claiming more than it proves.

`verify` must be able to detect a store that disagrees with its source. Prove it
with a fixture the parser cannot rescue: write a value into the store that no
reading of the source produces - not a malformed source, but a store that has
been altered after collection. Verification must report disagreement for it.

Hardening the parsers narrows the gap by removing the transformations that made
both sides agree on a wrong value. It does not by itself prove verification can
see a divergent store, because a parser and the store it wrote will always
agree with each other. Say plainly which part your work closes and which part
remains, rather than reporting the whole gap as closed.

Run `npm run check` and report its real output, together with the exact commit
sha it ran against.

Before you consider the work done, obtain an independent review of the final
candidate using the `review` subagent defined in `.opencode/agent/review.md`.
It must be a fresh read-only review of the finished state, not of an
intermediate one, and it must be given the diff and the findings above rather
than your account of them. If material changes follow the review, run it again
against the new state. Report what it found, including anything you disagree
with and why.

## Report

State each finding as fixed, rejected with evidence, or still open. Say which
of the canonical documents, if any, turned out to be wrong or unbuildable.

If you disagree with a finding, say so and defend the current behaviour. These
came from reviewers who did not write the code; they can be wrong too.
