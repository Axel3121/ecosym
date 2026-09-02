---
needs: []
touches:
  - AGENTS.md
  - DEVELOPMENT.md
  - docs/tasks/
  - scripts/run-task
  - scripts/run-ledger
  - test/run-task.test.ts
---
# Task 019 — The repository stops carrying our workflow

Read `DEVELOPMENT.md` first, particularly "Repository artifacts".

Work on branch `task/019-specs-leave-the-repository` in this worktree. Commit
each coherent verified piece as you go.

## Outcome

`docs/tasks/` is gone from the repository. The scheduler reads specifications
from a location outside it, configured rather than hardcoded, and every
guarantee it currently makes — territory conflicts, frozen declarations,
fail-closed on a missing declaration — still holds and is still tested.

## Why this exists

This repository is intended to become a public project. `docs/tasks/` is 2,500
lines of instructions written to the agents that build it — roughly half the
size of `src/` — and it is process, not product. A contributor reading "Task
013 — find out whether any credential owner on this machine can carry a
petition" learns nothing about what this software does.

It is not only clutter. Automated review spends its budget on those documents:
on 2026-09-02 three pull requests carried 28 unresolved review threads between
them, most of them findings on task specifications belonging to other subjects.

The coupling is thinner than it looks. Measured on 2026-09-02:

- `src/` does not reference `docs/tasks/` at all.
- `scripts/run-task` hardcodes one path: `SPEC="docs/tasks/${TASK}.md"`.
- Nearly every reference in `test/run-task.test.ts` is a fixture with an
  invented name (`example.md`, `demo.md`, `old.md`) that never needed the real
  directory.

The tooling needs *a* specification directory. It does not need that directory
to be inside the repository under review.

## What must be true

**The specification root is configuration, not a constant.** `run-task` and
`run-ledger` take it from an environment variable with a sensible default
outside the repository. Why: the whole point is that this location is ours and
not the project's, so it must be replaceable without editing tracked code.

**Nothing inside the specification root becomes a contract by accident.** The
existing refusal of task names that escape the directory has to survive the
move, and it has to be tested against the new root. Why: the name is now
resolved against a path nobody reviews in a pull request, which makes the
traversal guard more load-bearing than it was, not less. `run-ledger start`
already refuses a traversal name; keep both refusals.

**`touches` still governs the repository.** Declared paths are repository
paths. A specification living outside the tree still declares what it will
change inside it, and the territory audit still refuses a landed close for an
undeclared write. The one path that disappears is the specification's own file,
which several declarations currently list because `run-task` copies it into the
worktree — that copy stops happening, so the requirement to declare it must go
with it, not linger as a rule about a file that is no longer there.

**The current specifications move, they are not deleted.** Everything under
`docs/tasks/` at your base commit goes to the new root, including the landed
ones. Sorting out which of those are still worth keeping is a separate
judgement and not this task's business.

**`DEVELOPMENT.md` and `AGENTS.md` say where they live and why.** The reason is
the part that matters: the repository holds the product and its evidence, not
the instructions used to produce it. Without the reason someone helpfully moves
them back.

## The test that decides it

`run-task` launches a real run whose specification is outside the repository,
and that run's territory is enforced: construct two specifications with
overlapping `touches` in the new root, show the second refuses to start while
the first is live, remove the check, show it starts. Report both outputs.

Then the control that makes the move meaningful: `git ls-files docs/tasks` is
empty, and `npm run check` passes. A move that quietly leaves the directory
tracked has changed nothing.

Every guard you touch gets the same treatment — remove it, show the test fail,
restore it, show it pass. `DEVELOPMENT.md` owns this rule.

## Out of scope

Deciding which specifications deserve to survive the move. Everything goes.

Changing how `needs` resolves, the ledger's storage, or the conflict algorithm.
This task changes where a specification lives and what reads it.

The findings documents under `docs/` — `credential-owner-findings.md` and
`observation-layer.md` are evidence produced by the work, not instructions to
an agent. They stay.

## Report

Say what the new root is and how it is configured, which guards you re-tested
against it, and anything that turned out to depend on specifications being
in-tree that this specification did not anticipate.
