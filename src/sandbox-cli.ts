import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { defaultStateDirectory } from "./paths.ts";
import { sandboxArguments } from "./sandbox-runtime.ts";
import { prepareSandboxSources } from "./sandbox.ts";
import { ObservationStore } from "./store.ts";

const home = process.env.HOME ?? homedir();
const worktree = resolve(process.env.ECOSYM_WORKTREE ?? process.cwd());
const project = process.env.ECOSYM_PROJECT;
const stateDirectory = defaultStateDirectory(process.env, home);

try {
  const store = new ObservationStore(stateDirectory);
  let configs;
  let storePath: string;
  try {
    configs = store.listConnections().map((connection) => connection.config);
    storePath = store.path;
  } finally {
    store.close();
  }
  const guardian = new DatabaseSync(storePath);
  let sources;
  try {
    guardian.prepare("SELECT count(*) AS count FROM sqlite_schema").get();
    const stateMounts = [storePath, `${storePath}-wal`, `${storePath}-shm`]
      .filter(existsSync)
      .map((path) => ({ destination: path, source: path }));
    sources = await prepareSandboxSources(configs, worktree);
    const executable =
      process.env.ECOSYM_SANDBOX_EXEC ?? join(home, ".opencode", "bin", "opencode");
    const arguments_ = sandboxArguments({
      childArguments: process.argv.slice(2),
      commitChannel: process.env.ECOSYM_COMMIT_CHANNEL,
      environment: process.env,
      executable,
      home,
      project,
      readonlySourceDirectories: sources.readonlyDirectories,
      sourceDirectories: sources.directories,
      sourceMounts: sources.mounts,
      stateDirectory,
      stateMounts,
      worktree,
    });
    const result = spawnSync(process.env.ECOSYM_BWRAP ?? "/usr/bin/bwrap", arguments_, {
      env: process.env,
      stdio: "inherit",
    });
    if (result.error !== undefined) {
      throw result.error;
    }
    process.exitCode = result.status ?? 1;
  } finally {
    sources?.close();
    guardian.close();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`sandbox setup failed: ${message}\n`);
  process.exitCode = 1;
}
