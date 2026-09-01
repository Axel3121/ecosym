import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const runTask = fileURLToPath(new URL("../scripts/run-task", import.meta.url));

test("run-task launches the tracked sandbox with main and linked-worktree authority paths", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-launch-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  const capture = join(directory, "systemd-arguments");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  chmodSync(join(scripts, "run-task"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), "# Test task\n");
  writeFileSync(
    join(bin, "systemd-run"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$SYSTEMD_CAPTURE"\n',
    { mode: 0o700 },
  );

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    git(repository, [
      "-c",
      "user.name=Ecosym Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);

    const result = spawnSync(join(scripts, "run-task"), ["example"], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        ECOSYM_PORT: "3210",
        ECOSYM_PROJECT: "",
        ECOSYM_WORKTREE: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SYSTEMD_CAPTURE: capture,
        XDG_DATA_HOME: dataHome,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const arguments_ = readFileSync(capture, "utf8").split("\n");
    assert.ok(arguments_.includes(`--working-directory=${repository}`));
    assert.ok(arguments_.includes(`--setenv=ECOSYM_PROJECT=${repository}`));
    assert.ok(arguments_.includes(join(repository, "scripts", "ecosym-sandbox")));
    assert.ok(!arguments_.some((argument) => argument.startsWith("--setenv=ECOSYM_WORKTREE=")));

    const linkedWorktree = join(directory, "linked-worktree");
    git(repository, ["branch", "task/linked"]);
    git(repository, ["worktree", "add", linkedWorktree, "task/linked"]);
    const linkedResult = spawnSync(join(linkedWorktree, "scripts", "run-task"), ["example"], {
      cwd: linkedWorktree,
      encoding: "utf8",
      env: {
        ...process.env,
        ECOSYM_PORT: "3211",
        ECOSYM_PROJECT: "",
        ECOSYM_WORKTREE: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SYSTEMD_CAPTURE: capture,
        XDG_DATA_HOME: dataHome,
      },
    });
    assert.equal(linkedResult.status, 0, linkedResult.stderr);
    const linkedArguments = readFileSync(capture, "utf8").split("\n");
    assert.ok(linkedArguments.includes(`--working-directory=${linkedWorktree}`));
    assert.ok(linkedArguments.includes(`--setenv=ECOSYM_PROJECT=${repository}`));
    assert.ok(linkedArguments.includes(`--setenv=ECOSYM_WORKTREE=${linkedWorktree}`));
    assert.ok(linkedArguments.includes(join(linkedWorktree, "scripts", "ecosym-sandbox")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run-task refuses to reuse a worktree on another branch", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const worktree = join(dataHome, "ecosym", "worktrees", "example");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  chmodSync(join(scripts, "run-task"), 0o700);
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), "# Test task\n");
  writeFileSync(join(bin, "systemd-run"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    git(repository, [
      "-c",
      "user.name=Ecosym Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-m",
      "fixture",
    ]);
    git(repository, ["branch", "task/first"]);
    git(repository, ["branch", "task/second"]);
    mkdirSync(join(dataHome, "ecosym", "worktrees"), { recursive: true });
    git(repository, ["worktree", "add", worktree, "task/first"]);

    const result = spawnSync(
      join(scripts, "run-task"),
      ["example", "--worktree", "--branch", "task/second"],
      {
        cwd: repository,
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          XDG_DATA_HOME: dataHome,
        },
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /holds branch task\/first/);
    assert.match(result.stderr, /requested branch task\/second/);
    assert.doesNotMatch(result.stdout, /branch task\/second/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(repository: string, arguments_: string[]): void {
  const result = spawnSync("git", arguments_, {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
}
