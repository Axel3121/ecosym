---
needs: []
touches:
  - .github/dependabot.yml
  - .github/workflows/check.yml
  - docs/tasks/016-dependency-audit.md
  - package.json
  - test/check-workflow.test.ts
---
# Task 016 — The dependency check examines dependencies that exist

Closes #12.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Work on branch `task/016-dependency-audit` in this worktree. Commit each
coherent verified piece as you go.

## Outcome

The CI step that claims to audit dependencies audits a non-empty set, and fails
when that set contains a real advisory.

CI runs `npm audit --omit=dev --audit-level=high`. The project has no runtime
dependencies, so the step passes over nothing. The only dependencies that exist
are dev dependencies, and `--omit=dev` excludes them by construction. The
workflow comment is honest about intent; the step still proves nothing today.

## Why this is the same defect as the others in this repository

A green check that would be green with the mechanism absent is not evidence.
This step has been green since it was added and would have stayed green with a
critical advisory in `typescript`. It reports a guarantee nobody is receiving —
the same shape as the branch protection in #11 and the unasserted guards in #10.

## What must be true

**The audited set is non-empty and demonstrated to be.** Whatever the final
configuration, show the count of packages it actually examines.

**A finding fails the check.** Prove it, do not assert it.

**The workflow says what it does.** If dev dependencies are the only ones that
exist, the step's name and comment say that rather than implying a runtime
audit is happening.

Whether the answer is Dependabot alone, a second audit step covering dev
dependencies, both, or something else, is yours. Say what you chose and why.

## The test that decides it

Make the check fail on a dependency with a known advisory, and show the failure
output. Then remove the cause and show it pass.

How you produce the failing case is your call — a fixture manifest pinning a
vulnerable version, a lowered `--audit-level` against a real finding, whatever
is honest. What is not acceptable is reasoning that it would fail. If you find
no way to make it fail without network access the sandbox denies, say so
plainly and name what would settle it, rather than reporting the step as fixed.

One interaction to know about before you pick: the workflow runs `npm ci`
immediately before the audit step, and `npm ci` exits non-zero when
`package.json` and `package-lock.json` disagree. A vulnerable devDependency
added to the real manifest without regenerating the lockfile therefore breaks
the install step rather than demonstrating anything about the audit step. A
fixture directory outside the CI install path avoids this entirely; so does
regenerating the lockfile. Both are fine — know which you chose and why.

`test/check-workflow.test.ts` already asserts properties of the workflow file;
extend it rather than duplicating it.

## Constraints

Dependabot alerts and automated security fixes were enabled on the repository
on 2026-09-01. A `.github/dependabot.yml` may be present but uncommitted in the
checkout — `git status` says. Treat it as a draft to judge, not as settled: read
it, decide whether it covers the right ecosystems, and commit it as part of your
change or replace it.

Two other runs are working in `src/` and `test/` concurrently. Confine changes
to `.github/workflows/check.yml`, `.github/dependabot.yml`,
`docs/tasks/016-dependency-audit.md`, `test/check-workflow.test.ts` and
`package.json`. Do not modify existing files under `test/helpers/` or
`test/fixtures/`.

## Out of scope

Adding runtime dependencies. Changing what the project depends on. Any change
under `src/`.

Branch protection (#11) — related, separately owned, do not touch it.

## Report

What you chose and why, the demonstrated size of the audited set, both halves of
the failing/passing proof, and the real output of `npm run check` with the
commit it ran against. If the failure case could not be produced, that is the
report.
