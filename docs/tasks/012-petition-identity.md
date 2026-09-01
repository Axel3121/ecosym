# Task 012 — Design how a petition proves it is the user's

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

This task produces **a design document, not an implementation**. Nothing under
`src/` changes. The deliverable is `docs/petition-identity.md`, reviewed and
merged like any other change.

Work on branch `docs/petition-identity` in this worktree. Commit the document
when it is coherent; a design in progress is still worth committing.

## Why this and not code

`PRODUCT.md` line 338 names one vertical chain as the first proof: a petition;
a mandate resolved deterministically; mandatory admission; execution; the
enforcement check; the outcome observed; the case persisted; restart; the case
resumed.

Read against the repository, the first three links are blocked on one undesigned
thing:

> How that identity is established, bound to authority, scoped, expired, and
> recorded is not yet designed. Until it is, no consequential petition path is
> built: an unauthenticated request that starts work is the failure this
> product least survives. (l. 159–162)

Everything downstream — mandate, admission, case — either waits on this or is
built without knowing the shape it must hold. This design unblocks three links
at once. That is why it comes before any storage work.

## Outcome

`docs/petition-identity.md` answers the five questions `PRODUCT.md` names —
established, bound to authority, scoped, expired, recorded — such that a later
implementation task can be written against it without inventing anything.

The document is canonical about the design and honest about what remains open.
Where a question cannot be answered without a decision the user must make, name
it as a decision rather than guessing at it.

## What must be true

**A petition carries the user's identity, never Ecosym's.** `PRODUCT.md` l. 143:
Ecosym is the envelope, not the sender. A design in which Ecosym holds a service
credential with rights of its own is wrong, however convenient. State plainly
what Ecosym holds and what it cannot hold.

**A petition's identity outlives the asking.** l. 148: an outcome observed
hours later must be attributable to the petition that caused it. Attribution by
timing is coincidence, and the world would then show work as caused by a request
that did not cause it. The identity must therefore be recorded before the work
starts, not derived afterwards.

**Forgery must be structurally impossible, not merely unlikely.** Task 011
closed a defect where a confirmation token could be computed from values the
`status` command already printed. That failure shape must not recur here: a
petition identity that can be constructed from readable state is not an
identity. The existing `confirmation_previews` mechanism in `src/store.ts` is
the closest prior art in this repository — read it before designing, and say
whether this is the same problem or a different one.

**A petition can be refused, altered or deferred by the runtime.** l. 138–139.
The design must not assume acceptance. What happens to the identity when a
petition is refused is part of the design, not an afterthought.

**Expiry is stated, not implied.** A grant that never expires is a standing
authority Ecosym is defined not to have.

## Available evidence

Prior research already surveyed this ground and should be read rather than
repeated. `~/dev/_scratch/ecosym-research-2026-08-31/wave-1-admission-control.md`
surveyed every agent framework against the admission contract and concluded:

> The cheapest real admission gate is a locked launch boundary plus a signed
> single-use grant — not a framework feature, and not a pre-tool hook.

It sketches a grant binding manifest hash, admission ID, runner identity,
capability envelope, nonce and expiry. Treat that as a candidate shape to
evaluate, not a decision already made. Say where it fits and where it does not.

That report is research evidence, not repository authority. If it conflicts
with a canonical document, the canonical document wins and the conflict is
worth naming.

## Constraints

- No code. No schema migration. No `src/` changes. A design that cannot be
  explained without writing it is not finished being designed.
- Do not design the council, the mandate resolver, or the case store. This
  document owns petition identity and stops at its boundary.
- Do not invent a user-facing authentication product. The user is one person on
  one machine; a design that assumes an identity provider is answering a
  question nobody asked.
- Where the answer is "this depends on a decision the user has not made",
  say so and state the options with their consequences. An honest open question
  is worth more than a confident invention.

## What would prove it worked

The document is finished when someone who has not read this task can answer,
from it alone:

- What a petition identity physically is, and what proves it.
- What Ecosym holds, what the runtime holds, and what neither may hold.
- How an outcome observed later is tied back to the petition that caused it.
- When a petition identity stops being valid, and what happens then.
- Which questions remain open, and what would settle each one.

A second reader must be able to find at least one thing the design cannot do.
A design with no stated limits has not been thought through.

## Out of scope

Implementing any of it. Admission itself — `PRODUCT.md` l. 305 says no runtime
is known to satisfy it, and that stays true after this document exists. This
task removes one blocker; it does not remove that one.

## Report

State what was decided, what was deliberately left open, and anything in the
canonical documents that turned out to be contradictory or unbuildable as
written.
