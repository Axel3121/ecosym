import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
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
const runLedger = fileURLToPath(new URL("../scripts/run-ledger", import.meta.url));

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

test("a launch is registered in the ledger, and a failing ledger does not fail the run", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-ledger-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  chmodSync(join(scripts, "run-task"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), "# Test task\n");
  writeFileSync(join(bin, "systemd-run"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

  const environment = {
    ...process.env,
    ECOSYM_PORT: "3212",
    ECOSYM_PROJECT: "",
    ECOSYM_WORKTREE: "",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    XDG_DATA_HOME: dataHome,
  };

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

    // A launch nobody recorded is a run nobody will account for, so the
    // ledger write is part of launching rather than an afterthought.
    copyFileSync(runLedger, join(scripts, "run-ledger"));
    chmodSync(join(scripts, "run-ledger"), 0o700);
    const recorded = spawnSync(join(scripts, "run-task"), ["example"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(recorded.status, 0, recorded.stderr);

    const ledger = join(dataHome, "ecosym", "ledger.jsonl");
    const records = readFileSync(ledger, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records.length, 1);
    const started = records[0];
    assert.ok(started !== undefined);
    assert.equal(started.event, "started");
    assert.equal(started.task, "example");
    // The commit a run starts from is its base. Recording it as the run's
    // result would let every run that started on main read as landed.
    assert.ok(typeof started.base_commit === "string");
    assert.equal(started.result_commit, undefined);

    // The run is already live by the time the ledger is written. A ledger
    // that cannot be written must be reported, never allowed to kill it.
    rmSync(ledger);
    writeFileSync(join(scripts, "run-ledger"), "#!/bin/sh\nexit 1\n", { mode: 0o700 });
    const unrecorded = spawnSync(join(scripts, "run-task"), ["example"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(unrecorded.status, 0, unrecorded.stderr);
    assert.match(unrecorded.stderr, /the ledger did not record it/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a recorded result outranks the branch it was made on", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-ledger-state-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const dataHome = join(directory, "data");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    writeFileSync(join(repository, "file.txt"), "one\n");
    git(repository, ["add", "."]);
    commit(repository, "landed work");
    const landed = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    // The branch a run merged from keeps living and takes on later work.
    // That says nothing about whether this run's own commit reached main.
    git(repository, ["branch", "task/live", "main"]);
    git(repository, ["checkout", "task/live"]);
    writeFileSync(join(repository, "file.txt"), "two\n");
    git(repository, ["add", "."]);
    commit(repository, "unrelated later work");
    const later = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    git(repository, ["checkout", "main"]);

    ledger(["start", "landed-run", "unit-landed", "--branch", "task/live", "--commit", landed]);
    ledger([
      "close",
      "unit-landed",
      "--outcome",
      "landed",
      "--commit",
      landed,
      "--evidence",
      "merged",
    ]);

    const truthful = ledger(["list"]);
    assert.match(truthful.stdout, /in-main/);
    assert.doesNotMatch(truthful.stdout, /!!/);
    assert.equal(truthful.status, 0, "a run whose commit is in main is not disputed");

    // The inverse: a merged-looking branch must not vouch for a result
    // commit that never reached main.
    git(repository, ["branch", "task/merged", "main"]);
    ledger(["start", "false-run", "unit-false", "--branch", "task/merged", "--commit", landed]);
    ledger([
      "close",
      "unit-false",
      "--outcome",
      "landed",
      "--commit",
      later,
      "--evidence",
      "PR #99",
    ]);

    const disputed = ledger(["list"]);
    assert.match(disputed.stdout, /unmerged/);
    assert.match(disputed.stdout, /!!/);
    assert.equal(disputed.status, 1, "a landed claim Git denies must fail the command");

    // A branch merged and left undeleted carries no commit of its own, and
    // neither does a branch nobody committed to. Ambiguous evidence must
    // never be spent contradicting a close-out.
    git(repository, ["branch", "task/kept", "main"]);
    ledger(["start", "kept-run", "unit-kept", "--branch", "task/kept"]);
    ledger(["close", "unit-kept", "--outcome", "landed", "--evidence", "merged, see PR"]);

    const ambiguous = ledger(["list"]);
    const keptRow = ambiguous.stdout
      .split("\n")
      .find((line) => line.startsWith("unit-kept"));
    assert.ok(keptRow !== undefined, ambiguous.stdout);
    assert.match(keptRow, /unproven/);
    assert.doesNotMatch(keptRow, /!!/);

    // A commit that was named but that Git cannot find is a broken claim,
    // not a missing one — it must not borrow a living branch's standing.
    git(repository, ["branch", "task/alive", "main"]);
    git(repository, ["checkout", "task/alive"]);
    writeFileSync(join(repository, "file.txt"), "three\n");
    git(repository, ["add", "."]);
    commit(repository, "work on a living branch");
    git(repository, ["checkout", "main"]);

    ledger(["start", "typo-run", "unit-typo", "--branch", "task/alive"]);
    ledger([
      "close",
      "unit-typo",
      "--outcome",
      "landed",
      "--commit",
      "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "--evidence",
      "PR #7",
    ]);

    const typo = ledger(["list"]);
    const typoRow = typo.stdout.split("\n").find((line) => line.startsWith("unit-typo"));
    assert.ok(typoRow !== undefined, typo.stdout);
    assert.match(typoRow, /no-such-commit/);
    assert.match(typoRow, /!!/);
    assert.equal(typo.status, 1, "an unresolvable result commit must fail the command");

    // Git failing to answer is not the same as Git answering no. Without a
    // local main, `merge-base --is-ancestor` exits 128, and reading that as
    // "not an ancestor" would accuse a run that landed.
    const noMain = mkdtempSync(join(tmpdir(), "ecosym-run-ledger-nomain-"));
    const elsewhere = join(noMain, "repository");
    mkdirSync(join(elsewhere, "scripts"), { recursive: true });
    copyFileSync(runLedger, join(elsewhere, "scripts", "run-ledger"));
    chmodSync(join(elsewhere, "scripts", "run-ledger"), 0o700);
    try {
      git(elsewhere, ["init", "-b", "trunk"]);
      writeFileSync(join(elsewhere, "file.txt"), "only\n");
      git(elsewhere, ["add", "."]);
      commit(elsewhere, "the one commit");
      const only = spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: elsewhere,
        encoding: "utf8",
      }).stdout.trim();

      const away = (arguments_: string[]) =>
        spawnSync(join(elsewhere, "scripts", "run-ledger"), arguments_, {
          cwd: elsewhere,
          encoding: "utf8",
          env: { ...process.env, XDG_DATA_HOME: join(noMain, "data") },
        });

      away(["start", "away-run", "unit-away"]);
      away(["close", "unit-away", "--outcome", "landed", "--commit", only, "--evidence", "merged"]);

      const unanswerable = away(["list"]);
      assert.match(unanswerable.stdout, /unproven/);
      assert.doesNotMatch(unanswerable.stdout, /!!/);
      assert.equal(unanswerable.status, 0, "Git failing to answer must not dispute a claim");
    } finally {
      rmSync(noMain, { recursive: true, force: true });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function commit(repository: string, message: string): void {
  git(repository, [
    "-c",
    "user.name=Ecosym Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "-m",
    message,
  ]);
}

test("a ledger line that is not a record does not take the whole ledger with it", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-ledger-junk-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const dataHome = join(directory, "data");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    writeFileSync(join(repository, "file.txt"), "one\n");
    git(repository, ["add", "."]);
    commit(repository, "first");
    assert.equal(ledger(["start", "demo", "unit-real"]).status, 0);

    // JSON without an object: a truncated write, a stray line, a hand edit.
    // The ledger is append-only and read by every command, so one such line
    // must cost its own record and nothing else.
    const path = join(dataHome, "ecosym", "ledger.jsonl");
    for (const junk of ["123", '"note"', "[]", "null"]) {
      appendFileSync(path, `${junk}\n`);
    }

    const listed = ledger(["list"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /unit-real/u, listed.stdout);
    assert.match(listed.stderr, /not a record/u, listed.stderr);

    // The surviving record still accepts a close-out.
    const closed = ledger(["close", "unit-real", "--outcome", "dropped"]);
    assert.equal(closed.status, 0, closed.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a task name that escapes the specification directory is refused", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-name-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  copyFileSync(runTask, join(scripts, "run-task"));
  chmodSync(join(scripts, "run-task"), 0o700);
  // A real specification outside docs/tasks that a traversal could reach.
  writeFileSync(join(repository, "PRODUCT.md"), "# Not a task contract\n");

  // The agent follows its specification as instructions, so selecting one
  // outside docs/tasks would turn an unrelated document into a contract.
  for (const name of ["../../PRODUCT", "../PRODUCT", ".hidden", "a/b"]) {
    const refused = spawnSync(join(scripts, "run-task"), [name], {
      encoding: "utf8",
    });
    assert.equal(refused.status, 2, `expected ${name} to be refused`);
    assert.match(refused.stderr, /task name must be a plain identifier/);
  }
  rmSync(directory, { force: true, recursive: true });
});
