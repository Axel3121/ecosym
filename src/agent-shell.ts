import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { defaultStateDirectory } from "./paths.ts";

export interface AgentShellArgumentsInput {
  childArguments: string[];
  emptyDirectory: string;
  environment: NodeJS.ProcessEnv;
  home: string;
  mode: "agent" | "prober";
  project: string | undefined;
  stateDirectory: string;
  workdir: string;
  worktree: string;
}

export interface AgentShellCommandInput {
  command: string;
  timeout?: number | undefined;
  workdir?: string | undefined;
}

export interface AgentShellCommandContext {
  abort: AbortSignal;
  agent: string;
  directory: string;
  worktree: string;
}

export function agentShellArguments(input: AgentShellArgumentsInput): string[] {
  const requiredPaths: [string, string][] = [
    ["HOME", input.home],
    ["empty directory", input.emptyDirectory],
    ["working directory", input.workdir],
    ["worktree", input.worktree],
  ];
  for (const [name, path] of requiredPaths) {
    if (!isAbsolute(path)) {
      throw new Error(`${name} must be absolute`);
    }
  }
  if (input.mode === "prober") {
    for (const [name, path] of [
      ["worktree", input.worktree],
      ["project", input.project],
    ] as [string, string | undefined][]) {
      const canonicalPath = path === undefined ? undefined : realpathSync(path);
      if (
        canonicalPath !== undefined &&
        (canonicalPath === "/tmp" || canonicalPath.startsWith("/tmp/"))
      ) {
        throw new Error(`Prober ${name} must not be inside writable scratch`);
      }
    }
  }
  const arguments_ = [
    "--die-with-parent",
    "--new-session",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--unshare-uts",
    "--unshare-cgroup-try",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--bind",
    "/tmp",
    "/tmp",
  ];
  if (input.mode === "prober" && existsSync("/dev/shm")) {
    arguments_.push("--ro-bind", input.emptyDirectory, "/dev/shm");
  }
  for (const path of [
    join(input.home, ".local", "share", "opencode"),
    join(input.home, ".local", "state", "opencode"),
  ]) {
    if (existsSync(path)) {
      arguments_.push("--ro-bind", input.emptyDirectory, path);
    }
  }
  if (input.mode === "agent") {
    for (const path of [
      input.stateDirectory,
      input.worktree,
      ...(input.project === undefined ? [] : [join(resolve(input.project), ".git")]),
    ]) {
      if (existsSync(path)) {
        arguments_.push("--bind", path, path);
      }
    }
  }
  arguments_.push("--clearenv");
  for (const name of [
    "COLORTERM",
    "FORCE_COLOR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LOGNAME",
    "NO_COLOR",
    "NVM_BIN",
    "NVM_DIR",
    "NVM_INC",
    "PATH",
    "SHELL",
    "TERM",
    "TZ",
    "USER",
    "XDG_DATA_HOME",
  ]) {
    const value = input.environment[name];
    if (value !== undefined) {
      arguments_.push("--setenv", name, value);
    }
  }
  arguments_.push(
    "--setenv",
    "HOME",
    input.home,
    "--setenv",
    "TMPDIR",
    "/tmp",
    "--setenv",
    "ECOSYM_WORKTREE",
    input.worktree,
    "--setenv",
    "ECOSYM_AGENT_SHELL",
    input.mode,
  );
  if (input.project !== undefined) {
    arguments_.push("--setenv", "ECOSYM_PROJECT", input.project);
  }
  arguments_.push(
    "--chdir",
    input.mode === "prober" ? "/tmp" : input.workdir,
    "--",
    ...input.childArguments,
  );
  return arguments_;
}

export async function executeAgentShellCommand(
  input: AgentShellCommandInput,
  context: AgentShellCommandContext,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const mode = context.agent === "prober" ? "prober" : "agent";
  const requestedWorkdir = input.workdir ?? context.directory;
  const workdir = isAbsolute(requestedWorkdir)
    ? requestedWorkdir
    : resolve(context.directory, requestedWorkdir);
  const home = environment.HOME;
  if (home === undefined) {
    throw new Error("HOME is not set");
  }
  const emptyDirectory = mkdtempSync(join(tmpdir(), "ecosym-agent-shell-"));
  try {
    const arguments_ = agentShellArguments({
      childArguments: ["/bin/bash", "-c", input.command],
      emptyDirectory,
      environment,
      home,
      mode,
      project: environment.ECOSYM_PROJECT,
      stateDirectory: defaultStateDirectory(environment, home),
      workdir,
      worktree: context.worktree,
    });
    return await runAgentShell(arguments_, input.timeout ?? 120_000, context.abort, environment);
  } finally {
    rmSync(emptyDirectory, { force: true, recursive: true });
  }
}

async function runAgentShell(
  arguments_: string[],
  timeout: number,
  abort: AbortSignal,
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  const child = spawn(environment.ECOSYM_BWRAP ?? "/usr/bin/bwrap", arguments_, {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  let killTimer: NodeJS.Timeout | undefined;
  const stop = (): void => {
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1_000);
  };
  if (abort.aborted) {
    stop();
  } else {
    abort.addEventListener("abort", stop, { once: true });
  }
  const timer = setTimeout(stop, timeout);
  try {
    const exitCode = await new Promise<number>((accept, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => accept(code ?? (signal === null ? 1 : 128)));
    });
    return `${stdout}${stderr}${stdout !== "" || stderr !== "" ? "\n" : ""}exit code: ${exitCode}`;
  } finally {
    clearTimeout(timer);
    if (killTimer !== undefined) {
      clearTimeout(killTimer);
    }
    abort.removeEventListener("abort", stop);
  }
}
