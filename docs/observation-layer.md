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
facts or their configuration revision.

Status is `changed` after a successful attempt that added facts, `quiet` after
a successful attempt that added none, and `unread` after failure, skip, or no
attempt. Two connections have separate revisions, attempts, and status even
when they use the same reader.

## Verification result

Verification rereads every active source and emits schema version 1:

```json
{
  "command": "verify",
  "schemaVersion": 1,
  "outcome": "disagreement",
  "connections": [
    {
      "connectionId": "example-readings",
      "outcome": "disagreement",
      "unreadReason": null,
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

`payloadMismatch` means the same source identity and source time now has a
different selected payload. `missingAtSource` and `uncollected` compare the two
sides. `advanced` is a strictly newer point in an existing fact's time series,
not disagreement. `sourceVersionConflict` means the source itself supplied two
payloads under one identity and time.

Aggregate outcomes and exit codes are stable:

| Outcome | Exit code |
| --- | ---: |
| `agreement` | 0 |
| `disagreement` | 1 |
| `unread` | 2 |
| `mixed` | 3 |

Unread sources carry only a reason code such as `source_absent`,
`source_locked`, or `source_malformed`. They never produce exit code 0.

## Adding a source

Create a configuration in the state directory or pass it on standard input,
then run `connect`, `collect`, and `verify`. A new source whose shape fits one of
the declarative readers costs only that configuration. It does not require a
change to the store, query, collector, or reader packages.
