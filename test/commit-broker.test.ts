import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { brokerCommit, GIT_ENVIRONMENT as BROKER_ENVIRONMENT } from "../src/commit-broker.ts";

const GIT_ENVIRONMENT = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  HOME: "/nonexistent",
  PATH: "/usr/bin:/bin",
};

function git(worktree: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: worktree,
    encoding: "utf8",
    env: GIT_ENVIRONMENT,
  });
}

function fixture(): string {
  const worktree = mkdtempSync(join(tmpdir(), "ecosym-broker-"));
  git(worktree, "init", "-q", ".");
  git(worktree, "config", "user.email", "run@example.test");
  git(worktree, "config", "user.name", "Run");
  writeFileSync(join(worktree, "declared.txt"), "start\n");
  writeFileSync(join(worktree, "other.txt"), "start\n");
  git(worktree, "add", "-A");
  git(worktree, "commit", "-qm", "init");
  return worktree;
}

function committedPaths(worktree: string): string[] {
  return git(worktree, "show", "--name-only", "--format=", "HEAD")
    .split("\n")
    .filter((line) => line !== "");
}

test("a declared changed path commits", () => {
  const worktree = fixture();
  try {
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    const result = brokerCommit({
      declaredTouches: ["declared.txt"],
      request: { message: "the run's own message" },
      worktree,
    });
    assert.equal(result.outcome, "OK", result.reason);
    assert.deepEqual(committedPaths(worktree), ["declared.txt"]);
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("a changed path outside the declared touches is not committed", () => {
  const worktree = fixture();
  try {
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    writeFileSync(join(worktree, "other.txt"), "also changed\n");
    const result = brokerCommit({
      declaredTouches: ["declared.txt"],
      request: { message: "commit my work" },
      worktree,
    });
    assert.equal(result.outcome, "OK", result.reason);
    assert.deepEqual(
      committedPaths(worktree),
      ["declared.txt"],
      "an undeclared change rode along with a declared one",
    );
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("requesting an undeclared path is refused with a reason", () => {
  const worktree = fixture();
  try {
    writeFileSync(join(worktree, "other.txt"), "changed\n");
    const result = brokerCommit({
      declaredTouches: ["declared.txt"],
      request: { message: "take this too", paths: ["other.txt"] },
      worktree,
    });
    assert.equal(result.outcome, "DENIED");
    assert.match(result.reason ?? "", /not declared/u);
    assert.equal(git(worktree, "log", "--oneline").trim().split("\n").length, 1);
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("requested paths narrow the commit, they do not widen it", () => {
  const worktree = fixture();
  try {
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    writeFileSync(join(worktree, "second.txt"), "new\n");
    const result = brokerCommit({
      declaredTouches: ["declared.txt", "second.txt"],
      request: { message: "only the first", paths: ["declared.txt"] },
      worktree,
    });
    assert.equal(result.outcome, "OK", result.reason);
    assert.deepEqual(committedPaths(worktree), ["declared.txt"]);
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("a path escaping the worktree is refused even when it is declared", () => {
  const worktree = fixture();
  const outside = join(tmpdir(), `ecosym-broker-outside-${process.pid}.txt`);
  writeFileSync(outside, "host file\n");
  try {
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    // Declaring the escape too: only containment can refuse this one, so a
    // broker that dropped the check cannot pass by falling through to the
    // declared-touches filter.
    for (const escape of ["../outside.txt", outside, "/etc/passwd"]) {
      const result = brokerCommit({
        declaredTouches: ["declared.txt", escape],
        request: { message: "escape", paths: [escape] },
        worktree,
      });
      assert.equal(result.outcome, "DENIED", `${escape} was accepted`);
      assert.match(result.reason ?? "", /outside the worktree/u);
    }
  } finally {
    rmSync(outside, { force: true });
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("the broker's git configuration surface is closed, not inherited", () => {
  // The run cannot define a filter, but an attribute it writes names one, and
  // a definition in the operator's global or system config answers to that
  // name. Measured: the same attribute executed a host command through a
  // global definition and executed nothing with these two set.
  assert.equal(BROKER_ENVIRONMENT["GIT_CONFIG_GLOBAL"], "/dev/null");
  assert.equal(BROKER_ENVIRONMENT["GIT_CONFIG_SYSTEM"], "/dev/null");
  assert.notEqual(
    BROKER_ENVIRONMENT["HOME"],
    process.env.HOME,
    "the broker reads the operator's home, and therefore their .gitconfig",
  );
});

test("a symlink out of the tree is not a declared object", () => {
  const worktree = fixture();
  try {
    const secret = join(tmpdir(), `ecosym-broker-secret-${process.pid}`);
    writeFileSync(secret, "PRIVATE KEY\n");
    symlinkSync(secret, join(worktree, "link.txt"));
    const result = brokerCommit({
      declaredTouches: ["link.txt"],
      request: { message: "sneak", paths: ["link.txt"] },
      worktree,
    });
    assert.equal(result.outcome, "DENIED");
    rmSync(secret, { force: true });
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("a message is data, not arguments", () => {
  const worktree = fixture();
  try {
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    const hostile = "--exec=id\n$(id)\n`id`\n--amend";
    const result = brokerCommit({
      declaredTouches: ["declared.txt"],
      request: { message: hostile },
      worktree,
    });
    assert.equal(result.outcome, "OK", result.reason);
    const message = git(worktree, "log", "-1", "--format=%B");
    assert.ok(message.includes("--exec=id"), "the message was interpreted, not stored");
    assert.ok(message.includes("$(id)"));
    assert.ok(message.includes("`id`"));
    assert.equal(
      git(worktree, "log", "--oneline").trim().split("\n").length,
      2,
      "--amend in the message rewrote history",
    );
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("a request naming any other operation is refused", () => {
  const worktree = fixture();
  try {
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    for (const request of [
      { message: "x", push: true },
      { message: "x", amend: true },
      { args: ["push"] },
      { message: "" },
      "commit",
      ["commit"],
      null,
    ]) {
      const result = brokerCommit({
        declaredTouches: ["declared.txt"],
        request,
        worktree,
      });
      assert.equal(
        result.outcome,
        "DENIED",
        `${JSON.stringify(request)} was not refused`,
      );
    }
  } finally {
    rmSync(worktree, { force: true, recursive: true });
  }
});

test("a worktree .gitattributes cannot reach an installed host filter", () => {
  const worktree = fixture();
  const marker = join(tmpdir(), `ecosym-broker-executed-${process.pid}`);
  const operatorHome = mkdtempSync(join(tmpdir(), "ecosym-broker-home-"));
  writeFileSync(
    join(operatorHome, ".gitconfig"),
    `[filter "preinstalled"]\n\tclean = sh -c 'echo PWNED > ${marker}'\n`,
  );
  const realHome = process.env.HOME;
  process.env.HOME = operatorHome;
  try {
    // The run cannot write .git/config, but it can write this.
    writeFileSync(join(worktree, ".gitattributes"), "*.txt filter=preinstalled\n");
    writeFileSync(join(worktree, "declared.txt"), "changed\n");
    const result = brokerCommit({
      declaredTouches: [".gitattributes", "declared.txt"],
      request: { message: "ordinary commit" },
      worktree,
    });
    assert.notEqual(result.outcome, "FAILED", result.reason);
    assert.equal(
      readFileSync(marker, "utf8").length,
      0,
      "the operator's filter ran because the run named it",
    );
  } catch (error) {
    assert.match(
      (error as NodeJS.ErrnoException).code ?? "",
      /ENOENT/u,
      "the marker exists, so the filter executed broker-side",
    );
  } finally {
    if (realHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = realHome;
    }
    rmSync(operatorHome, { force: true, recursive: true });
    rmSync(marker, { force: true });
    rmSync(worktree, { force: true, recursive: true });
  }
});
