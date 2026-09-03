import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { sandboxArguments } from "../src/sandbox-runtime.ts";
import { brokerCommit } from "../src/commit-broker.ts";

const bwrapPresent = existsSync("/usr/bin/bwrap");

function argumentsFor(commitChannel: string | undefined): string[] {
  return sandboxArguments({
    childArguments: ["--version"],
    commitChannel,
    environment: { PATH: "/usr/bin" },
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

test("an existing commit channel is bound writable and named to the run", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-commit-channel-args-"));
  try {
    const arguments_ = argumentsFor(directory);

    const bindIndex = arguments_.indexOf("--bind");
    assert.ok(bindIndex >= 0, "the channel directory was never bound into the sandbox");
    assert.equal(
      arguments_[bindIndex + 1],
      directory,
      "the channel was not bound from its own path",
    );
    assert.equal(
      arguments_[bindIndex + 2],
      directory,
      "the channel was not bound at the same path the run is told to use",
    );

    const setenvIndex = arguments_.indexOf("ECOSYM_COMMIT_CHANNEL");
    assert.ok(
      setenvIndex > 0 && arguments_[setenvIndex - 1] === "--setenv",
      "the run was given no name for the channel it can write to",
    );
    assert.equal(
      arguments_[setenvIndex + 1],
      directory,
      "the run's ECOSYM_COMMIT_CHANNEL does not point at the bound directory",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("an absent commit channel is not named or mounted", () => {
  const arguments_ = argumentsFor(undefined);

  assert.equal(
    arguments_.includes("ECOSYM_COMMIT_CHANNEL"),
    false,
    "a run with no channel was still given a name for one",
  );
});

test("a commit channel path that does not exist yet is silently skipped", () => {
  // sandboxArguments only mounts and names paths that exist at call time
  // (existingMounts filters with existsSync); a caller that races channel
  // creation gets no mount and no env var, not a bwrap failure on a missing
  // bind source.
  const arguments_ = argumentsFor(join(tmpdir(), "ecosym-commit-channel-does-not-exist"));

  assert.equal(arguments_.includes("ECOSYM_COMMIT_CHANNEL"), false);
});

test(
  "a real run can write a commit request through the named channel while .git stays read-only",
  { skip: !bwrapPresent },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "ecosym-commit-channel-real-"));
    const home = join(directory, "home");
    const worktree = join(home, "project");
    const channel = join(directory, "channel");
    const stateDirectory = join(home, ".local", "state", "ecosym");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(join(worktree, ".git"), { recursive: true });
    mkdirSync(join(channel, "requests"), { recursive: true });
    writeFileSync(join(worktree, ".git", "config"), "[core]\n");

    try {
      const arguments_ = sandboxArguments({
        childArguments: [
          "-c",
          'printf "%s" "$ECOSYM_COMMIT_CHANNEL" > "$ECOSYM_COMMIT_CHANNEL/requests/0001.json" && ' +
            'printf changed > .git/config',
        ],
        commitChannel: channel,
        environment: { PATH: process.env.PATH ?? "/usr/bin" },
        executable: "/usr/bin/bash",
        home,
        project: worktree,
        readonlySourceDirectories: [],
        sourceDirectories: [],
        sourceMounts: [],
        stateDirectory,
        stateMounts: [],
        worktree,
      });

      const result = spawnSync("/usr/bin/bwrap", arguments_, { encoding: "utf8" });

      assert.equal(
        result.status,
        1,
        `expected the .git write to fail after the channel write succeeded: ${result.stderr}`,
      );
      assert.match(
        result.stderr,
        /Read-only file system/u,
        ".git/config must stay read-only even with a commit channel mounted",
      );

      const written = join(channel, "requests", "0001.json");
      assert.ok(existsSync(written), "the run's write to the commit channel never landed");
      assert.equal(
        readFileSync(written, "utf8"),
        channel,
        "the run did not see its own ECOSYM_COMMIT_CHANNEL value",
      );
      assert.equal(
        readFileSync(join(worktree, ".git", "config"), "utf8"),
        "[core]\n",
        ".git/config content changed even though the write was denied",
      );
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

test(
  "an inside-sandbox commit request reaches a real commit through the real broker",
  { skip: !bwrapPresent },
  () => {
    // End-to-end proof of the wiring this task completes: a real bwrap run,
    // told only ECOSYM_COMMIT_CHANNEL, writes a request; the real broker
    // (not a mock) picks it up from outside the sandbox and produces an
    // actual commit in the fixture repository — while .git never left
    // read-only inside the run that asked for it.
    const directory = mkdtempSync(join(tmpdir(), "ecosym-commit-channel-e2e-"));
    const home = join(directory, "home");
    const worktree = join(home, "project");
    const channel = join(directory, "channel");
    const stateDirectory = join(home, ".local", "state", "ecosym");
    mkdirSync(worktree, { recursive: true });
    mkdirSync(join(channel, "requests"), { recursive: true });
    mkdirSync(join(channel, "replies"), { recursive: true });

    try {
      spawnSync("git", ["init", "--initial-branch=main", worktree], { encoding: "utf8" });
      spawnSync("git", ["-C", worktree, "config", "user.email", "fixture@example.com"], {
        encoding: "utf8",
      });
      spawnSync("git", ["-C", worktree, "config", "user.name", "Fixture"], { encoding: "utf8" });
      writeFileSync(join(worktree, "tracked.txt"), "original\n");
      spawnSync("git", ["-C", worktree, "add", "tracked.txt"], { encoding: "utf8" });
      spawnSync("git", ["-C", worktree, "commit", "-m", "initial"], { encoding: "utf8" });

      const arguments_ = sandboxArguments({
        childArguments: [
          "-c",
          'printf changed >> tracked.txt && ' +
            'printf \'{"message":"fix: run-authored change"}\\n\' ' +
            '> "$ECOSYM_COMMIT_CHANNEL/requests/0001.json" && ' +
            'printf changed > .git/config',
        ],
        commitChannel: channel,
        environment: { PATH: process.env.PATH ?? "/usr/bin" },
        executable: "/usr/bin/bash",
        home,
        project: worktree,
        readonlySourceDirectories: [],
        sourceDirectories: [],
        sourceMounts: [],
        stateDirectory,
        stateMounts: [],
        worktree,
      });

      const runResult = spawnSync("/usr/bin/bwrap", arguments_, { encoding: "utf8" });
      assert.equal(runResult.status, 1, `run should fail on the .git write: ${runResult.stderr}`);
      assert.match(runResult.stderr, /Read-only file system/u);

      // Now play the broker's role, exactly as commit-servicer-cli does, but
      // driven directly so the test controls timing instead of racing a
      // background systemd unit.
      const request = JSON.parse(
        readFileSync(join(channel, "requests", "0001.json"), "utf8"),
      ) as { message: string };
      assert.equal(request.message, "fix: run-authored change");

      const before = spawnSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).stdout.trim();

      const outcome = brokerCommit({ declaredTouches: ["tracked.txt"], request, worktree });
      assert.equal(outcome.outcome, "OK", outcome.reason);

      const after = spawnSync("git", ["-C", worktree, "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).stdout.trim();
      assert.notEqual(after, before, "the broker did not create a new commit");

      const log = spawnSync(
        "git",
        ["-C", worktree, "log", "-1", "--pretty=%s"],
        { encoding: "utf8" },
      ).stdout.trim();
      assert.equal(log, "fix: run-authored change");

      const trackedContent = readFileSync(join(worktree, "tracked.txt"), "utf8");
      assert.equal(trackedContent, "original\nchanged");

      // .git/config must show none of the run's write reached it: the broker
      // ran with its own explicit config surface, and the run's own write
      // was denied by the OS before the broker ever ran.
      const config = readFileSync(join(worktree, ".git", "config"), "utf8");
      assert.doesNotMatch(config, /changed/u);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  },
);

