// This test uses only its own synthetic SQLite fixture, never a real ~/.hermes file.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

test("connects, collects, queries, and verifies a synthetic Hermes task board through the CLI", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-runtime-bridge-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourcePath = join(directory, "kanban.db");
  const configPath = join(directory, "connection.json");
  const xdgDataHome = join(directory, "data");
  const database = new DatabaseSync(sourcePath);
  try {
    assert.equal(database.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode, "wal");
    database.exec(`
      CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT NOT NULL, assignee TEXT, priority INTEGER);
      INSERT INTO tasks VALUES
        ('synthetic-task-1', 'ready', 'synthetic-agent-a', 1),
        ('synthetic-task-2', 'backlog', NULL, 0),
        ('synthetic-task-3', 'done', 'synthetic-agent-b', 2);
    `);
  } finally {
    database.close();
  }
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "hermes-kanban-example-tasks",
      factOwner: "hermes",
      reader: { type: "sqlite", path: sourcePath, table: "tasks" },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }],
        retention: "latest",
        recordedAt: { unavailable: true },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "hermes.kanban-task.status",
          subject: { scope: "record", path: "id" },
          payload: { value: { scope: "record", path: "status" } },
        },
        {
          epistemicStatus: "observation",
          kind: "hermes.kanban-task.assignee",
          subject: { scope: "record", path: "id" },
          payload: { value: { scope: "record", path: "assignee" } },
          required: [{ scope: "record", path: "assignee" }],
        },
        {
          epistemicStatus: "observation",
          kind: "hermes.kanban-task.priority",
          subject: { scope: "record", path: "id" },
          payload: { value: { scope: "record", path: "priority" } },
        },
      ],
    }),
  );

  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  assert.equal((await runCli(["collect", "hermes-kanban-example-tasks"], xdgDataHome)).code, 0);

  const query = await runCli(
    ["query", "observations", "--connection", "hermes-kanban-example-tasks"],
    xdgDataHome,
  );
  assert.equal(query.code, 0);
  const facts = (query.output.records as { kind: string; subject: string; payload: unknown }[])
    .map(({ kind, subject, payload }) => ({ kind, subject, payload }))
    .sort((left, right) => `${left.subject}:${left.kind}`.localeCompare(`${right.subject}:${right.kind}`));
  assert.deepEqual(facts, [
    { kind: "hermes.kanban-task.assignee", subject: "synthetic-task-1", payload: { value: "synthetic-agent-a" } },
    { kind: "hermes.kanban-task.priority", subject: "synthetic-task-1", payload: { value: 1 } },
    { kind: "hermes.kanban-task.status", subject: "synthetic-task-1", payload: { value: "ready" } },
    { kind: "hermes.kanban-task.priority", subject: "synthetic-task-2", payload: { value: 0 } },
    { kind: "hermes.kanban-task.status", subject: "synthetic-task-2", payload: { value: "backlog" } },
    { kind: "hermes.kanban-task.assignee", subject: "synthetic-task-3", payload: { value: "synthetic-agent-b" } },
    { kind: "hermes.kanban-task.priority", subject: "synthetic-task-3", payload: { value: 2 } },
    { kind: "hermes.kanban-task.status", subject: "synthetic-task-3", payload: { value: "done" } },
  ]);
  assert.equal(facts.some((fact) =>
    fact.subject === "synthetic-task-2" && fact.kind === "hermes.kanban-task.assignee"
  ), false);

  const verification = await runCli(["verify"], xdgDataHome);
  assert.equal(verification.code, 0);
  assert.equal(verification.output.outcome, "agreement");
});

async function runCli(
  arguments_: string[],
  xdgDataHome: string,
): Promise<{ code: number; output: Record<string, unknown> }> {
  const child = spawn(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? -1));
  });
  assert.equal(stderr, "");
  return { code, output: JSON.parse(stdout) as Record<string, unknown> };
}
