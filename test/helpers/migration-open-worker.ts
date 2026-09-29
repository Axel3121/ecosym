import { existsSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { ObservationStore } from "../../src/store.ts";

const [stateDirectory, pausedPath, gatePath] = process.argv.slice(2);
if (stateDirectory === undefined || pausedPath === undefined || gatePath === undefined) {
  throw new Error("migration-open-worker requires a state directory, paused path, and gate path");
}

// Pause just before the first write-lock acquisition. The opener has already made
// its out-of-lock decision reads by then; only scheduling changes, never SQL.
let paused = false;
const originalExec = DatabaseSync.prototype.exec;
DatabaseSync.prototype.exec = function (this: DatabaseSync, sql: string) {
  if (!paused && sql === "BEGIN IMMEDIATE") {
    paused = true;
    writeFileSync(pausedPath, "paused", { mode: 0o600 });
    const waiter = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(gatePath)) {
      Atomics.wait(waiter, 0, 0, 2);
    }
  }
  return originalExec.call(this, sql);
};

try {
  const store = new ObservationStore(stateDirectory);
  store.listProjects();
  store.close();
  process.stdout.write(JSON.stringify(paused ? { opened: true } : { opened: true, paused: false }));
} catch (error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  process.stdout.write(JSON.stringify({ error: failure.message, name: failure.name }));
  process.exit(1);
}
