import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const fixture = fileURLToPath(
  new URL("fixtures/fifth-source/habitat-survey.csv", import.meta.url),
);

test("connects, collects, queries, and verifies a declarative CSV source through the CLI", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-fifth-source-"));
  const sourcePath = join(directory, "habitat-survey.csv");
  const configPath = join(directory, "connection.json");
  const xdgDataHome = join(directory, "data");
  copyFileSync(fixture, sourcePath);
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "habitat-survey",
      factOwner: "field-survey",
      reader: { type: "csv", path: sourcePath, delimiter: "," },
      sourceRecord: {
        identity: [{ scope: "record", path: "survey_id" }],
        retention: "history",
        recordedAt: {
          selector: { scope: "record", path: "observed_at" },
          format: "iso8601",
        },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "field-survey.plant-condition",
          subject: { scope: "record", path: "plot_id" },
          payload: { value: { scope: "record", path: "condition" } },
        },
      ],
    }),
  );

  assert.equal((await runCli(["connect", configPath], xdgDataHome)).code, 0);
  assert.equal((await runCli(["collect", "habitat-survey"], xdgDataHome)).code, 0);

  const query = await runCli(
    ["query", "observations", "--connection", "habitat-survey"],
    xdgDataHome,
  );
  assert.equal(query.code, 0);
  assert.deepEqual(
    (query.output.records as { kind: string; payload: unknown }[]).map((record) => ({
      kind: record.kind,
      payload: record.payload,
    })),
    [{ kind: "field-survey.plant-condition", payload: { value: "flowering" } }],
  );
  assert.equal(JSON.stringify(query.output).includes("synthetic note"), false);

  const verification = await runCli(["verify"], xdgDataHome);
  assert.equal(verification.code, 0);
  assert.equal(verification.output.outcome, "agreement");
});

async function runCli(
  arguments_: string[],
  xdgDataHome: string,
): Promise<{ code: number; output: Record<string, unknown> }> {
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
  assert.equal(stderr, "");
  return { code, output: JSON.parse(stdout) as Record<string, unknown> };
}
