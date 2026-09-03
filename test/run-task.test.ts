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

    // A run that stops working holds its unit open, so nothing notices unless
    // something is watching. Launching without that watcher is the failure
    // this asserts against: it is invisible until a run hangs for hours.
    assert.ok(
      linkedArguments.includes(join(linkedWorktree, "scripts", "run-watchdog")),
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

    record(["start", "landed-run", "unit-landed", "--branch", "task/live", "--commit", landed]);
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
    record(["start", "false-run", "unit-false", "--branch", "task/merged", "--commit", landed]);
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

    const disputed = ledger(["list"]);
    assert.match(disputed.stdout, /unmerged/);
    assert.match(disputed.stdout, /!!/);
    assert.equal(disputed.status, 1, "a landed claim Git denies must fail the command");

    // A branch merged and left undeleted carries no commit of its own, and
    // neither does a branch nobody committed to. Ambiguous evidence must
    // never be spent contradicting a close-out.
    git(repository, ["branch", "task/kept", "main"]);
    record(["start", "kept-run", "unit-kept", "--branch", "task/kept"]);
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
    record([
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

    assert.equal(ledger(["start", "demo", "unit-still-active"]).status, 0);
    // A result commit Git cannot find at all — an unambiguous false claim,
    // regardless of what state the ledger displays it under.
    assert.equal(
      ledger([
        "close",
        "unit-still-active",
        "--outcome",
        "landed",
        "--commit",
        "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
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
    assert.equal(listed.status, 1, "list must fail on a landed claim Git cannot find");
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

    assert.equal(ledger(["start", "demo", "unit-broken-git"]).status, 0);
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
  chmodSync(join(scripts, "run-task"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), "# Test task\n");
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
  chmodSync(join(scripts, "run-task"), 0o700);
  writeFileSync(join(scripts, "ecosym-sandbox"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(scripts, "run-instruction.md"), "Test instruction\n");
  writeFileSync(join(tasks, "example.md"), "# Test task\n");
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

test("the sandboxed run is told its commit channel, and the channel exists before it launches", () => {
  // sandboxArguments only binds and names a channel directory that already
  // exists (existsSync-gated). The committer's own systemd-run call creates
  // that directory too (prepareChannel in the servicer), but systemd-run
  // returns as soon as the unit is registered — it does not wait for the
  // committer process to actually start. If run-task relied on the
  // committer to create the channel, the sandbox launch and the channel's
  // creation would race, and a run could start with no
  // ECOSYM_COMMIT_CHANNEL at all depending purely on scheduling luck.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-run-task-channel-"));
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
  // Captures every full argument list, one call per line, and — for the
  // run's own sandbox call specifically — snapshots whether the channel
  // directory the run was just told about already exists at the moment
  // systemd-run is invoked (before any process it starts has run at all).
  writeFileSync(
    join(bin, "systemd-run"),
    [
      "#!/bin/sh",
      'printf "%s\\t" "$@" >> "$SYSTEMD_CAPTURE"',
      'printf "\\n" >> "$SYSTEMD_CAPTURE"',
      "for a in \"$@\"; do",
      '  case "$a" in',
      "    --setenv=ECOSYM_COMMIT_CHANNEL=*)",
      '      channel="${a#--setenv=ECOSYM_COMMIT_CHANNEL=}"',
      '      if [ -d "$channel/requests" ] && [ -d "$channel/replies" ]; then',
      '        echo "channel-ready:$channel" >> "$SYSTEMD_CAPTURE"',
      "      else",
      '        echo "channel-missing:$channel" >> "$SYSTEMD_CAPTURE"',
      "      fi",
      "      ;;",
      "  esac",
      "done",
      "exit 0",
    ].join("\n"),
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
        ECOSYM_PORT: "3215",
        ECOSYM_PROJECT: "",
        ECOSYM_WORKTREE: "",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        SYSTEMD_CAPTURE: capture,
        XDG_DATA_HOME: dataHome,
      },
    });
    assert.equal(result.status, 0, result.stderr);

    const output = readFileSync(capture, "utf8");
    assert.match(
      output,
      /--setenv=ECOSYM_COMMIT_CHANNEL=/u,
      "run-task never told the sandboxed run its commit channel",
    );
    assert.match(
      output,
      /channel-ready:/u,
      "the channel directory did not exist yet when the sandboxed run was launched",
    );
    assert.doesNotMatch(
      output,
      /channel-missing:/u,
      "the sandboxed run could have started before its channel was created",
    );

    const channelLine = output
      .split("\n")
      .find((line) => line.startsWith("channel-ready:"));
    assert.ok(channelLine, output);
    const channelPath = channelLine!.slice("channel-ready:".length);
    // The same path must be handed to the committer as its channel argument,
    // not a second, disconnected directory.
    assert.ok(
      output.includes(channelPath) &&
        output.split(channelPath).length - 1 >= 2,
      "the sandbox's channel and the committer's channel argument must be the same path",
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
