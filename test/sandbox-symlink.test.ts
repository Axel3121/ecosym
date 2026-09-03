import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ConnectionConfig } from "../src/config.ts";
import { prepareSandboxSources } from "../src/sandbox.ts";

function jsonlConnection(path: string): ConnectionConfig {
  return {
    schemaVersion: 1,
    id: "jsonl-source",
    factOwner: "fixture",
    reader: { type: "jsonl", path },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "fixture.upload",
        payload: { index: { scope: "meta", value: "record-index" } },
        required: [],
        subject: { scope: "meta", value: "record-index" },
      },
    ],
  };
}

function jsonConnection(pathPattern: string): ConnectionConfig {
  return {
    schemaVersion: 1,
    id: "json-source",
    factOwner: "fixture",
    reader: { type: "json", pathPattern, recordsPath: "videos" },
    sourceRecord: {
      identity: [{ scope: "meta", value: "record-index" }],
      retention: "latest",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "fixture.metric",
        payload: { index: { scope: "meta", value: "record-index" } },
        required: [],
        subject: { scope: "meta", value: "record-index" },
      },
    ],
  };
}

test("a declared source may not be a symlink to a file outside it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-declared-"));
  const secrets = join(directory, "secrets");
  const sources = join(directory, "sources");
  mkdirSync(secrets);
  mkdirSync(sources);

  const secret = join(secrets, "id_rsa");
  writeFileSync(secret, "PRIVATE KEY\n");
  const declared = join(sources, "observations.jsonl");
  symlinkSync(secret, declared);

  try {
    await assert.rejects(
      prepareSandboxSources([jsonlConnection(declared)], directory),
      /Declared source is a symlink/u,
      "a symlink named as a source imports whatever it points at",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a declared source that is a real file still mounts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-realfile-"));
  const declared = join(directory, "observations.jsonl");
  writeFileSync(declared, '{"a":1}\n');

  try {
    const prepared = await prepareSandboxSources([jsonlConnection(declared)], directory);
    try {
      assert.deepEqual(
        prepared.mounts.map((mount) => mount.source),
        [declared],
      );
    } finally {
      prepared.close();
    }
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a glob match that is a symlink is refused with the rest of the batch", async () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-globbed-"));
  const secrets = join(directory, "secrets");
  const reports = join(directory, "reports");
  mkdirSync(secrets);
  mkdirSync(reports);

  writeFileSync(join(secrets, "token"), "ghp-secret\n");
  writeFileSync(join(reports, "honest.json"), '{"videos":[]}\n');
  symlinkSync(join(secrets, "token"), join(reports, "evil.json"));

  try {
    await assert.rejects(
      prepareSandboxSources([jsonConnection(join(reports, "*.json"))], directory),
      /Declared source is a symlink/u,
      "one symlink dropped into a globbed source directory reads any file on the host",
    );
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
