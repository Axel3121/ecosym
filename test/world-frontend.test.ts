import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { createServer } from "vite";
import ts from "typescript";
import { validateWorldSnapshot, type WorldSnapshot } from "../src/world-snapshot.ts";
import { worldForm } from "../src/world-form.ts";

const pureSources = ["world-form.ts", "world-snapshot.ts", "project-types.ts", "institution-snapshot.ts", "observation-snapshot.ts", "validate-institution-snapshot.ts", "time.ts", "source-report.ts", "source-report-time.ts"];
const empty: WorldSnapshot = { schemaVersion: 2, civilizations: [], sourcePictures: [], projects: [], observationsTruncated: false, claimsTruncated: false };

function foundedSnapshot(): WorldSnapshot {
  const snapshot = structuredClone(empty);
  const instant = "2026-01-01T00:00:00.000Z";
  for (const [index, reason] of ([null, "never-run", "nothing-new", "failed", "incomplete", "retired", "skipped", "record-index-unknown", "collected"] as const).entries()) {
    const connectionId = `synthetic-source:${index}`;
    const civilizationId = `synthetic-civilization:${index}`;
    snapshot.civilizations.push({ civilizationId, name: `Synthetic ${index}`, foundedAt: instant, bodyReadable: true,
      domain: `Declared domain ${index}`, sources: [connectionId], mayActAlone: ["Read synthetic records"], mustEscalate: ["Change synthetic policy"],
      mandate: { status: index === 3 ? "dissolved" : "active", mandateId: `mandate:${index}`, revision: "v1", recordedAt: instant } });
    snapshot.sourcePictures.push({ civilizationId, sources: [{ connectionId,
      collection: reason === null ? null : { connectionId, connectionVersion: "v1", reason,
        status: reason === "nothing-new" ? "quiet" : reason === "collected" ? "changed" : "unread", lastAttemptAt: reason === "never-run" ? null : instant },
      attemptsInProgress: reason === "incomplete" ? [{ attemptId: "synthetic-running", connectionId, connectionVersion: "v1", startedAt: instant }] : [],
      observations: [], claims: [] }] });
  }
  const source = snapshot.sourcePictures.at(-1)!.sources[0]!;
  for (const [index, temporalStatus] of (["unknown", "current", "historical"] as const).entries()) {
    for (const epistemicStatus of ["observation", "claim"] as const) {
      source[epistemicStatus === "claim" ? "claims" : "observations"].push({ id: index * 2 + (epistemicStatus === "claim" ? 2 : 1),
        collectedAt: instant, connectionId: source.connectionId, connectionVersion: "v1", collectionAsOf: null, epistemicStatus,
        factOwner: "synthetic-owner", kind: "record", payload: { text: "<b>synthetic, not markup</b>" },
        sourceRecordedAt: temporalStatus === "unknown" ? null : instant, sourceRecordId: `record:${index}`, subject: "synthetic-subject", temporalStatus });
    }
  }
  for (const bodyReadable of [true, false]) {
    const civilizationId = `synthetic-body:${bodyReadable}`;
    snapshot.civilizations.push({ civilizationId, name: `Synthetic body ${bodyReadable}`, foundedAt: instant, bodyReadable,
      domain: bodyReadable ? "No sources declared" : "", sources: [], mayActAlone: [], mustEscalate: [],
      mandate: bodyReadable ? { status: "active", mandateId: "mandate:empty", revision: "v1", recordedAt: instant } : { status: "unreadable" } });
    snapshot.sourcePictures.push({ civilizationId, sources: [] });
  }
  snapshot.observationsTruncated = snapshot.claimsTruncated = true;
  snapshot.sourcePictures.reverse();
  return validateWorldSnapshot(snapshot);
}

test("the production world surface uses the actual build and launcher with isolated synthetic browser fixtures", { timeout: 120000 }, async (t) => {
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
  const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/gu)].map((match) => match[1]!);
  assert.ok(styles.length > 0);
  for (const style of styles) {
    assert.match(style, /^\/assets\/.+\.css$/u);
    const css = await fetch(`${url}${style}`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(css.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await css.text(), await readFile(join(output, style), "utf8"));
  }
  const asset = await fetch(`${url}${script}`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await asset.text(), bundle);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    const requests: { url: string; method: string; type: string }[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
    const snapshotResponse = page.waitForResponse(`${url}/api/world-snapshot`);
    await page.goto(url);
    await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
    assert.equal(await page.title(), "EcoSym");
    const loaded = await snapshotResponse;
    assert.equal(loaded.status(), 200);
    assert.deepEqual(validateWorldSnapshot(await loaded.json()), empty);
    await page.getByRole("heading", { name: "No civilizations founded" }).waitFor();
    assert.equal(await page.locator(".place, .inspection").count(), 0);
    assert.match(await page.locator('.world-message[role="status"]').innerText(), /Nothing has been placed here/u);
    await page.waitForLoadState("networkidle");
    assert.deepEqual(requests.sort((a, b) => a.url.localeCompare(b.url)), [
      { url: `${url}/`, method: "GET", type: "document" },
      { url: `${url}${script}`, method: "GET", type: "script" },
      ...styles.map((style) => ({ url: `${url}${style}`, method: "GET", type: "stylesheet" })),
      { url: `${url}/api/world-snapshot`, method: "GET", type: "fetch" },
    ].sort((a, b) => a.url.localeCompare(b.url)));
    assert.deepEqual(errors, []);
    await page.close();
  }
  await t.test("loading, HTTP, request, invalid and loaded empty are distinct", async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    let mode = "loading";
    const expectedNetworkErrors = new Set(["http", "request"]);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const expected = mode === "http" ? "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"
        : mode === "request" ? "Failed to load resource: net::ERR_FAILED" : null;
      // Permit at most one exact resource error per deliberately failed API request.
      if (message.text() === expected && message.location().url === `${url}/api/world-snapshot` && expectedNetworkErrors.delete(mode)) return;
      errors.push(message.text());
    });
    try {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/api/world-snapshot", async (route) => {
        assert.equal(route.request().method(), "GET");
        if (mode === "loading") { await pending; await route.fulfill({ json: empty }); }
        else if (mode === "http") await route.fulfill({ status: 503, body: "synthetic unavailable" });
        else if (mode === "request") await route.abort("failed");
        else await route.fulfill({ json: { ...empty, extra: "invalid contract" } });
      });
      await page.goto(url);
      await page.getByRole("heading", { name: "Reading the world", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Read again" }).isDisabled(), true);
      assert.equal(await page.locator(".place, .inspection").count(), 0);
      release();
      await page.getByRole("heading", { name: "No civilizations founded" }).waitFor();
      for (const [kind, heading] of [["http", "World unavailable / HTTP 503"], ["request", "World connection failed"], ["invalid", "Unrecognized world picture"]] as const) {
        mode = kind;
        await page.getByRole("button", { name: "Read again" }).click();
        await page.getByRole("heading", { name: heading, exact: true }).waitFor();
        assert.match(await page.locator('.world-message[role="status"]').innerText(), /This is not an empty or quiet world/u);
        assert.equal(await page.locator(".place, .inspection").count(), 0);
        assert.equal(await page.getByRole("heading", { name: "No civilizations founded" }).count(), 0);
        await page.waitForLoadState("networkidle");
        assert.deepEqual(errors, []);
      }
    } finally { await page.close(); }
  });
  const snapshot = foundedSnapshot();
  const form = worldForm(snapshot);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await t.test(`${viewport.width}px legacy schema 1 snapshots without projects remain inspectable`, async () => {
      const page = await browser.newPage({ viewport });
      const { projects: _, ...fields } = foundedSnapshot();
      const legacy: WorldSnapshot = { ...fields, schemaVersion: 1 };
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: legacy }));
        await page.goto(url);
        await page.getByRole("button", { name: `Inspect ${legacy.civilizations[0]!.name}`, exact: true }).click();
        await page.getByRole("region", { name: "Prosjekter", exact: true }).getByText("Ingen prosjekter", { exact: true }).waitFor();
        assert.equal(await page.locator(".place").count(), legacy.civilizations.length);
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    });
    await t.test(`${viewport.width}px project creation retains failed keys, rotates success and reloads without optimistic insertion`, async () => {
      const page = await browser.newPage({ viewport });
      const picture = foundedSnapshot();
      const civilization = picture.civilizations[0]!;
      const submissions: { requestKey: string; name: string; harness: string }[] = [];
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let reads = 0;
      let release!: () => void;
      let received!: () => void;
      const arrived = new Promise<void>((resolve) => { received = resolve; });
      const pending = new Promise<void>((resolve) => { release = resolve; });
      try {
        await page.route("**/api/world-snapshot", (route) => { reads++; return route.fulfill({ json: picture }); });
        await page.route("**/api/civilizations/*/projects", async (route) => {
          const request = route.request();
          assert.equal(new URL(request.url()).pathname, `/api/civilizations/${encodeURIComponent(civilization.civilizationId)}/projects`);
          assert.equal(request.method(), "POST");
          const headers = await request.allHeaders();
          assert.equal(headers["content-type"], "application/json");
          assert.equal(headers.accept, "application/json");
          const body = request.postDataJSON();
          assert.deepEqual(Object.keys(body).sort(), ["harness", "name", "requestKey"]);
          assert.equal(body.harness, "hermes");
          assert.match(body.requestKey, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
          submissions.push(body);
          if (submissions.length === 1) {
            received();
            await pending;
            await route.fulfill({ status: 503, json: { error: "PRIVATE NATIVE STDERR", message: "/private/path" } });
            return;
          }
          const project = { projectId: `project:created-${submissions.length}`, civilizationId: civilization.civilizationId,
            name: body.name, slug: "fjordkart", workspacePath: "/synthetic/fjordkart", state: "established" as const,
            attempt: 1, reason: null, harness: { id: "hermes" as const, externalId: "p_ab12cd34", externalSlug: "fjordkart-2",
              externalArchived: true, provenance: "created" as const, observedAt: "2026-01-01T00:00:00.000Z" } };
          picture.projects!.push(project);
          await route.fulfill({ status: 201, json: project });
        });
        await page.goto(url);
        const place = page.getByRole("button", { name: `Inspect ${civilization.name}`, exact: true });
        await place.focus();
        await page.keyboard.press("Enter");
        const projects = page.getByRole("region", { name: "Prosjekter", exact: true });
        await projects.getByText("Ingen prosjekter", { exact: true }).waitFor();
        const close = page.getByRole("button", { name: "Close inspection" });
        const create = projects.getByRole("button", { name: "Opprett", exact: true });
        await close.focus();
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.getByRole("button", { name: "Home", exact: true }).evaluate((node) => node === document.activeElement), true);
        await close.focus();
        await page.keyboard.press("Tab");
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).evaluate((node) => node === document.activeElement), true);
        await projects.getByLabel("Prosjektnavn", { exact: true }).fill("Fjordkart");
        await create.click();
        await arrived;
        assert.equal(await create.isDisabled(), true);
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).isDisabled(), true);
        assert.equal(await projects.getByLabel("Harness", { exact: true }).isDisabled(), true);
        assert.equal(await close.evaluate((node) => node === document.activeElement), true, "sending must retain inspector keyboard access");
        assert.equal(await projects.locator("li").count(), 0);
        assert.equal(reads, 1);
        release();
        await projects.getByRole("alert").waitFor();
        assert.equal(await projects.getByRole("alert").innerText(), "Prosjektet kunne ikke behandles. Pr\u00f8v igjen.");
        assert.doesNotMatch(await projects.innerText(), /PRIVATE|\/private/);
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Fjordkart");
        await create.click();
        await projects.getByRole("heading", { name: "Fjordkart", exact: true }).waitFor();
        assert.equal(reads, 2);
        assert.deepEqual(submissions[1], submissions[0]);
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "");
        assert.match(await projects.innerText(), /Observert registrert i hermes \(fjordkart-2, p_ab12cd34\) 2026-01-01T00:00:00.000Z/);
        assert.match(await projects.innerText(), /Registreringen var arkivert i hermes ved siste observasjon/);
        assert.equal(await projects.getByRole("button", { name: "Pr\u00f8v igjen" }).count(), 0);
        assert.equal(await projects.locator(".mark, [data-axis], [role=progressbar]").count(), 0);
        await projects.getByLabel("Prosjektnavn", { exact: true }).fill("Another place");
        await create.click();
        await projects.getByRole("heading", { name: "Another place", exact: true }).waitFor();
        assert.notEqual(submissions[2]!.requestKey, submissions[1]!.requestKey);
        assert.equal(reads, 3);
        assert.equal(await page.getByRole("complementary").evaluate((node) => node.scrollWidth <= node.clientWidth), true);
        await page.keyboard.press("Escape");
        await page.getByRole("complementary").waitFor({ state: "detached" });
        assert.equal(await place.evaluate((node) => node === document.activeElement), true);
        await page.reload();
        await place.focus();
        await page.keyboard.press("Enter");
        await projects.getByRole("heading", { name: "Fjordkart", exact: true }).waitFor();
        assert.equal(await projects.locator("li").count(), 2);
        assert.deepEqual(errors, []);
      } finally { release?.(); await page.close(); }
    });
  }
  await t.test("every non-established state can retry; unknown stays distinct and other civilizations do not inherit projects", async () => {
    const page = await browser.newPage();
    const picture = foundedSnapshot();
    const civilizationId = picture.civilizations[0]!.civilizationId;
    const states = ["requested", "directory-created", "external-unknown", "failed"] as const;
    picture.projects = states.map((state) => ({ projectId: `project:${state}`, civilizationId, name: state,
      slug: state, workspacePath: `/synthetic/${state}`, state, attempt: state === "requested" ? 0 : 1,
      reason: state === "failed" ? "filesystem_denied" : state === "external-unknown" ? "harness_timeout" : null, harness: null }));
    const retries: { requestKey: string }[] = [];
    let failed = false;
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: picture }));
      await page.route("**/api/projects/*/retry", async (route) => {
        assert.equal(route.request().method(), "POST");
        const body = route.request().postDataJSON();
        assert.deepEqual(Object.keys(body), ["requestKey"]);
        retries.push(body);
        if (!failed) { failed = true; await route.fulfill({ status: 409, json: { error: "retry_in_progress" } }); return; }
        const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]!);
        const project = picture.projects!.find((project) => project.projectId === id)!;
        project.state = "established";
        project.reason = null;
        project.harness = { id: "hermes", externalId: "p_ab12cd34", externalSlug: project.slug, externalArchived: false,
          provenance: "adopted", observedAt: "2026-01-01T00:00:00.000Z" };
        await route.fulfill({ json: project });
      });
      await page.goto(url);
      await page.getByRole("button", { name: "Inspect Synthetic 0", exact: true }).focus();
      await page.keyboard.press("Enter");
      const projects = page.getByRole("region", { name: "Prosjekter", exact: true });
      await projects.waitFor();
      assert.equal(await projects.getByRole("button", { name: "Pr\u00f8v igjen", exact: true }).count(), 4);
      assert.match(await projects.innerText(), /Harness-registrering ukjent; ikke bevis p\u00e5 at den mislyktes. Mappa fantes ved fors\u00f8ket./);
      assert.match(await projects.innerText(), /Opprettelse mislyktes. Prosjektmappa kunne ikke opprettes./);
      assert.doesNotMatch(await projects.innerText(), /filesystem_denied/);
      assert.equal(await projects.getByText("Opprettelse p\u00e5begynt.", { exact: true }).count(), 2);
      for (const state of states) {
        const row = projects.locator("li").filter({ has: page.getByRole("heading", { name: state, exact: true }) });
        const retry = row.getByRole("button", { name: "Pr\u00f8v igjen", exact: true });
        await retry.click();
        if (state === "requested") {
          await projects.getByText("Et nytt fors\u00f8k p\u00e5g\u00e5r allerede.", { exact: true }).waitFor();
          await retry.click();
        }
        await retry.waitFor({ state: "detached" });
        assert.match(await row.innerText(), /Observert registrert i hermes/);
      }
      assert.equal(retries.length, 5);
      assert.deepEqual(retries[0], retries[1]);
      assert.equal(new Set(retries.slice(1).map((body) => body.requestKey)).size, 4);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Inspect Synthetic 1", exact: true }).focus();
      await page.keyboard.press("Enter");
      await projects.getByText("Ingen prosjekter", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Inspect Synthetic 3", exact: true }).focus();
      await page.keyboard.press("Enter");
      await projects.waitFor();
      assert.equal(await projects.locator("form").count(), 0, "dissolved civilizations cannot create projects");
    } finally { await page.close(); }
  });
  await t.test("visible axis and kind marks retain distinct computed visual grammar", async () => {
    const page = await browser.newPage();
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
      await page.goto(url);
      await page.locator(".place").first().waitFor();
      const treatments = new Map<string, string[]>();
      for (const [axis, kind, border, color, background] of [
        ["institution", "active", "solid", "rgb(124, 103, 76)", "rgb(220, 202, 158)"],
        ["institution", "dissolved", "double", "rgb(124, 103, 76)", "rgb(220, 202, 158)"],
        ["institution", "unreadable", "dashed", "rgb(124, 103, 76)", "rgb(181, 175, 149)"],
        ["collection", "unknown", "dotted", "rgb(79, 100, 91)", "rgb(200, 195, 174)"],
        ["collection", "unread", "dashed", "rgb(79, 100, 91)", "rgb(200, 195, 174)"],
        ["collection", "missing", "double", "rgb(119, 92, 71)", "rgb(200, 195, 174)"],
        ["collection", "quiet", "double", "rgb(79, 100, 91)", "rgb(200, 195, 174)"],
        ["collection", "changed", "solid", "rgb(79, 100, 91)", "rgb(200, 195, 174)"],
        ["temporal", "unknown", "dotted", "rgb(57, 94, 96)", "rgb(213, 220, 226)"],
        ["temporal", "current", "solid", "rgb(57, 94, 96)", "rgb(208, 222, 208)"],
        ["temporal", "historical", "double", "rgb(134, 99, 63)", "rgb(222, 208, 171)"],
        ["epistemic", "observation", "solid", "rgb(121, 97, 129)", "rgb(227, 215, 229)"],
        ["epistemic", "claim", "dashed", "rgb(121, 97, 129)", "rgb(227, 215, 229)"],
        ["attempt", "in-progress", "solid", "rgb(166, 83, 45)", "rgb(228, 216, 183)"],
        ["limits", "observations-truncated", "solid", "rgb(166, 83, 45)", "rgb(228, 216, 183)"],
        ["limits", "claims-truncated", "solid", "rgb(166, 83, 45)", "rgb(228, 216, 183)"],
      ] as const) {
        const mark = page.locator(`.mark[data-axis="${axis}"][data-kind="${kind}"]`).first();
        await mark.scrollIntoViewIfNeeded();
        assert.equal(await mark.isVisible(), true);
        assert.equal(await mark.innerText(), `${axis}: ${kind}`);
        const treatment = await mark.evaluate((node) => {
          const style = getComputedStyle(node);
          return [style.borderLeftStyle, style.borderLeftColor, style.backgroundColor, style.borderTopStyle];
        });
        assert.deepEqual(treatment, [border, color, background, axis === "collection" ? border : axis === "limits" ? "solid" : kind === "claim" ? "dashed" : "none"], `${axis}: ${kind}`);
        treatments.set(`${axis}: ${kind}`, treatment);
      }
      for (const other of ["collection: unknown", "collection: unread", "collection: missing", "institution: unreadable", "temporal: current", "temporal: historical"]) {
        assert.notDeepEqual(treatments.get("temporal: unknown"), treatments.get(other), `temporal uncertainty must differ from ${other}`);
      }
      assert.notDeepEqual(treatments.get("epistemic: observation"), treatments.get("epistemic: claim"));
      assert.notDeepEqual(treatments.get("attempt: in-progress"), treatments.get("limits: observations-truncated"));
    } finally { await page.close(); }
  });
  await t.test("validated founding, every core mark and every inspection value reach React one-for-one", async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
      await page.goto(url);
      await page.locator(".place").first().waitFor();
      assert.equal(await page.locator(".place").count(), form.places.length);
      assert.equal(await page.locator('.world-message[role="status"]').count(), 0);
      await page.getByRole("button", { name: "Read again" }).focus();
      await page.keyboard.press("Tab");
      for (const [index, place] of form.places.entries()) {
        const button = page.getByRole("button", { name: `Inspect ${place.name}`, exact: true });
        assert.equal(await button.getAttribute("data-institution"), place.institution);
        assert.equal(await button.locator(".place-name").textContent(), place.name);
        assert.equal(await button.locator(".place-domain").textContent(), place.domain);
        assert.deepEqual(await button.locator(".mark").evaluateAll((marks) => marks.map((mark) => ({
          axis: mark.getAttribute("data-axis"), kind: mark.getAttribute("data-kind"), label: mark.getAttribute("aria-label"),
        }))), place.marks);
        assert.equal(await page.locator(".place").nth(index).getAttribute("aria-label"), `Inspect ${place.name}`);
        // Keyboard activation also works for evidence-rich places taller than the viewport.
        await page.keyboard.press("Tab");
        assert.equal(await button.evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press("Enter");
        const inspector = page.getByRole("complementary", { name: `Inspection: ${place.name}`, exact: true });
        await inspector.waitFor();
        assert.deepEqual(await inspector.locator(".inspection-field").evaluateAll((fields) => fields.map((field) => ({
          label: field.querySelector("h3")!.textContent, values: [...field.querySelectorAll("p")].map((p) => p.textContent),
        }))), place.inspection);
        assert.equal(await inspector.locator("b, script").count(), 0);
        assert.equal(await page.getByRole("button", { name: "Close inspection" }).evaluate((node) => node === document.activeElement), true);
        await page.keyboard.press("Escape");
        await inspector.waitFor({ state: "detached" });
        assert.equal(await button.evaluate((node) => node === document.activeElement), true);
        assert.equal(await button.getAttribute("aria-expanded"), "false");
      }
      assert.doesNotMatch(await page.locator("body").innerText(), /\b(council|petition|decision|chat|persona)\b/iu);
      assert.equal(await page.locator("input, textarea, [contenteditable=true], [role=dialog], [role=log]").count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test("native placement, keyboard navigation, mouse selection and drag, zoom and reload", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const small = { ...empty, civilizations: snapshot.civilizations.slice(-2, -1), sourcePictures: snapshot.sourcePictures.filter((picture) => picture.civilizationId === snapshot.civilizations.at(-2)!.civilizationId) };
      let reads = 0;
      await page.route("**/api/world-snapshot", (route) => { reads++; return route.fulfill({ json: small }); });
      await page.goto(url);
      const button = page.getByRole("button", { name: `Inspect ${small.civilizations[0]!.name}`, exact: true });
      await button.waitFor();
      const scene = page.getByLabel("Explore world", { exact: true });
      await page.getByRole("button", { name: "Read again" }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await scene.evaluate((node) => node === document.activeElement), true);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowDown");
      assert.deepEqual(await scene.evaluate((node) => [node.scrollLeft, node.scrollTop]), [100, 100]);
      await page.keyboard.press("+");
      assert.equal(await page.getByLabel("Zoom level").textContent(), "110%");
      await page.keyboard.press("-");
      assert.equal(await page.getByLabel("Zoom level").textContent(), "100%");
      await page.keyboard.press("+");
      assert.equal(await page.getByLabel("Zoom level").textContent(), "110%");
      assert.equal(await scene.evaluate((node) => node.scrollLeft > 0 && node.scrollTop > 0), true);
      await page.keyboard.press("Home");
      assert.equal(await page.getByLabel("Zoom level").textContent(), "100%");
      assert.equal(await page.locator(".painted-world").evaluate((node) => getComputedStyle(node).transform), "matrix(1, 0, 0, 1, 0, 0)");
      assert.deepEqual(await scene.evaluate((node) => [node.scrollLeft, node.scrollTop]), [0, 0]);
      await page.keyboard.press("Tab");
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
      assert.equal(await button.evaluate((node) => node.tagName), "BUTTON");
      assert.notEqual(await button.evaluate((node) => getComputedStyle(node).outlineStyle), "none");
      assert.equal(await button.locator(".place-ground").evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") === node.closest("button");
      }), true, "the visible location is the native button hit target, not a second coordinate overlay");
      await page.keyboard.press("Enter");
      await page.getByRole("complementary").waitFor();
      assert.equal(await button.getAttribute("aria-expanded"), "true");
      await page.keyboard.press("Escape");
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
      await button.locator(".place-ground").click();
      await page.getByRole("complementary").waitFor();
      await page.getByRole("button", { name: "Close inspection" }).click();
      assert.equal(await button.evaluate((node) => node === document.activeElement), true);
      const bounds = (await scene.boundingBox())!;
      await page.mouse.move(bounds.x + bounds.width - 100, bounds.y + 100);
      await page.mouse.down();
      await page.mouse.move(bounds.x + bounds.width - 200, bounds.y + 50, { steps: 5 });
      await page.mouse.up();
      assert.deepEqual(await scene.evaluate((node) => [node.scrollLeft, node.scrollTop]), [100, 50]);
      assert.equal(await page.getByRole("complementary").count(), 0);
      await page.getByRole("button", { name: "Zoom in", exact: true }).click();
      assert.equal(await page.getByLabel("Zoom level").textContent(), "110%");
      assert.equal(await page.locator(".painted-world").evaluate((node) => getComputedStyle(node).transform), "matrix(1.1, 0, 0, 1.1, 0, 0)");
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
      await page.getByRole("button", { name: "Home", exact: true }).click();
      assert.deepEqual(await scene.evaluate((node) => [node.scrollLeft, node.scrollTop]), [0, 0]);
      await button.locator(".place-ground").click();
      await page.getByRole("complementary").waitFor();
      await page.getByRole("button", { name: "Read again" }).click();
      await button.waitFor();
      assert.equal(reads, 2);
      assert.equal(await page.getByRole("complementary").count(), 0);
      assert.equal(await button.getAttribute("aria-expanded"), "false");
    } finally { await page.close(); }
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await t.test(`${viewport.width}px navigation never covers founded places or evidence`, async () => {
      const page = await browser.newPage({ viewport });
      try {
        await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
        await page.goto(url);
        await page.locator(".place").first().waitFor();
        assert.equal(await page.locator(".place").count(), form.places.length);
        assert.equal(await page.locator(".mark").count(), form.places.reduce((count, place) => count + place.marks.length, 0));
        for (const inspecting of [false, true]) {
          if (inspecting) {
            await page.getByRole("button", { name: "Inspect Synthetic 8", exact: true }).focus();
            await page.keyboard.press("Enter");
            await page.getByRole("complementary").waitFor();
          }
          for (const zoom of ["100%", "60%", "160%"] as const) {
            while (await page.getByLabel("Zoom level").textContent() !== zoom) {
              await page.getByRole("button", { name: zoom === "60%" ? "Zoom out" : "Zoom in", exact: true }).click();
            }
            const scene = (await page.getByLabel("Explore world", { exact: true }).boundingBox())!;
            const controls = (await page.getByRole("navigation", { name: "World navigation" }).boundingBox())!;
            assert.ok(scene.y + scene.height <= controls.y, "navigation must be outside the entire scrollable scene at every scroll position");
            for (const target of await page.locator(".place-ground, .place-name, .place-domain, .mark").all()) {
              assert.equal(await target.evaluate((node) => {
                node.scrollIntoView({ block: "center", inline: "center" });
                const bounds = node.getBoundingClientRect();
                const scene = node.closest(".scene")!.getBoundingClientRect();
                const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
                // Scrolling rounds to CSS pixels while zoomed bounds can be fractional.
                return bounds.top >= scene.top - 1 && bounds.bottom <= scene.bottom + 1
                  && bounds.left >= scene.left - 1 && bounds.right <= scene.right + 1
                  && hit !== null && node.contains(hit);
              }), true, `${await target.getAttribute("class")} must remain reachable and unobstructed at ${zoom}, inspection ${inspecting}`);
            }
          }
          await page.getByRole("button", { name: "Home", exact: true }).click();
        }
      } finally { await page.close(); }
    });
  }
  await t.test("390px viewport retains at least 30% actual scene with inspection open and no page overflow", async (t) => {
    const viewport = { width: 390, height: 844 };
    const page = await browser.newPage({ viewport });
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
      await page.goto(url);
      const place = form.places.find((place) => place.name === "Synthetic 8")!;
      const button = page.getByRole("button", { name: `Inspect ${place.name}`, exact: true });
      await button.waitFor();
      await button.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("complementary").waitFor();
      const scene = (await page.getByLabel("Explore world", { exact: true }).boundingBox())!;
      const disclaimer = page.getByText("Neutral terrain / no inferred activity", { exact: true });
      assert.equal(await disclaimer.isVisible(), true);
      const disclaimerBounds = (await disclaimer.boundingBox())!;
      assert.ok(disclaimerBounds.x >= 0 && disclaimerBounds.y >= 0
        && disclaimerBounds.x + disclaimerBounds.width <= viewport.width
        && disclaimerBounds.y + disclaimerBounds.height <= viewport.height, "neutral terrain disclaimer must stay inside the narrow viewport");
      const inspector = (await page.getByRole("complementary").boundingBox())!;
      t.diagnostic(`Actual scene: ${scene.width} x ${scene.height}px; viewport: ${viewport.width} x ${viewport.height}px`);
      assert.ok(scene.height >= viewport.height * 0.3, `Actual scene height ${scene.height}px < ${viewport.height * 0.3}px`);
      assert.ok(scene.y + scene.height <= inspector.y, "inspector must not cover the scene");
      const controls = (await page.getByRole("navigation", { name: "World navigation" }).boundingBox())!;
      assert.ok(scene.y + scene.height <= controls.y, "navigation must not cover the scrollable scene or its evidence marks");
      assert.equal(await button.locator(".mark").count(), place.marks.length);
      for (const mark of await button.locator(".mark").all()) {
        const visible = await mark.evaluate((node) => {
          node.scrollIntoView({ block: "nearest", inline: "nearest" });
          const bounds = node.getBoundingClientRect();
          const scene = node.closest(".scene")!.getBoundingClientRect();
          return bounds.top >= scene.top && bounds.bottom <= scene.bottom
            && bounds.left >= scene.left && bounds.right <= scene.right
            && document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === node;
        });
        assert.ok(visible, `${await mark.getAttribute("aria-label")} must be reachable and unobstructed with inspection open`);
      }
      assert.equal(await page.getByRole("complementary").evaluate((node) => node.scrollWidth <= node.clientWidth), true, "inspection must wrap without horizontal overflow");
      assert.deepEqual(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight]), [viewport.width, viewport.height]);
    } finally { await page.close(); }
  });
  await t.test("long evidence marks do not overlap another native place hit target", async () => {
    const page = await browser.newPage();
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
      await page.goto(url);
      await page.locator(".place").first().waitFor();
      const overlaps = await page.locator(".place").evaluateAll((nodes) => nodes.flatMap((node, index) => {
        const a = node.getBoundingClientRect();
        return nodes.slice(index + 1).filter((other) => {
          const b = other.getBoundingClientRect();
          return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        }).map((other) => [node.getAttribute("aria-label"), other.getAttribute("aria-label")]);
      }));
      assert.deepEqual(overlaps, [], "Evidence-rich place buttons must not overlap");
    } finally { await page.close(); }
  });
  child.kill("SIGTERM");
  assert.deepEqual(await exit, [0, null]);
});

test("the committed Vite dev config shows invalid-response without an API proxy", { timeout: 60000 }, async (t) => {
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
  const errors: string[] = [];
  const dataRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") || ["fetch", "xhr"].includes(request.resourceType())) {
      dataRequests.push(request.url());
    }
  });
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.locator('#root > main[aria-label="EcoSym"]').waitFor({ state: "attached" });
  assert.equal(await page.title(), "EcoSym");
  await page.getByRole("heading", { name: "Unrecognized world picture" }).waitFor();
  assert.equal(await page.locator(".place, .inspection").count(), 0);
  assert.equal(server.config.server.proxy, undefined);
  await page.waitForLoadState("networkidle");
  assert.deepEqual(errors, []);
  assert.ok(dataRequests.length >= 1);
  assert.ok(dataRequests.every((request) => request === `http://127.0.0.1:${address.port}/api/world-snapshot`));
});

test("Vite hot-refreshes an isolated frontend copy without navigation", { timeout: 60000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ecosym-hmr-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const project = join(directory, "project");
  const root = join(project, "web");
  await cp("web", root, { recursive: true });
  await mkdir(join(project, "src"));
  for (const file of pureSources) await cp(join("src", file), join(project, "src", file));
  await symlink(resolve("node_modules"), join(directory, "node_modules"), "dir");
  const server = await createServer({ configFile: resolve("vite.config.ts"), root, logLevel: "silent", server: { port: 0, fs: { allow: [project] } } });
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
  await page.getByRole("heading", { name: "Unrecognized world picture" }).waitFor();
  // A full reload would remove this marker; only the isolated copy is edited.
  await page.evaluate("window.__hmrMarker = true");
  const component = join(root, "App.tsx");
  await writeFile(component, (await readFile(component, "utf8")).replace('aria-label="EcoSym"', 'aria-label="EcoSym HMR test"'));
  await page.locator('main[aria-label="EcoSym HMR test"]').waitFor({ state: "attached" });
  assert.equal(await page.evaluate("window.__hmrMarker"), true);
  assert.deepEqual(errors, []);
  assert.ok(apiRequests.length >= 1);
  assert.ok(apiRequests.every((request) => request === `${url}/api/world-snapshot`));
});

test("React entry import closure stays within React, CSS and pure world contracts", async () => {
  const allowed = new Set(["web/main.tsx", "web/App.tsx", "web/world-client.ts", "web/world.css", ...pureSources.map((file) => `src/${file}`)]);
  const visited = new Set<string>();
  async function visit(path: string): Promise<void> {
    assert.ok(allowed.has(path), `Unexpected browser dependency: ${path}`);
    if (visited.has(path)) return;
    visited.add(path);
    const source = await readFile(path, "utf8");
    if (path.endsWith(".css")) return;
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const dependencies: string[] = [];
    function walk(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const name = node.moduleSpecifier.text;
        if (!["react", "react-dom/client"].includes(name)) {
          assert.ok(name.startsWith("."), `Unexpected browser package: ${name}`);
          dependencies.push(new URL(name, new URL(`../${path}`, import.meta.url)).pathname.slice(new URL("../", import.meta.url).pathname.length));
        }
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(file) === "require")) assert.fail("Unexpected dynamic browser dependency");
      ts.forEachChild(node, walk);
    }
    walk(file);
    for (const dependency of dependencies) await visit(dependency);
  }
  await visit("web/main.tsx");
  assert.ok(visited.has("web/App.tsx"));
  assert.ok(visited.has("src/world-form.ts"));
  assert.ok(visited.has("src/world-snapshot.ts"));
});

test("manifest wiring guard keeps check connected to both typechecks, tests, and the production build", async () => {
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(scripts.check, "npm run typecheck && npm run typecheck:world && npm test && npm run build:world");
  assert.equal(scripts["build:world"], "vite build");
});
