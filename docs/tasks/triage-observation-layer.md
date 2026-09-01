# Finding triage — observation layer, rounds 001-004

Every finding from the independent reviews of this branch, and where it went.
Lanes follow the `finding-triage` rule: fix now / spec it / record it.

Reviews: Greptile CLI, plus independent compliance and quality reviews per
round. Full reports archived outside the repository.

## Lane B — specified and in progress

| Finding | Round | Status |
|---|---|---|
| Temporal currentness leaked across connections | 002 | closed |
| CSV accepted characters after a closing quote (`"abc"x` → `abcx`) | 002 | closed |
| `__proto__` CSV header silently discarded its column | 002 | closed |
| Invalid calendar dates normalised (`2026-02-30` → `2026-03-02`) | 002 | closed |
| Valid top-level JSON array could not be collected | 002 | closed |
| Bare `\r` in CSV silently trimmed | 002 | closed (found during the round) |
| Store admitted undeclared field names | 002 | closed |
| Store admitted declared fields carrying uncoercible values | 003 | closed |
| A fact could be persisted with no source record accounting for it | 003 | closed |
| `-0` payload could not round-trip through JSON | 003 | closed (unprompted) |
| Shortened UTC (`...T10:00:00Z`) refused | 004 | in progress |
| Sub-millisecond precision silently truncated (`.1234Z` → `.123Z`) | 004 | in progress |
| Two regression tests passed for the wrong reason | 004 | in progress |

## Lane C — recorded debt

**Whole-input buffering.** Collection buffers prepared facts; verification
buffers both comparison sets; JSON discovery buffers matched paths and whole
documents; CSV reads the entire file. A large enough source can exhaust memory.

Deferred deliberately: bounding it requires a size policy, and no such policy
exists. Inventing a threshold would look like a decision nobody made. Revisit
when a real source approaches the limit, or when someone decides the policy.

**`src/store.ts` is 1253 lines with four distinct concerns.** Schema and
migrations, connection lifecycle, the collection write path, and query/verify
reads share one module and one database handle. Named seams if it is split:
schema/migration, collection writer, query reader, admission validation.

Deferred: no defect is attributed to the size, and restructuring during active
feature work risks regressions in code that three reviews have now examined.
Best done as its own change, before the layer grows further.

## Rejected — technically correct, deliberately not acted on

**Leap seconds are refused.** `2016-12-31T23:59:60Z` was a real UTC instant and
is rejected.

Not fixed, because JavaScript cannot represent it: `Date.parse` returns `NaN`.
Accepting it would mean storing a value the store cannot order or compare — in a
store whose purpose is ordering observations. Current behaviour refuses the
source as malformed rather than silently rewriting it to `23:59:59`, which is
the honest outcome. Recorded as a decision in `src/time.ts`.

## Where the rounds came from

Four rounds on one component is more than the work warranted. Two are
attributable to specification, not implementation:

- **Round 003** exists because round 002's spec constrained *which fields* may
  be admitted without saying what *values* they may hold. The agent implemented
  exactly what was asked.
- **Round 004** exists because round 003 tightened without stating what must
  still be accepted, so the implementation refused valid input as well.

Both are recorded in the `finding-triage` skill as named failure modes.
