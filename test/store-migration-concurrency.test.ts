import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { parseCivilizationConfig } from "../src/institution.ts";
import type { ProjectRequest } from "../src/project-types.ts";
import { ObservationStore } from "../src/store.ts";

const WORKER = fileURLToPath(new URL("helpers/migration-open-worker.ts", import.meta.url));
const DEADLINE_MILLISECONDS = 15_000;

interface Worker {
  child: ChildProcess;
  finished: Promise<{ code: number | null; stdout: string; stderr: string }>;
}

function workspace(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "ecosym-migrate-race-"));
  const directory = join(root, "state");
  const path = join(directory, "observations.sqlite");
  const pausedPath = join(root, "paused");
  const gatePath = join(root, "gate");
  const workers: ChildProcess[] = [];
  t.after(() => {
    for (const child of workers) {
      if (child.exitCode === null) {
        child.kill("SIGKILL");
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const start = (): Worker => {
    const child = spawn(process.execPath, [WORKER, directory, pausedPath, gatePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    workers.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    const finished = new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        child.once("error", reject);
        // "close" fires after the stdio streams have drained; "exit" may not.
        child.once("close", (code) => resolve({ code, stdout, stderr }));
      },
    );
    // A rejection that nobody awaits yet must not crash the test process.
    finished.catch(() => {});
    return { child, finished };
  };
  const open = () => writeFileSync(gatePath, "open", { mode: 0o600 });
  return { root, directory, path, pausedPath, start, open };
}

async function awaitPaused(worker: Worker, pausedPath: string): Promise<void> {
  const deadline = Date.now() + DEADLINE_MILLISECONDS;
  while (!existsSync(pausedPath)) {
    if (worker.child.exitCode !== null) {
      const result = await worker.finished;
      assert.fail(`worker exited before pausing (${result.code}): ${result.stdout} ${result.stderr}`);
    }
    if (Date.now() > deadline) {
      assert.fail("worker never paused");
    }
    await delay(5);
  }
}

async function awaitFinished(worker: Worker) {
  const controller = new AbortController();
  const timeout = delay(DEADLINE_MILLISECONDS, undefined, { signal: controller.signal }).then(
    () => {
      worker.child.kill("SIGKILL");
      return "timeout" as const;
    },
    () => "cancelled" as const,
  );
  try {
    const result = await Promise.race([worker.finished, timeout]);
    assert.notEqual(result, "timeout", "worker did not finish before the deadline");
    return result as Awaited<Worker["finished"]>;
  } finally {
    controller.abort();
  }
}

function pragma(path: string, name: string): unknown {
  const database = new DatabaseSync(path);
  try {
    return Object.values(database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[0];
  } finally {
    database.close();
  }
}

function withRaw<T>(path: string, operation: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path);
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

function createProject(directory: string, root: string): string {
  const store = new ObservationStore(directory);
  try {
    const { civilizationId } = store.foundCivilization(
      parseCivilizationConfig({
        schemaVersion: 1,
        name: "Engineering",
        domain: "synthetic software",
        sources: [],
        mayActAlone: [],
        mustEscalate: [],
      }),
    );
    const input: ProjectRequest = {
      civilizationId,
      name: "Fjordkart",
      slug: "fjordkart",
      workspacePath: join(root, "workspace"),
      harness: "hermes",
      requestKey: "request-one",
      requestDigest: "digest-one",
    };
    return store.requestProject(input).project.projectId;
  } finally {
    store.close();
  }
}

function assertHealthy(path: string, directory: string): void {
  assert.equal(pragma(path, "user_version"), 18);
  assert.equal(pragma(path, "integrity_check"), "ok");
  withRaw(path, (database) => {
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
  const third = new ObservationStore(directory);
  try {
    third.listProjects();
  } finally {
    third.close();
  }
}

function columnCount(path: string, table: string, column: string): number {
  return withRaw(
    path,
    (database) =>
      database.prepare(`PRAGMA table_info(${table})`).all().filter((row) => row.name === column)
        .length,
  );
}

const DOWNGRADES: Record<number, string> = {
  17: `DROP INDEX project_retry_requests;
    ALTER TABLE project_provisioning_events DROP COLUMN retry_request_key;
    PRAGMA user_version = 17;`,
  15: `DROP TABLE project_harness_bindings; DROP TABLE project_provisioning_events; DROP TABLE projects;
    DROP TABLE source_report_facts; DROP TABLE source_report_admissions; DROP TABLE source_reports;
    PRAGMA user_version = 15;`,
  13: `ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v14;
    CREATE TABLE confirmation_previews (
      confirmation_token_hash TEXT NOT NULL PRIMARY KEY,
      operation TEXT NOT NULL
        CHECK (operation IN ('resolve-record-index', 'retire-collection-attempt', 'forget')),
      arguments_json TEXT NOT NULL,
      state_fingerprint TEXT NOT NULL,
      issued_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
    INSERT INTO confirmation_previews SELECT * FROM confirmation_previews_v14;
    DROP TABLE confirmation_previews_v14;
    ALTER TABLE owned_state_exports DROP COLUMN civilization_inventories_json;
    DROP TABLE civilization_forget_records;
    PRAGMA user_version = 13;`,
  8: `DROP TABLE record_index_mode_resolutions;
    DROP TABLE confirmation_previews;
    PRAGMA user_version = 8;`,
};

for (const version of [17, 13, 8, 15]) {
  test(`a second opener that queued behind an upgrade from schema ${version} applies no step twice`, async (t) => {
    const { root, directory, path, pausedPath, start, open } = workspace(t);
    new ObservationStore(directory).close();
    const projectId = version === 17 ? createProject(directory, root) : undefined;
    withRaw(path, (database) => database.exec(DOWNGRADES[version]!));

    const worker = start();
    await awaitPaused(worker, pausedPath);

    const opener = new ObservationStore(directory);
    t.after(() => opener.close());
    const schemaAfterFirst = pragma(path, "schema_version");

    open();
    const result = await awaitFinished(worker);
    assert.equal(result.code, 0, `${result.stdout} ${result.stderr}`);
    assert.equal(result.stdout, JSON.stringify({ opened: true }));
    assert.equal(pragma(path, "schema_version"), schemaAfterFirst);
    assertHealthy(path, directory);

    if (version === 17) {
      assert.equal(columnCount(path, "project_provisioning_events", "retry_request_key"), 1);
      withRaw(path, (database) => {
        assert.ok(
          database
            .prepare("SELECT 1 AS found FROM sqlite_master WHERE name = 'project_retry_requests'")
            .get(),
        );
      });
      assert.equal(opener.getProject(projectId!)?.projectId, projectId);
    }
    if (version === 13) {
      assert.equal(columnCount(path, "owned_state_exports", "civilization_inventories_json"), 1);
      withRaw(path, (database) => {
        const names = database
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name);
        assert.ok(!names.includes("confirmation_previews_v13"));
        assert.ok(names.includes("civilization_forget_records"));
      });
    }
  });
}

test("a second opener waits for an upgrade that holds the write lock past the busy window", async (t) => {
  const { root, directory, path, pausedPath, start, open } = workspace(t);
  new ObservationStore(directory).close();
  createProject(directory, root);
  withRaw(path, (database) => database.exec(DOWNGRADES[17]!));

  const upgrade = new DatabaseSync(path);
  t.after(() => {
    if (upgrade.isOpen) {
      upgrade.close();
    }
  });
  upgrade.exec("BEGIN IMMEDIATE");
  open();
  const worker = start();
  await awaitPaused(worker, pausedPath);
  await delay(1_000);
  assert.equal(worker.child.exitCode, null, "the second opener gave up while the upgrade held the lock");

  upgrade.exec("ROLLBACK");
  upgrade.close();
  const result = await awaitFinished(worker);
  assert.equal(result.code, 0, `${result.stdout} ${result.stderr}`);
  assert.equal(result.stdout, JSON.stringify({ opened: true }));
  assertHealthy(path, directory);
});

test("a second opener that wins the lock between another opener's steps continues from the committed version", async (t) => {
  const { directory, path, pausedPath, start, open } = workspace(t);
  new ObservationStore(directory).close();
  withRaw(path, (database) =>
    database.exec(`
      DROP INDEX mandate_revisions_current;
      DROP TABLE mandate_revisions;
      DROP TABLE civilizations;
      DROP TABLE record_index_mode_resolutions;
      DROP TABLE confirmation_previews;
      CREATE TABLE collection_attempts_replacement (blocker INTEGER) STRICT;
      PRAGMA user_version = 8;
    `),
  );

  const worker = start();
  await awaitPaused(worker, pausedPath);

  // Committed 8 -> 9, then the 9 -> 14 rebuild hits the blocker.
  assert.throws(() => new ObservationStore(directory), /already exists/);
  assert.equal(pragma(path, "user_version"), 9);
  withRaw(path, (database) => database.exec("DROP TABLE collection_attempts_replacement"));

  open();
  const result = await awaitFinished(worker);
  assert.equal(result.code, 0, `${result.stdout} ${result.stderr}`);
  assert.equal(result.stdout, JSON.stringify({ opened: true }));
  assertHealthy(path, directory);
});
