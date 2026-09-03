import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256, type JsonValue } from "../src/json.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface CliResult {
  code: number;
  output: Record<string, unknown>;
  stderr: string;
}

function mandateConfig(): unknown {
  return {
    schemaVersion: 1,
    id: "civilization:engineering",
    domain: "the software this person builds",
    sources: ["cli-source"],
    mayActAlone: ["read.source"],
    mustEscalate: ["spend.money"],
  };
}

test("a founded civilization resolves an authority context whose digest is derived from the stored mandate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(mandateConfig()));

  const found = await runCli(["found", configPath], xdgDataHome);
  assert.equal(found.code, 0);
  assert.equal(found.output.outcome, "founded");

  const resolved = await runCli(
    ["resolve-authority", "civilization:engineering"],
    xdgDataHome,
  );
  assert.equal(resolved.code, 0);

  const context = resolved.output.authorityContext as {
    civilizationId: string;
    authorityContext: { mandateId: string; mandateRevision: string; mandateDigest: string };
  };
  assert.equal(context.civilizationId, "civilization:engineering");

  // The digest must be the digest of the mandate the store actually holds,
  // recomputed here from the reported content rather than trusted as reported.
  const storedMandate = resolved.output.mandate as JsonValue;
  assert.equal(
    context.authorityContext.mandateDigest,
    `sha256:${sha256(canonicalJson(storedMandate))}`,
  );
});

async function runCli(arguments_: string[], xdgDataHome: string): Promise<CliResult> {
  const child = spawn(process.execPath, [cli, ...arguments_], {
    env: { ...process.env, XDG_DATA_HOME: xdgDataHome },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const code = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode) => resolve(exitCode ?? -1));
  });
  return {
    code,
    output: JSON.parse(stdout) as Record<string, unknown>,
    stderr,
  };
}
