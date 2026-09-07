import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import type { FoundedCivilizationSnapshot } from "../src/institution-snapshot.ts";
import { parseCivilizationConfig, parseMandateConfig } from "../src/institution.ts";
import { ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { createWorldServer } from "../src/world-server.ts";
import { validateWorldSnapshot, type WorldSnapshot } from "../src/world-snapshot.ts";

const body = { schemaVersion: 1, domain: "synthetic", sources: ["source"], mayActAlone: ["read"], mustEscalate: ["spend"] };
const entry: FoundedCivilizationSnapshot = {
  civilizationId: "civilization:synthetic", name: "Synthetic", foundedAt: "2026-01-01T00:00:00.000Z",
  bodyReadable: true, domain: body.domain, sources: body.sources, mayActAlone: body.mayActAlone,
  mustEscalate: body.mustEscalate,
  mandate: { status: "active", mandateId: "mandate:synthetic", revision: "revision:1", recordedAt: "2026-01-01T00:00:00.000Z" },
};

function snapshot(civilizations: FoundedCivilizationSnapshot[] = []): WorldSnapshot {
  return composeWorldSnapshot({
    listFoundedCivilizations: () => civilizations,
    narrate: () => ({ connections: [], attemptsInProgress: [], observations: [], claims: [], observationsTruncated: false, claimsTruncated: false }),
  });
}

function temporary(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-world-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

async function serve(t: TestContext, source: () => WorldSnapshot, build: string) {
  const server = createWorldServer(source, build);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return (path: string, method = "GET", host = `127.0.0.1:${address.port}`) =>
    new Promise<{ status: number; body: string; headers: import("node:http").IncomingHttpHeaders }>((resolve, reject) => {
      // node:http preserves raw traversal paths, unlike fetch's URL normalization.
      const req = request({ hostname: "127.0.0.1", port: address.port, path, method, setHost: false, headers: { Host: host } }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body, headers: res.headers }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    });
}

test("HTTP snapshot round-trips a real isolated store and refreshes redraw and dissolution", async (t) => {
  const directory = temporary(t);
  const store = new ObservationStore(directory);
  t.after(() => store.close());
  const get = await serve(t, () => composeWorldSnapshot(store), join(directory, "missing-build"));
  const empty = await get("/api/world-snapshot");
  assert.equal(empty.status, 200);
  assert.deepEqual(JSON.parse(empty.body), snapshot());
  const second = store.foundCivilization(parseCivilizationConfig({ ...body, name: "Second" }), new Date("2026-01-02"));
  const first = store.foundCivilization(parseCivilizationConfig({ ...body, name: "First" }), new Date("2026-01-01"));
  const verify = async () => {
    const response = await get("/api/world-snapshot");
    assert.equal(response.status, 200);
    assert.equal(response.headers["cache-control"], "no-store");
    const snapshot = JSON.parse(response.body);
    assert.deepEqual(snapshot, composeWorldSnapshot(store));
    assert.deepEqual(snapshot.civilizations.map((value: FoundedCivilizationSnapshot) => value.civilizationId),
      [first.civilizationId, second.civilizationId]);
    return snapshot.civilizations as FoundedCivilizationSnapshot[];
  };
  assert.equal((await verify())[0]!.bodyReadable, true);
  store.redrawMandate(first.civilizationId, parseMandateConfig({ ...body, domain: "redrawn" }), new Date("2026-01-03"));
  assert.equal((await verify())[0]!.domain, "redrawn");
  store.dissolveCivilization(first.civilizationId, new Date("2026-01-04"));
  assert.equal((await verify())[0]!.mandate.status, "dissolved");
});

const invalidEntries: unknown[] = [
  null, {}, { ...entry, name: undefined }, { ...entry, foundedAt: 123 }, { ...entry, extra: "secret" },
  { ...entry, bodyReadable: "true" }, { ...entry, sources: [4] }, { ...entry, sources: new Array(1) },
  { ...entry, mandate: { ...entry.mandate, extra: "secret" } },
  { ...entry, mandate: { ...entry.mandate, status: "unknown" } },
  { ...entry, mandate: { status: "active" } }, { ...entry, mandate: { status: "unreadable" } },
  { ...entry, bodyReadable: false },
  { ...entry, bodyReadable: false, domain: "", sources: [], mayActAlone: [], mustEscalate: ["not unknown"] },
  { ...entry, mandate: { status: "unreadable", revision: "revision:1" } },
];

test("invalid source shapes and thrown failures produce sanitized errors, never partial or stale data", async (t) => {
  let value: unknown = snapshot([entry]);
  let throws = false;
  const get = await serve(t, () => {
    if (throws) throw new Error("private /path/token");
    return value as WorldSnapshot;
  }, join(temporary(t), "absent"));
  assert.equal((await get("/api/world-snapshot")).status, 200);
  for (const invalid of [null, {}, { schemaVersion: 1, civilizations: [entry] },
    ...[...invalidEntries.map((entry) => [entry]), [entry, {}], null, {}, new Array(1)]
      .map((civilizations) => ({ ...snapshot([entry]), civilizations })),
    { ...snapshot([entry]), sourcePictures: [] }, { ...snapshot(), observationsTruncated: "false" }]) {
    value = invalid;
    const response = await get("/api/world-snapshot");
    assert.equal(response.status, 500);
    assert.deepEqual(JSON.parse(response.body), { error: "Verdensdata kunne ikke leses" });
    assert.equal(response.headers["cache-control"], "no-store");
  }
  throws = true;
  assert.equal((await get("/api/world-snapshot")).status, 500);
  assert.ok(!(await get("/api/world-snapshot")).body.includes("private"));
  throws = false;
  value = snapshot([entry]);
  assert.equal((await get("/api/world-snapshot")).status, 200);
});

test("shared validator rejects closed-shape violations and normalizes unknown bodies without aliases", () => {
  for (const value of [null, [], {}, { ...snapshot(), schemaVersion: 2 },
    { ...snapshot(), extra: true }, { schemaVersion: 1, civilizations: [] },
    ...invalidEntries.map((entry) => ({ ...snapshot(), civilizations: [entry] }))]) {
    assert.throws(() => validateWorldSnapshot(value));
  }
  const accessor = { ...entry };
  Object.defineProperty(accessor, "name", { get() { throw new Error("must not execute getter"); } });
  assert.throws(() => validateWorldSnapshot({ ...snapshot([entry]), civilizations: [accessor] }), /shape/);
  const symbol = { ...entry, [Symbol("secret")]: true };
  assert.throws(() => validateWorldSnapshot({ ...snapshot([entry]), civilizations: [symbol] }));
  assert.equal(entry.mandate.status, "active");
  for (const mandate of [entry.mandate, { ...entry.mandate, status: "dissolved" }, { status: "unreadable" }] as const) {
    const unknown = { ...entry, bodyReadable: false, domain: "", sources: [], mayActAlone: [], mustEscalate: [], mandate };
    const input = { ...snapshot([unknown]), civilizations: [unknown] };
    const output = validateWorldSnapshot(input);
    assert.deepEqual(output, input);
    assert.notEqual(output.civilizations[0], unknown);
    assert.notEqual(output.civilizations[0]!.sources, unknown.sources);
    assert.notEqual(output.civilizations[0]!.mandate, mandate);
  }
});

test("non-GET and invalid Host are refused before any store or filesystem access", async (t) => {
  let calls = 0;
  const get = await serve(t, () => { calls++; return snapshot(); }, temporary(t));
  const realpath = t.mock.method(fs, "realpath", () => { throw new Error("filesystem touched"); });
  const readFile = t.mock.method(fs, "readFile", () => { throw new Error("filesystem touched"); });
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    for (const path of ["/api/world-snapshot", "/", "/web/main.js", "/unknown"]) {
      const response = await get(path, method);
      assert.equal(response.status, 405);
      assert.equal(response.headers.allow, "GET");
    }
  }
  for (const host of ["attacker.example", "localhost", "127.0.0.1:1", "127.0.0.1", "[::1]:80", ""]) {
    for (const path of ["/api/world-snapshot", "/"]) assert.equal((await get(path, "GET", host)).status, 400);
  }
  assert.equal(calls, 0);
  assert.equal(realpath.mock.callCount(), 0);
  assert.equal(readFile.mock.callCount(), 0);
});

test("static assets use realpath containment and reject raw, encoded, and symlink escapes", async (t) => {
  const directory = temporary(t);
  const build = join(directory, "build");
  mkdirSync(join(build, "web"), { recursive: true });
  mkdirSync(join(build, "src"));
  writeFileSync(join(build, "index.html"), "<html>synthetic world</html>");
  writeFileSync(join(build, "web/main.js"), "export {};");
  writeFileSync(join(build, "src/validate-institution-snapshot.js"), "export {};");
  writeFileSync(join(directory, "canary.html"), "PRIVATE CANARY");
  writeFileSync(join(build, "private.sqlite"), "PRIVATE CANARY");
  symlinkSync(join(directory, "canary.html"), join(build, "escape.html"));
  symlinkSync(directory, join(build, "escape-directory"));
  symlinkSync(build, join(directory, "build-link"));
  symlinkSync(join(build, "index.html"), join(build, "inside.html"));
  const get = await serve(t, () => snapshot(), join(directory, "build-link"));
  assert.equal((await get("/")).body, "<html>synthetic world</html>");
  assert.equal((await get("/inside.html")).status, 200);
  for (const path of ["/web/main.js", "/src/validate-institution-snapshot.js"]) {
    const response = await get(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8");
  }
  for (const path of ["/../canary.html", "/%2e%2e%2fcanary.html", "/%2E%2E/canary.html",
    "/%252e%252e%252fcanary.html", "/web/../../canary.html", "/..%5ccanary.html",
    "/escape.html", "/escape-directory/canary.html", "/private.sqlite", "/%00.html", "/%.html",
    "//canary.html", "/not-found.html", "/api/other", "http://attacker.example/canary.html"]) {
    const response = await get(path);
    assert.ok(response.status >= 400 && response.status < 500, `${path}: ${response.status}`);
    assert.ok(!response.body.includes("PRIVATE CANARY"));
  }
});

test("launcher defaults to an ephemeral loopback port and closes an isolated store on SIGTERM", async (t) => {
  const directory = temporary(t);
  const child = spawn(process.execPath, ["src/world-main.ts"], {
    env: { ...process.env, XDG_DATA_HOME: directory }, stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const exit = once(child, "exit");
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Launcher timed out: ${stderr}`)), 10000);
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes("\n")) { clearTimeout(timer); resolve(stdout.trim()); }
    });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Launcher exited: ${stderr}`)); });
    child.once("error", reject);
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d*$/u);
  const response = await fetch(`${url}/api/world-snapshot`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot());
  child.kill("SIGTERM");
  assert.deepEqual(await exit, [0, null]);
});
