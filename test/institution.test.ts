import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { canonicalJson, sha256, type JsonValue } from "../src/json.ts";
import { assertAuthorityContextMatches } from "../src/petition-request.ts";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface AuthorityContext {
  civilizationId: string;
  authorityContext: {
    mandateId: string;
    mandateRevision: string;
    mandateDigest: string;
  };
}

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

test("a redrawn mandate refuses a context resolved under the previous revision", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-redraw-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(mandateConfig()));

  assert.equal((await runCli(["found", configPath], xdgDataHome)).code, 0);
  const first = await runCli(["resolve-authority", "civilization:engineering"], xdgDataHome);

  const redrawn = mandateConfig() as Record<string, unknown>;
  redrawn.mustEscalate = ["spend.money", "hire.agent"];
  writeFileSync(configPath, JSON.stringify(redrawn));
  const redraw = await runCli(["found", configPath], xdgDataHome);
  assert.equal(redraw.output.outcome, "redrawn");

  const second = await runCli(["resolve-authority", "civilization:engineering"], xdgDataHome);
  assert.notEqual(
    (first.output.authorityContext as AuthorityContext).authorityContext.mandateDigest,
    (second.output.authorityContext as AuthorityContext).authorityContext.mandateDigest,
  );
  assert.throws(
    () =>
      assertAuthorityContextMatches(
        first.output.authorityContext,
        second.output.authorityContext,
      ),
    { rule: "authority_context_mismatch" },
  );

  // The refusal above fires on the revision string alone, so it does not yet
  // prove the digest is load-bearing. Hold every other field equal and let only
  // the mandate content differ: a comparison that never reads the digest passes
  // this, and it must not.
  const forged = structuredClone(second.output.authorityContext) as AuthorityContext;
  forged.authorityContext.mandateDigest = (
    first.output.authorityContext as AuthorityContext
  ).authorityContext.mandateDigest;
  assert.throws(
    () => assertAuthorityContextMatches(forged, second.output.authorityContext),
    { rule: "authority_context_mismatch" },
  );
});

test("a mandate edited underneath the store refuses to resolve", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-tamper-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(mandateConfig()));
  assert.equal((await runCli(["found", configPath], xdgDataHome)).code, 0);

  // Edit the stored mandate directly, the way nothing legitimate ever would.
  // A digest cached at write time would still agree with its own column here;
  // only a digest re-derived from these bytes can notice.
  const database = new DatabaseSync(join(xdgDataHome, "ecosym", "observations.sqlite"));
  try {
    database
      .prepare("UPDATE mandate_revisions SET mandate_json = ? WHERE civilization_id = ?")
      .run('{"schemaVersion":1,"id":"civilization:engineering"}', "civilization:engineering");
  } finally {
    database.close();
  }

  const resolved = await runCli(["resolve-authority", "civilization:engineering"], xdgDataHome);
  assert.notEqual(resolved.code, 0);
  assert.equal(resolved.output.error, "mandate_unreadable");
});

test("resolution refuses an unknown and a dissolved civilization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-closed-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(mandateConfig()));

  const unknown = await runCli(["resolve-authority", "civilization:absent"], xdgDataHome);
  assert.notEqual(unknown.code, 0);
  assert.equal(unknown.output.error, "civilization_not_found");

  assert.equal((await runCli(["found", configPath], xdgDataHome)).code, 0);
  assert.equal(
    (await runCli(["dissolve", "civilization:engineering"], xdgDataHome)).output.outcome,
    "dissolved",
  );
  const dissolved = await runCli(["resolve-authority", "civilization:engineering"], xdgDataHome);
  assert.notEqual(dissolved.code, 0);
  assert.equal(dissolved.output.error, "civilization_dissolved");
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
