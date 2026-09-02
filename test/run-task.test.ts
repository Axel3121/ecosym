import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const runTask = fileURLToPath(new URL("../scripts/run-task", import.meta.url));
const runLedger = fileURLToPath(new URL("../scripts/run-ledger", import.meta.url));

test("run-task launches the tracked sandbox only from its managed worktree", () => {
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
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), taskSpec("example", ["src/example.ts"]));
  writeFileSync(
    join(bin, "systemd-run"),
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$SYSTEMD_CAPTURE"\n',
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
    const mainHead = spawnSync("git", ["rev-parse", "main"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    const callerWorktree = join(directory, "caller-worktree");
    git(repository, ["branch", "task/caller"]);
    git(repository, ["worktree", "add", callerWorktree, "task/caller"]);
    writeFileSync(join(callerWorktree, "caller-only.txt"), "not a task base\n");
    git(callerWorktree, ["add", "."]);
    commit(callerWorktree, "caller-only work");

    const result = spawnSync(join(callerWorktree, "scripts", "run-task"), ["example"], {
      cwd: callerWorktree,
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
    const managedWorktree = join(dataHome, "ecosym", "worktrees", "example");
    assert.ok(arguments_.includes(`--working-directory=${managedWorktree}`));
    assert.ok(!arguments_.includes(`--working-directory=${repository}`));
    assert.ok(!arguments_.includes(`--working-directory=${callerWorktree}`));
    assert.ok(arguments_.includes(`--setenv=ECOSYM_PROJECT=${repository}`));
    assert.ok(arguments_.includes(`--setenv=ECOSYM_WORKTREE=${managedWorktree}`));
    assert.ok(arguments_.includes(join(callerWorktree, "scripts", "ecosym-sandbox")));
    assert.equal(
      spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: managedWorktree,
        encoding: "utf8",
      }).stdout.trim(),
      mainHead,
      "a new task branch starts from main, not from the invoking task worktree",
    );

    // A run that stops working holds its unit open, so nothing notices unless
    // something is watching. Launching without that watcher is the failure
    // this asserts against: it is invisible until a run hangs for hours.
    assert.ok(
      arguments_.includes(join(callerWorktree, "scripts", "run-watchdog")),
      "a launch must start a watchdog for its own unit",
    );
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
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), taskSpec("example", ["src/example.ts"]));
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

function taskSpec(task: string, touches: string[], needs: string[] = []): string {
  const list = (name: string, values: string[]) =>
    values.length === 0 ? `${name}: []` : `${name}:\n${values.map((value) => `  - ${value}`).join("\n")}`;
  return `---\n${list("needs", needs)}\n${list("touches", [...touches, `docs/tasks/${task}.md`])}\n---\n# Test task\n`;
}

test("a launch is registered with its territory, and registration failure stops it", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-ledger-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  const systemctlCapture = join(directory, "systemctl-arguments");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  chmodSync(join(scripts, "run-task"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), taskSpec("example", ["src/example.ts"]));
  writeFileSync(join(tasks, "unrecorded.md"), taskSpec("unrecorded", ["src/other.ts"]));
  writeFileSync(join(tasks, "unstoppable.md"), taskSpec("unstoppable", ["src/third.ts"]));
  writeFileSync(join(bin, "systemd-run"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$SYSTEMCTL_CAPTURE"\nif [ "$2" = "is-active" ]; then echo "${SYSTEMCTL_STATE:-inactive}"; [ "${SYSTEMCTL_STATE:-inactive}" != active ]; exit; fi\nif [ "$2" = "stop" ] && [ "${SYSTEMCTL_STATE:-inactive}" = active ]; then exit 1; fi\nexit 0\n',
    { mode: 0o700 },
  );

  const environment = {
    ...process.env,
    ECOSYM_PORT: "3212",
    ECOSYM_PROJECT: "",
    ECOSYM_WORKTREE: "",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SYSTEMCTL_CAPTURE: systemctlCapture,
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
    assert.deepEqual(started.touches, ["src/example.ts", "docs/tasks/example.md"]);

    // A live run without a recorded declaration would leave the next launcher
    // unable to prove disjointness. Let the preflight check work, then make the
    // registration itself fail: the newly started unit must be stopped.
    copyFileSync(join(scripts, "run-ledger"), join(scripts, "run-ledger-real"));
    writeFileSync(
      join(scripts, "run-ledger"),
      '#!/bin/sh\ncase "$1" in can-start|declaration) exec "$(dirname "$0")/run-ledger-real" "$@";; esac\nexit 1\n',
      { mode: 0o700 },
    );
    const unrecorded = spawnSync(join(scripts, "run-task"), ["unrecorded"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(unrecorded.status, 1);
    assert.match(unrecorded.stderr, /run stopped because the ledger did not record its territory/);
    assert.match(readFileSync(systemctlCapture, "utf8"), /^stop$/mu);
    assert.equal(
      readFileSync(ledger, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "").length,
      1,
    );

    const unstoppable = spawnSync(join(scripts, "run-task"), ["unstoppable"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...environment, SYSTEMCTL_STATE: "active" },
    });
    assert.equal(unstoppable.status, 1);
    assert.match(unstoppable.stderr, /remains active without a ledger record/u);
    assert.doesNotMatch(unstoppable.stderr, /run stopped because/u);
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
  const declaration = JSON.stringify({
    autonomous: true,
    needs: [],
    touches: ["file.txt", "docs/tasks/"],
  });

  try {
    git(repository, ["init", "-b", "main"]);
    writeFileSync(join(repository, "file.txt"), "one\n");
    git(repository, ["add", "."]);
    commit(repository, "landed work");
    // A setup step that fails leaves the run OPEN with nothing recorded,
    // which reads as `unproven` — the same answer some of these
    // assertions expect. Unchecked setup can pass without testing anything.
    const record = (a: string[]) => {
      const r = ledger(a);
      assert.equal(r.status, 0, `${a.join(" ")}: ${r.stderr}`);
      return r;
    };
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

    record([
      "start",
      "landed-run",
      "unit-landed",
      "--branch",
      "task/live",
      "--worktree",
      repository,
      "--commit",
      landed,
      "--declaration",
      declaration,
    ]);
    record([
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
    record([
      "start",
      "false-run",
      "unit-false",
      "--branch",
      "task/merged",
      "--worktree",
      repository,
      "--commit",
      landed,
      "--declaration",
      declaration,
    ]);
    git(repository, ["checkout", "task/live"]);
    record([
      "close",
      "unit-false",
      "--outcome",
      "landed",
      "--commit",
      later,
      "--evidence",
      "PR #99",
    ]);
    git(repository, ["checkout", "main"]);

    const disputed = ledger(["list"]);
    assert.match(disputed.stdout, /unmerged/);
    assert.match(disputed.stdout, /!!/);
    assert.equal(disputed.status, 1, "a landed claim Git denies must fail the command");

    // A branch merged and left undeleted carries no commit of its own, and
    // neither does a branch nobody committed to. Ambiguous evidence must
    // never be spent contradicting a close-out.
    git(repository, ["branch", "task/kept", "main"]);
    record([
      "start",
      "kept-run",
      "unit-kept",
      "--branch",
      "task/kept",
      "--worktree",
      repository,
      "--commit",
      landed,
      "--declaration",
      declaration,
    ]);
    record(["close", "unit-kept", "--outcome", "landed", "--evidence", "merged, see PR"]);

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

    record(["start", "typo-run", "unit-typo", "--branch", "task/alive"]);
    appendFileSync(
      join(dataHome, "ecosym", "ledger.jsonl"),
      `${JSON.stringify({
        branch: "task/alive",
        event: "closed",
        evidence: "PR #7",
        outcome: "landed",
        result_commit: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        task: "typo-run",
        unit: "unit-typo",
      })}\n`,
    );

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

      away([
        "start",
        "away-run",
        "unit-away",
        "--worktree",
        elsewhere,
        "--commit",
        only,
        "--declaration",
        declaration,
      ]);
      const stored = away([
        "close",
        "unit-away",
        "--outcome",
        "landed",
        "--commit",
        only,
        "--evidence",
        "merged",
      ]);
      assert.equal(stored.status, 0, stored.stderr);

      const unanswerable = away(["list"]);
      assert.match(unanswerable.stdout, /unproven/);
      assert.doesNotMatch(unanswerable.stdout, /!!/);
      assert.equal(unanswerable.status, 0, "Git failing to answer must not dispute a claim");

      // A branch that exists only on the remote cannot be counted from a
      // local checkout. Git declining to answer must not become evidence
      // that the branch carries work — nor that it merged.
      git(elsewhere, ["update-ref", "refs/remotes/origin/task/remote-only", "HEAD"]);
      away(["start", "remote-run", "unit-remote", "--branch", "task/remote-only"]);

      const remoteOnly = away(["list"]);
      const remoteRow = remoteOnly.stdout
        .split("\n")
        .find((line) => line.startsWith("unit-remote"));
      assert.ok(remoteRow !== undefined, remoteOnly.stdout);
      assert.match(remoteRow, /unproven/);
      assert.doesNotMatch(remoteRow, /merged|open/);
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

test("a collided unit name keeps its task and its timestamp", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-ledger-collide-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const dataHome = join(directory, "data");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(join(dataHome, "ecosym", "runs"), { recursive: true });
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);

  try {
    git(repository, ["init", "-b", "main"]);
    writeFileSync(join(repository, "file.txt"), "one\n");
    git(repository, ["add", "."]);
    commit(repository, "first");

    // run-task appends a 'b' per collision. The ledger has to read those
    // names back, or the second run of a colliding pair loses its task and
    // its time and reads as an unparseable stranger.
    const collided = "ecosym-task-twins-1788000000b";
    writeFileSync(join(dataHome, "ecosym", "runs", `${collided}.log`), "");

    const listed = spawnSync(join(scripts, "run-ledger"), ["list"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /^twins\b/mu);
    assert.doesNotMatch(listed.stdout, /ecosym-task-twins/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a closed landed run is not hidden as RUNNING while its unit lingers", () => {
  // A run's systemd unit can stay "active" for a while after `close` runs —
  // the process is finishing up, or nothing has stopped it yet. Before the
  // fix, `unit_active` was checked ahead of the closed-event branch, so a
  // landed run whose unit was still active displayed as RUNNING instead of
  // `landed`, and `disputed` — which only fires on the `landed` state — never
  // got a chance to look at the (wrong) result commit. `list` exited 0 on a
  // false claim it never actually examined.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-ledger-running-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);

  // A fake systemctl that always reports the unit active, standing in for a
  // real run whose transient unit has not yet been reaped by systemd.
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/sh\nif [ "$1" = "--user" ] && [ "$2" = "is-active" ]; then echo active; exit 0; fi\nexit 1\n',
    { mode: 0o700 },
  );

  const environment = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    XDG_DATA_HOME: dataHome,
  };
  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });

  try {
    git(repository, ["init", "-b", "main"]);
    writeFileSync(join(repository, "file.txt"), "one\n");
    git(repository, ["add", "."]);
    commit(repository, "first");
    const base = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    git(repository, ["checkout", "-b", "task/demo"]);
    writeFileSync(join(repository, "file.txt"), "two\n");
    git(repository, ["add", "."]);
    commit(repository, "unmerged result");
    const resultCommit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    assert.equal(
      ledger([
        "start",
        "demo",
        "unit-still-active",
        "--branch",
        "task/demo",
        "--worktree",
        repository,
        "--commit",
        base,
        "--declaration",
        JSON.stringify({
          autonomous: true,
          needs: [],
          touches: ["file.txt", "docs/tasks/demo.md"],
        }),
      ]).status,
      0,
    );
    // A valid result commit that has not reached main is an unambiguous false
    // landed claim, regardless of what state the ledger displays it under.
    assert.equal(
      ledger([
        "close",
        "unit-still-active",
        "--outcome",
        "landed",
        "--commit",
        resultCommit,
        "--evidence",
        "merged",
      ]).status,
      0,
    );

    const listed = ledger(["list"]);
    assert.doesNotMatch(
      listed.stdout,
      /RUNNING/,
      "a closed run must report its outcome, not RUNNING, even while its unit lingers",
    );
    assert.match(listed.stdout, /landed/);
    assert.match(listed.stdout, /!!/, "the false claim must still be disputed");
    assert.equal(listed.status, 1, "list must fail on a landed claim outside main");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a Git failure while checking a result commit is unproven, not no-such-commit", () => {
  // resolves() distinguishes "Git confirmed the object is absent" (exit 1)
  // from "Git could not answer the question at all" (any other non-zero
  // code — 128 for a repository it can no longer read). Before the fix,
  // both were collapsed into a bare truthiness check on git()'s output,
  // which returns "" on ANY failure. A recorded commit could then be
  // reported as `no-such-commit` and disputed purely because Git itself
  // was broken, not because the claim was false.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-ledger-gitfail-"));
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
    const landed = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    assert.equal(
      ledger([
        "start",
        "demo",
        "unit-broken-git",
        "--worktree",
        repository,
        "--commit",
        landed,
        "--declaration",
        JSON.stringify({
          autonomous: true,
          needs: [],
          touches: ["file.txt", "docs/tasks/demo.md"],
        }),
      ]).status,
      0,
    );
    assert.equal(
      ledger([
        "close",
        "unit-broken-git",
        "--outcome",
        "landed",
        "--commit",
        landed,
        "--evidence",
        "merged",
      ]).status,
      0,
    );

    // Before corruption, the ledger can actually verify the commit.
    const before = ledger(["list"]);
    assert.match(before.stdout, /in-main/);
    assert.doesNotMatch(before.stdout, /!!/);
    assert.equal(before.status, 0);

    // Break Git itself (not the commit): every git invocation from here on
    // fails with exit 128, "not a git repository", the same way it does
    // with a missing local main or a broken clone.
    rmSync(join(repository, ".git", "HEAD"));

    const after = ledger(["list"]);
    assert.doesNotMatch(
      after.stdout,
      /no-such-commit/,
      "a Git failure must not be read as a confirmed-absent commit",
    );
    assert.match(after.stdout, /unproven/, "an unanswerable question must read as unproven");
    assert.doesNotMatch(after.stdout, /!!/);
    assert.equal(after.status, 0, "a Git failure must not dispute a claim it could not check");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a launch reserves its unit name instead of hanging when it cannot", () => {
  // Two launches racing on `[ -e log ]` then create is two steps, so both
  // can find the log missing; `mkdir` is the atomic step meant to fix that.
  // But the retry loop treated every mkdir failure as a same-second
  // collision (EEXIST) and retried by appending 'b' forever. When $RUNS is
  // unwritable for a real reason — permissions, a full disk — mkdir fails
  // for that reason on every attempt too, and the old loop spun forever
  // with no diagnostic instead of reporting the actual problem.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-mkdirfail-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), taskSpec("example", ["src/example.ts"]));
  writeFileSync(join(bin, "systemd-run"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    // Make $RUNS exist but unwritable, standing in for a permissions
    // problem or a full disk: every mkdir under it fails, and none of
    // those failures are EEXIST.
    const runs = join(dataHome, "ecosym", "runs");
    mkdirSync(runs, { recursive: true });
    chmodSync(runs, 0o500);

    try {
      const result = spawnSync(join(scripts, "run-task"), ["example"], {
        cwd: repository,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          ...process.env,
          ECOSYM_PORT: "3213",
          ECOSYM_PROJECT: "",
          ECOSYM_WORKTREE: "",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          XDG_DATA_HOME: dataHome,
        },
      });

      assert.notEqual(
        result.signal,
        "SIGTERM",
        "run-task must not hang when it cannot reserve a unit name",
      );
      assert.notEqual(result.status, 0, "an unwritable run directory must fail the launch");
      assert.match(result.stderr, /cannot reserve a unit name/);
    } finally {
      chmodSync(runs, 0o700);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the watchdog starts after the run's own unit exists, not before", () => {
  // run-watchdog's own loop is `while systemctl --user is-active --quiet
  // "$UNIT"`. If the watchdog's systemd-run call happens before the run's
  // systemd-run call, systemctl reports the run's unit inactive (or
  // not-found) on the watchdog's very first check, the while body — the
  // part that actually watches the log — never executes once, and the
  // watchdog process exits immediately having monitored nothing. The run's
  // own systemd-run call must come first, so the unit exists and is
  // reported active by the time the watchdog's systemd-run call is made.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-wdorder-"));
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
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), taskSpec("example", ["src/example.ts"]));
  // Marks each systemd-run invocation with a line naming which unit it
  // registers, in call order — that order is exactly what is under test.
  writeFileSync(
    join(bin, "systemd-run"),
    '#!/bin/sh\nfor a in "$@"; do case "$a" in --unit=*) echo "unit-call:${a#--unit=}" >> "$SYSTEMD_CAPTURE";; esac; done\nexit 0\n',
    { mode: 0o700 },
  );

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    const result = spawnSync(join(scripts, "run-task"), ["example"], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        ECOSYM_PORT: "3214",
        ECOSYM_PROJECT: "",
        ECOSYM_WORKTREE: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SYSTEMD_CAPTURE: capture,
        XDG_DATA_HOME: dataHome,
      },
    });
    assert.equal(result.status, 0, result.stderr);

    const calls = readFileSync(capture, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    const runIndex = calls.findIndex((line) => !line.includes("-watchdog"));
    const watchdogIndex = calls.findIndex((line) => line.includes("-watchdog"));
    assert.ok(runIndex !== -1, calls.join("\n"));
    assert.ok(watchdogIndex !== -1, calls.join("\n"));
    assert.ok(
      runIndex < watchdogIndex,
      `the run's own unit must be registered before its watchdog: ${calls.join(", ")}`,
    );
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

test("run-task refuses territory that omits the specification it copies", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-spec-territory-"));
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
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-watchdog"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(
    join(tasks, "example.md"),
    "---\nneeds: []\ntouches:\n  - src/example.ts\n---\n# Test task\n",
  );
  writeFileSync(
    join(bin, "systemd-run"),
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$SYSTEMD_CAPTURE"\n',
    { mode: 0o700 },
  );

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    const refused = spawnSync(join(scripts, "run-task"), ["example"], {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        ECOSYM_PORT: "3215",
        ECOSYM_PROJECT: "",
        ECOSYM_WORKTREE: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SYSTEMD_CAPTURE: capture,
        XDG_DATA_HOME: dataHome,
      },
    });

    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /touches.*docs\/tasks\/example\.md/u);
    assert.equal(existsSync(capture), false, "an invalid declaration never reaches systemd");
    assert.equal(existsSync(join(dataHome, "ecosym", "worktrees", "example")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run-ledger refuses to register a declaration that omits its task specification", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-start-spec-territory-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const dataHome = join(directory, "data");
  mkdirSync(scripts, { recursive: true });
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);

  try {
    const refused = spawnSync(
      join(scripts, "run-ledger"),
      [
        "start",
        "example",
        "unit-example",
        "--declaration",
        JSON.stringify({ autonomous: true, needs: [], touches: ["src/example.ts"] }),
      ],
      {
        cwd: repository,
        encoding: "utf8",
        env: { ...process.env, XDG_DATA_HOME: dataHome },
      },
    );
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /touches.*docs\/tasks\/example\.md/u);
    assert.equal(existsSync(join(dataHome, "ecosym", "ledger.jsonl")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a historical declaration that omits its task specification remains unknown", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-historical-territory-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(tasks, "candidate.md"), taskSpec("candidate", ["docs/tasks/old.md"]));
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/sh\nif [ "$3" = unit-old.service ]; then echo active; else echo inactive; fi\n',
    { mode: 0o700 },
  );

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        XDG_DATA_HOME: dataHome,
      },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    const ledgerFile = join(dataHome, "ecosym", "ledger.jsonl");
    mkdirSync(join(dataHome, "ecosym"), { recursive: true });
    writeFileSync(
      ledgerFile,
      `${JSON.stringify({
        autonomous: true,
        base_commit: head,
        event: "started",
        needs: [],
        task: "old",
        touches: ["src/old.ts"],
        unit: "unit-old",
        worktree: repository,
      })}\n`,
    );

    const candidate = ledger(["can-start", "candidate"]);
    assert.equal(candidate.status, 1);
    assert.match(candidate.stderr, /running task old.*no launch-time territory declaration/u);

    const close = ledger(["close", "unit-old", "--outcome", "landed", "--commit", head]);
    assert.equal(close.status, 1);
    assert.match(close.stderr, /no valid launch-time territory declaration/u);
    const records = readFileSync(ledgerFile, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records.at(-1)?.event, "territory-audit-failed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an unrecorded live declaration that omits its task specification remains unknown", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-unrecorded-territory-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const runs = join(dataHome, "ecosym", "runs");
  const bin = join(directory, "bin");
  const unit = "ecosym-task-old-123";
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(runs, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(tasks, "candidate.md"), taskSpec("candidate", ["docs/tasks/old.md"]));
  writeFileSync(join(runs, `${unit}.log`), "");
  writeFileSync(
    join(runs, `${unit}.declaration.json`),
    JSON.stringify({ autonomous: true, needs: [], touches: ["src/old.ts"] }),
  );
  writeFileSync(
    join(bin, "systemctl"),
    `#!/bin/sh\nif [ "$3" = ${unit}.service ]; then echo active; else echo inactive; fi\n`,
    { mode: 0o700 },
  );

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        XDG_DATA_HOME: dataHome,
      },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    const beforeBackfill = ledger(["can-start", "candidate"]);
    assert.equal(beforeBackfill.status, 1);
    assert.match(beforeBackfill.stderr, /running task old.*no launch-time territory declaration/u);

    const backfill = ledger(["backfill"]);
    assert.equal(backfill.status, 0, backfill.stderr);
    const afterBackfill = ledger(["can-start", "candidate"]);
    assert.equal(afterBackfill.status, 1);
    assert.match(afterBackfill.stderr, /running task old.*no launch-time territory declaration/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("backfill preserves a valid frozen declaration for an unrecorded live run", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-backfill-territory-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const runs = join(dataHome, "ecosym", "runs");
  const bin = join(directory, "bin");
  const unit = "ecosym-task-old-123";
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(runs, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(tasks, "conflict.md"), taskSpec("conflict", ["src/held.ts"]));
  writeFileSync(join(tasks, "free.md"), taskSpec("free", ["src/free.ts"]));
  writeFileSync(join(runs, `${unit}.log`), "");
  writeFileSync(
    join(runs, `${unit}.declaration.json`),
    JSON.stringify({
      autonomous: true,
      needs: [],
      touches: ["docs/tasks/old.md", "src/held.ts"],
    }),
  );
  writeFileSync(
    join(bin, "systemctl"),
    `#!/bin/sh\nif [ "$3" = ${unit}.service ]; then echo active; else echo inactive; fi\n`,
    { mode: 0o700 },
  );

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        XDG_DATA_HOME: dataHome,
      },
    });
  const assertPreciseTerritory = () => {
    const conflict = ledger(["can-start", "conflict"]);
    assert.equal(conflict.status, 1);
    assert.match(conflict.stderr, /territory conflicts with running task old/u);
    const free = ledger(["can-start", "free"]);
    assert.equal(free.status, 0, free.stderr);
  };

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    assertPreciseTerritory();
    const backfill = ledger(["backfill"]);
    assert.equal(backfill.status, 0, backfill.stderr);
    assertPreciseTerritory();

    const record = JSON.parse(
      readFileSync(join(dataHome, "ecosym", "ledger.jsonl"), "utf8").trim(),
    ) as Record<string, unknown>;
    assert.deepEqual(record.touches, ["docs/tasks/old.md", "src/held.ts"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a racing backfill cannot supersede a complete start or close record", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-backfill-race-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(bin, "systemctl"), "#!/bin/sh\necho inactive\n", { mode: 0o700 });

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        XDG_DATA_HOME: dataHome,
      },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    writeFileSync(join(repository, "result.txt"), "before\n");
    git(repository, ["add", "."]);
    commit(repository, "base");
    const base = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    writeFileSync(join(repository, "result.txt"), "after\n");
    git(repository, ["add", "."]);
    commit(repository, "result");
    const resultCommit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    const declaration = {
      autonomous: true,
      needs: [],
      touches: ["docs/tasks/example.md", "result.txt"],
    };

    const started = ledger([
      "start",
      "example",
      "unit-example",
      "--branch",
      "main",
      "--worktree",
      repository,
      "--commit",
      base,
      "--declaration",
      JSON.stringify(declaration),
    ]);
    assert.equal(started.status, 0, started.stderr);
    const ledgerFile = join(dataHome, "ecosym", "ledger.jsonl");
    const appendBackfill = () =>
      appendFileSync(
        ledgerFile,
        `${JSON.stringify({
          ...declaration,
          backfilled: true,
          base_commit: null,
          branch: null,
          event: "started",
          task: "example",
          unit: "unit-example",
          worktree: null,
        })}\n`,
      );

    // backfill took its known-unit snapshot first, then complete registration
    // won the append race before backfill wrote its weaker synthetic record.
    appendBackfill();
    const closed = ledger([
      "close",
      "unit-example",
      "--outcome",
      "landed",
      "--commit",
      resultCommit,
    ]);
    assert.equal(closed.status, 0, closed.stderr);

    // The same stale backfill append must not reopen an already closed run.
    appendBackfill();
    const listed = ledger(["list"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /example\s+landed\s+in-main/u);
    assert.doesNotMatch(listed.stdout, /\bOPEN\b/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ready derives landed needs and conflicts from frozen run declarations", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-ready-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const runningWorktree = join(directory, "running-worktree");
  const runningTasks = join(runningWorktree, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(runningTasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(tasks, "base.md"), taskSpec("base", ["src/base.ts"]));
  writeFileSync(join(tasks, "dependent.md"), taskSpec("dependent", ["src/dependent.ts"], ["base"]));
  writeFileSync(join(tasks, "stale.md"), taskSpec("stale", ["src/stale.ts"], ["base"]));
  writeFileSync(join(tasks, "free.md"), taskSpec("free", ["src/free.ts"]));
  writeFileSync(join(tasks, "contested.md"), taskSpec("contested", ["src/shared/child.ts"]));
  writeFileSync(join(tasks, "running.md"), taskSpec("running", ["src/not-shared.ts"]));
  writeFileSync(join(tasks, "missing.md"), "# No declaration\n");
  writeFileSync(join(runningTasks, "running.md"), taskSpec("running", ["src/shared"]));
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/sh\ncase "$3" in unit-running.service|unit-legacy.service) echo active;; *) echo inactive;; esac\n',
    { mode: 0o700 },
  );

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        XDG_DATA_HOME: dataHome,
      },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    git(repository, ["branch", "task/stale", head]);

    assert.equal(
      ledger([
        "start",
        "base",
        "unit-base",
        "--worktree",
        repository,
        "--spec",
        join(tasks, "base.md"),
      ]).status,
      0,
    );
    assert.equal(
      ledger(["close", "unit-base", "--outcome", "landed", "--commit", head]).status,
      0,
    );
    const unchanged = ledger(["can-start", "dependent"]);
    assert.equal(unchanged.status, 1);
    assert.match(unchanged.stderr, /base/u, "a zero-change result cannot satisfy a dependency");

    mkdirSync(join(repository, "src"), { recursive: true });
    writeFileSync(join(repository, "src", "base.ts"), "export {};\n");
    git(repository, ["add", "."]);
    commit(repository, "land base task");
    const landedHead = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(
      ledger([
        "close",
        "unit-base",
        "--outcome",
        "landed",
        "--commit",
        landedHead,
        "--reopen",
      ]).status,
      0,
    );
    const staleBranch = ledger(["can-start", "stale", "--branch", "task/stale"]);
    assert.equal(staleBranch.status, 1);
    assert.match(staleBranch.stderr, /does not contain landed needs: base/u);
    assert.equal(
      ledger([
        "start",
        "running",
        "unit-running",
        "--worktree",
        runningWorktree,
        "--spec",
        join(runningTasks, "running.md"),
      ]).status,
      0,
    );

    const ready = ledger(["ready"]);
    assert.equal(ready.status, 0, ready.stderr);
    assert.match(ready.stdout, /^dependent$/mu);
    assert.match(ready.stdout, /^free$/mu);
    assert.doesNotMatch(ready.stdout, /^base$/mu, "landed tasks are not work to start again");
    assert.doesNotMatch(ready.stdout, /^contested$/mu);
    assert.doesNotMatch(ready.stdout, /^missing$/mu);
    assert.match(ready.stderr, /missing.*declaration/u);

    const contested = ledger(["can-start", "contested"]);
    assert.equal(contested.status, 1);
    assert.match(contested.stderr, /running/u);
    assert.match(contested.stderr, /src\/shared/u);

    assert.equal(ledger(["close", "unit-running", "--outcome", "failed"]).status, 0);
    const stillActive = ledger(["can-start", "contested"]);
    assert.equal(stillActive.status, 1);
    assert.match(stillActive.stderr, /running/u, "a closed active unit must keep its territory");

    const invalid = ledger(["can-start", "missing"]);
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /declaration/u);

    assert.equal(
      ledger(["close", "unit-base", "--outcome", "failed", "--reopen"]).status,
      0,
    );
    const corrected = ledger(["can-start", "dependent"]);
    assert.equal(corrected.status, 1);
    assert.match(corrected.stderr, /base/u, "a corrected close-out must revoke landed status");

    assert.equal(ledger(["start", "legacy", "unit-legacy"]).status, 0);
    const unknownTerritory = ledger(["can-start", "free"]);
    assert.equal(unknownTerritory.status, 1);
    assert.match(unknownTerritory.stderr, /legacy/u);
    assert.match(unknownTerritory.stderr, /no launch-time territory declaration/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("run-task refuses contested ground in a worktree, and starts if that check is removed", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-conflict-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  const activeUnit = join(directory, "active-unit");
  const capture = join(directory, "systemd-arguments");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-watchdog"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "first.md"), taskSpec("first", ["src/shared"]));
  writeFileSync(join(tasks, "second.md"), taskSpec("second", ["src/shared/file.ts"]));
  writeFileSync(join(tasks, "racy.md"), taskSpec("racy", ["src/disjoint.ts"]));
  writeFileSync(
    join(bin, "systemd-run"),
    '#!/bin/sh\nfor a in "$@"; do case "$a" in --unit=*) unit=${a#--unit=};; --working-directory=*) tree=${a#--working-directory=};; esac; done\nprintf "%s\\n" "$@" >> "$SYSTEMD_CAPTURE"\ncase "$unit" in *-watchdog) ;; *-first-*) printf "%s\\n" "---" "needs: []" "touches:" "  - src/not-shared.ts" "---" "# Mutated after launch" > "$tree/docs/tasks/first.md"; printf "%s.service\\n" "$unit" >> "$ACTIVE_UNIT";; *) printf "%s.service\\n" "$unit" >> "$ACTIVE_UNIT";; esac\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/sh\nif [ -f "$ACTIVE_UNIT" ] && grep -Fxq "$3" "$ACTIVE_UNIT"; then echo active; else echo inactive; fi\n',
    { mode: 0o700 },
  );

  const environment = {
    ...process.env,
    ACTIVE_UNIT: activeUnit,
    ECOSYM_PORT: "3220",
    ECOSYM_PROJECT: "",
    ECOSYM_WORKTREE: "",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    SYSTEMD_CAPTURE: capture,
    XDG_DATA_HOME: dataHome,
    RACY_SPEC: join(tasks, "racy.md"),
  };

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    const first = spawnSync(join(scripts, "run-task"), ["first"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(first.status, 0, first.stderr);
    const managedWorktree = join(dataHome, "ecosym", "worktrees", "first");
    const firstRecord = JSON.parse(
      readFileSync(join(dataHome, "ecosym", "ledger.jsonl"), "utf8").trim(),
    ) as Record<string, unknown>;
    assert.deepEqual(
      firstRecord.touches,
      ["src/shared", "docs/tasks/first.md"],
      "the declaration must be frozen before the run can edit its own spec",
    );
    const launched = readFileSync(capture, "utf8");
    assert.match(launched, new RegExp(`--working-directory=${escapeRegExp(managedWorktree)}`));
    assert.doesNotMatch(launched, new RegExp(`--working-directory=${escapeRegExp(repository)}(?:\\n|$)`));

    const heldSpec = readFileSync(join(managedWorktree, "docs", "tasks", "first.md"), "utf8");
    const sameTask = spawnSync(join(scripts, "run-task"), ["first"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...environment, ECOSYM_PORT: "3221" },
    });
    assert.equal(sameTask.status, 1);
    assert.match(sameTask.stderr, /running task first/u);
    assert.equal(
      readFileSync(join(managedWorktree, "docs", "tasks", "first.md"), "utf8"),
      heldSpec,
      "a refused relaunch must not rewrite the active run's worktree",
    );

    copyFileSync(join(scripts, "run-ledger"), join(scripts, "run-ledger-real"));
    writeFileSync(
      join(scripts, "run-ledger"),
      '#!/bin/sh\nif [ "$1" = "can-start" ] && [ "$2" = "racy" ]; then printf "%s\\n" "---" "needs: []" "touches:" "  - src/shared/racy.ts" "---" "# Changed after check input froze" > "$RACY_SPEC"; fi\nexec "$(dirname "$0")/run-ledger-real" "$@"\n',
      { mode: 0o700 },
    );
    const racy = spawnSync(join(scripts, "run-task"), ["racy"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...environment, ECOSYM_PORT: "3221" },
    });
    assert.equal(racy.status, 0, racy.stderr);
    const racyRecord = readFileSync(join(dataHome, "ecosym", "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((record) => record.task === "racy");
    assert.deepEqual(
      racyRecord?.touches,
      ["src/disjoint.ts", "docs/tasks/racy.md"],
      "the declaration checked and registered must come from the same frozen read",
    );
    copyFileSync(join(scripts, "run-ledger-real"), join(scripts, "run-ledger"));

    const beforeRefusal = readFileSync(capture, "utf8");
    const refused = spawnSync(join(scripts, "run-task"), ["second"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...environment, ECOSYM_PORT: "3222" },
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /first/u);
    assert.match(refused.stderr, /src\/shared/u);
    assert.equal(readFileSync(capture, "utf8"), beforeRefusal, "a refused run never reaches systemd");
    assert.equal(
      existsSync(join(dataHome, "ecosym", "worktrees", "second")),
      false,
      "eligibility refusal happens before creating a worktree",
    );

    const source = readFileSync(join(scripts, "run-task"), "utf8");
    const mutant = source.replace(
      /^"\$REPO\/scripts\/run-ledger" can-start .*$/mu,
      ": # conflict check deliberately removed by the control",
    );
    assert.notEqual(mutant, source, "the control must actually remove the conflict check");
    writeFileSync(join(scripts, "run-task"), mutant, { mode: 0o700 });

    const unchecked = spawnSync(join(scripts, "run-task"), ["second"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...environment, ECOSYM_PORT: "3223" },
    });
    assert.equal(unchecked.status, 0, unchecked.stderr);
    assert.notEqual(readFileSync(capture, "utf8"), beforeRefusal);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a landed close is refused and records paths outside the launch declaration", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-territory-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const source = join(repository, "src");
  const dataHome = join(directory, "data");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(source);
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(tasks, "bounded.md"), taskSpec("bounded", ["src/allowed.ts"]));
  writeFileSync(join(source, "allowed.ts"), "export {};\n");

  const ledger = (arguments_: string[]) =>
    spawnSync(join(scripts, "run-ledger"), arguments_, {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");
    const base = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();
    assert.equal(
      ledger([
        "start",
        "bounded",
        "unit-bounded",
        "--worktree",
        repository,
        "--commit",
        base,
        "--spec",
        join(tasks, "bounded.md"),
      ]).status,
      0,
    );

    writeFileSync(join(source, "allowed.ts"), "export const allowed = true;\n");
    git(repository, ["add", "."]);
    commit(repository, "edit declared territory");
    const earlierCommit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    writeFileSync(join(source, "outside.ts"), "export {};\n");
    git(repository, ["add", "."]);
    commit(repository, "edit outside declared territory");
    const resultCommit = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    const staleResult = ledger([
      "close",
      "unit-bounded",
      "--outcome",
      "landed",
      "--commit",
      earlierCommit,
    ]);
    assert.equal(staleResult.status, 1);
    assert.match(staleResult.stderr, /not worktree HEAD/u);

    const refused = ledger([
      "close",
      "unit-bounded",
      "--outcome",
      "landed",
      "--commit",
      resultCommit,
    ]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /src\/outside\.ts/u);
    assert.match(refused.stderr, /outside.*declared territory/u);

    const records = readFileSync(join(dataHome, "ecosym", "ledger.jsonl"), "utf8");
    assert.match(records, /"event": "territory-violation"/u);
    assert.match(records, /src\/outside\.ts/u);

    const failed = ledger(["close", "unit-bounded", "--outcome", "failed"]);
    assert.equal(failed.status, 0, failed.stderr);
    const closed = readFileSync(join(dataHome, "ecosym", "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .at(-1);
    assert.equal(closed?.event, "closed");
    assert.deepEqual(closed?.undeclared_paths, ["src/outside.ts"]);
    assert.equal(closed?.territory_audit, "failed");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a landed close is refused when its launch declaration is unavailable", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-unknown-territory-"));
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
    writeFileSync(join(repository, "result.txt"), "result\n");
    git(repository, ["add", "."]);
    commit(repository, "fixture");
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    assert.equal(
      ledger([
        "start",
        "unknown-territory",
        "unit-unknown-territory",
        "--worktree",
        repository,
        "--commit",
        head,
      ]).status,
      0,
    );
    const refused = ledger([
      "close",
      "unit-unknown-territory",
      "--outcome",
      "landed",
      "--commit",
      head,
    ]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /no valid launch-time territory declaration/u);

    const records = readFileSync(join(dataHome, "ecosym", "ledger.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(records.at(-1)?.event, "territory-audit-failed");
    assert.match(String(records.at(-1)?.reason), /no valid launch-time territory declaration/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("every repository task specification has a valid scheduling declaration", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url));
  const dataHome = mkdtempSync(join(tmpdir(), "ecosym-run-validate-"));
  const tasks = join(repository, "docs", "tasks");
  const specifications = readdirSync(tasks)
    .filter((name) => name.endsWith(".md"))
    .map((name) => join(tasks, name));
  const validated = spawnSync(runLedger, ["validate", ...specifications], {
    cwd: repository,
    encoding: "utf8",
  });
  assert.equal(validated.status, 0, validated.stderr);

  const declaration = (task: string) => {
    const result = spawnSync(runLedger, ["declaration", join(tasks, `${task}.md`)], {
      cwd: repository,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout) as { touches: string[] };
  };
  assert.ok(declaration("002-close-review-findings").touches.includes("test/fifth-source.test.ts"));
  assert.deepEqual(declaration("016-dependency-audit").touches, [
    ".github/dependabot.yml",
    ".github/workflows/check.yml",
    "docs/tasks/016-dependency-audit.md",
    "package.json",
    "test/check-workflow.test.ts",
  ]);
  assert.doesNotMatch(
    readFileSync(join(tasks, "009-equivalence-decided-on-stored-identity.md"), "utf8"),
    /Note on `needs`/u,
  );
  const schedulerTask = readFileSync(
    join(tasks, "017-runs-scheduled-by-need-and-territory.md"),
    "utf8",
  );
  assert.doesNotMatch(schedulerTask, /## The question this task must decide/u);
  assert.match(schedulerTask, /DEVELOPMENT\.md#writer-ownership-and-concurrency/u);

  try {
    const supervised = spawnSync(runLedger, ["can-start", "014-agent-shell-source-boundary"], {
      cwd: repository,
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });
    assert.equal(supervised.status, 1);
    assert.match(supervised.stderr, /supervised or human run/u);
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test("two launchers racing for one territory produce exactly one run", async () => {
  // The conflict check is only as good as the window it runs in. Two launchers
  // that both read an empty territory before either registers would both start
  // on the same ground, and every other guarantee here rests on that not
  // happening. run-task holds an exclusive lock across the whole check-and-
  // reserve; this is the test that the window is actually closed.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-race-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  const bin = join(directory, "bin");
  const activeUnit = join(directory, "active-unit");
  const capture = join(directory, "systemd-arguments");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  mkdirSync(bin);
  copyFileSync(runTask, join(scripts, "run-task"));
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-task"), 0o700);
  copyFileSync(join(scripts, "run-ledger"), join(scripts, "run-ledger-real"));
  writeFileSync(
    join(scripts, "run-ledger"),
    '#!/bin/sh\nreal="$(dirname "$0")/run-ledger-real"\nif [ "$1" = can-start ] && [ "${RACER_ROLE:-}" = a ]; then\n  "$real" "$@" || exit $?\n  : > "$A_CHECKED"\n  while [ ! -f "$RELEASE_A" ]; do sleep 0.01; done\n  exit 0\nfi\nif [ "$1" = can-start ] && [ "${RACER_ROLE:-}" = b ]; then\n  "$real" "$@"\n  status=$?\n  printf "%s\\n" "$status" > "$B_CHECKED"\n  exit "$status"\nfi\nexec "$real" "$@"\n',
    { mode: 0o700 },
  );
  chmodSync(join(scripts, "run-ledger-real"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-watchdog"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  for (const prefix of ["control", "racer"]) {
    writeFileSync(join(tasks, `${prefix}-a.md`), taskSpec(`${prefix}-a`, ["src/contested.ts"]));
    writeFileSync(join(tasks, `${prefix}-b.md`), taskSpec(`${prefix}-b`, ["src/contested.ts"]));
  }

  const realFlock = spawnSync("/bin/sh", ["-c", "command -v flock"], {
    encoding: "utf8",
  }).stdout.trim();
  assert.notEqual(realFlock, "", "the race proof requires the same flock used by run-task");
  writeFileSync(
    join(bin, "flock"),
    '#!/bin/sh\nif [ "${RACER_ROLE:-}" = b ] && [ ! -f "$B_LOCK_ATTEMPT" ]; then : > "$B_LOCK_ATTEMPT"; fi\nif [ -n "${DISABLE_SCHEDULE_LOCK:-}" ]; then exit 0; fi\nexec "$REAL_FLOCK" "$@"\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "systemd-run"),
    '#!/bin/sh\nfor a in "$@"; do case "$a" in --unit=*) unit=${a#--unit=};; esac; done\nprintf "%s\\n" "$@" >> "$SYSTEMD_CAPTURE"\ncase "$unit" in *-watchdog) ;; *) printf "%s.service\\n" "$unit" >> "$ACTIVE_UNIT";; esac\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "systemctl"),
    '#!/bin/sh\nif [ -f "$ACTIVE_UNIT" ] && grep -Fxq "$3" "$ACTIVE_UNIT"; then echo active; else echo inactive; fi\n',
    { mode: 0o700 },
  );

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");

    const race = async (prefix: string, locking: boolean) => {
      const raceDataHome = join(dataHome, prefix);
      const firstChecked = join(directory, `${prefix}-a-checked`);
      const secondChecked = join(directory, `${prefix}-b-checked`);
      const secondLockAttempt = join(directory, `${prefix}-b-lock-attempt`);
      const releaseFirst = join(directory, `${prefix}-release-a`);
      const environment = {
        ...process.env,
        ACTIVE_UNIT: activeUnit,
        A_CHECKED: firstChecked,
        B_CHECKED: secondChecked,
        B_LOCK_ATTEMPT: secondLockAttempt,
        DISABLE_SCHEDULE_LOCK: locking ? "" : "1",
        ECOSYM_PROJECT: "",
        ECOSYM_WORKTREE: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        REAL_FLOCK: realFlock,
        RELEASE_A: releaseFirst,
        SYSTEMD_CAPTURE: capture,
        XDG_DATA_HOME: raceDataHome,
      };
      const launch = (task: string, role: string, port: string) => {
        const child = spawn(join(scripts, "run-task"), [task], {
          cwd: repository,
          env: { ...environment, ECOSYM_PORT: port, RACER_ROLE: role },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => (output += chunk));
        child.stderr.on("data", (chunk: string) => (output += chunk));
        const exited = new Promise<number | null>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", resolve);
        });
        return { child, exited, output: () => output };
      };
      const waitForRunMarker = async (
        path: string,
        run: ReturnType<typeof launch>,
      ): Promise<void> => {
        await Promise.race([
          waitForFile(path),
          run.exited.then((status) => {
            throw new Error(`${run.child.spawnargs.join(" ")} exited ${status}:\n${run.output()}`);
          }),
        ]);
      };

      const runs: ReturnType<typeof launch>[] = [];
      try {
        const first = launch(`${prefix}-a`, "a", locking ? "3232" : "3230");
        runs.push(first);
        await waitForRunMarker(firstChecked, first);

        const second = launch(`${prefix}-b`, "b", locking ? "3233" : "3231");
        runs.push(second);
        await waitForRunMarker(secondLockAttempt, second);
        if (!locking) {
          await waitForRunMarker(secondChecked, second);
        }
        const secondCheckedBeforeRegistration = existsSync(secondChecked);
        writeFileSync(releaseFirst, "release\n");
        const statuses = await Promise.all(runs.map((run) => run.exited));
        return {
          outputs: runs.map((run) => run.output()),
          secondCheckStatus: readFileSync(secondChecked, "utf8").trim(),
          secondCheckedBeforeRegistration,
          statuses,
        };
      } finally {
        if (!existsSync(releaseFirst)) {
          writeFileSync(releaseFirst, "release\n");
        }
        for (const run of runs) {
          run.child.kill();
        }
        await Promise.allSettled(runs.map((run) => run.exited));
      }
    };

    const unlocked = await race("control", false);
    assert.equal(
      unlocked.secondCheckedBeforeRegistration,
      true,
      "the control must put racer-b's eligibility check inside racer-a's registration window",
    );
    assert.deepEqual(unlocked.statuses, [0, 0], unlocked.outputs.join("\n---\n"));
    assert.equal(unlocked.secondCheckStatus, "0");
    assert.equal(unlocked.outputs.filter((text) => /^unit:/mu.test(text)).length, 2);

    const guarded = await race("racer", true);
    assert.equal(
      guarded.secondCheckedBeforeRegistration,
      false,
      "the schedule lock must keep racer-b out of the eligibility check until racer-a registers",
    );
    assert.deepEqual(guarded.statuses, [0, 1], guarded.outputs.join("\n---\n"));
    assert.equal(guarded.secondCheckStatus, "1");
    assert.equal(
      guarded.outputs.filter((text) => /^unit:/mu.test(text)).length,
      1,
      `exactly one launch expected, got:\n${guarded.outputs.join("\n---\n")}`,
    );
    assert.equal(
      guarded.outputs.filter((text) => /territory conflicts with running task/u.test(text)).length,
      1,
      `the loser must name the conflict, got:\n${guarded.outputs.join("\n---\n")}`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForFile(path: string): Promise<void> {
  // The marker appears only after run-task adds a worktree, copies the
  // specification and shells out to Git several times through
  // `run-ledger can-start`. Five seconds is comfortable locally and tight on
  // a loaded runner, and a timeout here reports a defect that is not there.
  // The loop exits the moment the file exists, so a larger bound costs the
  // passing case nothing.
  for (let attempt = 0; attempt < 3000; attempt += 1) {
    if (existsSync(path)) return;
    await delay(10);
  }
  assert.fail(`timed out waiting for ${path}`);
}

test("a task name that escapes the specification directory is refused at registration", () => {
  // run-task screens the name, but run-ledger is a separate entry point and
  // the ledger is what every later answer derives from. A traversal written
  // there once is a lie in the record forever, so the refusal has to live
  // here too rather than in the caller that happens to be careful.
  const dataHome = mkdtempSync(join(tmpdir(), "ecosym-ledger-name-"));
  try {
    for (const name of ["../../evil", "../escape", "..", "with/slash"]) {
      const started = spawnSync(runLedger, ["start", name, "unit-for-bad-name"], {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        encoding: "utf8",
        env: { ...process.env, XDG_DATA_HOME: dataHome },
      });
      assert.notEqual(started.status, 0, `${name} must be refused`);
      assert.match(started.stderr, /invalid task name/u);
    }

    // The control: a well-formed name still registers, so the guard refuses
    // traversals rather than refusing everything.
    const good = spawnSync(runLedger, ["start", "018-well-formed", "unit-for-good-name"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
      env: { ...process.env, XDG_DATA_HOME: dataHome },
    });
    assert.equal(good.status, 0, good.stderr);
  } finally {
    rmSync(dataHome, { recursive: true, force: true });
  }
});

test("a landed run recorded before declarations existed still satisfies a need", () => {
  // Backfilled runs carry base_commit: null — `backfill` writes it that way
  // for logs that predate the declaration format. The audited path needs a
  // base commit to diff against, so refusing those records outright made
  // every historical task permanently unlanded: measured against the real
  // ledger, zero of 22 landed tasks were recognised, `needs` could never be
  // satisfied by anything older than the scheduler, and `ready` offered
  // finished work as startable. This is the shape the fixtures elsewhere in
  // this file never produce, which is why it survived.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-legacy-"));
  const repository = join(directory, "repository");
  const scripts = join(repository, "scripts");
  const tasks = join(repository, "docs", "tasks");
  const dataHome = join(directory, "data");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(tasks, { recursive: true });
  copyFileSync(runLedger, join(scripts, "run-ledger"));
  chmodSync(join(scripts, "run-ledger"), 0o700);
  writeFileSync(join(tasks, "ancient.md"), taskSpec("ancient", ["src/ancient.ts"]));
  writeFileSync(join(tasks, "successor.md"), taskSpec("successor", ["src/successor.ts"], ["ancient"]));
  // A need that never landed at all, to prove the acceptance above is the
  // ledger answering rather than the scheduler waving every `needs` through.
  writeFileSync(join(tasks, "orphan.md"), taskSpec("orphan", ["src/orphan.ts"], ["never-ran"]));

  try {
    git(repository, ["init", "-b", "main"]);
    git(repository, ["add", "."]);
    commit(repository, "fixture");
    const head = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).stdout.trim();

    // Exactly what `backfill` writes for a pre-declaration run: a started
    // record with no base_commit and no frozen territory, then a landed close.
    const ledgerDirectory = join(dataHome, "ecosym");
    mkdirSync(ledgerDirectory, { recursive: true });
    writeFileSync(
      join(ledgerDirectory, "ledger.jsonl"),
      [
        JSON.stringify({
          event: "started",
          unit: "ecosym-task-ancient-1",
          task: "ancient",
          branch: null,
          worktree: null,
          base_commit: null,
          backfilled: true,
          ts: 1,
        }),
        JSON.stringify({
          event: "closed",
          unit: "ecosym-task-ancient-1",
          task: "ancient",
          outcome: "landed",
          result_commit: head,
          evidence: "merged before declarations existed",
          ts: 2,
        }),
      ].join("\n") + "\n",
    );

    const environment = { ...process.env, XDG_DATA_HOME: dataHome };
    const startable = spawnSync(join(scripts, "run-ledger"), ["can-start", "successor"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(startable.status, 0, `successor must be startable: ${startable.stderr}`);

    // The control: the landed task must not itself be offered as startable,
    // and a need whose task never landed must still be refused.
    const ready = spawnSync(join(scripts, "run-ledger"), ["ready"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.equal(ready.status, 0, ready.stderr);
    assert.doesNotMatch(ready.stdout, /^ancient$/mu, "a landed task is not startable");

    // The other half of that control, which the comment above promised and
    // the fixture did not deliver: a need naming a task that never ran must
    // still be refused. Without this, a scheduler that accepted every `needs`
    // entry would pass this test unchanged.
    const orphan = spawnSync(join(scripts, "run-ledger"), ["can-start", "orphan"], {
      cwd: repository,
      encoding: "utf8",
      env: environment,
    });
    assert.notEqual(orphan.status, 0, "an unlanded need must be refused");
    assert.match(orphan.stderr, /needs not landed: never-ran/u);
    assert.doesNotMatch(ready.stdout, /^orphan$/mu);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stale local main does not make landed work startable again", () => {
  // `in_main` decides whether work reached the shared branch. Asking a local
  // `main` answers only where this checkout last pulled, and a checkout that
  // is merely behind is the ordinary case, not an exotic one: measured against
  // a clone twenty commits behind, a task that landed days earlier was offered
  // as startable. The remote-tracking ref is the shared answer.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-stale-"));
  const upstream = join(directory, "upstream");
  const repository = join(directory, "repository");
  const dataHome = join(directory, "data");
  mkdirSync(upstream, { recursive: true });

  try {
    // An upstream whose main carries the landed commit.
    git(upstream, ["init", "-b", "main"]);
    mkdirSync(join(upstream, "docs", "tasks"), { recursive: true });
    mkdirSync(join(upstream, "scripts"), { recursive: true });
    writeFileSync(join(upstream, "docs", "tasks", "ancient.md"), taskSpec("ancient", ["src/a.ts"]));
    writeFileSync(
      join(upstream, "docs", "tasks", "successor.md"),
      taskSpec("successor", ["src/b.ts"], ["ancient"]),
    );
    copyFileSync(runLedger, join(upstream, "scripts", "run-ledger"));
    chmodSync(join(upstream, "scripts", "run-ledger"), 0o700);
    git(upstream, ["add", "."]);
    commit(upstream, "first");
    const stale = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: upstream,
      encoding: "utf8",
    }).stdout.trim();
    writeFileSync(join(upstream, "landed.txt"), "the work\n");
    git(upstream, ["add", "."]);
    commit(upstream, "the landed work");
    const landed = spawnSync("git", ["rev-parse", "HEAD"], {
      cwd: upstream,
      encoding: "utf8",
    }).stdout.trim();

    // A clone whose local main sits at the older commit — behind, not broken.
    spawnSync("git", ["clone", "-q", upstream, repository], { encoding: "utf8" });
    git(repository, ["checkout", "-q", "-b", "work"]);
    git(repository, ["branch", "-f", "main", stale]);

    const ledgerDirectory = join(dataHome, "ecosym");
    mkdirSync(ledgerDirectory, { recursive: true });
    writeFileSync(
      join(ledgerDirectory, "ledger.jsonl"),
      [
        JSON.stringify({
          event: "started",
          unit: "unit-ancient",
          task: "ancient",
          base_commit: null,
          backfilled: true,
          ts: 1,
        }),
        JSON.stringify({
          event: "closed",
          unit: "unit-ancient",
          task: "ancient",
          outcome: "landed",
          result_commit: landed,
          ts: 2,
        }),
      ].join("\n") + "\n",
    );

    const environment = { ...process.env, XDG_DATA_HOME: dataHome };
    const alreadyLanded = spawnSync(join(repository, "scripts", "run-ledger"), [
      "can-start",
      "ancient",
    ], { cwd: repository, encoding: "utf8", env: environment });
    assert.notEqual(alreadyLanded.status, 0, "a landed task must not be startable");
    assert.match(alreadyLanded.stderr, /already landed/u);

    // The control: a task that genuinely has not landed is still startable,
    // so the guard refuses landed work rather than refusing everything.
    const notLanded = spawnSync(join(repository, "scripts", "run-ledger"), [
      "can-start",
      "successor",
      "--commit",
      landed,
    ], { cwd: repository, encoding: "utf8", env: environment });
    assert.equal(notLanded.status, 0, notLanded.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
