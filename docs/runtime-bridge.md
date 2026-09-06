# Runtime bridge

**This document describes connection mechanics and column-shape examples only.**
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
Use it as `connection.json` outside the repository, replacing `<user>` and
`<board>` with the actual values and keeping an absolute, already-expanded path.
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
    "path": "/home/<user>/.hermes/kanban/boards/<board>/kanban.db",
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
so source time is explicitly unavailable, never replaced with collection time.
`latest` describes the mutable source; it does not invent source-time ordering.
See [identity and time](observation-layer.md#identity-and-time-without-native-fields)
for correction history and unknown temporal status.

Run the complete manual sequence, using the actual configuration path:

```sh
npm run ecosym -- connect /absolute/path/connection.json
npm run ecosym -- collect hermes-kanban-example-tasks
npm run ecosym -- query observations --connection hermes-kanban-example-tasks
npm run ecosym -- verify
```

`verify` rereads active sources and reports `agreement` when the stored selected
facts still match. A live source may change between collection and verification.
`test/runtime-bridge-hermes.test.ts` exercises this sequence against three
synthetic tasks, including an unassigned task, and asserts the selected facts
and verification agreement.

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
on disk. This convention adds no launcher, authority wiring, scheduling,
cross-connection aggregation, or UI.
