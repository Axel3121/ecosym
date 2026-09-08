import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { createServer } from "vite";

test("the production React boundary reads the world contract through the actual world launcher", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ecosym-frontend-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = resolve("dist/world");
  // This is the suite's only build writer. Stale output must not hide a wrong outDir.
  // check's final build runs only after the complete test process has exited.
  await rm(output, { recursive: true, force: true });
  await promisify(execFile)("npm", ["run", "build:world"], { timeout: 30000 });
  const child = spawn(process.execPath, ["src/world-main.ts", "--port", "0"], {
    env: { ...process.env, XDG_DATA_HOME: directory }, stdio: ["ignore", "pipe", "pipe"],
  });
  const exit = once(child, "exit");
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exit;
    }
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Launcher timed out: ${stderr}`)), 10000);
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.includes("\n")) { clearTimeout(timer); resolve(stdout.trim()); }
    });
    child.once("exit", () => { clearTimeout(timer); reject(new Error(`Launcher exited: ${stderr}`)); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
  });
  assert.match(url, /^http:\/\/127\.0\.0\.1:[1-9]\d*$/u);
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const html = await response.text();
  assert.deepEqual((await readdir(output)).sort(), ["assets", "index.html"]);
  assert.equal(html, await readFile(join(output, "index.html"), "utf8"));
  const script = html.match(/<script[^>]+src="([^"]+)"/u)?.[1];
  assert.ok(script);
  assert.match(script, /^\/assets\/.+\.js$/u);
  const bundle = await readFile(join(output, script), "utf8");
  assert.match(bundle, /\/api\/world-snapshot/u);
  assert.doesNotMatch(bundle, /node:sqlite|@vite\/client|react-refresh/u);
  assert.ok((await readdir(join(output, "assets"))).every((file) => /\.(js|css)$/u.test(file)));
  const asset = await fetch(`${url}${script}`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await asset.text(), bundle);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 667 }]) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    const requests: { url: string; method: string; type: string }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
    await page.goto(url);
    await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
    assert.equal(await page.title(), "EcoSym");
    await page.getByRole("status").filter({ hasText: "No civilizations have been founded." }).waitFor();
    await page.waitForLoadState("networkidle");
    assert.deepEqual(requests.filter((request) => request.type !== "stylesheet"), [
      { url: `${url}/`, method: "GET", type: "document" },
      { url: `${url}${script}`, method: "GET", type: "script" },
      { url: `${url}/api/world-snapshot`, method: "GET", type: "fetch" },
    ]);
    assert.deepEqual(errors, []);
    await page.close();
  }
  child.kill("SIGTERM");
  assert.deepEqual(await exit, [0, null]);
});

test("the Vite React boundary preserves loading, failures and orthogonal world evidence", { timeout: 60000 }, async (t) => {
  const server = await createServer({ configFile: resolve("vite.config.ts") });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.port, 5173);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  let respond!: () => void;
  let gate = new Promise<void>((resolve) => { respond = resolve; });
  let body: unknown = { schemaVersion: 1, civilizations: [], sourcePictures: [], observationsTruncated: false, claimsTruncated: false };
  let status = 200;
  await page.route("**/api/world-snapshot", async (route) => {
    await gate;
    await route.fulfill({ status, json: body });
  });
  const errors: string[] = [];
  const dataRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") || ["fetch", "xhr"].includes(request.resourceType())) {
      dataRequests.push(request.url());
    }
  });
  await Promise.all([page.waitForRequest("**/api/world-snapshot"), page.goto(`http://127.0.0.1:${address.port}`)]);
  await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
  assert.equal(await page.title(), "EcoSym");
  await page.getByRole("status").filter({ hasText: "Loading stored world snapshot." }).waitFor();
  respond();
  await page.getByRole("status").filter({ hasText: "No civilizations have been founded." }).waitFor();
  for (const failure of [{ status: 503, body: {}, text: "http (503)" }, { status: 200, body: {}, text: "invalid-response" }]) {
    status = failure.status;
    body = failure.body;
    gate = new Promise<void>((resolve) => { respond = resolve; });
    await Promise.all([page.waitForRequest("**/api/world-snapshot"), page.reload()]);
    respond();
    await page.getByRole("alert").filter({ hasText: failure.text }).waitFor();
    assert.equal(await page.locator("section").count(), 0);
  }
  status = 200;
  const instant = "2026-01-01T00:00:00.000Z";
  body = { schemaVersion: 1, civilizations: [{ civilizationId: "civilization:test", name: "Synthetic declaration", foundedAt: instant,
    bodyReadable: false, domain: "", sources: [], mayActAlone: [], mustEscalate: [],
    mandate: { status: "dissolved", mandateId: "mandate:test", revision: "v1", recordedAt: instant } }],
    sourcePictures: [{ civilizationId: "civilization:test", sources: [] }], observationsTruncated: true, claimsTruncated: false };
  gate = new Promise<void>((resolve) => { respond = resolve; });
  await Promise.all([page.waitForRequest("**/api/world-snapshot"), page.reload()]);
  respond();
  await page.getByRole("heading", { name: "Synthetic declaration" }).waitFor();
  await page.getByText("Inspect stored declaration and source evidence").click();
  const text = await page.locator("main").innerText();
  assert.match(text, /"bodyReadable":false/u);
  assert.match(text, /"status":"dissolved"/u);
  assert.match(text, /Sources unknown/u);
  assert.match(text, /observationsTruncated: true; claimsTruncated: false/u);
  assert.equal(await page.locator("canvas").count(), 0);
  await page.setViewportSize({ width: 375, height: 667 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(errors, ["Failed to load resource: the server responded with a status of 503 (Service Unavailable)"]);
  assert.ok(dataRequests.length >= 4);
  assert.ok(dataRequests.every((url) => new URL(url).pathname === "/api/world-snapshot"));
});

test("Vite hot-refreshes an isolated frontend copy without navigation", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ecosym-hmr-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "web");
  await cp("web", root, { recursive: true });
  await cp("src", join(directory, "src"), { recursive: true });
  await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
  const server = await createServer({ configFile: resolve("vite.config.ts"), root, logLevel: "silent", server: { port: 0, fs: { allow: [root] } } });
  t.after(() => server.close());
  await server.listen();
  const address = server.httpServer!.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  const url = `http://127.0.0.1:${address.port}`;
  const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    get(url, { headers: { Host: "attacker.example" } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on("error", reject);
  });
  assert.equal(invalidHostStatus, 403);
  const canary = join(directory, "private.txt");
  await writeFile(canary, "PRIVATE CANARY");
  const denied = await fetch(`${url}/@fs/${canary}`);
  assert.equal(denied.status, 403);
  assert.ok(!(await denied.text()).includes("PRIVATE CANARY"));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: { schemaVersion: 1, civilizations: [], sourcePictures: [], observationsTruncated: false, claimsTruncated: false } }));
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
  await page.goto(url);
  await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
  await page.getByRole("status").filter({ hasText: "No civilizations have been founded." }).waitFor();
  // A full reload would remove this marker; only the isolated copy is edited.
  await page.evaluate("window.__hmrMarker = true");
  const component = join(root, "App.tsx");
  await writeFile(component, (await readFile(component, "utf8")).replace('aria-label="EcoSym"', 'aria-label="EcoSym HMR test"'));
  await page.locator('main[aria-label="EcoSym HMR test"]').waitFor({ state: "attached" });
  assert.equal(await page.evaluate("window.__hmrMarker"), true);
  assert.deepEqual(errors, []);
  assert.ok(apiRequests.length > 0);
  assert.ok(apiRequests.every((url) => new URL(url).pathname === "/api/world-snapshot"));
});

test("manifest wiring guard keeps check connected to both typechecks, tests, and the production build", async () => {
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(scripts.check, "npm run typecheck && npm run typecheck:world && npm test && npm run build:world");
  assert.equal(scripts["build:world"], "vite build");
});
