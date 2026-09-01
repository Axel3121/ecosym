import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { executeAgentShellCommand } from "../src/agent-shell.ts";

const agentShell = fileURLToPath(new URL("../scripts/agent-shell", import.meta.url));

test(
  "prober shell cannot modify the worktree and can write to scratch",
  { skip: !existsSync("/usr/bin/bwrap") },
  () => {
    const worktree = mkdtempSync(join(process.cwd(), ".agent-shell-test-"));
    const tracked = join(worktree, "tracked.txt");
    const scratch = join(tmpdir(), `ecosym-prober-${process.pid}.txt`);
    writeFileSync(tracked, "original\n");
    try {
      const denied = runAgentShell(
        "prober",
        worktree,
        `printf changed > ${shellQuote(tracked)}`,
      );
      assert.equal(denied.status, 1);
      assert.match(denied.stderr, /Read-only file system/u);
      assert.equal(readFileSync(tracked, "utf8"), "original\n");

      const allowed = runAgentShell(
        "prober",
        worktree,
        `printf scratch > ${shellQuote(scratch)}`,
      );
      assert.equal(allowed.status, 0, allowed.stderr);
      assert.equal(readFileSync(scratch, "utf8"), "scratch");

      const hiddenRuntime = runAgentShell(
        "prober",
        worktree,
        'test ! -e "$HOME/.local/share/opencode/auth.json" && test -z "${TEST_SECRET_TOKEN+x}" && test -z "${DATABASE_URL+x}" && ! touch /dev/shm/ecosym-prober-write',
      );
      assert.equal(hiddenRuntime.status, 0, hiddenRuntime.stderr);
    } finally {
      rmSync(scratch, { force: true });
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

test(
  "prober shell rejects a worktree beneath writable scratch",
  { skip: !existsSync("/usr/bin/bwrap") },
  () => {
    const worktree = mkdtempSync(join(tmpdir(), "ecosym-prober-worktree-"));
    try {
      const result = runAgentShell("prober", worktree, "true");
      assert.equal(result.status, 1);
      assert.match(result.stderr, /must not be inside writable scratch/u);
    } finally {
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

test(
  "OpenCode shell dispatcher selects the prober boundary and clears undeclared environment",
  { skip: !existsSync("/usr/bin/bwrap") },
  async () => {
    const worktree = process.cwd();
    const fixture = mkdtempSync(join(worktree, ".ecosym-prober-tool-"));
    const trackedPath = join(fixture, "evidence.txt");
    const errorPath = join(tmpdir(), `ecosym-prober-tool-error-${process.pid}`);
    const scratchPath = join(tmpdir(), `ecosym-prober-tool-scratch-${process.pid}`);
    writeFileSync(trackedPath, "original\n");
    const controller = new AbortController();
    try {
      const output = await executeAgentShellCommand(
        {
          command:
            `printf changed 2>${shellQuote(errorPath)} > ${shellQuote(trackedPath)}; ` +
            'printf "write_status=%s env_status=%s\\n" "$?" "$(test -z "${DATABASE_URL+x}"; printf %s "$?")"; ' +
            `cat ${shellQuote(errorPath)}; printf scratch > ${shellQuote(scratchPath)}; cat ${shellQuote(scratchPath)}`,
        },
        {
          abort: controller.signal,
          agent: "prober",
          directory: worktree,
          worktree,
        },
        {
          ...process.env,
          DATABASE_URL: "postgres://synthetic-secret.invalid/database",
        },
      );
      assert.match(output, /write_status=1 env_status=0/u);
      assert.match(output, /Read-only file system/u);
      assert.match(output, /scratch/u);
      assert.match(output, /exit code: 0/u);
      assert.equal(readFileSync(trackedPath, "utf8"), "original\n");
    } finally {
      controller.abort();
      rmSync(errorPath, { force: true });
      rmSync(fixture, { force: true, recursive: true });
      rmSync(scratchPath, { force: true });
    }
  },
);

test(
  "ordinary agent shell retains its worktree write boundary",
  { skip: !existsSync("/usr/bin/bwrap") },
  () => {
    const worktree = mkdtempSync(join(process.cwd(), ".agent-shell-test-"));
    const tracked = join(worktree, "tracked.txt");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(tracked, "original\n");
    try {
      const result = runAgentShell("agent", worktree, `printf changed > ${shellQuote(tracked)}`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(tracked, "utf8"), "changed");
    } finally {
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

test(
  "an agent shell cannot rewrite the files that define its own sandbox",
  { skip: !existsSync("/usr/bin/bwrap") },
  () => {
    const worktree = mkdtempSync(join(process.cwd(), ".agent-shell-test-"));
    mkdirSync(join(worktree, ".opencode", "tools"), { recursive: true });
    mkdirSync(join(worktree, "src"), { recursive: true });
    const definitions = [
      join(worktree, ".opencode", "tools", "bash.ts"),
      join(worktree, "src", "agent-shell.ts"),
      join(worktree, "src", "sandbox-runtime.ts"),
      join(worktree, "opencode.json"),
    ];
    for (const path of definitions) {
      writeFileSync(path, "original\n");
    }
    try {
      for (const path of definitions) {
        const result = runAgentShell("agent", worktree, `printf weakened > ${shellQuote(path)}`);
        assert.notEqual(result.status, 0, `expected a refusal for ${path}`);
        assert.equal(
          readFileSync(path, "utf8"),
          "original\n",
          `${path} must survive the shell that it governs`,
        );
      }
    } finally {
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

test(
  "an agent that declares no writes gets the read-only boundary",
  { skip: !existsSync("/usr/bin/bwrap") },
  async () => {
    const worktree = mkdtempSync(join(process.cwd(), ".agent-shell-test-"));
    mkdirSync(join(worktree, ".opencode", "agent"), { recursive: true });
    for (const [name, write] of [
      ["reader", "false"],
      ["writer", "true"],
    ]) {
      writeFileSync(
        join(worktree, ".opencode", "agent", `${name}.md`),
        `---\nmode: subagent\ntools:\n  write: ${write}\n---\nrole\n`,
      );
    }
    const tracked = join(worktree, "tracked.txt");
    try {
      for (const [agent, expectWrite] of [
        ["reader", false],
        ["writer", true],
      ] as [string, boolean][]) {
        writeFileSync(tracked, "original\n");
        await executeAgentShellCommand(
          { command: `printf changed > ${shellQuote(tracked)}` },
          {
            abort: new AbortController().signal,
            agent,
            directory: worktree,
            worktree,
          },
          { HOME: process.env.HOME, PATH: process.env.PATH } as NodeJS.ProcessEnv,
        );
        assert.equal(
          readFileSync(tracked, "utf8") === "changed",
          expectWrite,
          `${agent} declares write: ${String(expectWrite)} and the shell must match it`,
        );
      }
    } finally {
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

test(
  "a shell cannot read another tool's credentials from the home directory",
  { skip: !existsSync("/usr/bin/bwrap") },
  () => {
    const home = mkdtempSync(join(tmpdir(), "ecosym-home-"));
    const worktree = mkdtempSync(join(process.cwd(), ".agent-shell-test-"));
    // Named the way real credential stores on a developer machine are named:
    // a forge token, another agent's session, a third tool's secret file.
    const secrets = [
      join(home, ".config", "gh", "hosts.yml"),
      join(home, ".claude.json"),
      join(home, ".config", "Hermes", "secure-token-storage.json"),
      join(home, ".local", "share", "opencode", "auth.json"),
    ];
    for (const path of secrets) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "token: must-not-be-readable\n");
    }
    try {
      for (const mode of ["agent", "prober"] as const) {
        const result = runAgentShell(
          mode,
          worktree,
          secrets.map((path) => `cat ${shellQuote(path)} 2>/dev/null`).join("; ") + "; true",
          { HOME: home },
        );
        assert.equal(result.status, 0, result.stderr);
        assert.doesNotMatch(
          result.stdout,
          /must-not-be-readable/u,
          `${mode} mode read a credential file out of the home directory`,
        );
      }
    } finally {
      rmSync(home, { force: true, recursive: true });
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

test(
  "a read-only shell has no route to the network",
  { skip: !existsSync("/usr/bin/bwrap") },
  () => {
    const worktree = mkdtempSync(join(process.cwd(), ".agent-shell-test-"));
    try {
      // A route, not a reachable host: this asserts the network namespace is
      // unshared, so it holds on a machine that is offline anyway.
      const denied = runAgentShell("prober", worktree, "ip -o link show | grep -cv ' lo:'");
      assert.equal(denied.stdout.trim(), "0", "prober mode kept a network interface");

      const permitted = runAgentShell("agent", worktree, "ip -o link show | grep -cv ' lo:'");
      assert.notEqual(
        permitted.stdout.trim(),
        "0",
        "the writing agent still needs the network it uses to fetch and push",
      );
    } finally {
      rmSync(worktree, { force: true, recursive: true });
    }
  },
);

function runAgentShell(
  mode: "agent" | "prober",
  worktree: string,
  command: string,
  overrides: NodeJS.ProcessEnv = {},
): SpawnSyncReturns<string> {
  return spawnSync(
    agentShell,
    [
      "--mode",
      mode,
      "--worktree",
      worktree,
      "--workdir",
      worktree,
      "--",
      "/bin/bash",
      "-c",
      command,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgres://synthetic-secret.invalid/database",
        TEST_SECRET_TOKEN: "must-not-reach-shell",
        ...overrides,
      },
    },
  );
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
