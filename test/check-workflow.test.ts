import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("the dependency audit includes development dependencies", () => {
  const workflow = readFileSync(".github/workflows/check.yml", "utf8");
  const auditStep = workflow.match(
    /^\s*- name: audit dependencies[^\n]*\n\s*run: ([^\n]+)$/m,
  );

  assert.ok(auditStep, "expected an audit dependencies step");
  const command = auditStep[1];
  assert.ok(command);
  assert.match(command, /(?:^|\s)--include=dev(?:\s|$)/);
  assert.doesNotMatch(command, /(?:^|\s)--omit=dev(?:\s|$)/);
  assert.match(command, /(?:^|\s)--audit-level=(?:high|critical)(?:\s|$)/);
});
