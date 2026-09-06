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

For new JSONL connection versions, `record-index` is the ordinal among nonblank
records. Schema-six stores did not record whether they used that rule or a
physical line number. On the first collection or verification of an affected
version, Ecosym reads the JSONL file once and derives both index interpretations
from those same records. It records `record-ordinal` and continues only when the
file did not change during the read, both rules produce the same selected fact
set, and that set exactly matches the store's integrity-checked current
snapshot. Otherwise the version remains unread rather than having its identity
guessed. The unpublished schema-seven migration guessed that mode, so stores
carrying that version are refused.

For a version that remains ambiguous, `status` supplies its exact connection
version. Run `resolve-record-index CONNECTION_ID CONNECTION_VERSION MODE` to
preview a resolution. The preview changes nothing: it enumerates the exact
affected fact IDs and collection-attempt IDs, states the consequence and
recoverability, and issues a random, single-use confirmation token.

The preview also reports store-only record-index evidence when every source
identity selector is either `record-index` or `source-path`. It does not read the
source. For each recorded collection attempt, the store knows how many source
records reached the collection sink. A stored identity reconstructed from an
index at or above the maximum of those counts cannot have been produced by
record-ordinal, so such an identity refutes that mode. The maximum is deliberately
conservative because a fact can be re-seen by a later attempt. The evidence can
miss a refutation, can never refute physical-line, and never confirms either
mode. Its conclusion also rests on all stored facts having been written under a
single record-index rule; that premise can fail if a collector changed rules
between attempts.

Absent refuting evidence, the manual preview cannot distinguish the modes from
stored data. The automatic path described above remains the only source-backed
disambiguation. Even when record-ordinal is refuted, that is not evidence that
physical-line is correct. The preview informs rather than refuses a choice: the
single-rule premise may not hold, and an operator may have provenance knowledge
that the store does not.

The store records a hash of the confirmation token with the exact operation,
inventory fingerprint, and issue time; `status`, `query`, and `verify` do not
expose enough state to derive it. Every preview issues a different token. Repeat
the command with `--confirm TOKEN` to make the recorded choice. A successful
confirmation spends the token atomically with the choice, and a changed
inventory refuses it as stale. Confirmations do not expire by elapsed time: this
store has no operator session lifetime from which to derive a meaningful
deadline, and time alone does not change the previewed consequence. They remain
usable only while their exact subject state is unchanged and until they are
spent. A resolution is refused while a collection for that version is running. If an
operator has established that a marker is abandoned, `status` lists its exact
`attemptId` under `collectionAttempts`. `retire-collection-attempt` requires a
stable `ACTOR` identifier and its own persisted preview and confirmation token.
It is never
automatic and does not use elapsed time. Confirmation changes only that attempt
to the distinct `retired` outcome and appends a durable retirement record with
the attempt, actor, time, connection version, and confirmation token. Retirement
also prevents a process that was merely slow rather than dead from later
committing facts, so an operator must not retire a genuinely live attempt.
Other running attempts continue to refuse record-index resolution.

The resolution changes no fact rows. It records the old and selected modes,
configuration hash, exact inventory, and time as a durable user decision. Choosing
incorrectly can make later verification disagree or collection create
identities that were not intended. The same preview and confirmation process
can correct the mode later; every prior decision and facts collected under it
remain recorded. `status` lists those decisions even after the version is
disconnected.

A direct selector is `{ "scope": "record", "path": "field.name" }`, a
root selector changes the scope to `root`, and source metadata is selected with
`{ "scope": "meta", "value": "source-path" }` or `record-index`.
`{ "coalesce": [SELECTOR, ...] }` chooses the first present non-null value.
`{ "default": SCALAR, "selector": SELECTOR }` replaces missing or null.
Temporal meaning follows [PRODUCT.md's distinction between history and current
truth](../PRODUCT.md#history-and-current-truth-are-distinct) and
[ARCHITECTURE.md's observation ownership boundary](../ARCHITECTURE.md#observation-owner).

Source time formats are `iso8601`, `date`, `unix-seconds`, and
`unix-milliseconds`. Numeric source times must convert exactly to a whole
millisecond; values requiring sub-millisecond truncation are malformed. JSON
and JSONL readers retain the selected number's source token for this check, so
parsing cannot hide precision the token carried. SQLite numbers have no source
token after the driver returns them and are checked as their exact binary
values; precision already discarded by SQLite or its driver cannot be
recovered.

An ISO-8601 source time is stored exactly as the source spelled it, while a
separate derived key provides ordering, so supplied values are not rewritten.
Both `Z` and `+00:00` are accepted because they denote the same instant.
Precision finer than a millisecond is refused rather than truncated, and a
non-UTC offset is refused rather than converted. When the same instant is
supplied again with a different spelling, the most recently supplied spelling
is stored for that sighting.

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
npm run ecosym -- resolve-record-index CONNECTION_ID CONNECTION_VERSION physical-line|record-ordinal
npm run ecosym -- resolve-record-index CONNECTION_ID CONNECTION_VERSION physical-line|record-ordinal --confirm TOKEN
npm run ecosym -- retire-collection-attempt ATTEMPT_ID --by ACTOR
npm run ecosym -- retire-collection-attempt ATTEMPT_ID --by ACTOR --confirm TOKEN
npm run ecosym -- export DESTINATION
npm run ecosym -- forget CONNECTION_ID --by ACTOR
npm run ecosym -- forget CONNECTION_ID --by ACTOR --export-digest DIGEST --confirm TOKEN
npm run ecosym -- forget-civilization CIVILIZATION_ID --by ACTOR
npm run ecosym -- forget-civilization CIVILIZATION_ID --by ACTOR --export-digest DIGEST --confirm TOKEN
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
failed collection surfaces only the machine failure code; the underlying error
is not chained because it can originate in caller-supplied source reading and
carry source paths or source content. Each active entry includes its exact
configuration hash as `connectionVersion`. A marker is
committed before source reading; facts and successful completion are then
committed together. If the process stops between those points, the marker
remains `incomplete` rather than revealing the previous success as current.
`Incomplete` is deliberately neutral: the collector may still be alive, or it
may have stopped. Two connection lifetimes have separate attempts and status
even when they use the same revision and reader. A store migration that cannot
prove continuity starts the active lifetime at `never-run`; the next collection
establishes its status.
Status also includes every collection attempt under `collectionAttempts` and
every durable retirement under `collectionAttemptRetirements`, including the
actor and retirement time. It continues to include every recorded user
resolution under `recordIndexModeResolutions`, scoped by connection ID and
configuration hash. Completed deletion records appear under `forgetRecords`;
they retain the actor, time, connection, exact identifiers and counts, inventory
digest, and presented export digest, but no deleted configuration or fact
payload. Completed civilization deletion records appear under
`civilizationForgetRecords`; they retain the actor, time, civilization ID,
revision identities, counts, inventory digest, and presented export digest.

## Export and deletion

`export DESTINATION` writes one canonical JSON bundle to the named path with
mode `0600`. Standard output remains one schema-version-one command envelope:
`outcome` is `exported`, and `destination`, `digest`, `exportedAt`, and `counts`
describe the file. The digest is `sha256:` followed by SHA-256 of the exact
canonical file bytes. Re-exporting unchanged owned state writes byte-identical
content and reports the original snapshot instant; a change to exported state
creates a new snapshot instant and digest.

The bundle has its own `schemaVersion`, the store schema version, an institution
section containing every civilization, mandate revision, and completed
civilization forget record, and an observation
section containing every connection version and canonical registered
configuration, active connection, fact, collection attempt, attempt retirement,
record-index-mode resolution, and completed forget record. Facts retain their
stored provenance, epistemic status, source and collection times, source-time
ordering key, payload and payload digest, attempt order, and derived temporal
status without upgrading unknown values.

Each exported mandate digest is derived from the validated stored mandate bytes,
not copied from the stored digest column. Export refuses with
`mandate_unreadable` if either the mandate cannot be read canonically or its
derived digest disagrees with the stored digest.

Attempt retirements and record-index-mode resolutions carry the SHA-256 digest
of the confirmation token as `confirmationTokenDigest`, preserving the link to
the preview that authorized the operation. Confirmation tokens are never
exported in plaintext.

The bundle deliberately omits `confirmationPreviews`, because approval-gate
records are operational state and exporting them could disclose confirmation
material. Confirmation material in exported operation records is carried only
as the digest described above, never in plaintext. The bundle also omits the
operational `ownedStateExports` evidence ledger so creating an export does not
recursively change the next bundle. Both omissions and their reasons are stated
in every bundle.

An export is a complete copy of owned state at the stated instant and evidence
for deletion. Ecosym has no import or restore command that reinstates records
with their original epistemic status, provenance, source timing, and temporal
status. A bundle cannot be read back as the observations it once held; connecting
it as a JSON file creates new observations of that file instead. An export is not
a way to undo `forget`.

`forget CONNECTION_ID --by ACTOR` is only a preview. The connection must already
be inactive. The preview lists all versions, fact IDs, collection-attempt IDs,
attempt-retirement IDs, and record-index-resolution IDs, gives exact counts and
an inventory digest, states the permanent consequence, and issues the existing
random single-use confirmation token. It deletes nothing.

Confirmation additionally requires `--export-digest DIGEST`. Export coverage
is decided by comparing the previewed connection inventory digest with the
inventory digest recorded atomically when that exact export was produced. The
inventory includes every identifier in the deletion scope, so an export made
before a later collection or decision does not cover the changed inventory.
Changes to unrelated connections do not invalidate coverage of the named
connection. Confirmation first rechecks the preview fingerprint, then checks
export coverage, deletes the listed rows in one transaction, spends the token,
and appends the payload-free forget record.

`forget-civilization CIVILIZATION_ID --by ACTOR` follows the same gate and is
also only a preview. Its schema-version-one stdout envelope has `command` set to
`forget-civilization`, `outcome` set to `confirmation-required`, and contains
the civilization ID, the exact list of every revision identity as
`(civilizationId, mandateId, revision)`, counts, inventory digest, actor,
consequence, recoverability statement, and single-use `confirmationToken`.
Confirmation adds `--export-digest DIGEST --confirm TOKEN`; success returns the
same envelope with `outcome` set to `forgotten` and the durable forget record.

Requiring dissolution first is a design choice, not a requirement quoted from
the product documents. Dissolution is the sovereign, recorded world act that
ends the active mandate; forgetting is the later store operation that removes
its residue. Allowing the store operation to delete a live civilization would
end an active mandate without an institutional revision recording that act.

The deletion unit is exactly the civilization row and its entire mandate
revision chain, deleted together in one transaction. No command or argument can
delete a revision or suffix of a chain. Removing a suffix could promote an older,
wider mandate to current or remove the dissolved revision and resurrect a
civilization, so partial deletion is not a supported variant. After successful
deletion authority resolution reports `civilization_not_found`, not
`civilization_dissolved`.

The preview is covered only when its inventory digest equals the civilization
inventory digest recorded atomically for the presented export digest. An export
from before dissolution does not cover the appended dissolved revision. Changes
to another civilization or to observation state do not change coverage for the
named civilization.

The durable record identifies each deleted revision only by
`(civilizationId, mandateId, revision)`, never by `revision_order`, because the
SQLite integer order can be reused after deletion. It carries no mandate payload
and deliberately carries no mandate digest. Mandates are low-entropy,
user-declared content, so retaining a digest could let deleted content be
confirmed by guessing it. The retained export digest verifies the evidence file,
not a mandate, and the inventory digest verifies deletion scope. Forgetting can
make later petition attribution independently unverifiable because the
institutional revision to which a petition was bound is gone.

Forget refusal codes are:

| Code | Meaning |
| --- | --- |
| `forget_connection_active` | The named connection is still active. |
| `forget_connection_not_found` | No connection versions exist for that ID. |
| `confirmation_preview_not_found` | No matching forget preview issued this token. |
| `confirmation_already_spent` | This confirmation was already used. |
| `forget_state_changed` | The exact inventory or active state changed after preview. |
| `forget_export_coverage_mismatch` | The digest is unknown or covers a different inventory. |

Civilization forget refusal codes are:

| Code | Meaning |
| --- | --- |
| `forget_civilization_not_found` | No civilization exists under the named ID. |
| `forget_civilization_not_dissolved` | The civilization is still live; dissolve it first. |
| `confirmation_preview_not_found` | No matching civilization-forget preview issued this token. |
| `confirmation_already_spent` | This confirmation was already used. |
| `forget_civilization_state_changed` | The exact civilization or revision inventory changed after preview. |
| `forget_civilization_export_coverage_mismatch` | The digest is unknown or covers a different civilization inventory. |

An export destination that cannot be written is reported as
`export_unwritable`. Invalid command shapes continue to report
`invalid_arguments`.

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

Verification compares the source against one store snapshot taken before the
source is read. Facts collected after that snapshot are not compared during
that run, so a collection landing during verification does not produce
disagreement. Those facts are reported by the next verification run. This
property covers a store that changes during verification; a source that changes
while it is being read is not covered and is not distinguished from real
disagreement.

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
`no_connections`. Connections with different outcomes aggregate as `mixed`.
An aggregate containing an unverified connection carries
`connections_unverified`. An entirely unverified result uses exit code 4, so
nothing checked is distinct from both agreement and disagreement.

## Recorded risks

Unbounded input buffering in the observation layer is recorded as a risk, not
closed as a defect. No size limit, threshold, or other bound is set here because
the acceptable input size is product policy, and none has been decided.

In `src/readers.ts`, `readJsonFiles` collects every path matched by the glob into
an array before sorting and reading any file. It then uses `handle.readFile` to
read each entire matched file into a string before parsing it, and `JSON.parse`
holds the whole document and its record array in memory at once. In the same
file, `readCsv` likewise uses `handle.readFile` to read the entire file into a
string, and `parseCsv` materialises every row into an array before the first
record is yielded. The `readJsonLines` function instead streams the file line by
line through `readline`, and the SQLite reader iterates its prepared statement,
so those two readers do not hold a whole source in memory. They still
materialise one complete JSONL line or SQLite row and its column values, so they
are bounded by the largest single record rather than bounded absolutely.

The other JSONL entry point, `readJsonlSourceWithRecordIndexModes`, builds
complete `physicalLine` and `recordOrdinal` `SourceRecord` arrays over the entire
file before returning. The arrays contain distinct wrapper objects and distinct
`meta` objects, but each pair of wrappers spreads the same parsed source object,
so its `record`, `root`, and `numericLexemes` payloads are shared rather than
copied. In `src/record-index.ts`, `resolveLegacyRecordIndexMode` then flat-maps
each array through `materializeFacts` into the whole-input `physicalLineFacts`
and `recordOrdinalFacts` arrays. Its source-revision closure captures `source`,
keeping both `SourceRecord` arrays reachable for the entire store transaction.
Inside that transaction, `ObservationStore.resolveRecordIndexModeFromEquivalentFacts`
builds two further whole-input arrays through `verificationFactsFromInputs`, and
`sameVerificationFactSet` builds a whole-set key `Set` for each side on both of
its calls. The transaction also calls `#verificationSnapshot`, so at peak the
two `SourceRecord` arrays, two fact arrays, two verification-fact arrays, key
sets, and the whole stored side are live together. Measured current behaviour
for a 27.6 MB JSONL source of 200,000 records held 200,000 entries in each source
array and cost about 159 MB of heap in
`readJsonlSourceWithRecordIndexModes` alone, before the store-side arrays exist.

Both `collectConnection` and `verifyConnection` call
`resolveLegacyRecordIndexMode` when the stored `jsonlRecordIndexMode` is
`"unknown"`. New registrations store `"record-ordinal"`; `"unknown"` arises only
from the `user_version === 6` migration, and only for a pre-existing JSONL
connection version that has stored facts and whose mapping uses a selector with
`scope: "meta"` and `value: "record-index"`. A legacy JSONL mapping that does not
use that record index is assigned `"record-ordinal"` and does not take this path.
The buffer is not necessarily one-shot: if
`resolveRecordIndexModeFromEquivalentFacts` returns false,
`resolveLegacyRecordIndexMode` leaves the connection `"unknown"`, after which
collection throws and verification reports `store_record_index_mode_unknown`.
Every later collection or verification invocation reads and buffers the whole
file again until the mode is resolved.

In `src/store.ts`, `ObservationStore.collect` accumulates every prepared fact
from an attempt before opening the write transaction, so peak memory for a
source is proportional to its entire fact count rather than one record. At
commit time it also builds the whole-attempt `correctionSlots` and
`correctionStateBefore` maps over those facts. In `src/verify.ts`,
`verifyConnection` materialises both the whole stored snapshot for the
connection and every fact from the source before comparing them. The stored
side includes a distinct integrity load in `#verificationSnapshot`:
`integrityRows` uses `.all()` to materialise every fact row for the
`connection_id`, without a `config_hash` filter, across all prior connection
versions including superseded rows. Each row carries the full canonical
`payload_json` string, while the current-fact snapshot immediately below is
limited by both `connection_id` and `config_hash` and carries only payload
hashes. The integrity load is therefore bounded by the connection's whole
history multiplied by payload size, not by its current fact count. It is reached
from `factsForVerification` during `verifyConnection` and again from the legacy
record-index resolution transaction. In `src/cli.ts`, `readConfig` reads either
a whole connection configuration file or all of standard input into memory
before parsing it.

An incremental CSV parser that yielded each row as it was completed and an
incremental JSON reader would remove the reader-side peak. The `readJsonLines`
JSONL reader already has that per-record streaming shape and is the model,
subject to the largest-record bound described above. Bounding legacy JSONL
record-index resolution has two available structural shapes, neither of which
sets an input-size policy. When a source has no blank lines,
`physicalLineIndex` and `recordOrdinalIndex` advance together, so the two
interpretations are identical by construction and only one side needs to be
materialised; a single streaming pass that notices the first blank line is
enough to distinguish that case. In the general case, the question is set
equality between both interpretations and the stored side, so each side could
instead stream into the store's own open transaction and be compared there,
moving the buffer into the store rather than retaining arrays on the heap. The
integrity pass has no cross-row dependency or ordering requirement, so iterating
its statement instead of calling `.all()` would bound that load. Committing
collection in bounded batches within an attempt rather than buffering the whole
attempt would bound the collector, but only if partial results were prevented
from becoming visible at all, for example by staging rows scoped to the attempt
and publishing them atomically on success or by another atomic publication
mechanism. Merely marking the attempt incomplete is not enough: fact queries
filter on `epistemic_status`, `fact_id`, `connection_id`, `fact_owner`, `kind`,
and `subject`, never on attempt outcome, so committed batches would remain
visible even if the attempt later failed. The current single-transaction shape
guarantees that outcome without additional handling.
Comparing a sorted stored side against a sorted source stream would bound
verification per identity group, at the cost of requiring both sides to arrive
in a comparable order. It would not make memory constant per record because
`isStrictlyNewerThanHistory` needs the whole history of one identity at once;
the resulting bound is the largest identity group.

## Adding a source

Create a configuration in the state directory or pass it on standard input,
then run `connect`, `collect`, and `verify`. A new source whose shape fits one of
the declarative readers costs only that configuration. It does not require a
change to the store, query, collector, or reader packages.
See [Runtime bridge](runtime-bridge.md) for the convention for observing a runtime's own SQLite state, with a synthetic-tested Hermes example.
