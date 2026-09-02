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

function extractShellBlock(marker: string): string {
  const workflow = readFileSync(workflowPath, "utf8");
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start === -1) {
    throw new Error(`could not find the shell block marked ${marker} in check.yml`);
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

function extractAuditScript(): string {
  return extractShellBlock("# Exercised as a complete shell block by check-workflow.test.ts.");
}

function extractGateScript(): string {
  return extractShellBlock(
    "# Exercised as a complete shell block by check-workflow.test.ts: gate.",
  );
}

// The gate decides whether a run's evidence counts, so it is exercised whole —
// with a stub `node` standing in for the suite — rather than by pulling one awk
// expression out of it. A guard tested one expression at a time can have a
// broken expression sitting next to a correct one and stay green; that is
// exactly how `# skip` survived here while node was emitting `# skipped`.
function runGateScript(tapText: string, nodeStatus: number) {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-check-gate-"));
  const nodePath = join(directory, "node");
  writeFileSync(nodePath, '#!/bin/sh\nprintf "%s\\n" "$GATE_TAP"\nexit "$GATE_STATUS"\n');
  chmodSync(nodePath, 0o755);

  try {
    const result = spawnSync("bash", ["-e", "-c", extractGateScript()], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        GATE_STATUS: String(nodeStatus),
        GATE_TAP: tapText,
        PATH: `${directory}:${process.env.PATH ?? ""}`,
      },
    });
    return {
      output: `${result.stdout}\n${result.stderr}`,
      status: result.status,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function tap(counts: {
  cancelled?: number;
  fail?: number;
  pass?: number;
  records?: string[];
  skipped?: number;
}): string {
  return [
    "TAP version 13",
    ...(counts.records ?? ["ok 1 - works"]),
    "# tests 1",
    "# suites 0",
    `# pass ${counts.pass ?? 1}`,
    `# fail ${counts.fail ?? 0}`,
    `# cancelled ${counts.cancelled ?? 0}`,
    `# skipped ${counts.skipped ?? 0}`,
    "# todo 0",
  ].join("\n");
}

test("the gate accepts a run whose suite passed", () => {
  const result = runGateScript(tap({ pass: 2, records: ["ok 1 - a", "ok 2 - b"] }), 0);

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /pass 2, fail 0, cancelled 0, skipped 0/u);
});

test("a failing run names the test that failed, not just how many", () => {
  // The whole point of the step. A log that says "1 failed" and nothing else
  // cannot be acted on: that happened on PR #24, and the failing test had to
  // be hunted by re-running the suite locally.
  const failingTap = tap({
    fail: 1,
    pass: 1,
    records: ["ok 1 - the good one", "not ok 2 - the broken one", "  ---", "  error: 'boom'"],
  });
  const result = runGateScript(failingTap, 1);

  assert.notEqual(result.status, 0, "a failed suite closed the gate as passing");
  assert.match(
    result.output,
    /not ok 2 - the broken one/u,
    "the gate refused the run without naming the test that failed",
  );
  assert.match(result.output, /error: 'boom'/u, "the failure's diagnostics were discarded");
});

test("a cancelled run is refused and its record survives", () => {
  const result = runGateScript(
    tap({ cancelled: 1, pass: 0, records: ["not ok 1 - abandoned # CANCELLED"] }),
    1,
  );

  assert.notEqual(result.status, 0);
  assert.match(result.output, /not ok 1 - abandoned/u);
});

test("an all-skipped run proves nothing and is refused", () => {
  const result = runGateScript(tap({ pass: 0, records: ["ok 1 - skipped # SKIP"], skipped: 1 }), 1);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no tests ran/u);
});

test("skips do not excuse a non-zero runner exit", () => {
  // node --test exits 0 for a skipped test. Measured on v24.19.0, the version
  // .nvmrc pins: one pass plus one skip exits 0. The gate used to treat any
  // skip as an explanation for a non-zero status, which meant a genuine
  // runner crash was waved through as long as one test somewhere had been
  // skipped -- a hole justified by a belief about node that was never true.
  const result = runGateScript(
    tap({ pass: 3, records: ["ok 1 - a", "ok 2 - b", "ok 3 - c # SKIP"], skipped: 1 }),
    1,
  );

  assert.notEqual(
    result.status, 0,
    `a non-zero runner exit was excused by a skip: ${result.output}`,
  );
  assert.match(result.stderr, /did not run cleanly/u);
});

test("a clean run with skips is still accepted", () => {
  // The other side: skipping is normal (bwrap-dependent tests skip off CI).
  // A suite that skipped some tests and exited 0 must pass the gate.
  const result = runGateScript(
    tap({ pass: 3, records: ["ok 1 - a", "ok 2 - b", "ok 3 - c # SKIP"], skipped: 1 }),
    0,
  );

  assert.equal(result.status, 0, result.output);
  assert.match(result.stdout, /skipped 1/u, "the gate did not read the TAP skip total");
});

test("a truncated TAP summary is refused rather than read as zero", () => {
  const truncated = ["TAP version 13", "ok 1 - works", "# tests 1", "# pass 1", "# fail 0"].join(
    "\n",
  );
  const result = runGateScript(truncated, 0);

  assert.notEqual(result.status, 0, "a run that never finished was accepted");
  assert.match(result.stderr, /the run did not finish/u);
});

test("a summary missing only the skip total is refused, not silently read as zero", () => {
  // Every other count is present, so the run looks finished. But `skipped` is
  // the field that decides whether a non-zero runner exit was benign, and an
  // absent line and a real zero are indistinguishable once awk has run. If the
  // presence check stops covering it, the gate goes back to guessing.
  const withoutSkipped = [
    "TAP version 13",
    "ok 1 - works",
    "# tests 1",
    "# suites 0",
    "# pass 1",
    "# fail 0",
    "# cancelled 0",
    "# todo 0",
  ].join("\n");
  const result = runGateScript(withoutSkipped, 0);

  assert.notEqual(result.status, 0, "a summary with no skip total was accepted as complete");
  assert.match(result.stderr, /has no '# skipped' line/u);
});

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
    workflow, /cp "\$\(command -v node\)" \/usr\/bin\/node/u,
    "a symlink into /opt/hostedtoolcache resolves to a path the sandbox never " +
      "mounts; the binary has to physically live under /usr",
  );
  assert.match(
    workflow, /apparmor_restrict_unprivileged_userns=0/u,
    "Ubuntu 24.04 blocks unprivileged user namespaces, so bwrap fails with " +
      "'setting up uid map: Permission denied' and every enforcement test " +
      "fails for an environment reason rather than a real one",
  );
  assert.match(
    workflow, /bwrap[\s\S]{0,240}?-- \/usr\/bin\/node --version/u,
    "a host-side node check passes for a link the namespace cannot follow; " +
      "the probe has to run node from inside the sandbox",
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
