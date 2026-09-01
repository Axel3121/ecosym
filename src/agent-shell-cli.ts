import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { agentShellArguments } from "./agent-shell.ts";
import { defaultStateDirectory } from "./paths.ts";

const parsed = parseArguments(process.argv.slice(2));
const home = process.env.HOME ?? homedir();
const emptyDirectory = mkdtempSync(join(tmpdir(), "ecosym-agent-shell-"));

try {
  const arguments_ = agentShellArguments({
    childArguments: parsed.childArguments,
    emptyDirectory,
    environment: process.env,
    home,
    mode: parsed.mode,
    project: process.env.ECOSYM_PROJECT,
    stateDirectory: defaultStateDirectory(process.env, home),
    workdir: parsed.workdir,
    worktree: parsed.worktree,
  });
  const result = spawnSync(process.env.ECOSYM_BWRAP ?? "/usr/bin/bwrap", arguments_, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  process.stderr.write(`agent shell setup failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  rmSync(emptyDirectory, { force: true, recursive: true });
}

interface ParsedArguments {
  childArguments: string[];
  mode: "agent" | "prober";
  workdir: string;
  worktree: string;
}

function parseArguments(arguments_: string[]): ParsedArguments {
  let mode: "agent" | "prober" | undefined;
  let workdir: string | undefined;
  let worktree: string | undefined;
  let index = 0;
  while (index < arguments_.length && arguments_[index] !== "--") {
    const option = arguments_[index];
    const value = arguments_[index + 1];
    if (value === undefined) {
      throw new Error(`${option ?? "option"} needs a value`);
    }
    switch (option) {
      case "--mode":
        if (value !== "agent" && value !== "prober") {
          throw new Error("--mode must be agent or prober");
        }
        mode = value;
        break;
      case "--workdir":
        workdir = resolve(value);
        break;
      case "--worktree":
        worktree = resolve(value);
        break;
      default:
        throw new Error(`unknown option: ${option}`);
    }
    index += 2;
  }
  if (arguments_[index] !== "--") {
    throw new Error("agent shell command must follow --");
  }
  const childArguments = arguments_.slice(index + 1);
  if (mode === undefined || workdir === undefined || worktree === undefined) {
    throw new Error("--mode, --workdir, and --worktree are required");
  }
  if (childArguments.length === 0) {
    throw new Error("agent shell command must not be empty");
  }
  return { childArguments, mode, workdir, worktree };
}
