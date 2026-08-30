# Connected sources

This is the frozen contract for connecting data to Axey. A connection is JSON
configuration, not executable code. The core recognizes three reader types:
`sqlite`, `jsonl`, and `json`. Reader names do not identify connections.

## State layout

Axey uses `${XDG_DATA_HOME:-$HOME/.local/share}/axey/`:

```text
observations.sqlite3
connections/<connection_id>.json
connection-identities/<connection_id>.sha256
```

The identity record remains after disconnection. The connection file does not.
This permits the same configuration to reconnect while preventing an old
identity from being reused for a different source. State directories and files
are private to the user. Tests override the state root with a temporary
directory.

## Registration format

Configuration schema version 1 has this shape:

```json
{
  "version": 1,
  "connection_id": "weather-observations",
  "inputs": [
    {
      "id": "readings",
      "reader": {
        "type": "jsonl",
        "path": "~/observations/readings.jsonl"
      },
      "mappings": [
        {
          "id": "temperature",
          "epistemic_status": "observation",
          "fact_owner": "weather-station",
          "kind": "station.air-temperature.celsius",
          "subject": "item.station_id",
          "source_version": ["meta.offset", "item.measured_at"],
          "source_time": {
            "field": "item.measured_at",
            "format": "iso8601"
          },
          "temporal_status": "current",
          "payload": {
            "temperature": "item.temperature"
          },
          "comparison": {
            "source_mode": "append_only",
            "newer_is_next": true
          }
        }
      ]
    }
  ]
}
```

Unknown keys and unknown reader types are rejected. IDs use lower-case letters,
digits, dots, underscores, and hyphens. Mapping kinds and mapping IDs are unique
within a connection. Configuration has no import, command, module, hook,
template, expression language, or code path.

Every value that reaches a record is named in a mapping. A value expression is
either a field path such as `item.video_id`, an object containing exactly a
`literal` value, or a `coalesce` list that takes the first non-null declared
value. The optional `is_not_null` transform produces a Boolean. Field paths begin
with one of:

- `item`: the selected source item;
- `root`: the enclosing JSON object or SQLite row;
- `meta`: reader-owned scalar metadata such as JSONL byte `offset`, source
  `line`, or selected-item `index`.

`payload` is a flat object whose fields are individually declared and whose
mapped values are JSON scalars. A source object or array cannot be copied as one
payload value. There is no copy-all operation. An optional `when` condition
supports only `is_null` and `is_not_null`; it controls whether that mapping emits
a record.

Subjects are source scalars encoded as canonical JSON text, preserving the
difference between values such as the number `1`, the string `"1"`, and the
Boolean `true` in fact identity.

`source_time` may be absent. When present, its format is `unix`, `iso8601`, or
`date`. A null source value remains no source time. It is never changed to zero
or collection time. `source_version` is the canonical JSON array of its named
source fields. It is inspectable source identity, not a payload hash.

## Reader interface

Each input is read completely before records are written. A reader returns
source rows with four values: a provenance URI, its reader type, the root value,
and the selected item plus bounded reader metadata. It never returns collection
status and never writes to a source.

The built-in readers are:

- `sqlite`: requires `path`, `table`, and an explicit `columns` allowlist. It
  generates a quoted `SELECT` and opens an absolute file URI with `mode=ro` and
  `PRAGMA query_only`. A column may use `is_not_null`, which is projected inside
  SQLite so free text does not enter the reader process.
- `jsonl`: requires one absolute path after home and environment expansion. Each
  non-empty line is one root record. Byte offset and line number are metadata.
- `json`: requires exactly one absolute `path` or `glob`. Files and glob matches
  are sorted. No matches is unread. The optional input `items` selects a nested
  list; `"$"` selects a top-level list.

Absent, locked, malformed, partially malformed, wrongly shaped, or non-finite
sources are unread. Reader and mapping errors never include source values in
command output.

Home and environment expansion happens while configuration is parsed. The
normalized absolute locator is what registration fingerprints and stores, so a
later environment change cannot retarget an immutable connection identity.

## Connection identity

`connection_id` is user-selected, immutable, and distinct from reader type and
input ID. Registration binds it permanently to the SHA-256 digest of canonical
validated configuration. Registering the same configuration is idempotent;
registering different configuration under that ID fails. To change a source or
mapping, register a new connection identity.

Store schema v4 uses `connection_id` for records and collection attempts and
keeps `reader_type` on each new record. Migration from v3 renames the old
`adapter` columns as schema metadata and adds nullable reader metadata. Existing
records and attempts are not updated, deleted, reinserted, or reinterpreted. A
legacy record's old adapter value is therefore its deterministic connection
identity, while its reader type remains unknown.

## Runner semantics

The runner records an in-progress attempt before source I/O. Success or handled
failure completes that same attempt. Process termination leaves the durable
attempt incomplete, which reads as `interrupted` and therefore unread.

All inputs must be read and mapped before the first record is written. Duplicate
source identities and a different payload at an already stored source version
fail the attempt. Records remain immutable and idempotent. A successful attempt
records exact seen and added counts; failed, skipped, and interrupted attempts
record no counts.

Connection health is based only on its latest attempt:

- `quiet`: success with zero additions, whether the scan was empty or all
  records were already known;
- `changed`: success with one or more additions;
- `unread`: never run, failed, skipped, or interrupted.

One connection's attempt cannot establish another connection's health, even
when both use the same reader.

## Comparison contract

Every mapping declares:

- source record identity: provenance URI, epistemic status, kind, subject, and
  the declared source-version fields;
- source version: the canonical array of the mapping's named fields;
- source time: the declared field and timestamp format, or unknown;
- compared values: every declared payload field, fact owner, and source time;
- source mode: `append_only` or `rolling_snapshot`;
- whether a strictly newer point for an already known fact is the next point in
  a series rather than disagreement.

Verification rereads without collecting. For append-only mappings, a stored
identity absent from the source is `missing`; rolling snapshots may stop
exposing old points. Different compared JSON values at the same identity are
`changed`, including a change of JSON type such as number to Boolean. A source
identity never collected is `uncollected`, except for a
declared next series point whose source time is strictly newer than all stored
points for that fact; that is reported as `pending` and is not disagreement.

Output is sorted by connection and contains counts, never source records:

```text
weather-observations: ok pending=0
weather-observations: disagree missing=1 changed=0 uncollected=0 pending=0
weather-observations: unread
```

Any readable disagreement makes verification exit non-zero. Unread connections
do not hide another connection's disagreement. Unread-only exits zero.

## Commands

Run these from `backend/`:

```text
python connected_sources.py register /path/to/connection.json
python connected_sources.py list
python connected_sources.py collect [connection_id ...]
python connected_sources.py status [connection_id ...]
python connected_sources.py verify [connection_id ...]
python connected_sources.py disconnect connection_id
python check.py
```

`check.py` is the ordinary entry point: deterministic backend tests followed by
verification of all currently registered connections.

## Fifth-connection boundary

The frozen protected core paths are:

```text
backend/check.py
backend/connected_sources.py
backend/connection_config.py
backend/connection_runner.py
backend/observation_store.py
backend/source_readers.py
docs/connected-sources.md
```

The fifth-connection proof must register external configuration through the CLI,
collect through the normal runner, and show no path above changed after this
contract's commit. Source-specific fixtures and proof evidence are not core.
