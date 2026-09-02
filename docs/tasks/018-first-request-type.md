---
needs: []
touches:
  - docs/tasks/018-first-request-type.md
  - src/petition-request.ts
  - test/petition-request.test.ts
---
# Task 018 — One consequential request type, with an authority projection that fails closed

`needs` is empty on purpose. The contract this task implements —
`docs/petition-identity.md` — is already in `main`, but the run that wrote it
predates the declaration format, so the ledger cannot record it as landed and
will not fail-close on it. `needs` tracks runs; this dependency is an artefact,
and the artefact is present. Verify with
`git cat-file -e origin/main:docs/petition-identity.md` before starting.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `DEVELOPMENT.md` and
`docs/petition-identity.md` first. That last one is the contract this task
implements against. It is not up for revision here.

Work on branch `task/018-first-request-type` in this worktree. Commit each
coherent verified piece as you go.

## Why this task can run now

`docs/petition-identity.md` lists seven open decisions. Task 013 measured the
first one and returned a negative result: no credential owner on this machine
can carry a petition proof, so no consequential petition can be *dispatched*.

This decision is a different one, and its settle-condition names no credential,
proof, or signature:

> Specify one closed request schema and deterministic projection, then test
> conflicting text/parameters, civilization/mandate mismatches, destructive
> disclosures, and subset comparisons all fail closed.

That is schema and projection logic. It is testable with no signer present, and
it is the piece a dispatch path would otherwise have to invent later under
pressure. Building it now converts a blocked design into a decided one.

## Outcome

One consequential request type exists as a canonical definition record, with a
deterministic `authorityProjection` over a complete request, and a validator
that refuses everything the contract says must be refused. A reader can tell
what a petition of this type authorises by reading the projection, not by
reasoning about prose.

## Choosing the type

Pick one narrow, genuinely consequential operation and say why you picked it.
It must be destructive or materially irreversible — that is what makes the
consequence and evidence rules load-bearing rather than decorative. It must be
expressible as a closed schema whose authority is total: no parameter and no
free text may widen it.

Do not pick something broad enough to be interesting. A type whose projection
you cannot state exactly is the wrong type, and the contract already refuses it
(`docs/petition-identity.md`: "A request type that needs a model to decide
which operation or resources its text authorizes is ineligible").

## What must be true

**The projection is total and deterministic.** It either fails or returns the
operation, resource bounds, limits, and consequence classification. The same
request always projects to the same authority. Why: the projection is the only
authority-bearing reading of a request; if it is partial, the unprojected part
is authority nobody checked.

**`parameters` and `userText` cannot add authority.** The validator rejects any
parameter whose effect falls outside the projection. Text is an objective to
reason about, never permission to act. Why: this is the boundary that stops a
model's interpretation from becoming an authorisation.

**Everything unknown is refused.** Unknown envelope fields, unknown request
types, undefined projections, and values outside the schema fail closed — not
ignored, not defaulted. Why: an ignored field is an unreviewed instruction.

**Subset comparison is decided on the projection, not the text.** Whatever the
contract's subset rule is, two requests compare through their projections.

**Consequence and evidence follow the contract.** For the destructive operation,
`consequence` carries the operation-specific disclosure and its evidence
identified by owner, source record ID, digest, observation time, and
currentness. Missing, unknown, stale, or mismatched evidence fails closed.
Evidence is referenced, never copied as an assertion.

**The definition record is content-addressed exactly as specified.** Use the
`ecosym.petition-request-definition.v1` digest construction in
`docs/petition-identity.md` l. 191-203. The signed `id` and `revision` equal the
canonical definition's own values. A definition never changes in place.

That construction says JCS (RFC 8785), and `src/json.ts` does not implement
JCS — `canonicalize()` sorts keys and hands the rest to `JSON.stringify`.
Measured on 2026-09-02, the gap is narrower than it looks: `JSON.stringify`
already produces JCS-conformant number output for the cases tested
(`1e21` → `1e+21`, `1e-7` → `1e-7`, `0.1+0.2` → `0.30000000000000004`), and
JavaScript's default sort is already UTF-16 code-unit order, which is what JCS
requires. One real divergence: `-0` serialises as `0`, so a negative zero in a
request would produce a digest over bytes that no longer distinguish it.

Decide whether that matters for your request type and say which you chose:
forbid the value in the schema, or make the canonicaliser conform. Do not
assume `canonicalJson` is JCS because it is called canonical — if you rely on
it, demonstrate agreement against RFC 8785's own test vectors for the value
space your schema admits.

**Take the schema route.** `src/json.ts` is not in this task's declared
territory, and the declaration is frozen at launch, so a run that changes the
canonicaliser has its landed close refused for writing outside its territory —
after doing the work. Reject `-0` where the request schema is validated. If you
conclude the canonicaliser genuinely must change, stop and report that rather
than editing it: that is a second task with its own territory.

## The test that decides it

A request that is valid in every respect except one, for each refusal rule
above, must be refused — and the refusal must name which rule refused it. Build
the valid request once, then mutate exactly one thing per case.

This is the test that separates a validator that works from one that refuses
everything: the unmutated request must pass. State both outcomes.

For each rule, remove the guard, show the test fail, restore it, show it pass.
A test that passes with its guard removed is proof of nothing —
`DEVELOPMENT.md` owns this rule.

## Out of scope

Signing, proof, credential owners, and anything a user approves. Task 013
established there is nothing here to sign with; this task builds the thing that
*would* be signed, and stops there.

Dispatch, admission, the control plane, mandate resolution, and the case store.
Jurisdiction and mandate rules — the decision explicitly excludes them.

The other five open decisions. If you conclude one of them must be settled to
finish this, stop and report that instead of settling it silently.

## Do not delegate the design decision

Two runs of this task were killed by the watchdog after ~950 seconds of silence.
Both had just dispatched a subagent to decide the request type's shape — once
named "Challenge request-type design", once "Design request boundary" — and that
agent never returned. Probe agents in the same runs completed normally, and
other tasks delegate freely without this happening, so the problem is not
delegation as such: it is handing an open-ended design question to a subagent
that has no way to converge.

Choose the request type and its projection yourself, in the main run. Delegate
only questions with a determinate answer: what a library does, whether a
mutation is caught, what the tests currently assert. If you catch yourself
writing a subagent brief that starts "decide" or "design", that is the signal to
do it inline instead.

## Report

Say which request type you chose and why, what its projection returns, and
which of the contract's rules turned out to be ambiguous when you tried to
implement them. Name anything in `docs/petition-identity.md` that could not be
built as written.
