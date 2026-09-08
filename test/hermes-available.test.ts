import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { hermesAvailable } from "./hermes-available.ts";

test("native availability requires an executable file on an absolute PATH entry", (t) => {
  const root = mkdtempSync(resolve(".hermes-availability-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(hermesAvailable(root), false);
  assert.equal(hermesAvailable(""), false);
  const binary = join(root, "hermes");
  mkdirSync(binary);
  assert.equal(hermesAvailable(root), false);
  rmSync(binary, { recursive: true });
  writeFileSync(binary, "#!/bin/sh\nexit 0\n", { mode: 0o600 });
  assert.equal(hermesAvailable(root), false);
  chmodSync(binary, 0o700);
  assert.equal(hermesAvailable(root), true);
  assert.equal(hermesAvailable(join(root, "absent") + delimiter + root), true);
  assert.equal(hermesAvailable(root.slice(process.cwd().length + 1)), false);
  const links = join(root, "links");
  mkdirSync(links);
  symlinkSync(binary, join(links, "hermes"));
  assert.equal(hermesAvailable(links), true);
});
