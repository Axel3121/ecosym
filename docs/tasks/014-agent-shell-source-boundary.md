---
needs: []
touches:
  - src/agent-shell.ts
  - src/sandbox.ts
  - src/sandbox-cli.ts
  - src/sandbox-runtime.ts
  - test/agent-shell.test.ts
  - test/sandbox.test.ts
---
# Task 014 — A connected source is unwritable through every shell this repository ships

Closes #9.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

## This task cannot be run by an ordinary autonomous run

Measured on 2026-09-02 against `c801331`, before any attempt to execute it.

The files this task must change are protected against exactly the kind of
process that would execute it, by two independent mechanisms:

- `opencode.json` sets `"src/agent-shell.ts": "deny"` and the same for
  `sandbox.ts`, `sandbox-cli.ts` and `sandbox-runtime.ts` under
  `permission.edit`.
- `agentShellArguments` re-binds those four paths read-only through
  `sandboxDefinitionPaths` (`src/agent-shell.ts` l. 287-297), so even a shell
  that got past the permission layer meets a read-only filesystem. A probe
  attempting to overwrite `src/agent-shell.ts` from a fresh worktree in agent
  mode received `Read-only file system` and the file was unchanged.

This is not a defect to route around. `SECURITY.md` records the incident that
put those protections there: a shell could rewrite the sandbox definition that
governed it. Issue #9 offers routing through the runtime as the alternative
approach, but `sandbox-runtime.ts` carries the same two protections.

So this work needs either a supervised run with a deliberate, scoped, and
time-boxed exception, or a human editing those files. Deciding which is the
maintainer's call and is not part of this task. Do not grant yourself the
exception.

The rest of this specification stands and is what the work must satisfy once
that decision is made.

Work on branch `task/014-agent-shell-source-boundary` in this worktree. Commit
each coherent verified piece as you go.

## Outcome

A registered source cannot be written by an agent, whatever sandbox that agent's
command goes through and wherever on the filesystem the source happens to live.
Today `ecosym-sandbox` enforces that with a SQLite read-only guardian and an
OS-level remount; the per-command shell in `src/agent-shell.ts` has no concept
of a registered source at all.

## Why this matters more than it looks

A connected source is the evidence the whole system reasons from. If an agent
can edit it, every observation derived from it is a claim about a file the agent
controls, and `verify` proves agreement between two things the same process
wrote.

The current protection outside the worktree and `/tmp` is real but accidental:
it comes from the blanket `--ro-bind / /`, which every unrelated file on the
machine also gets. Protection that follows from filesystem location changes the
moment someone registers a source somewhere new, and nothing will say so.

## What must be true

**Registration, not location, decides.** A source is unwritable because it is
registered, not because it sits outside a writable mount. Why: the property has
to survive a user putting a source in a directory the agent legitimately writes.

**Every shell this repository ships enforces it.** Whether that is achieved by
teaching `agent-shell.ts` about sources or by routing agent commands through the
runtime that already knows, is yours to choose. Say which you chose and why.

**A failure to determine the source set is a refusal.** If the config cannot be
read or parsed, the shell does not run. Why: an unreadable config is an unknown
territory, and an unknown territory cannot be proven safe. Fail closed.

**Nothing that legitimately needs writing loses it.** The worktree, the state
directory and `/tmp` stay writable except where a source sits inside them.

## The test that decides it

A registered SQLite source, written to through `executeAgentShellCommand` in
agent mode, from each of: inside the worktree, inside `/tmp`, and outside both.
All three refused.

Then the control that makes it mean something: an **unregistered** file at the
same path in the worktree and in `/tmp` is still writable. If both the
registered and unregistered cases fail, you have proven the mount plan is
tight, not that it discriminates on registration — and the outside-both case
would pass under today's defect too.

Report the output of all cases, registered and unregistered.

## Evidence

Every rule above gets a regression test that fails before its fix — show the
failing assertion, not a claim that it failed.

`test/agent-shell.test.ts` presently contains no reference to sqlite,
`prepareSandboxSources` or `readonlySourceDirectories`; `git grep` in your
worktree says whether that is still so. Report the real output of `npm run
check` and the commit it ran against.

## Constraints

Another run is working on test assertions across `src/` at the same time. Files
outside your subject are being edited concurrently: confine changes to
`src/agent-shell.ts`, `src/sandbox.ts`, `src/sandbox-cli.ts`,
`src/sandbox-runtime.ts`, `test/agent-shell.test.ts` and `test/sandbox.test.ts`.

Do not modify existing files under `test/helpers/` or `test/fixtures/` — they
are shared. Add a new file there if you need one.

If the fix genuinely requires a file outside that list, stop and report it
rather than editing it.

## Out of scope

The outer `ecosym-sandbox` guardian's existing behaviour, which already works.
Source registration UX, config schema changes, and anything under `docs/`
beyond noting the boundary where the canonical documents already describe it.

## Report

What you changed, which mechanism you chose and why, both halves of the
discriminating test, and anything in `SECURITY.md` or `ARCHITECTURE.md` that
turned out to describe a boundary that does not exist.
