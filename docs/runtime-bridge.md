# Runtime bridge

**This document describes local connection mechanics and generic templates only.**
It embeds no actual runtime data: no real task titles, bodies, agent prompts, or
session content. The repository must never contain a copy of anyone's real
`~/.hermes` database. The accompanying test builds its own synthetic fixture
with the same selected column shape.

A runtime that already keeps operational state in local SQLite (task boards,
run ledgers, cost accounting, and similar records) can be observed like any
other declarative source. Point a `ConnectionConfig` with `reader.type: "sqlite"`
at the database, one table per connection, read-only. This is exactly the
[Adding a source](observation-layer.md#adding-a-source) case: zero changes to
the store, query, collector, or reader packages.

## Repository boundary interpretation

[DEVELOPMENT.md](../DEVELOPMENT.md#repository-boundary) excludes personal agent
prompts, task specifications, run ledgers, and session output from the repository.
It also admits ordinary project tooling, such as a formatter, compiler, test
runner, migration tool, release script, or CI workflow, when needed to build,
verify, package, or operate Ecosym and when it works without a particular
person's agent setup.

Classifying this schema-shape connection convention under that exception is an
**interpretation, not a literal quote or a settled boundary decision**. The
argument is that it documents how any runtime's SQLite state can be connected,
uses Hermes only as a worked example of column shapes rather than actual
content, and stores no real per-person data in the repository at any point.
The test also uses only synthetic data and needs no Hermes installation. This
is not a copy of a task specification, prompt, or session transcript. Future
readers should be able to re-judge this interpretation rather than assume the
boundary question has already been settled.

## Useful tables

These are the verified Hermes column shapes relevant to connections, not full
database dumps. The board tables live in
`~/.hermes/kanban/boards/<board>/kanban.db`; usage lives in `~/.hermes/state.db`.

| Table | Relevant column shape | Subject and use |
| --- | --- | --- |
| `tasks` | `id TEXT PRIMARY KEY`, `status TEXT NOT NULL`, `assignee TEXT` (nullable), `priority INTEGER` | Subject `id`: status, assignee, and priority of each unit of work. This is the fully worked and tested example below. |
| `task_events` | `id INTEGER PRIMARY KEY AUTOINCREMENT`, `task_id TEXT NOT NULL`, `kind TEXT NOT NULL`, `created_at INTEGER NOT NULL`, `payload TEXT` | Subject `task_id`, **not `id`**: events about the task. An old newest event relative to the task's status can help detect a stall. `payload` is a JSON string selectable only as opaque text, never as a path into its JSON. |
| `task_runs` | `task_id` identifies the task; `id` identifies the run. Usable scalars include `status TEXT NOT NULL`, `outcome TEXT`, `started_at INTEGER NOT NULL`, `ended_at INTEGER`; `summary`, `metadata`, and `error` are opaque `TEXT`. | Subject `task_id`, **not `id`**: execution status, outcome, and timing about the task. |
| `session_model_usage` | No single ID column; composite primary key (`session_id`, `model`, `billing_provider`, `billing_base_url`, `billing_mode`, `task`). `estimated_cost_usd` and `actual_cost_usd` are `REAL`. | Subject `session_id`: cost about a session. A connection necessarily produces several facts per subject, one per model/provider combination the session used, not one row per subject as in `tasks`. |

SQLite selectors name top-level columns only. The subject is always the entity
the fact is **about**, not the storage row's own key when they differ. Using an
event's autoincrement `id` as subject would put every event under its own private
subject and defeat grouping facts about a task with `query --subject`.
Keep source-record identity distinct: event/run identities can use their own
row keys, and usage identity should select all composite-key columns even
though the subject is just `session_id`.

## Naming convention

- `kind`: lowercase, dot-separated `<runtime-name>.<concept>.<attribute>`, such
  as `hermes.kanban-task.status`. This is a stricter design choice for
  readability, not code enforcement. `src/config.ts`'s `NAME_PATTERN` is
  `^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$`, which permits uppercase and other
  separators.
- `factOwner`: the runtime/system name, such as `"hermes"`, constant across all
  connections observing that runtime. This field and the runtime-name segment
  of `kind` both exist and need not match token-for-token: that segment may
  vary per concept, while the owner remains constant.
- `subject`: the stable identity a human understands for the entity being
  described, not necessarily the row's own ID. Use `task_id` for events and
  runs about a task.
- Multiple boards: give each board's `kanban.db` its own connection ID, such as
  `hermes-kanban-<board-name>-tasks`. Connection IDs are the natural per-source
  scope; no separate cross-board collision mechanism is introduced.

## Worked connection

This complete connection selects status, assignee, and priority from `tasks`.
Use it as `connection.json` outside the repository, replacing the placeholder
database path with an absolute, already-expanded path selected by the operator.
**`~` is not expanded.** `openSqliteReadOnly` uses `node:url`'s `pathToFileURL`,
which treats a literal `~` as an ordinary path segment, not home-directory
shorthand. A `~/...` configuration silently fails to resolve as intended; the
operator must expand the path before writing the configuration.

```json
{
  "schemaVersion": 1,
  "id": "hermes-kanban-example-tasks",
  "factOwner": "hermes",
  "reader": {
    "type": "sqlite",
    "path": "/absolute/path/to/board/kanban.db",
    "table": "tasks"
  },
  "sourceRecord": {
    "identity": [{ "scope": "record", "path": "id" }],
    "retention": "latest",
    "recordedAt": { "unavailable": true }
  },
  "facts": [
    {
      "epistemicStatus": "observation",
      "kind": "hermes.kanban-task.status",
      "subject": { "scope": "record", "path": "id" },
      "payload": { "value": { "scope": "record", "path": "status" } }
    },
    {
      "epistemicStatus": "observation",
      "kind": "hermes.kanban-task.assignee",
      "subject": { "scope": "record", "path": "id" },
      "payload": { "value": { "scope": "record", "path": "assignee" } },
      "required": [{ "scope": "record", "path": "assignee" }]
    },
    {
      "epistemicStatus": "observation",
      "kind": "hermes.kanban-task.priority",
      "subject": { "scope": "record", "path": "id" },
      "payload": { "value": { "scope": "record", "path": "priority" } }
    }
  ]
}
```

The required assignee selector suppresses that fact for an unassigned task,
rather than storing a null payload. Status and priority remain observable for
the same subject: unknown is not zero. No timestamp is selected in this shape,
so source time is explicitly unavailable, never replaced with task creation,
collection, or wall-clock time. Stored `sourceRecordedAt` is null and temporal
status remains `unknown` unless later exhaustive collection establishes absence
and makes the fact `historical`; a successful read does not make it `current`.
`latest` describes the mutable source; it does not invent source-time ordering.
See [identity and time](observation-layer.md#identity-and-time-without-native-fields)
for correction history and unknown temporal status.

These facts observe only Hermes' durable row fields at collection time. In
particular, `status = done` means **Hermes' recorded workflow/task state**, not
work completed, operational success, prosperity, decay, population, attribution,
or a causal outcome. Assignee and priority likewise describe recorded fields,
not observed agents or activity. Runtime prose saying an effect happened remains
a `claim`, even when persisted in SQLite.

## Local procedure

Use the Node version required by `DEVELOPMENT.md` and install with `npm ci`.
Keep actual connection and civilization JSON in an operator-owned local
config/data directory outside the repository. The paths below are placeholders,
not locations to discover or scan. Keep real databases, selected task values,
command output, credentials, and personal agent configuration out of the tree.

By default both institutional and observation state live in
`${XDG_DATA_HOME:-$HOME/.local/share}/ecosym/observations.sqlite`. Use the same
environment for every CLI command and the world launcher so they open the same
store. Do not point tests at that personal store.

### One-time setup

Prepare the connection template above locally. Prepare a separate local
`civilization.json` with all four founding inputs:

```json
{
  "schemaVersion": 1,
  "name": "<civilization-name>",
  "domain": "<operator-declared domain>",
  "sources": ["hermes-kanban-example-tasks"],
  "mayActAlone": ["<operator-declared permitted scope>"],
  "mustEscalate": ["<operator-declared escalation boundary>"]
}
```

For the first local civilization, the operator supplies `EcoSym` as the name
and explicitly chooses its domain and mandate. No civilization is shipped or
automatically founded, and that name has no special engine behavior.

The source link is a deliberate design choice: each `sources[]` entry must
equal a registered connection ID exactly. It is not inferred from civilization
names, task titles, keywords, bodies, timing, or causality. A second civilization
uses another declaration and, if needed, another connection configuration with
its own ID and source path; no engine or renderer change is needed for the link.

```sh
npm run ecosym -- connect /absolute/path/connection.json
npm run ecosym -- found /absolute/path/civilization.json
```

Retain the returned `civilizationId` locally. **`found` is not idempotent:**
repeating it creates another civilization with new identities, even for the same
name and declaration. Do not put it in a restart or collection script. Registering
the same connection ID and identical configuration is idempotent; changing an
active configuration is refused and requires an explicit disconnect first.

### Repeatable collection and inspection

Run these commands after setup and whenever a fresh collected picture is needed:

```sh
npm run ecosym -- collect hermes-kanban-example-tasks
npm run ecosym -- status
npm run ecosym -- query observations --connection hermes-kanban-example-tasks
npm run ecosym -- query claims --connection hermes-kanban-example-tasks
npm run ecosym -- verify
```

`verify` rereads active sources and reports `agreement` when the stored selected
facts still match. A live source may change between collection and verification.
It audits every active connection, not just the board above, and does not update
the collected picture. Recollect to advance that picture. Agreement has exit
code 0; disagreement, unread, mixed, and unverified use 1, 2, 3, and 4. An empty
source with no stored facts is unverified (`no_facts`), not verified success.
See [verification results](observation-layer.md#verification-result).

### Start the world

```sh
npm run world
```

Open the printed `http://127.0.0.1:<port>` URL locally. The launcher builds the
browser assets and chooses an available loopback port; it does not collect,
auto-discover sources, found civilizations, or start work in Hermes. Restarting
it is repeatable and reads the same persisted Ecosym state.

The server exposes `/api/world-snapshot` through a callback supplied by the
launcher that calls `composeWorldSnapshot`. The React view reads that contract once
and displays stored declarations and separately labeled source evidence. Inspect the endpoint directly
or use `status` and `query` above, keeping the collection boundary distinct from
the later `verify` audit. See [DEVELOPMENT.md](../DEVELOPMENT.md) for frontend
dev/build/serve commands.

After collecting again, reload the browser for a new GET of the updated stored picture.
The browser does not poll or collect sources. Startup alone does not establish that
a source was read successfully or that its recorded fields prove an outcome.
This is an operator procedure, not a claim that real data has been connected or
verified by the documentation's authors; repository proof uses synthetic sources.

## Combined world contract

`src/world-application.ts` composes `WorldSnapshot` from the institution owner's
founded civilizations and the observation owner's narration. It does not collect
or read external sources. `src/world-snapshot.ts` runtime-validates the closed
display shape, exact civilization/source links, connection versions, separate
observation and claim lists, and timestamps, returning detached data. Institutional
state is not routed through the observation owner. Observation-derived depiction
belongs to the pure `src/world-form.ts` field projection, retained independently
of the browser skeleton; HTTP revalidates and serializes the callback's
already-composed snapshot rather than implementing a second mapping. No source handle, reader configuration, or
database handle belongs in the browser contract.

`ObservationStore.narrate()` reads statuses, in-progress attempts, facts, and
truncation counts inside one read transaction. Facts are filtered by active
connection ID/configuration hash; attempts and statuses also use the activation.
Disconnect removes that source's active evidence. An identical-config reconnect
can retain prior-activation facts and their original provenance while reporting
`never-run`; a changed-config reconnect excludes old-version facts. The world
validator retains whole-snapshot fail-closed behavior for corruption, rather than
turning inconsistent evidence into plausible unknowns. This transaction does not
include the separate institution snapshot read.

The contract preserves these distinctions:

- No founded civilizations is an empty world; a founding alone is not activity.
- An empty declared source list is distinct from a declared source with no facts.
- `collection: null` means no matching active connection, not unread or quiet.
- `collection.status` is Ecosym-owned collection health: `changed`, `quiet`, or
  `unread`, with a separate reason such as `never-run`, `incomplete`, or `failed`.
  A successful empty/unchanged picture can be quiet only in this collection sense.
  The form gives each reason its own meaning: no attempt in this activation,
  incomplete attempt, failed attempt, explicit retirement, skipped attempt, or
  unknown JSONL record-index interpretation. These are owner states, not a new
  form lifecycle.
- `attemptsInProgress` records incomplete attempts, not proof that a collector
  process is still alive. Retained facts do not hide an unread collection path.
- Every fact carries its external `factOwner`, connection ID/version, source
  record identity, `epistemicStatus`, `sourceRecordedAt`, `collectedAt`,
  `collectionAsOf`, and `temporalStatus` (`unknown`, `current`, or `historical`).
  These are not collapsed into a trusted/current flag. Currentness describes
  stored collection evidence, not live source truth.
- `connectionVersion` is an opaque configuration fingerprint retained as
  observation provenance, not a source handle. Actual reader paths/configuration
  and unselected source fields remain excluded from the loopback HTTP contract.
- `observationsTruncated` and `claimsTruncated` are owner-wide limits, not
  per-civilization completeness assessments. Empty lists under truncation do not
  establish that a declared source has no facts.

`test/runtime-bridge-hermes.test.ts` exercises the connect/collect/query/verify
commands against three synthetic tasks, including an unassigned task, and
asserts the selected facts and verification agreement.
`test/world-observations.test.ts` separately exercises synthetic SQLite
registration, collection, founding, production composition, the world HTTP API,
and the browser-facing pure form projection, including exact source links, collection
health, and observation/claim and temporal distinctions. Neither test accesses
a real Hermes board or personal Ecosym store, or executes a real browser or DOM
wiring. `test/world-transitions.test.ts` exercises reachable first-run, reconnect,
skipped, retired, and unknown-index states and a second-writer interleaving that
proves narration keeps one read snapshot. Frontend execution and visual design
remain separate replatform work.

## Read-only operational boundary

Hermes' kanban board databases have been verified to run in SQLite WAL mode.
In WAL mode, this read-only connection does not block a live Hermes dispatcher's
writes and is not blocked by those writes: readers observe a snapshot while a
writer appends to the WAL. The synthetic test also uses WAL mode; it does not
inspect a real Hermes database.

This is not a claim that Ecosym never affects a runtime in every configuration.
A database in legacy rollback-journal mode could have a long-held read
transaction interact differently with a writer. WAL is what makes the
read-only connection cheap here, and is a property of the source, not a
guarantee the SQLite reader makes for every possible source.

The reader opens the database with `mode=ro` and `readOnly: true`. Ecosym starts
nothing and manages nothing about the observed runtime, and does not write
back to its database. Connecting a source is always an explicit, manual
operator action (`connect config.json`), never automatic discovery of databases
on disk. The local world launcher starts only Ecosym's display server. Neither
the bridge nor world composition adds runtime writes, execution authority,
admission, petition execution, a council, city hall, scheduling, or general
orchestration.
