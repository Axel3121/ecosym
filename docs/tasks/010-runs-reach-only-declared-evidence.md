---
needs:
  - 001-observation-layer
touches:
  - docs/tasks/010-runs-reach-only-declared-evidence.md
  - .opencode/agent/prober.md
  - .opencode/tools/bash.ts
  - docs/observation-layer.md
  - opencode.json
  - scripts/agent-shell
  - scripts/ecosym-sandbox
  - scripts/run-task
  - scripts/verify-sandbox
  - src/agent-shell-cli.ts
  - src/agent-shell.ts
  - src/sandbox-cli.ts
  - src/sandbox-runtime.ts
  - src/sandbox.ts
  - test/agent-shell.test.ts
  - test/run-task.test.ts
  - test/sandbox.test.ts
---
# Task 010 — A run reaches only the evidence it was connected to

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continue on branch `task/001-observation-layer` in this worktree. Commit each
coherent piece as you go.

**Note on `needs`.** The sentence above names the branch this work continued
on. Here that happens to match the real dependency — Git history puts it at
001 — but the declaration is what the scheduler reads, not the prose.

## Outcome

A sandboxed run can read exactly the source data its connections declare, and
can write only where it is meant to write. Today it can read whole personal
archives that no connection asked for, and every agent — including one whose
only job is to run throwaway experiments — can modify the repository.

## Why this is not a documentation change

`.opencode/agent/prober.md` already says "Work only in a scratch directory
under `/tmp`. Never write to the project." That sentence is a request. The
agent has `write: true`, `edit: allow`, and `bash: *`, and the sandbox binds
the project read-write. Nothing enforces the boundary the document describes.

A rule an agent is asked to follow is not a rule it cannot break. This task
is about the second kind.

## What must be true

**A run reads only what its connections declare.** Measured now, the sandbox
binds:

```text
$HOME/.hermes/state.db      582 MB, 83,551 rows in `messages`
                            — connection needs `async_delegations`, 51 rows
$HOME/shorts-content        8.2 GB, all channels and assets
                            — connection needs output/reports/, 108 KB
```

The `hermes-delegations` connection declares one table. The `shorts-*`
connections declare two report paths. Everything else in those mounts is
personal history that no connection asked for and no task needs. It is
exposed to every agent in every run.

Narrow what is mounted to what is declared. Where a source is a database and
only one table is declared, mounting the whole file still exposes the rest —
say plainly in the delivery whether that case is solved or merely reduced,
rather than implying a guarantee the mount does not provide.

**An agent that only runs experiments cannot change the repository.** The
prober's write boundary is enforced by the runtime, not by its own
instructions. Removing its `write`/`edit` tools is not sufficient on its own
while `bash` can redirect into a file; the boundary has to hold against any
path the agent has.

**The enforcement is verifiable from outside the agent.** A check can
demonstrate the boundary holds without trusting an agent's report that it
behaved. `PRODUCT.md` requires observed outcomes rather than asserted ones;
this is the same rule applied to the runtime that produces them.

**Nothing that works today stops working.** Collection, verification and the
task runner keep functioning against real connected sources. A boundary that
breaks the product is not a boundary, it is an outage.

## The test that decides it

Two, and both must be demonstrated by running them:

1. From inside a sandboxed run, attempt to read a part of a bound source that
   no connection declares — for instance the `messages` table in
   `state.db`, or a file under `shorts-content` outside `output/reports/`.
   It must fail. Show the exact error.

2. From inside a prober-scoped run, attempt to modify a tracked repository
   file through the shell, not through an editor tool. It must fail. Show the
   exact error, and show that a write to the intended scratch location still
   succeeds.

A test that only proves the agent *chose* not to write proves nothing. Break
the enforcement and show the check fails.

## Constraints

- Do not weaken the existing sandbox for other agents to make prober work.
- Do not add a dependency without saying so.
- `~/.hermes/**` and `~/shorts-content/**` stay unwritable, as they are now.
- The sandbox is `~/bin/ecosym-sandbox`, outside the repository. If the fix
  requires changing it, say so explicitly in your report and explain what a
  reader of the repository alone would not see.

## Out of scope

Proving that experiment inputs are *semantically* synthetic. A filesystem
boundary cannot tell a real record from a fabricated one that looks like it.
If you find yourself claiming synthetic-only enforcement, stop and say what is
actually enforced instead.

Network egress. Named here so it is not silently assumed to be covered.

## Report

State what is enforced by the operating system, what is enforced by
configuration, and what remains a request. Those three are different, and the
difference is the entire point of this task.
