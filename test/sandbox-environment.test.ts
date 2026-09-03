import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import { sandboxArguments } from "../src/sandbox-runtime.ts";

const bwrapPresent = existsSync("/usr/bin/bwrap");

function argumentsFor(environment: Record<string, string>): string[] {
  return sandboxArguments({
    childArguments: ["--version"],
    environment,
    executable: "/usr/bin/true",
    home: "/home/tester",
    project: undefined,
    readonlySourceDirectories: [],
    sourceDirectories: [],
    sourceMounts: [],
    stateDirectory: "/home/tester/.local/state/ecosym",
    stateMounts: [],
    worktree: "/home/tester/work",
  });
}

function settingsFor(arguments_: string[]): Map<string, string> {
  const settings = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    if (arguments_[index] === "--setenv") {
      const name = arguments_[index + 1];
      const value = arguments_[index + 2];
      if (name !== undefined && value !== undefined) {
        settings.set(name, value);
      }
    }
  }
  return settings;
}

test("the run boundary clears the environment it inherited", () => {
  const arguments_ = argumentsFor({
    ANTHROPIC_API_KEY: "sk-must-not-reach-the-run",
    GITHUB_TOKEN: "ghp-must-not-reach-the-run",
    PATH: "/usr/bin",
  });

  assert.ok(
    arguments_.includes("--clearenv"),
    "a run that inherits the launcher's environment reads every secret in it",
  );
});

test("only declared variables survive into the run", () => {
  const arguments_ = argumentsFor({
    ANTHROPIC_API_KEY: "sk-must-not-reach-the-run",
    DATABASE_URL: "postgres://must-not-reach-the-run",
    GITHUB_TOKEN: "ghp-must-not-reach-the-run",
    PATH: "/usr/bin",
    TERM: "xterm",
  });
  const settings = settingsFor(arguments_);

  assert.equal(settings.get("PATH"), "/usr/bin");
  assert.equal(settings.get("TERM"), "xterm");
  assert.equal(settings.get("HOME"), "/home/tester");

  for (const secret of ["ANTHROPIC_API_KEY", "DATABASE_URL", "GITHUB_TOKEN"]) {
    assert.equal(
      settings.get(secret),
      undefined,
      `${secret} was passed into the run and is readable there`,
    );
  }
});

test(
  "a real run cannot read a secret from the launcher's environment",
  { skip: !bwrapPresent },
  async () => {
    const { spawnSync } = await import("node:child_process");
    const arguments_ = sandboxArguments({
      childArguments: ["-c", 'test -z "${ECOSYM_TEST_SECRET+x}"'],
      environment: { PATH: process.env.PATH ?? "/usr/bin" },
      executable: "/usr/bin/bash",
      home: process.env.HOME ?? "/home/tester",
      project: undefined,
      readonlySourceDirectories: [],
      sourceDirectories: [],
      sourceMounts: [],
      stateDirectory: "/tmp/ecosym-clearenv-state",
      stateMounts: [],
      worktree: process.cwd(),
    });

    const result = spawnSync("/usr/bin/bwrap", arguments_, {
      encoding: "utf8",
      env: { ...process.env, ECOSYM_TEST_SECRET: "must-not-reach-the-run" },
    });

    assert.equal(
      result.status,
      0,
      `ECOSYM_TEST_SECRET reached the sandboxed run: ${result.stderr}`,
    );
  },
);
