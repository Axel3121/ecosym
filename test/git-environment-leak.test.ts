import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Git exports GIT_DIR (and GIT_WORK_TREE, GIT_COMMON_DIR, GIT_INDEX_FILE,
// GIT_OBJECT_DIRECTORY, GIT_CONFIG_PARAMETERS, ...) into the environment of
// any process it runs — including a `pre-push` hook, and including whatever
// that hook goes on to run, such as `npm run check`. Once set, `git`
// prefers these variables over an explicit `-C <path>`/`--cwd`, so a test
// fixture's own `git init` / `git worktree add` / `git commit` stops
// operating on the disposable fixture and instead mutates whatever
// repository GIT_DIR names — which, from inside a hook of the real
// repository this suite lives in, is the real repository. This is the
// mechanism that produced dangling worktree registrations and injected
// branches (task/first, task/second, task/caller, task/live, task/stale,
// ...) in the real repository.
//
// `test/env-sanitize.ts` is preloaded via `node --import` ahead of every
// test module (see package.json's "test" script) specifically to strip
// these variables before any test file's top-level code — and therefore
// before any fixture git repository — runs. This test proves both ends of
// that claim: that the entry point actually preloads the sanitizer, and
// that a leaked GIT_DIR genuinely redirects an unsanitized `git` command
// into the wrong repository, so the regression this guards against is real
// and not hypothetical.

const testScript = "node --import ./test/env-sanitize.ts --test --test-reporter=spec test/*.test.ts";

test("the test script preloads the git environment sanitizer", () => {
  const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
  const packageJson = JSON.parse(
    execFileSync("cat", [packageJsonPath], { encoding: "utf8" }),
  ) as { scripts?: Record<string, string> };
  assert.equal(
    packageJson.scripts?.test,
    testScript,
    "the \"test\" npm script must preload test/env-sanitize.ts so every test " +
      "module's environment is already clean, protecting every entry point " +
      "(bare npm test, CI, and any git hook) rather than only one caller",
  );
});

test("a leaked GIT_DIR is what actually redirects git — the mechanism this guards against is real", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-git-env-leak-"));
  const decoy = join(directory, "decoy-real-repo");
  const fixture = join(directory, "fixture-repo");
  try {
    for (const repo of [decoy, fixture]) {
      run("git", ["init", "-q", "-b", "main", repo]);
      run("git", ["-C", repo, "config", "user.email", "a@b.c"]);
      run("git", ["-C", repo, "config", "user.name", "test"]);
    }
    writeFileSync(join(decoy, "real.txt"), "decoy pre-existing work\n");
    run("git", ["-C", decoy, "add", "."]);
    run("git", ["-C", decoy, "commit", "-qm", "decoy: pre-existing work"]);

    const decoyHeadBefore = headOf(decoy);

    // Simulate the leaked environment exactly as a git hook (and anything
    // it spawns) receives it: GIT_DIR/GIT_WORK_TREE/GIT_COMMON_DIR pointed
    // at the enclosing repository (here, the decoy), while a script issues
    // an explicit `-C fixture` against a different repository entirely.
    const leakedEnvironment = {
      ...process.env,
      GIT_COMMON_DIR: join(decoy, ".git"),
      GIT_DIR: join(decoy, ".git"),
      GIT_WORK_TREE: decoy,
    };
    const result = spawnSync(
      "git",
      ["-C", fixture, "checkout", "-b", "task/leak-proof"],
      { encoding: "utf8", env: leakedEnvironment },
    );
    assert.equal(result.status, 0, result.stderr);

    // The proof: with GIT_DIR leaked, the branch created "in the fixture"
    // lands in the decoy instead, and the decoy's HEAD commit is unchanged
    // only because checkout doesn't commit — but the branch itself, and any
    // future write through this environment, targets the decoy.
    const decoyBranches = run("git", ["-C", decoy, "branch"]).stdout;
    const fixtureBranches = run("git", ["-C", fixture, "branch"]).stdout;
    assert.match(
      decoyBranches,
      /task\/leak-proof/u,
      "an unsanitized GIT_DIR must redirect a fixture git command into the " +
        "decoy 'real' repository — if this assertion fails, git's own " +
        "behaviour changed and the sanitizer's premise should be re-checked",
    );
    assert.doesNotMatch(
      fixtureBranches,
      /task\/leak-proof/u,
      "the branch must NOT land in the fixture repository named by -C",
    );
    assert.equal(headOf(decoy), decoyHeadBefore, "decoy HEAD commit is unmoved by checkout alone");
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

function run(command: string, arguments_: string[]): { status: number | null; stdout: string } {
  const result = spawnSync(command, arguments_, { encoding: "utf8" });
  assert.equal(result.status, 0, `${command} ${arguments_.join(" ")}: ${result.stderr}`);
  return { status: result.status, stdout: result.stdout };
}

function headOf(repository: string): string {
  return spawnSync("git", ["-C", repository, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
}
