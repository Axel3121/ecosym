---
needs:
  - 007-stored-identity-migration
touches:
  - docs/tasks/008-verification-trusts-the-store.md
  - src/collect.ts
  - src/record-index.ts
  - src/store.ts
  - src/verification-facts.ts
  - src/verify.ts
  - test/cli.test.ts
  - test/collection.test.ts
  - test/store.test.ts
---
# Task 008 - Verification must trust the store, and refuse only what is ambiguous

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continues branch `task/005-close-automated-review` at `edfd0b2`. Base for
review: `c7e975f`.

Two independent reviewers examined the same frozen commit. Both confirmed the
identity transition prevents invented history. Both found the same shape of
problem underneath it, from opposite directions.

Confirm each finding before changing anything.

## 1. Verification reads the mode from the caller, not from the store

`verifyConnection` takes `jsonlRecordIndexMode` from the `ActiveConnection`
object it was handed. `collect` re-reads it from persisted state.

A caller holding a store marked `unknown` can pass a connection object whose
mode says `physical-line`, and verification will compare and report
`agreement`. A reviewer reproduced exactly that: two matched facts certified
from a store the product had explicitly declared ambiguous. Collection refused
the same forged connection, because collection does not trust the caller.

This repeats the round-003 fact-admission defect in verification. The canonical
provenance rule is in [SECURITY.md](../../SECURITY.md#ecosym-owned-state-is-user-controlled).

Verification must resolve the mode from the same persisted source collection
uses. A regression test must forge the field on the connection object and
require that verification does not report agreement.

## 2. An unambiguous legacy store is refused along with the ambiguous ones

The transition marks every schema-6 connection version that used
`meta.record-index` as `unknown`. But a source containing no blank lines has
identical identities under both rules — nothing is ambiguous, and nothing
needs deciding.

Reproduced: a store collected under the old rule from a source with no blank
lines is marked `unknown`, verification returns `unread`, and collection is
refused, even though the old and new identities are the same.

Refusing to guess is right. Refusing when there is nothing to guess is not:
it makes readable evidence unreadable, and the product's own record of what
it saw becomes unusable through no fault of the data.

Distinguish the two cases. Where the stored identities are provably identical
under both rules, the mode is not unknown and the store stays usable. Where
they differ, keep refusing.

State how you establish "provably identical" — deriving it from stored records
is acceptable; assuming it is not.

## 3. There is no way out of `unknown`

When a store is genuinely ambiguous, the user has no supported action.
`disconnect` and re-registering the same configuration hits `INSERT OR IGNORE`
and keeps `unknown`. No command resolves, rebaselines, or archives it. The
only escape is inventing a new connection id, which abandons the history.

A refusal with no remedy is a dead end. Provide one supported way for a person
to decide what the ambiguous history means — re-baselining under the current
rule, archiving the old version, or another mechanism you can defend — and
document it.

Whatever you choose, the decision stays with the user and is recorded. The
product must not resolve ambiguity on its own; that is the defect this whole
round exists to prevent.

## Constraints

Do not add dependencies. Do not weaken or delete an existing test. Do not
rewrite stored rows to make a comparison pass.

## Evidence

For each finding: the confirmation before the fix, the fix, and a regression
test shown to fail against `edfd0b2`.

Finding 1's test must forge the caller-held field, not merely test the happy
path. Finding 2's test must build a store under the old rule from a source
with no blank lines and require it remains readable.

Run `npm run check` against your exact final commit and report its real
output and that commit. Obtain an independent read-only review of that exact
commit through whatever mechanism the repository provides. If none is
available, report the review as unavailable rather than as passed.
