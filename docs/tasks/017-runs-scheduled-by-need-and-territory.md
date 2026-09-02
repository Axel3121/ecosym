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

## Territory policy

The declaration-width and undeclared-write rules are owned by
[`DEVELOPMENT.md`](../../DEVELOPMENT.md#writer-ownership-and-concurrency). This
task implements those rules rather than redefining them.

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

---

# Closing the review on PR #20

Everything above is the original task and has largely been implemented on this
branch. This section is what remains before the pull request can land.

## The state you are starting from

PR #20 is `MERGEABLE / BLOCKED`. `check` and CodeRabbit pass. Two things are
outstanding, and one of them is easy to miss:

**The `automated review` check did not fail — it was CANCELLED.** It never
produced a verdict. Unlike PRs #17, #18 and #19, this pull request has never
been assessed by Qodo at all. A cancelled check is not a passing check, and it
must not be treated as one. Find out why it cancelled and get a real verdict.

**Three CodeRabbit rounds posted ten inline findings.** You have already
answered four of them on the pull request: the frozen declaration, the atomic
check-and-reserve (`08f6fb6`), the task identity (`4b55f63`), and the rejection
of "do not turn ambiguous history into a valid declaration". Those answers
stand. Do not re-litigate them.

The rest are unanswered. Read the current set rather than trusting this list:

```
gh pr view 20 --json comments,reviews,statusCheckRollup
gh api repos/Axel3121/ecosym/pulls/20/comments --paginate
```

## Two findings that are confirmed, not alleged

These were reproduced against `d4b5d0b` in this worktree before this section
was written. Both are in `scripts/run-ledger`, in the close path. Verify them
yourself, then fix them.

**A run with no declaration closes as landed without any audit.** The gate
reads `if record_declaration(started) is not None and args.outcome ==
"landed":`. A started record carrying no `needs`/`touches` therefore skips the
undeclared-path refusal entirely. The run whose territory is *least* known is
the one that receives the least scrutiny. That is backwards, and it
contradicts the fail-closed principle you argued for on the pull request
yourself: a spec without a declaration is refused at launch, so a *record*
without one should not sail through at close.

**`territory_audit: "passed"` is recorded for runs with undeclared writes.**
The final `append` computes `"territory_audit": "unknown" if audit_error else
("passed" if changed is not None else None)`. It never consults `undeclared`.
The refusal block above it runs only when `args.outcome == "landed"`, so
closing with any other outcome writes a record where `undeclared_paths` lists
real violations while `territory_audit` says `passed`. The ledger is the
evidence trail for this repository; a record that contradicts itself is worse
than no record, because it will be believed.

Decide what a truthful status is for each case and make the record say it.

## The remaining findings

Assess each against the current branch. Some may be stale — for example, the
`run-task` task-name validation the review asks for is already present at
`scripts/run-task` l. 33-39, and the `Task 013` heading was corrected in
`4b55f63`. A stale finding gets answered as stale, with the evidence that
retires it.

Findings still open at the time of writing, by file:

- `scripts/run-task:122` — specs whose `touches` does not cover their own spec
  file.
- `test/run-task.test.ts:1270` — assert the recorded audit status, not only the
  exit code. This is the test that would have caught the mislabel above.
- `test/run-task.test.ts:1365` — the race setup does not prove overlapping
  eligibility checks. It starts both processes near the same time, which is not
  the same as forcing `racer-b` to call `can-start` inside `racer-a`'s window.
- `docs/tasks/002-close-review-findings.md:16` — `test/fifth-source.test.ts` is
  edited by that task but absent from its `touches`.
- `docs/tasks/016-dependency-audit.md:9` — the prose constraint list names four
  paths, the declaration names six.
- `docs/tasks/017-...:91` — the section reopens decisions `DEVELOPMENT.md`
  already owns.
- `docs/tasks/009-...:19` — repeated scheduler-policy note across specs.

The last two are the same species of problem `AGENTS.md` warns about: policy
restated away from its owner drifts. Decide once where the rule lives.

## Boundaries

This branch owns `DEVELOPMENT.md`, `docs/tasks/`, `scripts/run-ledger`,
`scripts/run-task` and `test/run-task.test.ts`. Task 013 is running
concurrently in its own worktree and owns `docs/credential-owner-findings.md`.
Task 012 is running concurrently and owns `docs/petition-identity.md`. Do not
touch either.

Your territory includes `docs/tasks/`, and both of those runs have an addendum
appended to their own specification there. You may add frontmatter to those
files as this task requires — that is your declared territory. Do not edit
their prose; those two runs are working from it as they read.

Note the asymmetry: your own scheduler is what would normally enforce this,
and it is unmerged. For the duration of these three runs the boundary is
honoured because it is written here, not because anything is checking.

Do not weaken or delete an existing test to make a new rule pass.

## Evidence

Every fix gets a regression test that fails before it. Run each new test
against the unfixed code first and report that it failed. For the two
confirmed defects specifically, prove the tests are load-bearing: remove the
fix, show the test fails, restore it, report both outputs.

Report the real output of `npm run check` and the exact commit it ran against.

## Report

Per finding: addressed, or rejected with evidence. Say plainly whether the
`automated review` check produced a verdict this time, and what it said.
