import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { chromium, type Browser } from "playwright";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { HermesProjectAdapter } from "../src/hermes-projects.ts";
import { parseCivilizationConfig } from "../src/institution.ts";
import type { WorldProjectSnapshot } from "../src/project-types.ts";
import { ProjectService } from "../src/projects.ts";
import { ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { createWorldServer } from "../src/world-server.ts";
import { validateWorldSnapshot } from "../src/world-snapshot.ts";
import { hermesAvailable } from "./hermes-available.ts";

function assertIsolated(root: string, home: string) {
  assert.ok(isAbsolute(home), "DANGER: native test requires an absolute Hermes home");
  assert.notEqual(resolve(home), resolve(homedir(), ".hermes"),
    "DANGER: native test targets the user's real ~/.hermes");
  const within = relative(root, home);
  assert.ok(within && within !== ".." && !within.startsWith(`..${sep}`) && !isAbsolute(within),
    "DANGER: Hermes home escaped the isolated test tree");
}

test("native integration isolation rejects real ~/.hermes before even resolving an absent binary", async (t) => {
  const root = mkdtempSync(resolve(".native-project-isolation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const adapter = (home: string) => {
    assertIsolated(root, home);
    return new HermesProjectAdapter({ root, home: root,
      env: { HERMES_HOME: home, PATH: root }, binary: join(root, "absent-hermes") });
  };
  assert.throws(() => adapter(join(homedir(), ".hermes")), /DANGER:.*real ~\/\.hermes/);
  assert.throws(() => adapter(resolve(root, "..", "escaped-profile")), /DANGER:.*escaped/);
  assert.deepEqual(await adapter(join(root, "profile")).reconcile({
    name: "Fjordkart", slug: "fjordkart", workspacePath: join(root, "workspaces", "fjordkart"),
  }), { kind: "unknown", reason: "harness_unavailable" });
});

test("real HTTP native create and show primary readback survive browser reload", { timeout: 60_000 }, async (t) => {
  // Keep even the disposable state inside the repo; never inspect a user's profile.
  const root = mkdtempSync(resolve(".native-project-integration-"));
  const profile = join(root, "profile");
  const home = join(root, "home");
  const workspaces = join(root, "workspaces");
  const state = join(root, "state");
  let store: ObservationStore | undefined;
  let server: ReturnType<typeof createWorldServer> | undefined;
  let vite: ViteDevServer | undefined;
  let browser: Browser | undefined;
  t.after(async () => {
    await browser?.close();
    await vite?.close();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise<void>((done, reject) => server!.close((error) => error ? reject(error) : done()));
    }
    store?.close();
    rmSync(root, { recursive: true, force: true });
  });
  for (const path of [profile, home, workspaces]) mkdirSync(path, { mode: 0o700 });
  const env = { PATH: process.env.PATH, HERMES_HOME: profile, ECOSYM_HARNESS_HOME: profile };
  // Unconditional and before adapter construction: missing Hermes must not skip safety.
  assertIsolated(root, env.HERMES_HOME);
  assertIsolated(root, env.ECOSYM_HARNESS_HOME);
  assertIsolated(root, home);
  assertIsolated(root, workspaces);
  assert.equal(env.HERMES_HOME, profile, "DANGER: native call escaped test profile");
  assert.notEqual(realpathSync(profile), join(homedir(), ".hermes"), "DANGER: real Hermes home");
  if (!hermesAvailable(env.PATH)) {
    t.skip("Native integration skipped: no executable hermes on PATH; profile isolation verified");
    return;
  }
  const adapter = new HermesProjectAdapter({ root: workspaces, home, env });
  store = new ObservationStore(state);
  const { civilizationId } = store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1,
    name: "Native integration", domain: "Isolated native workspace", sources: [], mayActAlone: [], mustEscalate: [] }));
  server = createWorldServer(() => composeWorldSnapshot(store!), join(root, "unused-build"));
  server.projectService = new ProjectService(store, { root: workspaces, adapter });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const apiUrl = `http://127.0.0.1:${address.port}`;
  const reload = async () => {
    const response = await fetch(`${apiUrl}/api/world-snapshot`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return validateWorldSnapshot(await response.json());
  };
  assert.deepEqual((await reload()).projects, []);

  // Use the existing dev-server pattern, with real HTTP snapshot forwarding, not fixtures.
  vite = await createViteServer({ configFile: resolve("vite.config.ts"),
    cacheDir: join(root, "vite-cache"), logLevel: "silent",
    server: { port: 0, fs: { allow: [resolve("web"), resolve("src")] },
      proxy: { "/api/world-snapshot": { target: apiUrl, changeOrigin: true } } },
  });
  await vite.listen();
  const frontendAddress = vite.httpServer!.address();
  assert.ok(frontendAddress && typeof frontendAddress !== "string");
  const frontendUrl = `http://127.0.0.1:${frontendAddress.port}`;
  browser = await chromium.launch();
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(frontendUrl);
  await page.getByRole("button", { name: "Inspect Native integration", exact: true }).click();
  await page.getByText("Ingen prosjekter", { exact: true }).waitFor();

  const response = await fetch(`${apiUrl}/api/civilizations/${encodeURIComponent(civilizationId)}/projects`, {
    method: "POST", headers: { Origin: apiUrl, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" },
    body: JSON.stringify({ requestKey: randomUUID(), name: "Bl\u00e5b\u00e6r \u00d8", harness: "hermes" }),
  });
  assert.equal(response.status, 201);
  const project = await response.json() as WorldProjectSnapshot;
  assert.equal(project.state, "established",
    `Available native Hermes must establish the project: ${project.reason ?? project.state}`);
  assert.ok(project.harness);
  assert.equal(project.harness.provenance, "created");
  assert.ok(statSync(project.workspacePath).isDirectory());
  assertIsolated(workspaces, project.workspacePath);

  // reconcile executes real list --all + show and only binds an exact primary: match.
  const readback = await adapter.reconcile(project);
  assert.equal(readback.kind, "bound", "Native show must read back the created workspace as primary");
  assert.ok(readback.kind === "bound");
  assert.equal(readback.binding.externalId, project.harness.externalId);
  assert.equal(readback.binding.externalSlug, project.harness.externalSlug);
  assert.equal(readback.binding.externalArchived, false);
  assert.equal(readback.binding.provenance, "adopted");
  assert.equal(readback.binding.harnessHome, profile);
  assertIsolated(root, readback.binding.harnessHome);
  assert.match(readback.binding.harnessVersion, /^\d+\.\d+\.\d+/);
  t.diagnostic(`Native Hermes ${readback.binding.harnessVersion}: create and show primary readback verified`);

  assert.deepEqual((await reload()).projects, [project]);
  store.close();
  store = new ObservationStore(state);
  const reloaded = await reload();
  assert.deepEqual(reloaded.projects, [project]);
  assert.equal(reloaded.projects![0]!.civilizationId, civilizationId);
  assert.ok(reloaded.civilizations.some((civilization) => civilization.civilizationId === civilizationId));

  const snapshotResponse = page.waitForResponse(`${frontendUrl}/api/world-snapshot`);
  await page.reload();
  const loaded = await snapshotResponse;
  assert.equal(loaded.status(), 200);
  assert.deepEqual(validateWorldSnapshot(await loaded.json()).projects, [project]);
  await page.getByRole("button", { name: "Inspect Native integration", exact: true }).click();
  const projects = page.getByRole("region", { name: "Prosjekter", exact: true });
  await projects.getByRole("heading", { name: project.name, exact: true }).waitFor();
  assert.equal(await projects.getByText(project.workspacePath, { exact: true }).isVisible(), true);
  const mark = `Observert registrert i hermes (${project.harness.externalSlug}, ${project.harness.externalId}) ${project.harness.observedAt}. Erkl\u00e6rt sted, ikke bevis p\u00e5 arbeid.`;
  assert.equal(await projects.getByText(mark, { exact: true }).isVisible(), true);
  assert.equal(await projects.getByText("Ingen prosjekter", { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  t.diagnostic("Real HTTP POST returned 201; Chromium reload displayed the persisted native project and observed binding");
});
