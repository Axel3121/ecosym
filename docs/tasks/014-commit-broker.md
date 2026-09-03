# Task 014 — A run commits through a broker that will not run its code

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Work on branch `task/014-commit-broker` in this worktree. Commit each coherent
verified piece as you go.

## Outcome

A run can no longer write inside `.git`. It commits by asking a broker that
runs outside the sandbox, and that broker executes one operation with
arguments the run supplies as data. The run's changes still reach history at
the granularity its author chose; the run no longer controls the git that
puts them there.

## The defect, reproduced

`sandboxArguments` binds the project's `.git` directory writable so a run can
commit its own work. A run can therefore write anything under `.git`, and git
run later by the operator reads it.

Nine paths from that write access to host execution were demonstrated, each
with a command and an observed result:

- `.git/hooks/post-checkout` — fired on an ordinary `git checkout -b`
- `.git/hooks/reference-transaction` — fired three times from one commit,
  because nearly every git operation touches a ref
- `.git/hooks/post-merge`, `.git/hooks/pre-push` — fired on merge and push
- `.git/config` → `core.hooksPath` pointed at a directory the run created
  inside `.git` itself, which is why protecting `.git/hooks` alone is not a
  protection
- `.git/config` → `filter.<name>.smudge` with `.git/info/attributes`, needing
  no `.gitattributes` in the worktree at all
- `.git/config` → `core.fsmonitor`, fired by `git status`
- `.git/config` → `core.sshCommand`, fired before the network error it
  precedes
- `.git/config` → `credential.helper`, fired with no network at all

Four more are likely and untested: `core.pager`, `diff.<name>.command`,
`protocol.ext.allow`, and submodule configuration.

Reproduce at least the `core.hooksPath` and `core.fsmonitor` paths in a
fixture repository before changing anything, and keep them as regression
tests. They are the two that defeat the obvious partial fix.

## Why an allow-list was rejected

Git always reads the repository's own config, and there is no supported flag
to ignore it. Screening the dangerous keys is therefore a deny-list against a
surface that other people extend: `reference-transaction` and the fsmonitor
hook are both recent additions. A boundary that a git release can widen is
not a boundary.

`.git` becomes read-only to the run instead. With no writable config, the
host's git never reads configuration the run authored, and the whole
allow-list question does not arise.

## What must be true

**The run cannot write inside `.git`.** Not the config, not the hooks, not
`info/attributes`, not any directory `core.hooksPath` could name. Why: every
demonstrated path above begins with that write.

**The broker executes one operation.** Commit. Not "run git" — no branch, no
push, no amend, no rebase, no rev-parse, no flags. A request that names
anything else is refused without reaching git.

**The request is data.** The message and the paths are passed as arguments,
never through a shell, and never as a git configuration value. A message
containing `--exec`, a newline, or a shell metacharacter changes the commit
message and nothing else.

**Requested paths narrow; they never widen.** What may be staged is

    requested ∩ declared touches ∩ actually changed

An absent `paths` means "everything I am already allowed to touch", not
`git add .`. Why: a request may describe the effect it wants. It may not
assert the authority that permits it.

**The broker's git configuration is explicit.** Global and system config are
excluded, and the broker's own local surface is known. Why, measured: a
worker-written `.gitattributes` naming `filter=preinstalled` executed a host
command when the operator had a filter by that name installed, and stopped
executing under `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null`.
The worker cannot define a filter, but it can name one the operator already
defined — so the broker's config surface must be chosen, not inherited.

**The broker's authority is commit and nothing else.** It is a separate
process from the watchdog. Why: the watchdog is a failure detector, and a
later change to it must not inherit repository mutation.

**The broker lives and dies with its run.** It starts when the run starts,
exits when the run exits, and serves that run only. A request naming another
run's worktree is refused.

**The run learns the outcome, not the output.** `OK`, `DENIED`, or `FAILED`.
No git stdout, no stderr, no diff. Why: the reply is a channel back into the
sandbox, and everything on it is attack surface.

**Refusal is recorded.** A denied request is written to the run's log with
its reason. Why: a boundary nobody can see rejecting anything is
indistinguishable from one that never fires.

## The test that decides it

In a fixture repository, from inside the sandbox:

1. Write `.git/config`, `.git/hooks/pre-commit`, and
   `.git/info/attributes`. Each write must fail. Then run the host-side git
   operation that would have triggered each, and show nothing executed.
2. Set `core.hooksPath` to a directory inside `.git`, by every route the run
   has. All must fail.
3. Request a commit for a declared, changed path. It must succeed, and the
   commit must contain exactly that path.
4. Request a commit for a path outside the declared touches. It must be
   refused, the reason logged, and no commit created.
5. Request a commit with a message containing `--exec=id`, a newline, and
   `$(id)`. The commit message must contain those characters literally and
   nothing must have executed.
6. Write a `.gitattributes` in the worktree naming a filter the operator has
   installed, then request a commit. Nothing must execute broker-side.
7. Request a commit naming another run's worktree. It must be refused.

Each case gets a regression test. For each, break the guard it protects and
report the exact failing assertion. A test that passes with the guard removed
is proof of nothing — in the symlink work that preceded this task, three
tests passed against a broken guard because the fixture directory's name
happened to satisfy the assertion's pattern.

## Scope

- `src/sandbox-runtime.ts`, the broker and its tests, `scripts/run-task`.
- Do not weaken or delete an existing test. If one must change because `.git`
  is no longer writable, name it and explain the changed assertion.

## Out of scope

Push, branch creation, rebase, and any other git operation. If a run needs
one, that is a separate decision about a separate authority, and the honest
answer for now is that the operator does it.

Sandboxing the broker itself, and reducing the privilege of host-side git.
Both are real second lines of defence and neither is this task.

Whether a commit per coherent piece survives this change. It should — the
broker exists precisely so it does — but if implementation shows the
granularity cannot be kept, report that rather than quietly committing once
at the end.
