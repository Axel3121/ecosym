---
needs:
  - 008-verification-trusts-the-store
touches:
  - src/store.ts
  - test/store.test.ts
---
# Task 009 — Equivalence is decided on stored identity, not on a still source

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continue on branch `task/001-observation-layer` in this worktree. Commit each
coherent piece as you go rather than once at the end.

**Note on `needs`.** The sentence above names the branch this work continued
on, which is not the same thing as what it depended on. Git history puts the
real dependency at 008 (verification trusting the store), and that is what
`needs` declares. Branch reuse was a workspace convention; the scheduler reads
the declaration.

## Outcome

A store carried over from the old JSONL indexing rule becomes usable again
whenever its **already-stored** record identities are provably the same under
both the physical-line and the record-ordinal rule — even if the source file has
changed since those records were collected. Today that recovery additionally
demands that the source still match the store exactly, so an ordinary append
leaves a store permanently unusable with nothing ambiguous to decide.

## Why the current behaviour is wrong

`resolveRecordIndexModeFromEquivalentFacts` in `src/store.ts` refuses to resolve
unless `snapshot.currentnessKnown` holds and the stored facts equal the freshly
read source facts. Those are conditions about **whether the store is up to
date**, not about whether the two indexing rules disagree.

The two questions are independent:

- *Whether the stored evidence is current* — governed by
  [PRODUCT.md's history/current-truth invariant](../../PRODUCT.md#history-and-current-truth-are-distinct)
  and the [ARCHITECTURE.md observation-owner boundary](../../ARCHITECTURE.md#observation-owner);
  this task does not redefine that policy.
- *Do the two indexing rules assign the same identity to what is already
  stored?* — answerable from the stored records alone.

Conflating them means an append-only log, the ordinary shape of a JSONL source,
loses access to its own history.

## What must be true

- Resolution is decided by comparing identities the two rules assign to the
  records **that the store already holds**. A source that has grown, shrunk, or
  changed since collection does not by itself make the stored identities
  ambiguous.

- When the two rules assign different identities to any stored record, retain
  `unknown` and the existing accountable remedy. The governing historical-state
  policy is in [SECURITY.md](../../SECURITY.md#destructive-changes-to-owned-history);
  this task preserves the predicate that detects a real ambiguity.

- Resolution must leave verification's currentness outcome unchanged; it proves
  only that the stored identities are unambiguous. See
  [PRODUCT.md](../../PRODUCT.md#history-and-current-truth-are-distinct) for the
  canonical currentness rule.

- Stored identities are never rewritten. Resolution records which rule was
  already in force; it does not renumber history.

- The source-revision guard around the resolving transaction stays intact. If
  the file changes underneath the resolution, the resolution must not be
  recorded on the strength of a read that no longer describes the file.

## The test that decides it

A schema-six store collected under the physical-line rule from a source with no
blank lines, which then receives one appended record before being reopened.
Stored identities are identical under both rules, so the mode must resolve and
collection must proceed — picking up the appended record as new evidence,
leaving the pre-existing records' identities untouched.

The same fixture with a blank line interior to the originally collected records
must still refuse, and must still offer the remedy.

Prove both directions: revert your change and show the first case fails; keep it
and show the second case still refuses.

## Constraints

- TypeScript, Node's built-in test runner, no new dependencies.
- `npm run check` must pass with no test weakened, renamed away, or deleted.
- Do not touch unrelated behaviour; this is a narrow correction to one predicate.
- Before semantic reinterpretation of stored history, follow
  [SECURITY.md's destructive-change requirements](../../SECURITY.md#destructive-changes-to-owned-history)
  and include the required approval and recovery evidence in the delivery
  record.

## Out of scope

Any broader redesign of currentness, verification outcomes, or the remedy
command. If you find a defect outside this predicate, stop and report it rather
than fixing it here.

## Report back

State what you changed, which condition you removed and why it was safe to
remove, and how you convinced yourself an ambiguous store still refuses.
