import assert from "node:assert/strict";
import { once } from "node:events";
import { cp, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { build, createServer } from "vite";

import { createWorldServer } from "../src/world-server.ts";

test("a clean production bundle renders the blank React root through the world server", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ecosym-frontend-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "world");
  const nodeEnv = process.env.NODE_ENV;
  try {
    await build({ build: { outDir: output }, logLevel: "silent" });
  } finally {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
  }
  assert.deepEqual((await readdir(output)).sort(), ["assets", "index.html"]);
  const html = await readFile(join(output, "index.html"), "utf8");
  const script = html.match(/<script[^>]+src="([^"]+)"/u)?.[1];
  assert.ok(script);
  assert.match(script, /^\/assets\/.+\.js$/u);
  const bundle = await readFile(join(output, script), "utf8");
  assert.doesNotMatch(bundle, /\/api\/world-snapshot|node:sqlite|@vite\/client|react-refresh/u);
  assert.ok((await readdir(join(output, "assets"))).every((file) => file.endsWith(".js")));
  let reads = 0;
  const server = createWorldServer(() => { reads++; throw new Error("No data should be requested"); }, output);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(url);
    await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
    assert.equal(await page.title(), "EcoSym");
    assert.equal(await page.locator("body").innerText(), "");
    assert.equal(await page.locator("main").innerHTML(), "");
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.equal(reads, 0);
});

test("Vite serves the blank root and hot-refreshes an isolated component without navigation", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ecosym-hmr-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, "web");
  await cp("web", root, { recursive: true });
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
  const errors: string[] = [];
  const apiRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
  await page.goto(url);
  await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
  assert.equal(await page.locator("body").innerText(), "");
  // A full reload would remove this marker; only the isolated copy is edited.
  await page.evaluate("window.__hmrMarker = true");
  const component = join(root, "App.tsx");
  await writeFile(component, (await readFile(component, "utf8")).replace('aria-label="EcoSym"', 'aria-label="EcoSym HMR test"'));
  await page.locator('main[aria-label="EcoSym HMR test"]').waitFor({ state: "attached" });
  assert.equal(await page.evaluate("window.__hmrMarker"), true);
  assert.deepEqual(errors, []);
  assert.deepEqual(apiRequests, []);
});

test("check retains both typechecks, the full test suite, and the production build", async () => {
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(scripts.check, "npm run typecheck && npm run typecheck:world && npm test && npm run build:world");
  assert.equal(scripts["build:world"], "vite build");
});
