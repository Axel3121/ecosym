---
needs:
  - 002-close-review-findings
touches:
  - docs/tasks/003-store-boundary-values.md
  - src/collect.ts
  - src/materialize.ts
  - src/store.ts
  - src/time.ts
  - test/cli.test.ts
  - test/collection.test.ts
  - test/store.test.ts
  - test/verify.test.ts
  - test/fixtures/fifth-source/habitat-survey.csv
  - test/fixtures/verification/corrupted.jsonl
  - test/fixtures/verification/original.jsonl
  - test/helpers/interrupted-collection-worker.ts
---
# Task 003 - Make the store boundary check values, not just field names

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

This task continues branch `task/001-observation-layer`. Task 002 closed the
store's admission boundary against *undeclared field names*. An independent
quality review then found the boundary accepts declared fields carrying values
the store cannot faithfully hold.

## Outcome

A fact reaching `ObservationStore.collect` is rejected unless its identity and
time values are what the store can hold faithfully. What the store persists is
what the caller supplied, or the attempt fails; a value is never coerced into a
different value on the way in.

## The defect, reproduced

At `65901fc`, this succeeds and persists corrupted data:

```ts
await store.collect(active, (sink) => {
  sink.writeFact({
    epistemicStatus: "observation", factOwner: "owner-a", kind: "example.value",
    payload: { value: 7 },
    sourceRecordedAt: "2026-02-30",   // impossible calendar date
    sourceRecordId: 42 as any,        // number, not string
    subject: 99 as any,               // number, not string
  });
});
```

Observed result: `outcome: "success"`, and the row reads

```text
subject = "99.0"   source_record_id = "42.0"   source_recorded_at = "2026-02-30"
```

Three separate failures of the same rule:

- SQLite coerced numbers to strings. `99` and `"99.0"` are different identities;
  distinct caller values can collapse onto one persisted identity.
- An impossible calendar date persisted. Task 002 rejected this at
  materialization, so the source path is closed and this path is not.
- The attempt reported `sourceRecordsSeen: 0` alongside `factsAdded: 1`.

## What must be true

**Identity values are strings or the attempt fails.** `subject`,
`sourceRecordId`, `factOwner`, and `kind` are rejected when they are not
strings. Rejection fails the attempt; it is never a silent skip, and nothing
from that attempt is persisted.

**A persisted source time is a real instant, or is absent.** `null` remains
valid and means the source expressed no time; Task 001 supports sources that
have none, and that is not the defect here. A *present* `sourceRecordedAt` is
rejected unless it denotes a real calendar instant the store can order.

Task 002 already decided what "real" means for source data in
`src/materialize.ts`. Do not invent a second, competing definition here —
establish that rule once and have both paths obey it.

Whether a valid non-UTC representation (`2026-08-30T12:00:00+02:00`) is
rejected, or preserved exactly alongside a separate sortable key, is yours to
decide. Both satisfy this task. State which you chose and why, and make ordering
work under it — the rule is that nothing is silently rewritten, not that only
one spelling exists.

**No value is silently transformed.** This applies to every value in a
`FactInput` the store persists — identity fields, source time, and declared
payload values alike. If a supplied value cannot be persisted exactly as given,
the attempt fails rather than storing a changed value. Note that SQLite's type
affinity is the mechanism that made this possible: a number handed to a text
column became a different string without any code deciding to change it.

This is the same rule the CSV and calendar-date fixes established for source
data, now applied where a caller writes directly.

**A fact has an origin.** The reproduction reported `sourceRecordsSeen: 0`
alongside `factsAdded: 1`: a fact appeared that no source record produced.

`recordSourceRecord()` is not a statistic a caller may skip. In `src/collect.ts`
it is called once per record read from the source, immediately before that
record's facts are written — it is how a fact is tied to the record it came
from. `PRODUCT.md` requires an observation to carry where it came from, so a
fact written outside any source record has no origin to carry.

Make that structurally true rather than conventionally true: it must not be
possible to write a fact that no source record accounts for. Whether that means
rejecting such a write, or restructuring the sink so facts are written within a
record's scope, is yours to decide.

If you conclude the current shape is already correct and the reproduction is
misreading it, say so with evidence rather than changing code to match my
description.

## Boundaries

The store validates against **the connection's own persisted declaration**,
never against a list of field names or value shapes the product knows. A test
that passes because the core learned one source's schema has broken
`ARCHITECTURE.md`, whatever the test asserts.

Do not add dependencies. Do not weaken or delete any existing test to make a new
rule pass; if an existing test asserted the old permissive behaviour, its
assertion was wrong and the change is part of this work.

## Evidence

Every rule above gets a regression test that fails before its fix. Run each new
test against the unfixed code first and report that it failed.

For the boundary specifically, prove the test is load-bearing: remove or disable
the validation, show the test fails, restore it. Report both outputs.

Report the real output of `npm run check`, and the exact commit it ran against.

## Independent review

Obtain a fresh independent review of the final candidate before reporting done,
against the exact final commit. Report what it found. If it found nothing, say
so plainly rather than implying more scrutiny than occurred.

## Report

Per rule: what changed, which test proves it, and its before-fix failure. Name
anything you chose not to do and why.
