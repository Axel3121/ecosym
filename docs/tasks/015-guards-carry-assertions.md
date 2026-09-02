---
needs: []
touches:
  - src/config.ts
  - src/json.ts
  - src/materialize.ts
  - src/readers.ts
  - src/store.ts
  - src/time.ts
  - test/cli.test.ts
  - test/collection.test.ts
  - test/config.test.ts
  - test/csv-cli.test.ts
  - test/guards.test.ts
  - test/store.test.ts
  - test/verify.test.ts
---
# Task 015 — A guard is defended by a test or it is deleted

Closes #10.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Work on branch `task/015-guards-carry-assertions` in this worktree. Commit each
coherent verified piece as you go.

## Outcome

Removing a validation guard in `src/` makes a named test fail. Today much of the
suite executes guards without asserting anything about them: an independent
reviewer ran 25 single-line mutations and 18 survived a green `npm test`.

The deliverable is a mutation score with the surviving mutants named, and either
an assertion or a deletion for each one addressed.

## Why deletion is a real option

A guard no test defends is indistinguishable from a comment, and the honest
resolution is sometimes that the guard was never load-bearing. Deleting it makes
the code smaller and the remaining guards mean something. Choosing to keep one
means writing the test that proves it matters.

Do not default to keeping everything. Say, per guard, which you chose and why.

## What must be true

**Every guard addressed is exercised by an assertion that fails without it.**
Not covered — asserted. Why: `DEVELOPMENT.md` already says a result that would
look identical when the mechanism is absent has established nothing.

**The mutation is semantically meaningful.** Removing a bound check, accepting a
rejected value, inverting a comparison. Not renaming a variable.

**No test is weakened to make a mutant die.** If an existing test must change,
name it and say why.

## Named survivors

Reported by the reviewer, in the modules this task owns:

- `json.ts` — canonical key sort removed; NaN/Infinity accepted as valid scalars
- `config.ts` — "facts must not be empty" validation removed
- `store.ts` — query limit raised 1000x; busy-timeout negative guard removed
- `readers.ts` — CSV empty-header and row-length-mismatch checks removed
- `time.ts` — month bound removed; seconds bound off-by-one (59 → 60)
- `materialize.ts` — empty-subject rejection removed

The `json.ts` sort is the one to take seriously first: it underwrites hash
stability for `sourceRecordId` and payload hashes, so a surviving mutant there
means two different records can be proven identical.

This list is what one reviewer found, not a boundary. Run your own mutations
across the modules in scope and report survivors it missed.

## The test that decides it

For each guard you keep: remove the guard, run `npm test`, paste the failing
assertion. Restore it, run again, paste the pass. Both outputs, per guard.

A summary saying "all mutants now die" is the exact shape of claim this task
exists to stop being believed.

## Constraints

Report a mutation score — mutants introduced, mutants killed — not a coverage
percentage. Coverage is what made the defect invisible.

Another run is working on the sandbox shell concurrently. `src/agent-shell.ts`
and `src/sandbox-runtime.ts` are **out of scope** even though the reviewer named
a HOME-validation survivor in both; check whether that survivor is still alive
and report it for the other run rather than fixing it here.

Do not modify existing files under `test/helpers/` or `test/fixtures/`, or
`.github/`. Add a new test file if you need one.

## Out of scope

New features, refactoring beyond what an assertion requires, and any change to
`src/` behaviour other than deleting a guard you judged unnecessary.

## Report

The mutation score, the per-guard decision with its reason, the survivors you
found that the reviewer did not, and the real output of `npm run check` with the
commit it ran against.
