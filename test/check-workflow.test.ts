import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// The "tests actually ran" guard in check.yml is itself unguarded: if its awk
// expression regresses to counting skipped `ok` records instead of the TAP
// `# pass` total, a run where every test is skipped would be reported as
// passing assertions rather than as the empty suite it is. Extract the exact
// awk expression from the workflow and exercise it against fixture TAP
// output, so a regression in the guard fails the guard's own test.

const workflowPath = fileURLToPath(new URL("../.github/workflows/check.yml", import.meta.url));

function extractAwkExpression(): string {
  const workflow = readFileSync(workflowPath, "utf8");
  const match = /count=\$\(awk '([^']+)' tap\.txt\)/u.exec(workflow);
  if (match === null) {
    throw new Error("could not find the tests-actually-ran awk expression in check.yml");
  }
  return match[1] ?? "";
}

function runAwk(expression: string, tapText: string): string {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-check-workflow-"));
  const tapPath = join(directory, "tap.txt");
  writeFileSync(tapPath, tapText);
  try {
    return execFileSync("awk", [expression, tapPath], { encoding: "utf8" }).trim();
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("the CI no-tests guard reports zero when every test is skipped", () => {
  const expression = extractAwkExpression();
  const allSkippedTap = [
    "TAP version 13",
    "# Subtest: skipped",
    "ok 1 - skipped # SKIP",
    "1..1",
    "# tests 1",
    "# suites 0",
    "# pass 0",
    "# fail 0",
    "# cancelled 0",
    "# skipped 1",
    "# todo 0",
  ].join("\n");
  assert.equal(
    runAwk(expression, allSkippedTap),
    "0",
    "an all-skipped run must report zero passing assertions",
  );
});

test("the CI no-tests guard reports the TAP pass total when tests actually pass", () => {
  const expression = extractAwkExpression();
  const passingTap = [
    "TAP version 13",
    "# Subtest: works",
    "ok 1 - works",
    "1..1",
    "# tests 1",
    "# suites 0",
    "# pass 1",
    "# fail 0",
    "# cancelled 0",
    "# skipped 0",
    "# todo 0",
  ].join("\n");
  assert.equal(runAwk(expression, passingTap), "1");
});
