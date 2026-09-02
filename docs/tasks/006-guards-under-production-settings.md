---
needs:
  - 005-close-automated-review
touches:
  - docs/tasks/006-guards-under-production-settings.md
  - scripts/run-task
  - src/cli.ts
  - src/materialize.ts
  - src/readers.ts
  - src/store.ts
  - src/verify.ts
  - test/cli.test.ts
  - test/collection.test.ts
  - test/run-task.test.ts
  - test/store.test.ts
  - test/verify.test.ts
---
# Task 006 - Make the new guards hold under production settings

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continues branch `task/005-close-automated-review` at `c53f864`. Base for
review: `7c9b735`.

Four independent reviewers looked at the same frozen commit. Five findings
survived confirmation. Each is confirmed reproducible unless noted.

Confirm every finding before changing anything. Say so plainly if one does not
reproduce, and leave it alone.

## 1. The contention bound does not bind

`BUSY_RETRY_WINDOW_MILLISECONDS` is 250, but the deadline is only consulted
after SQLite's own `BEGIN IMMEDIATE` returns. `DatabaseSync` is constructed
with a 5000 ms busy timeout, so SQLite blocks inside the statement first.

Reproduced: with the default store and another connection holding
`BEGIN IMMEDIATE`, collection returned `store_contention` after **5008 ms**.

The regression test passes because it constructs the store with a 20 ms
timeout — a value production never uses. A guard proven only under a setting
the product does not run is not proven.

Make the bound hold for a store built the way the product builds it. Whether
that means deriving SQLite's busy timeout from the window, checking the
deadline before entering a blocking statement, or another approach, is yours.
State what you chose.

The regression test must fail against `c53f864` **using the default store
construction**, not a shortened timeout.

## 2. Verification can report agreement for a connection that is no longer active

The active-connection check after the source read was removed. Reproduced by a
reviewer: deactivating the connection in a microtask after the first snapshot
still returned `agreement` with `matched: 1`.

A report that says a connection agrees, when that connection is not active, is
the world claiming something it cannot support.

Decide and state what the correct outcome is when a connection stops being
active mid-verification. It must not be `agreement`.

## 3. Sub-millisecond precision still passes through JSON

`1756550400000.0001` in a JSONL source: `JSON.parse` reduces it to
`1756550400000` before any check can see the extra digits, and collection
succeeds. The stored instant is not what the source wrote.

The integer check added in task 005 closes the cases it was given and cannot
see this one, because the loss happens during parsing.

If the lexical value is recoverable at the reader boundary, refuse a numeric
source time whose text carries precision the number cannot hold. If it is not
recoverable, say so explicitly and record the limit — an honest documented
boundary is acceptable; a silent one is not.

## 4. The exact-millisecond test is done in floating point

`src/materialize.ts` multiplies seconds by 1000 and tests `Number.isInteger`.
Binary floating point makes that test wrong at the edges: some values that are
exact milliseconds fail it, and some that are not can pass.

Establish the check so that it answers the question actually being asked —
whether the source value denotes a whole millisecond — rather than whether one
particular arithmetic result happens to land on an integer. Cover boundary
values: very large and very small magnitudes, negatives before the epoch, and
values integral in seconds but not in milliseconds.

## 5. Two verification tests assert less than their names claim

- `an empty connection is unverified rather than agreement` covers one
  connection only. It does not pin what the top-level outcome must be when
  connections disagree with each other — `agreement` plus `unverified`,
  `unread` plus `unverified`, `disagreement` plus `unverified`.
- `verification compares the source with one stable store snapshot` asserts
  that exactly one snapshot read happens. It does not assert that the snapshot
  is still valid to compare against, which is why finding 2 slipped past it.

Make each test assert the property its name promises. The aggregate rule
across mixed connection outcomes must be pinned by a test, whatever that rule
turns out to be.

## Two findings from the automated reviewer, also in scope

**`--limit 0` reports an internal error.** Out-of-range query limits throw an
untyped `RangeError`, so invalid user input returns `internal_error` and exit
1 instead of `invalid_arguments` and exit 64. A caller's mistake reported as
the product's mistake.

**Blank lines in JSONL shift record identity.** With `meta.record-index`, a
blank line advances the physical index while producing no record. Adding a
blank line to a source file makes unchanged records appear as removals and
additions. Formatting must not change what a record is.

## Constraints

Do not add dependencies. Do not weaken or delete an existing test to make a
new rule pass. Do not rewrite stored rows.

## Evidence

Follow [DEVELOPMENT.md's implementation-and-evidence requirements](../../DEVELOPMENT.md#implementation-and-evidence)
and [independent-review requirements](../../DEVELOPMENT.md#review). For this
task, retain each finding's pre-fix confirmation and regression evidence against
`c53f864`; where a test needs a particular construction, use the construction
the product uses. Once the exact candidate is frozen, ask an independent
read-only reviewer whether each guard holds under production settings; report
review as unavailable if no reviewer can run.
