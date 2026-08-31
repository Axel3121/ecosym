# Task 004 - Accept the UTC instants we can actually hold

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` first.

Continues branch `task/001-observation-layer` at `215e209`. Task 003 stopped the
store from rewriting values on the way in. In doing so it narrowed accepted
source time further than intended.

## Outcome

A source expressing a real UTC instant is collected. A source expressing
something the store cannot hold faithfully is still refused. Ordering still
works, and no supplied value is rewritten into a different one.

## The defect, reproduced

At `215e209`:

```ts
import { isCanonicalUtcInstant } from "./src/time.ts";
isCanonicalUtcInstant("2026-08-30T10:00:00Z")      // false  <-- wrong
isCanonicalUtcInstant("2026-08-30T10:00:00.000Z")  // true
```

`2026-08-30T10:00:00Z` is the most common ISO-8601 spelling of a UTC instant and
is what most real sources emit. Unlike a leap second, JavaScript parses it
without difficulty. Every source that omits milliseconds currently collects as
`unread`, so Ecosym refuses evidence it is perfectly able to hold.

## What must be true

**A real UTC instant is accepted regardless of sub-second spelling.** At minimum
`...T10:00:00Z`, `...T10:00:00.5Z`, `...T10:00:00.25Z` and `...T10:00:00.000Z`
all denote real instants and must collect.

`Z` and `+00:00` spell the same instant. Decide whether both are accepted and
say which you chose; if only one, the other is refused rather than rewritten.

Precision finer than a millisecond has a trap: JavaScript silently truncates
`...T10:00:00.1234Z` to `.123Z`, discarding a digit the source expressed. That
is the transformation this work exists to prevent. Either refuse such input, or
hold it exactly; do not accept it and store a shortened value. State which.

**Ordering still holds.** Task 003 chose fixed-width canonical storage so SQLite
text ordering stays chronological. That property must survive: instants written
in different spellings must still order correctly against each other. Prove it
with a test that stores several spellings and reads them back in order.

**Nothing is rewritten into a different instant.** Accepting more spellings must
not reintroduce the transformation Task 003 removed. Storing a normalised form
of the same instant is acceptable *only if* the stored value denotes exactly the
same moment. Precision may not be invented or discarded: if a stored form cannot
express what the source expressed, the attempt fails instead.

State plainly which of these you chose and why:
- store the supplied spelling exactly and order by a separate derived key, or
- store one canonical form, and demonstrate losslessness concretely: for every
  spelling the implementation accepts, show the stored value denotes the same
  instant as the input, and that no accepted input reaches storage with fewer
  digits of precision than it was given. A test that round-trips the accepted
  spellings and compares instants satisfies this; an assertion that it is
  lossless does not.

**Still refused, deliberately:** anything JavaScript cannot represent as an
instant, including a leap second such as `2016-12-31T23:59:60Z`. Add a short
comment in `src/time.ts` recording that this is a decision and why: JavaScript's
Date cannot represent it, so a stored leap second could not be ordered or
compared. Do not build a workaround.

**A non-UTC offset stays refused unless you can hold it faithfully.** Task 003
chose to reject `+02:00`. That decision stands unless your chosen storage shape
makes it lossless, in which case say so.

## Test-quality debt from Task 003

An independent review found two regression tests weaker than they appear. Fix
both; they are cheap and they protect rules that matter.

**`factOwner` and `kind` string enforcement is untested.** The subtests pass even
with identity validation removed, because the persisted-declaration comparison
rejects them for a different reason. Make them fail for the reason under test —
or state, with evidence, that the declaration comparison is the real enforcement
and the identity loop is redundant for those two fields.

**The origin test proves API shape, not persistence.** It asserts `writeFact` is
absent from the sink. That proves the old entry point is gone, not that a fact
without a source record cannot reach the store. Prove the persisted property:
after an attempt that supplies no source record, no fact exists.

## Boundaries

Validation stays driven by each connection's own declaration, never by a list of
field names or formats the product knows.

Do not add dependencies. Do not weaken or delete an existing test to make a new
rule pass; if a test asserted the over-strict behaviour, correcting it is part of
this work.

## Evidence

Each rule gets a regression test that fails before its fix. Run them against
unfixed code first and report the failure output.

For the ordering property, show the actual stored values and the order they read
back in — not an assertion that ordering works.

Report the real output of `npm run check` and the exact commit it ran against.

## Independent review

Use the `review` subagent defined in `.opencode/agent/review.md`, on a fresh
context, against the exact final commit. Give it the commit, its base, and this
specification; it reads only.

Report what it found. If it found nothing, say so plainly rather than implying
more scrutiny than occurred. If it cannot be run, say that instead — an absent
review is reported as absent, never as a pass.

## Report

Per rule: what changed, which test proves it, its before-fix failure. Name
anything you chose not to do and why.
