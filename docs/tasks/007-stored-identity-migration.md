---
needs:
  - 006-guards-under-production-settings
touches:
  - docs/tasks/007-stored-identity-migration.md
  - src/collect.ts
  - src/readers.ts
  - src/store.ts
  - src/verify.ts
  - test/collection.test.ts
  - test/store.test.ts
---
# Task 007 - Do not rewrite identity that is already stored

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continues branch `task/005-close-automated-review` at `c7e975f`. Base for
review: `c53f864`.

Two independent reviewers examined the same frozen commit. One found every
scoped guard closed. The other found two defects the first did not look for.
Both were confirmed by running code.

Confirm each finding before changing anything. If one does not reproduce, say
so and leave it alone.

## 1. The JSONL index change silently rewrites stored identity

Task 006 changed `meta.record-index` from the physical line number to the
ordinal among non-blank records, so that adding a blank line no longer shifts
the records after it. That is the right rule going forward.

It also changes what an already-stored record *is*. For a source containing a
blank line, a record previously stored under index `2` is now index `1`.

Confirmed twice:

```text
record-index old (physical line): 0, 2
record-index new (ordinal):       0, 1
```

and end to end by a reviewer: collect under the old rule, open the same store
under the new one, and verification reports `disagreement` with
`missingAtSource: 1` and `uncollected: 1`. The next collection adds a third
fact under a new identity. The source did not change.

The store gains duplicate records and reports removals and additions that
never happened. See [PRODUCT.md's canonical product
invariant](../../PRODUCT.md#the-world-cannot-flatter).

Decide how an existing store crosses this change. A recorded migration, a
connection-scoped indexing mode, or refusing to read a store written under the
old rule are all defensible. Inventing new history is not.

State what you chose and why. Whatever you choose must make this true: a store
collected under the old rule, opened under the new code, does not report facts
that the source never expressed.

## 2. The contention budget covers admission only

The deadline and the lowered SQLite timeout guard the admission transaction.
The completion transaction and the failure-marker transaction still use the
configured busy timeout with no shared deadline.

Confirmed: holding `BEGIN IMMEDIATE` *after* admission made `collect` take
505 ms and return `internal_error` — not `store_contention` — leaving the
attempt unread and incomplete.

Two things are wrong. The window does not bound the operation it names, and
contention is reported as an internal fault rather than as contention.

Bring every transaction in a collection attempt under one budget, and report
contention as contention wherever it occurs.

## What the reviewers agreed was already right

Do not revisit these; they are closed with regression tests that fail when
reverted:

- the admission contention bound under production defaults, including
  cumulative retries;
- verification refusing agreement when a connection becomes inactive
  mid-verification;
- numeric source-time precision, including JSON lexical precision;
- the whole-millisecond check at boundary magnitudes;
- aggregate verification outcomes across disagreeing connections;
- `--limit 0` as invalid input rather than an internal error.

## Constraints

Do not add dependencies. Do not weaken or delete an existing test. Do not
rewrite stored rows to make a comparison pass — that is the defect, not the
fix.

## Evidence

For each finding: the confirmation before the fix, the fix, and a regression
test shown to fail against `c7e975f`. For finding 1 the test must involve a
store written under the old rule, not only new collections under the new one.

Run `npm run check` against your exact final commit and report its real output
and that commit. Obtain an independent read-only review of that exact commit
through whatever mechanism the repository provides. If none is available,
report the review as unavailable rather than as passed.
