import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { once } from "node:events";
import { promises as fs, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";

import type { FoundedCivilizationSnapshot } from "../src/institution-snapshot.ts";
import { parseCivilizationConfig, parseMandateConfig } from "../src/institution.ts";
import { ObservationStore } from "../src/store.ts";
import { ProjectService } from "../src/projects.ts";
import { ProjectError } from "../src/project-types.ts";
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
    listProjects: () => [],
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
  assert.equal(JSON.parse(empty.body).schemaVersion, 2);
  assert.deepEqual(JSON.parse(empty.body).projects, []);
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

test("the server serves legacy schema 1 snapshots without adding projects", async (t) => {
  const { projects: _, ...fields } = snapshot([entry]);
  const legacy: WorldSnapshot = { ...fields, schemaVersion: 1 };
  const get = await serve(t, () => legacy, join(temporary(t), "absent"));
  const response = await get("/api/world-snapshot");
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), legacy);
});

test("shared validator rejects closed-shape violations and normalizes unknown bodies without aliases", () => {
  for (const value of [undefined, null, false, 0, "snapshot", [], {}, { ...snapshot(), schemaVersion: 3 },
    { ...snapshot(), extra: true }, { schemaVersion: 1, civilizations: [] },
    { ...snapshot(), observationsTruncated: "false" }, { ...snapshot(), claimsTruncated: "false" },
    ...invalidEntries.map((entry) => ({ ...snapshot(), civilizations: [entry] }))]) {
    assert.throws(() => validateWorldSnapshot(value));
  }
  for (const field of Object.keys(snapshot()).filter((field) => field !== "projects")) {
    const missing: Record<string, unknown> = { ...snapshot() };
    delete missing[field];
    assert.throws(() => validateWorldSnapshot(missing), `missing required top-level field: ${field}`);
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
  // Pin path wiring without requiring a pre-existing build in this launcher test.
  assert.match(await fs.readFile("src/world-main.ts", "utf8"),
    /createWorldServer\(\(\) => composeWorldSnapshot\(store\), fileURLToPath\(new URL\("\.\.\/dist\/world\/", import\.meta\.url\)\)\)/u);
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

async function projectServer(t: TestContext) {
  const directory = temporary(t);
  const store = new ObservationStore(join(directory, "state"));
  t.after(() => store.close());
  const civilization = store.foundCivilization(parseCivilizationConfig({ ...body, name: "Projects" }));
  let provisions = 0;
  const server = createWorldServer(() => composeWorldSnapshot(store), directory);
  server.projectService = new ProjectService(store, { root: join(directory, "projects"), adapter: {
    id: "hermes",
    async provision() { provisions++; return { kind: "unknown", reason: "harness_timeout" }; },
    async reconcile() { return { kind: "unknown", reason: "harness_timeout" }; },
  } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const host = `127.0.0.1:${address.port}`;
  const path = `/api/civilizations/${civilization.civilizationId}/projects`;
  const payload = { requestKey: randomUUID(), name: "Blåbær", harness: "hermes" };
  const send = async (options: { headers?: Record<string, string | undefined>; body?: string; path?: string; method?: string } = {}) => {
    const data = options.body ?? JSON.stringify(payload);
    const headers: Record<string, string | undefined> = {
      Host: host, Origin: `http://${host}`, "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json; charset=utf-8", "Content-Length": String(Buffer.byteLength(data)),
      ...options.headers,
    };
    return new Promise<{ status: number; body: string; allow: string | undefined }>((resolve, reject) => {
      const req = request({ hostname: "127.0.0.1", port: address.port, path: options.path ?? path,
        method: options.method ?? "POST", headers: Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode!, body: text, allow: res.headers.allow }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(data);
    });
  };
  return { server, store, host, port: address.port, path, payload, send, provisions: () => provisions };
}

test("project HTTP writes refuse each browser boundary before effects", async (t) => {
  const fixture = await projectServer(t);
  for (const headers of [
    { Host: "attacker.example" }, { Origin: undefined }, { Origin: "http://attacker.example" },
    { Origin: `http://${fixture.host}/` }, { "Sec-Fetch-Site": "cross-site" },
    { "Content-Type": "text/plain" }, { "Content-Type": "application/jsonp" }, { "Content-Type": undefined },
  ]) {
    const result = await fixture.send({ headers });
    assert.equal(result.status, 403);
    assert.deepEqual(JSON.parse(result.body), { error: "forbidden_origin", message: "Forespørselen er ikke tillatt" });
  }
  assert.deepEqual(fixture.store.listProjects(), []);
  assert.equal(fixture.provisions(), 0);
});

test("project HTTP writes refuse oversized, unframed, malformed and open-shape bodies", async (t) => {
  const fixture = await projectServer(t);
  for (const options of [
    { body: " ".repeat(8193) }, { headers: { "Content-Length": undefined, "Transfer-Encoding": "chunked" } }, { body: "{" },
    { body: JSON.stringify({ ...fixture.payload, workspacePath: "/private/canary" }) },
    { body: JSON.stringify({ ...fixture.payload, slug: "injected" }) },
    { body: JSON.stringify({ requestKey: "not-a-uuid", name: "name", harness: "hermes" }) },
    { body: "null" },
    { path: "/api/projects/project:missing/retry", body: JSON.stringify({ requestKey: randomUUID(), extra: true }) },
  ]) {
    const result = await fixture.send(options);
    assert.equal(result.status, 400);
    assert.equal(JSON.parse(result.body).error, "invalid_request");
    assert.ok(!result.body.includes("/private/canary"));
  }
  assert.deepEqual(fixture.store.listProjects(), []);
  assert.equal(fixture.provisions(), 0);
});

test("project HTTP framing rejects mismatched Content-Length over a real socket", async (t) => {
  const fixture = await projectServer(t);
  const data = JSON.stringify(fixture.payload);
  const result = await new Promise<string>((resolve, reject) => {
    const socket = connect(fixture.port, "127.0.0.1");
    t.after(() => socket.destroy());
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error("Framing refusal timed out")); });
    let response = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("error", reject);
    socket.on("end", () => resolve(response));
    socket.on("connect", () => socket.end(`POST ${fixture.path} HTTP/1.1\r\nHost: ${fixture.host}\r\nOrigin: http://${fixture.host}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(data) + 1}\r\n\r\n${data}`));
  });
  assert.match(result, /^HTTP\/1.1 400 /u);
  assert.match(result, /"error":"invalid_request"/u);
  assert.deepEqual(fixture.store.listProjects(), []);
  assert.equal(fixture.provisions(), 0);
});

test("project HTTP method gate precedes path parsing and non-write POST remains 405", async (t) => {
  const fixture = await projectServer(t);
  for (const options of [{ method: "DELETE", path: "/%" }, { method: "PUT" }, { path: "/api/world-snapshot" }, { path: "/" }]) {
    const response = await fixture.send(options);
    assert.equal(response.status, 405);
    assert.equal(response.allow, "GET");
  }
  assert.equal((await fixture.send({ path: "/%" })).status, 400);
  assert.deepEqual(fixture.store.listProjects(), []);
});

test("project HTTP creation, idempotent replay, conflict, retry and snapshot reload", async (t) => {
  const fixture = await projectServer(t);
  const results = await Promise.all(Array.from({ length: 10 }, () => fixture.send()));
  assert.equal(results.filter((result) => result.status === 201).length, 1);
  assert.equal(results.filter((result) => result.status === 200).length, 9);
  const project = JSON.parse(results.find((result) => result.status === 201)!.body);
  assert.ok(results.every((result) => JSON.parse(result.body).projectId === project.projectId));
  assert.equal(project.state, "external-unknown");
  assert.equal(project.harness, null);
  assert.equal(fixture.provisions(), 1);
  const conflict = await fixture.send({ body: JSON.stringify({ ...fixture.payload, name: "Changed" }) });
  assert.equal(conflict.status, 409);
  assert.equal(JSON.parse(conflict.body).error, "request_key_conflict");
  const retry = await fixture.send({ path: `/api/projects/${project.projectId}/retry`, body: JSON.stringify({ requestKey: randomUUID() }),
    headers: { "Sec-Fetch-Site": undefined } });
  assert.equal(retry.status, 200);
  assert.equal(JSON.parse(retry.body).attempt, 2);
  const reload = await fetch(`http://${fixture.host}/api/world-snapshot`);
  assert.deepEqual((await reload.json() as WorldSnapshot).projects, fixture.store.listProjects());
});

test("project HTTP errors never return native output or filesystem paths", async (t) => {
  const fixture = await projectServer(t);
  for (const error of [new Error("native stdout stderr /private/canary"), new ProjectError("containment_violation")]) {
    fixture.server.projectService = { async create() { throw error; }, async retry() { throw error; } };
    for (const options of [{}, { path: "/api/projects/project:missing/retry", body: JSON.stringify({ requestKey: randomUUID() }) }]) {
      const result = await fixture.send(options);
      assert.equal(result.status, 400);
      assert.deepEqual(JSON.parse(result.body), { error: error instanceof ProjectError ? error.code : "invalid_request",
        message: "Prosjektforespørselen kunne ikke fullføres" });
    }
  }
});

test("disconnected HTTP writes drain before shutdown closes their store", async (t) => {
  const fixture = await projectServer(t);
  let finish!: () => void;
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const release = new Promise<void>((resolve) => { finish = resolve; });
  fixture.server.projectService = new ProjectService(fixture.store, { root: temporary(t), adapter: {
    id: "hermes",
    async provision() { started(); await release; return { kind: "unknown", reason: "harness_timeout" }; },
    async reconcile() { throw new Error("not a retry"); },
  } });
  const request = fixture.send().catch(() => null);
  await running;
  let drained = false;
  const closing = new Promise<void>((resolve) => fixture.server.once("close", async () => {
    await fixture.server.drainProjectWrites();
    drained = true;
    resolve();
  }));
  fixture.server.close();
  fixture.server.closeAllConnections();
  await request;
  assert.equal(drained, false);
  finish();
  await closing;
  assert.equal(drained, true);
  assert.equal(fixture.store.listProjects()[0]!.reason, "harness_timeout");
  assert.match(await fs.readFile("src/world-main.ts", "utf8"), /await server\.drainProjectWrites\(\);\s+closeStore\(\)/u);
});
