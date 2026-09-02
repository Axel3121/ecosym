import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function extractAuditScript(): string {
  const workflow = readFileSync(workflowPath, "utf8");
  const lines = workflow.split("\n");
  const marker = "# Exercised as a complete shell block by check-workflow.test.ts.";
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start === -1) {
    throw new Error("could not find the dependency audit script in check.yml");
  }

  const indentation = /^\s*/u.exec(lines[start] ?? "")?.[0] ?? "";
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line !== "" && !line.startsWith(indentation)) {
      break;
    }
    end += 1;
  }
  return lines
    .slice(start, end)
    .map((line) => line.slice(indentation.length))
    .join("\n")
    .trimEnd();
}

function runAuditScript(report: object, auditStatus: number) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-check-audit-"));
  const npmPath = join(directory, "npm");
  const argsPath = join(directory, "args.txt");
  writeFileSync(
    npmPath,
    '#!/bin/sh\nprintf "%s\\n" "$*" > "$AUDIT_ARGS_PATH"\nprintf "%s\\n" "$AUDIT_REPORT"\nexit "$AUDIT_STATUS"\n',
  );
  chmodSync(npmPath, 0o755);

  try {
    const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", extractAuditScript()], {
      encoding: "utf8",
      env: {
        ...process.env,
        AUDIT_ARGS_PATH: argsPath,
        AUDIT_REPORT: JSON.stringify(report),
        AUDIT_STATUS: String(auditStatus),
        PATH: `${directory}:${process.env.PATH ?? ""}`,
      },
    });
    return {
      args: readFileSync(argsPath, "utf8").trim(),
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

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

test("CI installs the sandbox runtime so enforcement is actually exercised", () => {
  // The sandbox tests skip themselves when bwrap is missing. That is correct
  // locally and catastrophic in CI: the only tests that prove an agent shell
  // cannot escape its worktree quietly do not run, and the job goes green.
  // Measured on PR #24 — 11 skipped, reported as a pass.
  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(
    workflow, /apt-get install[^\n]*bubblewrap/u,
    "CI does not install bwrap, so every sandbox enforcement test skips",
  );
  assert.match(
    workflow, /ln -sf[^\n]*\/usr\/bin\/node/u,
    "the sandbox binds /usr read-only and setup-node installs elsewhere, so " +
      "without this link the sandbox child has no node to run",
  );
});

test("the CI audit examines the non-empty development dependency set", () => {
  const result = runAuditScript({ metadata: { dependencies: { total: 3 } } }, 0);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.args, "audit --include=dev --audit-level=high --json");
  assert.match(
    result.stdout,
    /npm audit examined 3 dependency packages \(including development dependencies\)/u,
  );
});

test("the CI audit preserves npm's advisory failure status", () => {
  const result = runAuditScript(
    {
      metadata: { dependencies: { total: 1 } },
      vulnerabilities: { lodash: { severity: "high" } },
    },
    1,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /"severity":"high"/u);
});

test("the CI audit rejects an empty dependency set", () => {
  const result = runAuditScript({ metadata: { dependencies: { total: 0 } } }, 0);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /npm audit examined no dependency packages/u);
});
