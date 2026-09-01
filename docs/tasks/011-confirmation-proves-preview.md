# Task 011 — A confirmation must prove the operator saw the consequence

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continue on branch `task/001-observation-layer` in this worktree. Commit each
coherent verified piece as you go.

## Outcome

Two operations change the meaning of recorded history: retiring an abandoned
collection attempt, and resolving a legacy record-index mode. Both are gated by
a two-step preview-then-confirm flow whose stated purpose is that an operator
reads the consequence before the effect happens.

Today that gate does not hold. The confirmation token is a sha256 over fields
the `status` command already prints, so any caller can compute it without ever
requesting the preview. Afterwards, a confirmation proves the preview was
actually issued for this operation.

## The defect, reproduced

`#collectionAttemptRetirementPlan` builds its token from `attemptId`,
`connection_id`, `config_hash`, `started_at`, `outcome` and the caller-supplied
actor. Every one of those is returned by `store.collectionAttempts()`, which
`status` exposes. The same shape applies to the record-index resolution plan.

An independent probe computed a valid-shaped token from those public values
alone, with no preview call. Reproduce this before changing anything, and keep
the reproduction as a regression test.

## What must be true

**A confirmation cannot be produced from readable state.** Knowing everything
`status`, `query` and `verify` print is not enough to confirm a destructive
operation. Why: the gate exists so a consequence is read, not so a checksum
matches.

**A confirmation is only valid for the preview that issued it.** Requesting a
preview is what creates the ability to confirm. Two previews for the same
operation do not produce interchangeable confirmations.

**Staleness still blocks.** The current design correctly refuses when the
underlying state changed after the preview. That property must survive: a
confirmation whose subject has moved on is refused, with the existing distinct
error.

**A confirmation is spent.** Confirming twice with one token does not perform
the operation twice. Why: an operator authorised one effect, not a reusable
capability.

**Expiry is recorded, not inferred.** If a confirmation can go stale by time,
that limit is stored with the preview rather than computed from wall-clock
guesses at read time. If you choose not to expire confirmations, say so and why.

**The audit trail keeps its meaning.** Retirement and resolution records still
show actor, time, and what changed. Nothing already recorded is rewritten.

## The test that decides it

From outside the store, with full access to everything the CLI prints:

1. Read `status`. Attempt to confirm a retirement without calling the preview.
   It must be refused, and the refusal must name the missing preview rather
   than looking like a state mismatch.
2. Call the preview, then confirm with what it returned. It must succeed.
3. Confirm a second time with the same token. It must be refused.
4. Call the preview, change the underlying state, then confirm. It must be
   refused for staleness — the existing behaviour.

Each case gets a regression test. For each, break the guard it protects and
report the exact failing assertion. A test that passes with the guard removed
is proof of nothing.

## Scope

- `src/store.ts`, `src/cli.ts`, their tests, and `docs/observation-layer.md`.
- Do not touch the sandbox, agent-shell, or anything under `.opencode/`.
- Do not weaken or delete an existing test. If one must change, say which and
  why in the report.

## Out of scope

Session identity, user accounts, and cryptographic signing of operator identity.
This store has one operator. The gate must prove a preview happened, not prove
who a person is. If you conclude the requirement cannot be met without one of
these, stop and report that instead of building it.
