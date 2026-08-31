import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface CliResult {
  code: number;
  output: Record<string, unknown>;
  stderr: string;
}

test("the command surface connects, collects, queries, and verifies", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-cli-"));
  const sourcePath = join(directory, "source.jsonl");
  const configPath = join(directory, "connection.json");
  const xdgDataHome = join(directory, "data");
  writeFileSync(
    sourcePath,
    '{"id":"record-1","subject":"subject-1","at":"2026-08-30T00:00:00.000Z","value":7,"secret":"not selected"}\n',
  );
  writeFileSync(
    configPath,
    JSON.stringify({
      schemaVersion: 1,
      id: "cli-source",
      factOwner: "external-owner",
      reader: { type: "jsonl", path: sourcePath },
      sourceRecord: {
        identity: [{ scope: "record", path: "id" }],
        retention: "history",
        recordedAt: {
          selector: { scope: "record", path: "at" },
          format: "iso8601",
        },
      },
      facts: [
        {
          epistemicStatus: "observation",
          kind: "api.value",
          subject: { scope: "record", path: "subject" },
          payload: { value: { scope: "record", path: "value" } },
        },
      ],
    }),
  );

  const connect = await runCli(["connect", configPath], xdgDataHome);
  assert.equal(connect.code, 0);
  assert.equal(connect.output.outcome, "connected");

  const before = await runCli(["status"], xdgDataHome);
  assert.equal(
    (before.output.connections as { status: string }[])[0]?.status,
    "unread",
  );

  const collect = await runCli(["collect"], xdgDataHome);
  assert.equal(collect.code, 0);
  assert.equal(collect.output.outcome, "success");

  const query = await runCli(["query", "observations", "--limit", "10"], xdgDataHome);
  assert.equal(query.code, 0);
  const records = query.output.records as { payload: unknown }[];
  assert.deepEqual(records.map((record) => record.payload), [{ value: 7 }]);
  assert.equal(JSON.stringify(query.output).includes("not selected"), false);

  const verify = await runCli(["verify"], xdgDataHome);
  assert.equal(verify.code, 0);
  assert.equal(verify.output.outcome, "agreement");

  writeFileSync(
    sourcePath,
    '{"id":"record-1","subject":"subject-1","at":"2026-08-30T00:00:00.000Z","value":8}\n',
  );
  const disagreement = await runCli(["verify"], xdgDataHome);
  assert.equal(disagreement.code, 1);
  assert.equal(disagreement.output.outcome, "disagreement");
  assert.equal(disagreement.stderr, "");
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
