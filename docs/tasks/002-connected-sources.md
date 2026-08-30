# Task 002 — Connected sources

*This is a rewrite of the specification this work was actually built from. The
original had grown to 222 lines of prescription: exit codes, migration
strategies, field-by-field instructions. It got the work done, but by telling
the implementer what to type rather than what to achieve. Kept as the reference
shape for later tasks.*

Read `PRODUCT.md`, `ARCHITECTURE.md`, `SECURITY.md`, `DEVELOPMENT.md`, and
`docs/tasks/001-observation-layer.md`. The store in `backend/observation_store.py`
is built and verified; you are writing into it.

## Outcome

Axey can be pointed at a source it did not previously know about, and that
source starts producing observations. Nothing about any particular source is
built into Axey's core: remove every connection and Axey is intact, containing
no platform name.

A verification command proves the store agrees with reality, and can fail when
it does not.

## What must be true

**A source is connected, never shipped.** Adding one changes configuration, not
the core. The store and query layers do not know what a Hermes delegation or a
YouTube view count is.

**No user-supplied code is executed.** Connections are declarative. Executable
connectors are an untrusted-code problem under `SECURITY.md`, and package
boundaries are not isolation.

**Nothing personal leaks in.** `~/.hermes/state.db` holds the user's entire
conversation history; `async_delegations.result_json`, `event_json` and
`task_json` carry subagent prose, copied prompts, and possibly secrets. A field
reaches the store because it was named, never because it was present. Wrong here
is not a bug to fix later — it is personal data written to disk.

**Quiet is not unread.** A connection is quiet when its last collection
succeeded and found nothing new; unread when the last attempt failed, was
skipped, or never ran. An empty result from a broken connection must never
appear as silence. This is the property most likely to be lost by accident.

**Two connections never contaminate each other.** They may share a reader type
against different sources; their attempts, coverage and status stay separate.

## The sources to connect

Hermes delegations and Hermes cron (`~/.hermes/state.db`,
`~/.hermes/cron/executions.db`), Shorts uploads and Shorts metrics
(`~/shorts-content/`). Read-only, always.

Two details worth knowing, because getting them wrong loses history: `deleted:
true` in `uploads.jsonl` marks history rather than absence, and `day7_stats:
null` is an outcome not yet observable — unknown, not zero.

A Hermes report that work completed is a claim about the world, not an observed
outcome. Hermes owns its runtime state; it does not own the external effect.

## The test that decides whether this worked

Freeze the contract, then connect a fifth source unlike any of the four —
through the documented path, from outside the core, no new reader type — and
prove no file in the store, query, or reader packages changed.

If that requires touching the core, the mechanism is not real. Say so rather
than adding a special case.

## Where state lives

`${XDG_DATA_HOME:-$HOME/.local/share}/axey/`. Never in the repository:
observations are personal. Disconnecting removes configuration and stops
collection; it does not delete what was already observed.

## Constraints

Python. Read-only against every source. No HTTP, no UI, no scheduling, no
orchestration framework. Tests use synthetic fixtures in temporary directories;
real sources are for a final supplementary run. One check entry point that runs
everything without an agent. Do not touch `app/`.

Out of scope: cities, mandates, cases, the council, petitions, anything visual.
If the design seems to need one, stop and say so rather than inventing it.

## Report back

What you built and what you decided, the fifth source's cost, the check output
including a deliberate failure, and anything in the canonical documents that
turned out to be wrong or unbuildable.
