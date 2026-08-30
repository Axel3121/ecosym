# Task 002 — Connected sources

Read `docs/tasks/001-observation-layer.md` for the parent reasoning, and
`backend/observation_store.py` with its tests for the store you write into. The
store is done and verified: it holds observations and claims with provenance,
keeps changing values as a time series, and knows what is currently true.

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md` and `DEVELOPMENT.md`.

## Outcome

Axey can be pointed at a source it did not previously know about, and that
source starts producing observations. Nothing about any particular source is
built into Axey's core. A verification command proves the store agrees with
reality and can fail when it does not.

This is a large task. Work through it properly rather than quickly; there is no
prize for finishing early, and a half-built connector mechanism is worse than
none.

## The point

Axey is a world the user connects their own things to. A source is connected,
never shipped. Removing every connection must leave Axey intact and containing
no platform name.

## Part one — the connection mechanism

**Part one ends in a committed contract.** Before any of the four sources is
connected, the registration format, reader interface, connection identity, and
runner semantics are written down and committed. That commit is the frozen
reference the fifth-connection proof measures against. Do not build sources
first and infer the contract afterwards.

Design how a source is connected, registered, and collected from. You decide the
interface, within these decisions:

**No user code runs.** A connection is declarative configuration naming a
built-in reader type — SQLite, JSONL, JSON — plus how its fields map onto
observation records. Axey never imports or executes user-supplied Python. This
is a product decision, not an implementation choice: executable connectors are
an untrusted-code problem under `SECURITY.md`, and package boundaries are not
isolation.

The reader types are generic. A SQLite reader knows about tables and columns,
not about Hermes. A JSONL reader knows about lines and fields, not about
YouTube.

**Connections have identity.** Two connections may use the same reader type
against different sources, and their collection attempts, coverage, and status
must never be confused. The store keys collection attempts by adapter only, so
this requires a store change — that one is authorised. Define an immutable
connection identity, distinct from reader type, and migrate schema v3
deterministically without rewriting existing records.

**The store and query layer must not otherwise change** when a source is added.
If they must, the boundary is in the wrong place — say so rather than working
around it.

## Where Axey keeps its own state

`${XDG_DATA_HOME:-$HOME/.local/share}/axey/`. The observation database and
connection configuration live there — outside the repository, since they hold
personal data that must never enter a commit.

Nothing under that directory is fixture material. Tests use temporary
directories.

Disconnecting a source removes its configuration and stops future collection. It
does not delete what was already observed: that would be destroying history,
which `SECURITY.md` governs separately.

## Part two — connect four sources

Read-only, always. These are the first connections, not product content.

**Hermes delegations** — `~/.hermes/state.db`, table `async_delegations`.

Store only named scalar columns: the delegation id, its state, and its
dispatch/completion timestamps. Those four, nothing else. **Never store
`result_json`, `event_json`, or `task_json`, raw or parsed.** They carry
subagent prose, copied prompts, file contents, and potentially secrets. A field
is stored because it was explicitly allowed, never because it was present.

The fixture for this connection must place a recognisable sentinel string inside
`result_json`, `event_json`, and `task_json`, and a test must assert that
sentinel appears nowhere in the store or in any output.

Define the equivalent allowlist for each of the other three connections. Never
infer fields from whatever a source row happens to contain.

Lineage: the table has `parent_session_id`, which is a session relation. Whether
that is a delegation tree is not established — if you cannot determine the
parent delegation from the schema, store lineage as unknown rather than
inferring it.

**Hermes cron** — `~/.hermes/cron/executions.db`, table `executions`. The
`error` column is free text from a failing job and may contain anything: record
that a failure occurred, not its message.

**Shorts uploads** — `~/shorts-content/output/reports/uploads.jsonl` and
`~/shorts-content/scripts_data/learning_log.jsonl`. `deleted: true` marks
history, not absence — never drop those. `day7_stats: null` is an outcome not
yet observable; it is unknown, not zero.

**Shorts metrics** — `~/shorts-content/output/reports/daily_snapshots.jsonl`
and `analytics_*.json`.

## Part three — quiet is not unread

A source is **quiet** only when the most recent collection attempt *for that
connection* completed successfully and added no new records. It is **unread**
whenever the last attempt failed, was skipped, was interrupted, read a malformed
or absent source, or has never run. An empty result from a broken connection
must never surface as quiet.

Two cases must both read as quiet: a scan that found nothing at all, and a scan
that found only records already known. And a connection that was quiet and then
fails must read as unread, not stay quiet.

Status is per connection, never per reader type. Two connections sharing a
reader must be able to be quiet and unread at the same time — prove it with a
test.

The store already records collection attempts. This is the property most likely
to be lost by accident — do not collapse it into a null.

## Part four — verification

A command that re-reads the sources and reports disagreement between the store
and reality. Disagreement is one of: a record the store expected that the source
no longer has, a payload differing at the same source version, or a record
present at the source that was never collected. A newer view count is not
disagreement — it is the next point in a series.

The command exits non-zero if any readable connection disagrees, even when
others are unread. A connection whose source is absent, locked, or malformed is
reported *unread* and does not by itself cause failure: the check reports what
it could not see rather than inventing a verdict. Unread-only means exit zero.

Output is stable and per connection.

Include corrupted-store fixtures for each of the three disagreement classes,
proving the check fails on each. A check that cannot fail proves nothing.

## Decisions already made

**subject** is the smallest thing the fact is about — a video id, a delegation
id. Not a compound of channel and video.

**fact_owner** is what a connection declares about its own source, never
something Axey knows. A local JSONL file does not own view counts; it is a local
record of a platform's fact, and the connection says so.

**Measurement method belongs in `kind`.** Two APIs reported the same video's
views differently within seconds — both true, measured differently. They must be
distinguishable kinds so neither retires the other. Fact identity is
`(fact_owner, kind, subject)`.

**Changing values are a time series.** Only a strictly newer `source_time`
supersedes. Nothing observed is overwritten.

**Verification needs a comparison contract.** Before part four, define per
connection: what identifies a source record, what its source version and source
time mean, what part of the payload is compared, and whether the source is
append-only or a rolling snapshot. A rolling snapshot that no longer exposes an
old point is not disagreement; an append-only source that lost a record is.

## The test that matters

Freeze the connection contract before this step — note the commit. Then install
a fifth connection through the documented registration path, using a source
shape none of the four resemble, and collect from it through the normal runner.

It must be a real installation, not an internal shortcut: the configuration
lives outside the core package, is registered the way a user would register it,
and requires no new reader type written into the core — it uses an existing
reader against a source schema unlike the four. Name the protected package paths
before the test, then assert `git diff --name-only <frozen-ref>..HEAD` is empty
for them.

Report its cost as the configuration it took, with zero core changes.

If that is not possible without touching the core, the mechanism is not real.
Report that honestly rather than adding a fifth special case.

## Constraints

- Python. Read-only against every source — SQLite opened with a read-only URI,
  never a writable connection. A test must prove a fixture source was not
  modified by collection.
- Axey's own state lives in `~/.local/share/axey/`, never in the repository.
- No HTTP, no UI, no scheduling, no orchestration framework.
- No user-supplied code is imported or executed.
- Field allowlists, not field exclusions: a source field reaches the store
  because it was named, never because it was present.
- No source content in logs, test output, fixtures, or commits. Synthetic
  fixture records are of course necessary and fine — what is forbidden is real,
  personal, or copied production content, and echoing payloads in output.
- Tests use synthetic fixtures in temporary directories. Real sources are for
  the final run, not tests.
- Acceptance rests on synthetic fixture tests, not on real-source output — real
  data is mutable and machine-specific. A real run is supplementary evidence.
- Do not put runtime facts in code comments or docs as fixed truths; row counts
  go stale within minutes.
- Do not touch `app/`.
- One check entry point that runs everything, runnable without an agent.

## Out of scope

Cities, mandates, cases, the council, petitions, rendering, anything visual.
If the design seems to need one of these, stop and say so rather than inventing
it.

## Report back

The connection format, the fifth source's cost, the exact Hermes field
allowlist, the check output including the corrupted fixture failing, and
anything in the canonical documents that turned out to be wrong.

Commit as you go — a commit per coherent piece, not one at the end. This work
touches a trust-bearing boundary; expect independent review.
