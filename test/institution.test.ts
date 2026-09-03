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

function foundingConfig(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    name: "Engineering",
    domain: "the software this person builds",
    sources: ["cli-source"],
    mayActAlone: ["read.source"],
    mustEscalate: ["spend.money"],
  };
}

function redrawConfig(): Record<string, unknown> {
  const { name: _name, ...mandate } = foundingConfig();
  return mandate;
}

test("a founded civilization resolves an authority context whose digest is derived from the stored mandate", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(foundingConfig()));

  const found = await runCli(["found", configPath], xdgDataHome);
  assert.equal(found.code, 0);
  assert.equal(found.output.outcome, "founded");
  const civilizationId = found.output.civilizationId as string;

  const resolved = await runCli(
    ["resolve-authority", civilizationId],
    xdgDataHome,
  );
  assert.equal(resolved.code, 0);

  const context = resolved.output.authorityContext as {
    civilizationId: string;
    authorityContext: { mandateId: string; mandateRevision: string; mandateDigest: string };
  };
  assert.equal(context.civilizationId, civilizationId);

  const database = new DatabaseSync(join(xdgDataHome, "ecosym", "observations.sqlite"), {
    readOnly: true,
  });
  const row = database
    .prepare("SELECT mandate_json FROM mandate_revisions WHERE civilization_id = ?")
    .get(civilizationId) as { mandate_json: string };
  database.close();
  const storedMandate = JSON.parse(row.mandate_json) as JsonValue;
  assert.equal(
    context.authorityContext.mandateDigest,
    `sha256:${sha256(canonicalJson(storedMandate))}`,
  );
});

test("a redrawn mandate refuses a context resolved under the previous revision", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-redraw-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(foundingConfig()));

  const founded = await runCli(["found", configPath], xdgDataHome);
  assert.equal(founded.code, 0);
  const civilizationId = founded.output.civilizationId as string;
  const first = await runCli(["resolve-authority", civilizationId], xdgDataHome);

  const redrawn = redrawConfig();
  redrawn.mustEscalate = ["spend.money", "hire.agent"];
  writeFileSync(configPath, JSON.stringify(redrawn));
  const redraw = await runCli(["redraw", civilizationId, configPath], xdgDataHome);
  assert.equal(redraw.output.outcome, "redrawn");

  const second = await runCli(["resolve-authority", civilizationId], xdgDataHome);
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

  const database = new DatabaseSync(join(xdgDataHome, "ecosym", "observations.sqlite"), {
    readOnly: true,
  });
  const history = database
    .prepare(
      `SELECT revision, previous_revision, mandate_json
         FROM mandate_revisions
        WHERE civilization_id = ?
        ORDER BY revision_order`,
    )
    .all(civilizationId) as {
    mandate_json: string;
    previous_revision: null | string;
    revision: string;
  }[];
  database.close();
  assert.deepEqual(
    history.map(({ revision, previous_revision: previousRevision }) => ({
      revision,
      previousRevision,
    })),
    [
      { revision: "revision:1", previousRevision: null },
      { revision: "revision:2", previousRevision: "revision:1" },
    ],
  );
  assert.deepEqual(JSON.parse(history[0]?.mandate_json ?? "null"), redrawConfig());
});

test("a mandate edited underneath the store refuses to resolve", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-tamper-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(foundingConfig()));
  const founded = await runCli(["found", configPath], xdgDataHome);
  assert.equal(founded.code, 0);
  const civilizationId = founded.output.civilizationId as string;

  // Edit the stored mandate directly, the way nothing legitimate ever would.
  // A digest cached at write time would still agree with its own column here;
  // only a digest re-derived from these bytes can notice.
  const database = new DatabaseSync(join(xdgDataHome, "ecosym", "observations.sqlite"));
  try {
    const tampered = redrawConfig();
    tampered.mayActAlone = ["read.source", "delete.repository"];
    database
      .prepare("UPDATE mandate_revisions SET mandate_json = ? WHERE civilization_id = ?")
      .run(canonicalJson(tampered as JsonValue), civilizationId);
  } finally {
    database.close();
  }

  const resolved = await runCli(["resolve-authority", civilizationId], xdgDataHome);
  assert.notEqual(resolved.code, 0);
  assert.equal(resolved.output.error, "mandate_unreadable");
});

test("resolution refuses an unknown and a dissolved civilization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-closed-"));
  const xdgDataHome = join(directory, "data");
  const configPath = join(directory, "civilization.json");
  writeFileSync(configPath, JSON.stringify(foundingConfig()));

  const unknown = await runCli(["resolve-authority", "civilization:absent"], xdgDataHome);
  assert.notEqual(unknown.code, 0);
  assert.equal(unknown.output.error, "civilization_not_found");

  const founded = await runCli(["found", configPath], xdgDataHome);
  assert.equal(founded.code, 0);
  const civilizationId = founded.output.civilizationId as string;
  assert.equal(
    (await runCli(["dissolve", civilizationId], xdgDataHome)).output.outcome,
    "dissolved",
  );
  const dissolved = await runCli(["resolve-authority", civilizationId], xdgDataHome);
  assert.notEqual(dissolved.code, 0);
  assert.equal(dissolved.output.error, "civilization_dissolved");
});

test("a second, structurally different civilization is founded from configuration alone", async () => {
  // PRODUCT.md: "the second civilization must be foundable without writing
  // code. If it cannot be, the engine was not general." Nothing below touches
  // src/ — the only input is a different JSON document.
  const directory = mkdtempSync(join(tmpdir(), "ecosym-institution-second-"));
  const xdgDataHome = join(directory, "data");

  const firstPath = join(directory, "first.json");
  writeFileSync(firstPath, JSON.stringify(foundingConfig()));
  const first = await runCli(["found", firstPath], xdgDataHome);
  assert.equal(first.output.outcome, "founded");

  const secondPath = join(directory, "second.json");
  writeFileSync(
    secondPath,
    JSON.stringify({
      schemaVersion: 1,
      name: "Household",
      domain: "the money and the house",
      sources: ["bank-export", "energy-meter"],
      mayActAlone: ["read.balance", "read.meter", "summarise.month"],
      mustEscalate: ["move.money", "sign.contract"],
    }),
  );
  const second = await runCli(["found", secondPath], xdgDataHome);
  assert.equal(second.code, 0);
  assert.equal(second.output.outcome, "founded");

  // Each resolves to its own authority, with its own derived digest.
  const one = await runCli(
    ["resolve-authority", first.output.civilizationId as string],
    xdgDataHome,
  );
  const two = await runCli(
    ["resolve-authority", second.output.civilizationId as string],
    xdgDataHome,
  );
  const digestOne = (one.output.authorityContext as AuthorityContext).authorityContext;
  const digestTwo = (two.output.authorityContext as AuthorityContext).authorityContext;
  assert.notEqual(digestOne.mandateDigest, digestTwo.mandateDigest);
  assert.equal(
    digestTwo.mandateDigest,
    `sha256:${sha256(canonicalJson(two.output.mandate as JsonValue))}`,
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
