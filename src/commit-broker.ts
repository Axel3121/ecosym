import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export interface CommitRequest {
  message: string;
  paths?: string[];
}

export type CommitOutcome = "OK" | "DENIED" | "FAILED";

export interface CommitResult {
  outcome: CommitOutcome;
  reason?: string;
}

export interface BrokerInput {
  declaredTouches: string[];
  request: unknown;
  worktree: string;
}

// The broker runs git on the host, so the configuration git reads is the
// broker's own surface, not something inherited. A worker cannot define a
// filter — it cannot write .git/config — but an attribute it writes in the
// worktree only NAMES one, and a filter the operator installed globally
// answers to that name. Measured: `*.txt filter=preinstalled` executed a
// host command through a global definition, and executed nothing once the
// global and system files were excluded.
export const GIT_ENVIRONMENT: Record<string, string> = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
};

// Passed to every git invocation. core.hooksPath at an empty directory means
// no hook runs even if one were somehow present; the rest name the keys that
// were demonstrated to reach execution. This is defence in depth: the run
// cannot write .git/config at all, so none of these should have anything to
// override.
const GIT_OVERRIDES = [
  "-c",
  "core.hooksPath=/var/empty",
  "-c",
  "core.fsmonitor=",
  "-c",
  "core.sshCommand=",
  "-c",
  "core.pager=cat",
  "-c",
  "credential.helper=",
];

function deny(reason: string): CommitResult {
  return { outcome: "DENIED", reason };
}

function parseRequest(input: unknown): CommitRequest | string {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return "request must be an object";
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "message" && key !== "paths") {
      return `unknown field: ${key}`;
    }
  }
  const { message, paths } = record;
  if (typeof message !== "string" || message.trim() === "") {
    return "message must be a non-empty string";
  }
  if (paths === undefined) {
    return { message };
  }
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
    return "paths must be an array of strings";
  }
  return { message, paths: paths as string[] };
}

function insideWorktree(worktree: string, candidate: string): string | undefined {
  const absolute = isAbsolute(candidate) ? candidate : resolve(worktree, candidate);
  const relation = relative(worktree, absolute);
  if (relation === "" || relation.startsWith("..") || isAbsolute(relation)) {
    return undefined;
  }
  // A symlink out of the tree is a path that resolves elsewhere; the declared
  // object is what may be committed, not what a link points at.
  if (existsSync(absolute) && realpathSync(absolute) !== absolute) {
    return undefined;
  }
  return relation;
}

function changedPaths(worktree: string): string[] {
  const result = spawnSync(
    "git",
    [...GIT_OVERRIDES, "status", "--porcelain=v1", "-z", "--no-renames"],
    { cwd: worktree, encoding: "utf8", env: GIT_ENVIRONMENT },
  );
  if (result.status !== 0) {
    return [];
  }
  return result.stdout
    .split("\0")
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3));
}

export function brokerCommit(input: BrokerInput): CommitResult {
  const parsed = parseRequest(input.request);
  if (typeof parsed === "string") {
    return deny(parsed);
  }

  const worktree = resolve(input.worktree);
  const declared = new Set<string>();
  for (const touch of input.declaredTouches) {
    const relation = insideWorktree(worktree, touch);
    if (relation !== undefined) {
      declared.add(relation);
    }
  }

  // requested ∩ declared ∩ changed. A request may narrow what it commits; an
  // absent `paths` means everything already permitted, never `git add .`.
  let permitted = changedPaths(worktree).filter((path) => declared.has(path));

  if (parsed.paths !== undefined) {
    const requested = new Set<string>();
    for (const path of parsed.paths) {
      const relation = insideWorktree(worktree, path);
      if (relation === undefined) {
        return deny(`path outside the worktree: ${path}`);
      }
      if (!declared.has(relation)) {
        return deny(`path not declared by this run: ${relation}`);
      }
      requested.add(relation);
    }
    permitted = permitted.filter((path) => requested.has(path));
  }

  if (permitted.length === 0) {
    return deny("nothing to commit within the declared paths");
  }

  // Paths and message are arguments, never a shell string and never a config
  // value. `--` ends option parsing, so a path beginning with a dash is a
  // path. `-m` takes the message as its own argv entry, so --exec, newlines
  // and $(...) reach the commit message as characters.
  const staged = spawnSync("git", [...GIT_OVERRIDES, "add", "--", ...permitted], {
    cwd: worktree,
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
  if (staged.status !== 0) {
    return { outcome: "FAILED", reason: "staging failed" };
  }

  const committed = spawnSync(
    "git",
    [...GIT_OVERRIDES, "commit", "--only", "-m", parsed.message, "--", ...permitted],
    { cwd: worktree, encoding: "utf8", env: GIT_ENVIRONMENT },
  );
  if (committed.status !== 0) {
    return { outcome: "FAILED", reason: "commit failed" };
  }
  return { outcome: "OK" };
}
