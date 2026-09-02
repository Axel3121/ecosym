---
needs: []
touches:
  - DEVELOPMENT.md
  - docs/tasks/
  - scripts/run-ledger
  - scripts/run-task
  - test/run-task.test.ts
---
# Task 017 — Runs are scheduled by what they need and what they touch

Closes #13.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Work on branch `task/017-run-scheduling` in this worktree. The run ledger this
task builds on has landed in `main`; `scripts/run-ledger` is the git-derived
state model referred to below. Commit each coherent verified piece as you go.

## Outcome

A person deciding what to start next asks the tooling instead of reading twelve
task specifications and holding the answer in their head. A run cannot start
while another run holds the files it would edit, and that refusal comes from a
check rather than from an operator remembering.

Today the ledger records what a run came to. It cannot answer what may begin.

## Why this exists

Every specification under `docs/tasks/` names its subject in prose, and some
name their predecessor in prose too — Task 011 opens with "Continue on branch
`task/001-observation-layer` in this worktree." That sentence is a dependency,
written for a human, unreadable by anything.

The consequence is that every task has been run one at a time. Not because the
work is inherently serial: 003 and 010 touch disjoint files and could have run
together. The queue is serial because nothing can prove two runs would not
collide, so the safe choice is always to wait.

On 2026-09-01 two agents working in the same checkout collided three times in
one session: one moved HEAD to a new branch under the other, a commit landed on
the wrong branch, and an unrelated dependency edit appeared in a working tree
that did not expect it. Isolation per run would have prevented the mechanics.
It would not have answered whether the two tasks should have been running at
the same time at all.

## What must be true

**A task specification declares what it needs and what it touches.** Two
fields, machine-readable, in every specification under `docs/tasks/`. `needs`
names the tasks that must have landed first. `touches` names the repository
paths the run is expected to modify. Prose continues to explain; these fields
decide.

**A specification without those fields is not startable.** Not "startable with
a warning" — refused. A missing declaration is an unknown territory, and an
unknown territory cannot be proven disjoint from anything. Fail closed.

**The tooling answers what may begin.** A command lists the tasks whose `needs`
have landed and whose `touches` overlap nothing currently running. The answer
derives from Git and from live run state on every invocation, never from a
cached list — the same rule the ledger already follows.

A running task's declaration is read from the spec snapshot in its own worktree,
not from the shared branch: `run-task` copies the spec into the worktree at
launch, and the territory a run actually holds is the one it started with. Say
so in the report if you find a reason to decide otherwise.

**A run refuses to start on contested ground.** Launching a task whose
`touches` intersect those of a running task fails, names the conflicting task,
and does not start. This is the check that replaces an operator's judgement,
so it must hold when the operator is not paying attention.

**A run refuses to start in the shared checkout.** Every run gets its own
worktree. The main checkout stops being a work surface.

## The question this task must decide

`touches` is a claim made before the work happens, and the work may disagree
with it. Two failure modes pull in opposite directions:

- Declared too broadly (`src/`), every task conflicts with every other and the
  scheduler serialises everything — the current state, with more ceremony.
- Declared too narrowly, two runs are told they are disjoint and then both
  discover they need to edit the same test helper.

Decide which of these the design must prefer, and say why in the report. Decide
also what happens when a run edits a path it did not declare: whether that is
detected, whether it is refused, whether it is merely recorded. Do not treat
this as settled by the phrasing above.

## Evidence

Every rule above gets a regression test that fails before its fix.

For the conflict check specifically, prove it is load-bearing: construct two
task specifications with overlapping `touches`, show the second refuses to
start while the first is live, remove the check, show it starts. Report both
outputs.

Backfill `needs` and `touches` for every specification present under
`docs/tasks/` at your base commit — `ls docs/tasks/*.md` says how many there are;
do not trust a count written here. Derive them from what those tasks actually
changed in Git history, not from what their prose implies.
Where history and prose disagree, report the disagreement rather than choosing
silently.

Report the real output of `npm run check`, and the exact commit it ran against.

## Out of scope

Scheduling policy beyond disjointness — priority, ordering among eligible
tasks, or any automatic selection of what to run. This task makes the set of
startable tasks visible and makes collision impossible. A person still chooses.

Cross-repository coordination. This governs one repository.
