# Task 001 - The observation layer

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md` at the
repository root first.

## Outcome

Echosystem holds what it has seen, with provenance, and can prove it against the
source. It can be pointed at a source it did not previously know about, and
that source starts producing observations.

Nothing renders. This ends at a queryable store, connected sources, and a
verification command.

## Why this first

Everything later - cities, cases, the council - rests on observations being
trustworthy. The hardest requirement in the product is that the world cannot
lie, and that is discovered far too late if depiction is built first.

The surface-to-observation boundary is also the one `ARCHITECTURE.md` names as
expensive to introduce later: the surface never reads a source directly.

## What must be true

**A source is connected, never shipped.** Adding one changes configuration, not
the core. Remove every connection and Echosystem is intact, containing no platform
name. The store and query layers do not know what a Hermes delegation or a
YouTube view count is.

**No user-supplied code is executed.** Connections are declarative. Executable
connectors are an untrusted-code problem under `SECURITY.md`, and package
boundaries are not isolation.

**Nothing personal leaks in.** A field reaches the store because its connection
named it, never because it was present in the source. The core enforces that
rule; it never carries a list of which fields are safe for any particular
source, because that would make one user's schema part of the product.

Prove the rule, not a list: give a connection a source carrying fields it did
not name - including something that looks like a secret - and show they are
absent from the store. A source may hold an entire conversation history two
fields away from what was asked for; wrong here is not a bug to fix later, it
is personal data written to disk.

**A claim is not an observation.** A Hermes report that work completed is an
assertion about the world; a view count read from a platform is evidence.
Hermes owns its runtime state, not the external effect that work claims to have
produced. Both are storable; a query for observations must not return claims.

**Changing values are a time series.** A view count rising from 7 to 12 is two
observations of the same subject at different times, both kept. Nothing already
observed is overwritten when a source changes, and a late-arriving older value
does not displace newer truth.

**Quiet is not unread.** A connection is quiet when its last collection
succeeded and found nothing new; unread when the last attempt failed, was
skipped, or never ran. An empty result from a broken connection must never
appear as silence. This is the property most likely to be lost by accident - do
not collapse it into a null.

**Two connections never contaminate each other.** They may share a reader type
against different sources; their attempts, coverage and status stay separate.

## Decisions already made

These were expensive to work out. Do not re-derive them.

**subject** is the smallest thing a fact is about - a video id, a delegation
id. Not a compound of channel and video.

**fact_owner** is what a connection declares about its own source, never
something Echosystem knows. A local JSONL file does not own view counts; it is a
local record of a platform's fact, and the connection says so.

**Measurement method belongs in `kind`.** Two YouTube APIs reported the same
video's views differently within seconds - both true, measured differently.
They must be distinguishable kinds so neither retires the other. Fact identity
is `(fact_owner, kind, subject)`.

**A source record needs its own identity and its own time.** Fact identity says
what a value is about; it does not say which source record produced it, or when
the source believed it. Without both, a corrected record and the next reading in
a series are indistinguishable - and that distinction is what verification
rests on.

Decide how a connection declares those, and say why your answer holds when a
source has no obvious key and no timestamp of its own. Ordering must come from
the source's own sense of time where it has one; collection time is when Echosystem
looked, which is a different fact.

## The sources to connect

These four exist on this machine and are the evidence the mechanism works. They
are this user's sources, not Echosystem's: their configurations live in the state
directory alongside observations, never in the repository. Echosystem ships with no
connections at all, and a fresh clone knows of no platform.

Hermes delegations and Hermes cron (`~/.hermes/state.db`,
`~/.hermes/cron/executions.db`), Shorts uploads and Shorts metrics
(`~/shorts-content/`). Read-only, always - open SQLite with a read-only URI.

Schema knowledge about any of them - table names, field names, which fields are
allowed - belongs in its configuration, not in code. If connecting a source
requires the core to learn something about that source, the contract is too
narrow: say so rather than special-casing it.

`~/.hermes/state.db` is worth naming as the sharpest case: it holds the user's
entire conversation history, and fields like `result_json` and `event_json`
carry subagent prose and possibly secrets. Its connection must name only what it
needs. This is a fact about configuring that source, not something Echosystem knows.

Two details worth knowing, because getting them wrong loses history: `deleted:
true` in `uploads.jsonl` marks history rather than absence, and `day7_stats:
null` is an outcome not yet observable - unknown, not zero.

## Verification

A command that re-reads the sources and reports disagreement between the store
and reality: a record the store expected that the source no longer has, a
payload differing at the same source version, or a record at the source never
collected. A newer view count is not disagreement - it is the next point in a
series.

A source that is absent, locked or malformed is unread, not disagreement: the
check reports what it could not see rather than inventing a verdict. But
"we could not look" must never read as "everything is fine".

The result must be machine-readable and stable enough that a reviewer can tell
agreement, disagreement and unread apart without reading prose - and unread must
never be reported as success. Say what shape you chose and why.

Include a deliberately corrupted fixture proving the check fails. A check that
cannot fail proves nothing.

## The test that decides whether this worked

Freeze the contract, then connect a fifth source that differs in kind from all
four - not a fifth file of a shape already handled - through the documented
path, from outside the core, and prove no file in the store, query, or reader
packages changed.

If that requires touching the core, the mechanism is not real. Say so rather
than adding a special case: what the contract could not express is the finding.

## Where state lives

`${XDG_DATA_HOME:-$HOME/.local/share}/echosystem/` - both observations and the
connection configurations that produced them. Never in the repository: what a
user watches is as personal as what was observed. Disconnecting removes configuration and stops
collection; it does not delete what was already observed.

## Working with real sources

Build and test against synthetic fixtures you write. The real sources are read
by the code you are writing, not by you: do not dump rows, print payloads, or
read personal content into your own context to understand a schema. Read the
shape — table names, column names, field names — and write fixtures that match
it.

This is the same rule the product follows. Minimum personal context, and no
personal content in logs, test output, commits, or anything you report.

## Constraints

TypeScript on Node 24, ESM. `node:sqlite` is built in - prefer it over a
dependency, and say so if you find a reason not to.

Read-only against every external source, proven by a test that attempts a write
and is refused - not by a grep for a connection string.

Sources grow. Collection's cost must not rise with how much history is already
stored: reading a large source is unavoidably proportional to that source,
loading everything Echosystem has ever observed is not.

Writing records and completing an attempt is one transaction. A failure must
not leave a partially advanced history marked as a failed attempt.

Registration is safe between processes. Two processes registering different
configurations under the same id must not interleave into a config and identity
that disagree.

No HTTP, no UI, no scheduling, no orchestration framework. Tests use synthetic
fixtures in temporary directories; real sources are for a final supplementary
run. One check entry point that runs everything without an agent.

Out of scope: cities, mandates, cases, the council, petitions, anything visual.
If the design seems to need one, stop and say so rather than inventing it.

## Report back

What you built and what you decided and why, the fifth source's cost, the check
output including a deliberate failure, and anything in the canonical documents
that turned out to be wrong or unbuildable.

Commit each coherent piece as you go. A run can be interrupted; committed work
survives.
