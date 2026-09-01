import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
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
  if (input.home === "/") {
    throw new Error("HOME must name an absolute non-root directory");
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
  ];
  // A shell that only reads and reports has no errand on the network. Denying
  // it a route is what keeps a prompt-injected read-only agent from turning
  // whatever it can read into something it can send. The writing agent keeps
  // its network: it fetches dependencies and talks to the forge.
  if (input.mode === "prober") {
    arguments_.push("--unshare-net");
  }
  arguments_.push(
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
  );
  if (input.mode === "prober" && existsSync("/dev/shm")) {
    arguments_.push("--ro-bind", input.emptyDirectory, "/dev/shm");
  }
  // `--ro-bind / /` above hands the shell the whole host, and a home directory
  // is where every other tool on the machine keeps its credentials: a token
  // for the forge, a session file, another agent's key. Masking them one path
  // at a time only ever hides the ones somebody remembered. Replace the home
  // directory with an empty filesystem and mount back the few paths a shell
  // needs to run, so an unlisted credential file is absent by construction
  // rather than by recall.
  arguments_.push("--tmpfs", input.home);
  for (const path of homeAllowances(input.home)) {
    if (existsSync(path)) {
      arguments_.push("--ro-bind", path, path);
    }
  }
  // The checkout usually lives under the home directory the tmpfs just
  // covered, and every mode has to be able to read the code it works on.
  // Read-only here is the floor; the writing mode raises it below.
  for (const path of [
    input.worktree,
    ...(input.project === undefined ? [] : [resolve(input.project)]),
  ]) {
    if (existsSync(path)) {
      arguments_.push("--ro-bind", path, path);
    }
  }
  if (input.mode === "agent") {
    for (const path of [
      input.stateDirectory,
      join(input.home, ".npm"),
      input.worktree,
      ...(input.project === undefined ? [] : [join(resolve(input.project), ".git")]),
    ]) {
      if (existsSync(path)) {
        arguments_.push("--bind", path, path);
      }
    }
    // The worktree bind above makes the checkout writable, which would include
    // the files that define this sandbox. A shell that can rewrite its own
    // mount plan is not a boundary: the weakened definition loads on the next
    // run. Re-bind those paths read-only on top of the writable checkout.
    for (const path of sandboxDefinitionPaths(input.worktree, input.project)) {
      if (existsSync(path)) {
        arguments_.push("--ro-bind", path, path);
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
  const mode = declaresNoWrites(context.agent, context.worktree, environment.ECOSYM_PROJECT)
    ? "prober"
    : "agent";
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

function declaresNoWrites(
  agent: string,
  worktree: string,
  project: string | undefined,
): boolean {
  if (!/^[A-Za-z0-9._-]+$/u.test(agent)) {
    return true;
  }
  for (const root of [worktree, ...(project === undefined ? [] : [resolve(project)])]) {
    const definition = join(root, ".opencode", "agent", `${agent}.md`);
    if (!existsSync(definition)) {
      continue;
    }
    const frontmatter = readFileSync(definition, "utf8").split(/^---\s*$/mu)[1] ?? "";
    return /^\s*write:\s*false\s*$/mu.test(frontmatter);
  }
  return false;
}

function homeAllowances(home: string): string[] {
  // Everything a shell needs from a home directory in order to run: the
  // toolchain it executes, the caches those tools read, and the git and
  // opencode configuration that tells them how this project works. No
  // credential store belongs on this list. `.local/share/opencode` and
  // `.local/state/opencode` are deliberately absent — they hold opencode's own
  // auth tokens, and the tmpfs now keeps them out without a special case.
  return [
    join(home, ".cache", "node"),
    join(home, ".config", "git"),
    join(home, ".config", "opencode"),
    join(home, ".gitconfig"),
    join(home, ".local", "bin"),
    join(home, ".npmrc"),
    join(home, ".nvm"),
    join(home, ".opencode"),
  ];
}

function sandboxDefinitionPaths(worktree: string, project: string | undefined): string[] {
  const paths = new Set<string>();
  for (const root of [worktree, ...(project === undefined ? [] : [resolve(project)])]) {
    paths.add(join(root, ".opencode"));
    paths.add(join(root, "opencode.json"));
    for (const file of ["agent-shell.ts", "sandbox.ts", "sandbox-cli.ts", "sandbox-runtime.ts"]) {
      paths.add(join(root, "src", file));
    }
  }
  return [...paths].sort();
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
