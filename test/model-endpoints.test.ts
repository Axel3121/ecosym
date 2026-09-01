import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

// SECURITY.md requires every configured endpoint to be chosen by reading its
// provider's data policy. This test cannot check what a provider's policy says
// today; it checks that nothing reaches a model through an endpoint nobody
// recorded a decision about. That is the failure this repository actually had:
// an endpoint picked for latency, with the policy never read.

const repositoryRoot = join(import.meta.dirname, "..");

type ApprovedEndpoints = {
  endpoints: { id: string; policyRead: string; retention: string; source: string }[];
  refused: { id: string; reason: string }[];
};

function approvedEndpoints(): ApprovedEndpoints {
  return JSON.parse(
    readFileSync(join(repositoryRoot, ".opencode/approved-endpoints.json"), "utf8"),
  ) as ApprovedEndpoints;
}

function configuredEndpoints(): { source: string; id: string }[] {
  const found: { source: string; id: string }[] = [];

  const config = JSON.parse(
    readFileSync(join(repositoryRoot, "opencode.json"), "utf8"),
  ) as Record<string, unknown>;
  for (const key of ["model", "small_model"]) {
    const value = config[key];
    if (typeof value === "string") {
      found.push({ source: `opencode.json ${key}`, id: value });
    }
  }

  const agentDirectory = join(repositoryRoot, ".opencode/agent");
  for (const entry of readdirSync(agentDirectory)) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    const text = readFileSync(join(agentDirectory, entry), "utf8");
    const match = /^model:\s*(\S+)\s*$/m.exec(text);
    if (match !== null) {
      found.push({ source: `.opencode/agent/${entry}`, id: match[1] as string });
    }
  }

  return found;
}

test("every configured model endpoint has a recorded data-policy decision", () => {
  const approved = new Set(approvedEndpoints().endpoints.map((entry) => entry.id));
  const unrecorded = configuredEndpoints().filter((entry) => !approved.has(entry.id));
  assert.deepEqual(
    unrecorded,
    [],
    "an endpoint is configured that .opencode/approved-endpoints.json does not record",
  );
});

test("an endpoint refused for its data policy is never configured", () => {
  const refused = new Map(
    approvedEndpoints().refused.map((entry) => [entry.id, entry.reason]),
  );
  const violations = configuredEndpoints()
    .filter((entry) => refused.has(entry.id))
    .map((entry) => `${entry.source}: ${entry.id} (${refused.get(entry.id) ?? ""})`);
  assert.deepEqual(violations, []);
});

test("every approved endpoint records what was read and when", () => {
  for (const entry of approvedEndpoints().endpoints) {
    assert.match(
      entry.policyRead,
      /^\d{4}-\d{2}-\d{2}$/,
      `${entry.id} does not record the date its policy was read`,
    );
    assert.notEqual(entry.retention.trim(), "", `${entry.id} records no retention terms`);
    assert.match(entry.source, /^https:\/\//, `${entry.id} cites no policy source`);
  }
});
