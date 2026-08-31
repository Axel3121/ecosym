# Observation layer

The observation layer stores only facts a connection explicitly selects. It
ships with no connections and no source names. Persistent connection
configuration and observations live together in
`${XDG_DATA_HOME:-$HOME/.local/share}/ecosym/observations.sqlite`.

`npm run ecosym -- help` lists the commands. Every command writes one JSON
object to standard output; operational failures are machine codes rather than
source values or exception text.

## Connection contract

A connection is JSON with `schemaVersion: 1` and five decisions:

- `reader` says how to read a source. Supported declarative readers are
  `sqlite`, `jsonl`, `json`, and `csv`; none executes connection-supplied code.
- `factOwner` declares the external owner of the fact. The file or database
  containing a copy need not be that owner.
- `sourceRecord.identity` selects the source's record key.
- `sourceRecord.recordedAt` selects the time the source assigned to that
  record, separately from collection time.
- `facts` names each stored scalar, its subject, its measurement `kind`, and
  whether it is an `observation` or a `claim`.

This fictional JSONL connection is complete:

```json
{
  "schemaVersion": 1,
  "id": "example-readings",
  "factOwner": "example-owner",
  "reader": {
    "type": "jsonl",
    "path": "/absolute/path/readings.jsonl"
  },
  "sourceRecord": {
    "identity": [{ "scope": "record", "path": "reading_id" }],
    "retention": "history",
    "recordedAt": {
      "selector": { "scope": "record", "path": "measured_at" },
      "format": "iso8601"
    }
  },
  "facts": [
    {
      "epistemicStatus": "observation",
      "kind": "method-a.temperature",
      "subject": { "scope": "record", "path": "sensor_id" },
      "payload": {
        "value": { "scope": "record", "path": "temperature" }
      }
    }
  ]
}
```

Selectors use `record` for the repeated record, `root` for its containing JSON
document, and `meta` for `source-path` or zero-based `record-index`. A selector
may use `coalesce` or a scalar `default`. A fact's optional `required` selector
list suppresses that fact when any selected value is absent or null; this
represents not-yet-observable as unknown rather than zero.

Payload selectors must resolve to JSON scalars. Selecting an object cannot
accidentally admit all of its children. SQLite readers derive the `SELECT`
column list from these selectors and open a `file:` URL with `mode=ro` plus
Node's `readOnly` option. File readers open descriptors with the `r` flag.

Reader objects have these exact forms:

| Type | Properties | Record shape |
| --- | --- | --- |
| `sqlite` | `path`, `table` | One table row. Selectors name top-level columns only. |
| `jsonl` | `path` | One object per nonblank line; `root` and `record` are the same object. |
| `json` | `pathPattern`, `recordsPath` | The pattern must match at least one JSON file. `recordsPath` is a dot-separated path to an array; `root` is the document and `record` is an array member. |
| `csv` | `path`, one-character `delimiter` | The first row supplies unique headers. Every selected field is a string. |

A direct selector is `{ "scope": "record", "path": "field.name" }`, a
root selector changes the scope to `root`, and source metadata is selected with
`{ "scope": "meta", "value": "source-path" }` or `record-index`.
`{ "coalesce": [SELECTOR, ...] }` chooses the first present non-null value.
`{ "default": SCALAR, "selector": SELECTOR }` replaces missing or null.
Source time formats are `iso8601`, `date`, `unix-seconds`, and
`unix-milliseconds`. Numeric source times must convert exactly to a whole
millisecond; values requiring sub-millisecond truncation are malformed.

### Identity and time without native fields

Identity selectors are hashed into an opaque, deterministic source-record ID.
When a source has no key, an append-only connection may explicitly use both
`source-path` and `record-index`. That identifies the source-local slot without
inventing a domain key. If the source later reorders those slots, verification
reports removals and additions rather than silently treating records as the
same.

When a source has no timestamp, configure:

```json
{ "recordedAt": { "unavailable": true } }
```

The store then keeps source time as null and makes no claim about which point is
current. Collection time is still recorded as when Ecosym looked, but is never
substituted for source time. Where source time exists it controls temporal
ordering, so a late older value remains historical.

Two payloads under the same source identity and source time are corrections,
not later time-series points. The payload seen by the highest admitted
collection attempt is current; older payloads remain queryable as historical.
Concurrent attempts cannot move that order backward, and a configuration
revision does not split a fact's correction history. Correction slots remain
scoped to one connection, so source-local record IDs in two connections cannot
contaminate each other. If payloads tie at the latest attempt, or if a migrated
store lacks enough evidence to know which correction was last, they remain
`unknown` until the source version is observed again.

`retention: "history"` means previously collected source versions must remain
verifiable at the source. `retention: "latest"` allows a strictly newer source
time for the same fact to supersede an older mutable record.

## Commands

```text
npm run ecosym -- connect /path/to/connection.json
npm run ecosym -- connect -
npm run ecosym -- disconnect CONNECTION_ID
npm run ecosym -- collect [CONNECTION_ID]
npm run ecosym -- status
npm run ecosym -- query observations [--connection ID] [--owner OWNER] [--kind KIND] [--subject SUBJECT] [--after ID] [--limit N]
npm run ecosym -- query claims [same filters]
npm run ecosym -- verify
```

Registration stores a canonical configuration revision and its hash in one
SQLite transaction. Registering the same ID and revision is idempotent;
registering a different revision under an active ID fails. Disconnect first to
change it. Disconnecting removes only the active pointer and never deletes
facts or their configuration revision. Collection rechecks that exact active
connection lifetime in the transaction that writes facts, so a collector that
was reading while disconnect completed cannot persist its buffered records
afterward, even if the same configuration is reconnected.

Status is `changed` after a successful attempt that added a fact or changed
which correction is current, `quiet` after a successful attempt that did
neither, and `unread` after failure, skip, incomplete work, or no attempt. A
marker is committed before source reading;
facts and successful completion are then committed together. If the process
stops between those points, the marker remains `incomplete` rather than
revealing the previous success as current. `Incomplete` is deliberately neutral:
the collector may still be alive, or it may have stopped. Two connection
lifetimes have separate attempts and status even when they use the same revision
and reader. A store migration that cannot prove continuity starts the active
lifetime at `never-run`; the next collection establishes its status.

## Verification result

Verification rereads every active source and emits schema version 1:

```json
{
  "command": "verify",
  "schemaVersion": 1,
  "outcome": "disagreement",
  "unverifiedReason": null,
  "connections": [
    {
      "connectionId": "example-readings",
      "outcome": "disagreement",
      "unreadReason": null,
      "unverifiedReason": null,
      "counts": {
        "advanced": 0,
        "matched": 3,
        "missingAtSource": 0,
        "payloadMismatch": 1,
        "sourceFacts": 4,
        "sourceVersionConflict": 0,
        "storedFacts": 4,
        "superseded": 0,
        "uncollected": 0
      }
    }
  ]
}
```

`payloadMismatch` counts stored facts whose selected payload matches no payload
the source expressed for that source identity and source time.
`missingAtSource` and `uncollected` compare the two sides. `advanced` is a
strictly newer point in an existing fact's time series, not disagreement.
`sourceVersionConflict` means the source itself supplied two payloads under one
identity and time. Superseded correction payloads remain in history but are not
compared as current expectations. If correction currentness is unknown,
verification returns unread with `store_currentness_unknown` rather than
inventing agreement or disagreement.

Aggregate outcomes and exit codes are stable:

| Outcome | Exit code |
| --- | ---: |
| `agreement` | 0 |
| `disagreement` | 1 |
| `unread` | 2 |
| `mixed` | 3 |
| `unverified` | 4 |

Unread sources carry only a reason code such as `source_absent`,
`source_locked`, or `source_malformed`. They never produce exit code 0.
An active connection with no facts on either side is `unverified` with
`no_facts`; a store with no active connections is `unverified` with
`no_connections`. Aggregate verification over an unverified connection carries
`connections_unverified`. These outcomes use exit code 4, so nothing checked is
distinct from both agreement and disagreement.

## Adding a source

Create a configuration in the state directory or pass it on standard input,
then run `connect`, `collect`, and `verify`. A new source whose shape fits one of
the declarative readers costs only that configuration. It does not require a
change to the store, query, collector, or reader packages.
