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
import { brightness } from "../web/sky.ts";
import { gap, lastRead, readLine, signal } from "../web/timing.ts";

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

const isActive = (node: Element) => node === document.activeElement;
const body = (page: import("playwright").Page, name: string) => page.getByRole("button", { name: `Åpne ${name}`, exact: true });
const plate = (page: import("playwright").Page, name: string) => page.getByRole("region", { name: `Sivilisasjon: ${name}`, exact: true });
const amber = "rgb(242, 181, 68)";
const red = "rgb(240, 69, 90)";
const blue = "rgb(77, 158, 255)";
const ink = "rgb(233, 237, 245)";
const ink3 = "rgb(141, 151, 168)";

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
  const assets = await readdir(join(output, "assets"));
  assert.ok(assets.every((file) => /\.(js|css|woff2)$/u.test(file)), "the field ships no raster: every light is drawn from data");
  const fonts = assets.filter((file) => file.endsWith(".woff2"));
  assert.deepEqual(fonts.map((file) => file.match(/^(plex-(?:sans|mono)-(?:ext-)?\d{3})-[\w-]+\.woff2$/u)?.[1] ?? file).sort(),
    ["plex-mono-400", "plex-mono-500", "plex-mono-ext-400", "plex-mono-ext-500", "plex-sans-300", "plex-sans-400", "plex-sans-500", "plex-sans-ext-300", "plex-sans-ext-400", "plex-sans-ext-500"]);
  const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/gu)].map((match) => match[1]!);
  assert.ok(styles.length > 0);
  for (const style of styles) {
    assert.match(style, /^\/assets\/.+\.css$/u);
    const css = await fetch(`${url}${style}`);
    assert.equal(css.status, 200);
    assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
    assert.equal(css.headers.get("x-content-type-options"), "nosniff");
    const text = await css.text();
    assert.equal(text, await readFile(join(output, style), "utf8"));
    // CSP allows only same-origin fonts: every face is a hashed self-hosted file, never inlined or fetched from a CDN.
    assert.doesNotMatch(text, /url\(["']?(?:data:|https?:|\/\/)/u);
    for (const font of fonts) assert.ok(text.includes(`/assets/${font}`), `${font} must be referenced by the built stylesheet`);
  }
  for (const font of fonts) {
    const served = await fetch(`${url}/assets/${font}`);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "font/woff2");
    assert.equal(served.headers.get("x-content-type-options"), "nosniff");
    assert.equal(Buffer.compare(Buffer.from(await served.arrayBuffer()), await readFile(join(output, "assets", font))), 0);
  }
  const asset = await fetch(`${url}${script}`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await asset.text(), bundle);
  const browser = await chromium.launch();
  t.after(() => browser.close());
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
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
    assert.equal(await page.locator("html").getAttribute("lang"), "nb");
    const loaded = await snapshotResponse;
    assert.equal(loaded.status(), 200);
    assert.deepEqual(validateWorldSnapshot(await loaded.json()), { ...empty, schemaVersion: 3 });
    await page.getByRole("heading", { name: "Ingen sivilisasjoner grunnlagt", exact: true }).waitFor();
    assert.equal(await page.locator(".body, .plate").count(), 0);
    assert.match(await page.locator('.notice[role="status"]').innerText(), /Ingenting er grunnlagt ennå/u);
    assert.equal(await page.locator(".foot .gap").textContent(), "Ingen erklærte kilder", "a world with no declared sources makes no claim about reading");
    // Creating a project registers it in Hermes: the surface never claims that nothing leaves it.
    assert.doesNotMatch(await page.locator(".foot").innerText(), /sendes/u);
    await page.waitForLoadState("networkidle");
    const fontRequests = requests.filter((request) => request.type === "font");
    assert.ok(fontRequests.length >= 1, "the self-hosted face must actually be fetched");
    for (const request of fontRequests) {
      assert.equal(request.method, "GET");
      assert.ok(request.url.startsWith(`${url}/assets/plex-`) && request.url.endsWith(".woff2"), `unexpected font request ${request.url}`);
    }
    assert.deepEqual(requests.filter((request) => request.type !== "font").sort((a, b) => a.url.localeCompare(b.url)), [
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
      await page.getByRole("heading", { name: "Leser verden", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Les på nytt", exact: true }).isDisabled(), true);
      assert.equal(await page.locator(".body, .plate").count(), 0);
      assert.equal(await page.locator('.notice[role="status"]').getAttribute("data-kind"), "loading");
      assert.equal(await page.locator(".notice-ring").evaluate((node) => getComputedStyle(node).animationName), "none", "loading is a static hairline ring");
      release();
      await page.getByRole("heading", { name: "Ingen sivilisasjoner grunnlagt", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Les på nytt", exact: true }).isDisabled(), false);
      for (const [kind, heading] of [["http", "Verden utilgjengelig / HTTP 503"], ["request", "Ingen forbindelse til verden"], ["invalid", "Ukjent verdensbilde"]] as const) {
        mode = kind;
        await page.getByRole("button", { name: "Les på nytt", exact: true }).click();
        await page.getByRole("heading", { name: heading, exact: true }).waitFor();
        const notice = page.locator('.notice[role="status"]');
        assert.match(await notice.innerText(), /ikke en tom eller stille verden/u);
        assert.equal(await notice.getAttribute("data-kind"), "failure");
        assert.equal(await notice.locator(".notice-ring").evaluate((node) => getComputedStyle(node).borderTopColor), red, "failure is the ring in red rim, nothing else is red");
        assert.equal(await notice.locator(".notice-ring").evaluate((node) => getComputedStyle(node).animationName), "none", "nothing spins: a ring, not a spinner");
        assert.equal(await page.locator(".body, .plate").count(), 0);
        assert.equal(await page.getByRole("heading", { name: "Ingen sivilisasjoner grunnlagt" }).count(), 0);
        await page.waitForLoadState("networkidle");
        assert.deepEqual(errors, []);
      }
    } finally { await page.close(); }
  });
  const snapshot = foundedSnapshot();
  const form = worldForm(snapshot);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await t.test(`${viewport.width}px legacy schema 1 snapshots without projects remain readable`, async () => {
      const page = await browser.newPage({ viewport });
      const { projects: _, ...fields } = foundedSnapshot();
      const legacy: WorldSnapshot = { ...fields, schemaVersion: 1 };
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      try {
        await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: legacy }));
        await page.goto(url);
        await body(page, legacy.civilizations[0]!.name).click();
        await page.getByRole("region", { name: "Prosjekter", exact: true }).getByText("Ingen prosjekter", { exact: true }).waitFor();
        assert.equal(await page.locator(".body").count(), legacy.civilizations.length);
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
        const star = body(page, civilization.name);
        await star.focus();
        await page.keyboard.press("Enter");
        const projects = page.getByRole("region", { name: "Prosjekter", exact: true });
        await projects.getByText("Ingen prosjekter", { exact: true }).waitFor();
        const close = page.getByRole("button", { name: "Lukk", exact: true });
        const create = projects.getByRole("button", { name: "Opprett", exact: true });
        assert.equal(await close.evaluate(isActive), true, "approaching a body moves focus to the plate's close control");
        await page.keyboard.press("Shift+Tab");
        assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("body")), true, "the field sits before the plate in reading order");
        await close.focus();
        await page.keyboard.press("Tab");
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).evaluate(isActive), true);
        await projects.getByLabel("Prosjektnavn", { exact: true }).fill("Fjordkart");
        await create.click();
        await arrived;
        assert.equal(await create.isDisabled(), true);
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).isDisabled(), true);
        assert.equal(await projects.getByLabel("Harness", { exact: true }).isDisabled(), true);
        assert.equal(await close.evaluate(isActive), true, "sending must retain plate keyboard access");
        assert.equal(await projects.locator("li").count(), 0);
        assert.equal(reads, 1);
        release();
        await projects.getByRole("alert").waitFor();
        assert.equal(await projects.getByRole("alert").innerText(), "Prosjektet kunne ikke behandles. Prøv igjen.");
        assert.doesNotMatch(await projects.innerText(), /PRIVATE|\/private/);
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "Fjordkart");
        await create.click();
        await projects.getByRole("heading", { name: "Fjordkart", exact: true }).waitFor();
        assert.equal(reads, 2);
        assert.deepEqual(submissions[1], submissions[0]);
        assert.equal(await projects.getByLabel("Prosjektnavn", { exact: true }).inputValue(), "");
        assert.match(await projects.innerText(), /Observert registrert i hermes \(fjordkart-2, p_ab12cd34\) 2026-01-01T00:00:00.000Z/);
        assert.match(await projects.innerText(), /Registreringen var arkivert i hermes ved siste observasjon/);
        assert.equal(await projects.getByRole("button", { name: "Prøv igjen" }).count(), 0);
        assert.equal(await projects.locator(".tick, .bloom, [data-brightness], [role=progressbar]").count(), 0, "a registered project is a declared place, never a light");
        assert.equal(await page.locator(".bloom").count(), 0, "an established project earns no bloom");
        await projects.getByLabel("Prosjektnavn", { exact: true }).fill("Another place");
        await create.click();
        await projects.getByRole("heading", { name: "Another place", exact: true }).waitFor();
        assert.notEqual(submissions[2]!.requestKey, submissions[1]!.requestKey);
        assert.equal(reads, 3);
        assert.equal(await plate(page, civilization.name).evaluate((node) => node.scrollWidth <= node.clientWidth), true);
        await page.keyboard.press("Escape");
        await plate(page, civilization.name).waitFor({ state: "detached" });
        assert.equal(await star.evaluate(isActive), true);
        await page.reload();
        await star.focus();
        await page.keyboard.press("Enter");
        await projects.getByRole("heading", { name: "Fjordkart", exact: true }).waitFor();
        assert.equal(await projects.locator("li").count(), 2);
        assert.deepEqual(errors, []);
      } finally { release?.(); await page.close(); }
    });
  }
  await t.test("every non-established state can retry; unknown stays distinct and other civilizations do not inherit projects", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const picture = foundedSnapshot();
    // A quiet civilization: loss outranks waiting on the signal line, so the bloom needs a body that can see.
    const civilizationId = picture.civilizations[2]!.civilizationId;
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
      // Waiting on you is the single pure-white bloom in the field, with a blue label, before anything is opened.
      const star = body(page, "Synthetic 2");
      await star.waitFor();
      assert.equal(await star.getAttribute("data-waiting"), "4");
      assert.equal(await page.locator(".bloom").count(), 1, "one bloom per civilization, whatever waits there");
      assert.equal(await star.locator(".bloom").evaluate((node) => getComputedStyle(node).fill), "rgb(255, 255, 255)", "pure white is reserved for what waits on you");
      assert.equal(await star.locator(".wait").textContent(), "4 prosjekter venter på deg");
      assert.equal(await star.locator(".wait").evaluate((node) => getComputedStyle(node).fill), blue);
      assert.equal(await star.locator(".line").getAttribute("data-tone"), "waiting");
      assert.equal(await star.locator(".line").textContent(), `lest for ${gap("2026-01-01T00:00:00.000Z", Date.now())} siden`, "waiting colours the bloom label, never the gap line");
      await star.click();
      const projects = page.getByRole("region", { name: "Prosjekter", exact: true });
      await projects.waitFor();
      await plate(page, "Synthetic 2").waitFor();
      assert.equal(await projects.getByRole("button", { name: "Prøv igjen", exact: true }).count(), 4);
      assert.match(await projects.innerText(), /Harness-registrering ukjent; ikke bevis på at den mislyktes. Mappa fantes ved forsøket./);
      assert.match(await projects.innerText(), /Opprettelse mislyktes. Prosjektmappa kunne ikke opprettes./);
      assert.doesNotMatch(await projects.innerText(), /filesystem_denied/);
      assert.equal(await projects.getByText("Opprettelse påbegynt.", { exact: true }).count(), 2);
      for (const state of states) {
        const row = projects.locator("li").filter({ has: page.getByRole("heading", { name: state, exact: true }) });
        const retry = row.getByRole("button", { name: "Prøv igjen", exact: true });
        await retry.click();
        if (state === "requested") {
          await projects.getByText("Et nytt forsøk pågår allerede.", { exact: true }).waitFor();
          await retry.click();
        }
        await retry.waitFor({ state: "detached" });
        assert.match(await row.innerText(), /Observert registrert i hermes/);
      }
      assert.equal(retries.length, 5);
      assert.deepEqual(retries[0], retries[1]);
      assert.equal(new Set(retries.slice(1).map((body) => body.requestKey)).size, 4);
      await page.locator(".bloom").waitFor({ state: "detached" });
      assert.equal(await star.getAttribute("data-waiting"), null, "nothing waits once every project is established");
      await page.keyboard.press("Escape");
      await plate(page, "Synthetic 2").waitFor({ state: "detached" });
      await body(page, "Synthetic 1").focus();
      await page.keyboard.press("Enter");
      await projects.getByText("Ingen prosjekter", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await body(page, "Synthetic 3").focus();
      await page.keyboard.press("Enter");
      await projects.waitFor();
      assert.equal(await projects.locator("form").count(), 0, "dissolved civilizations cannot create projects");
      assert.match(await projects.innerText(), /Oppløste sivilisasjoner kan ikke opprette prosjekter/);
    } finally { await page.close(); }
  });
  await t.test("every light and line form in the field is derived: brightness steps, tick forms, occlusion, one colour per meaning", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
      await page.goto(url);
      await page.locator(".body").first().waitFor();
      const now = Date.now();
      for (const place of form.places) {
        const star = body(page, place.name);
        const expected = brightness(lastRead(place), now);
        assert.equal(await star.getAttribute("data-brightness"), expected, `${place.name} brightness`);
        assert.equal(await star.locator(".tick").count(), place.sourcePicture.sources.length, `${place.name} carries one tick per declared source`);
        const state = signal(place, []);
        assert.equal(await star.getAttribute("data-occluded"), state.tone === "loss" ? "true" : null, `${place.name} occlusion follows lost sight only`);
        assert.equal(await star.locator(".occluder").count(), state.tone === "loss" ? 1 : 0);
        const expectedLine = state.tone === "loss" ? state.line : place.institution === "dissolved" ? "oppløst" : readLine(place.sourcePicture.sources, now);
        assert.equal(await star.locator(".line").textContent(), expectedLine, `${place.name} carries its gap time, or its loss in words`);
        if (place.institution === "dissolved") {
          assert.equal(await star.getAttribute("data-dissolved"), "true");
          assert.equal(await star.locator(".core, .glow").count(), 0, "a dissolved civilization is an empty ring");
        }
        if (place.institution === "dissolved") continue;
        if (expected === "never") assert.equal(await star.locator(".core-outline").count(), 1, "never read is an outline, not a dim core");
        else assert.equal(await star.locator(".core").evaluate((node) => Number(getComputedStyle(node).opacity) > 0), true);
      }
      // Stated outright rather than re-derived: an attempt that read nothing is never shown as a read, nor lights a body.
      for (const name of ["Synthetic 4", "Synthetic 5", "Synthetic 6"]) {
        assert.equal(await body(page, name).locator(".line").textContent(), "ulest etter siste forsøk", `${name}: an incomplete, retired or skipped attempt is not a read`);
        assert.equal(await body(page, name).getAttribute("data-brightness"), "never", `${name}: an attempt that read nothing lights nothing`);
        assert.match(await body(page, name).getAttribute("aria-description") ?? "", /\. Ulest etter siste forsøk\.$/u);
      }
      for (const name of ["Synthetic 3", "Synthetic 7"]) assert.equal(await body(page, name).getAttribute("data-brightness"), "never", `${name}: lost sight lights nothing`);
      for (const name of ["Synthetic 2", "Synthetic 8"]) assert.notEqual(await body(page, name).getAttribute("data-brightness"), "never", `${name}: a successful read lights the body`);
      assert.equal(await page.locator(".foot .gap").textContent(), `Sist lest for ${gap("2026-01-01T00:00:00.000Z", now)} siden`, "no unsuccessful attempt here is later than the reads");
      const stroke = (selector: string) => page.locator(selector).first().evaluate((node) => { const style = getComputedStyle(node); return [style.stroke, style.strokeWidth, style.strokeDasharray]; });
      assert.deepEqual(await stroke('.tick[data-kind="changed"]'), [amber, "3.5px", "none"]);
      assert.deepEqual(await stroke('.tick[data-kind="quiet"]'), [ink, "2.5px", "none"]);
      assert.deepEqual(await stroke('.tick[data-kind="unread"]'), [ink, "2.5px", "4px, 5px"]);
      assert.deepEqual(await stroke('.tick[data-kind="missing"] .gap-rim'), [red, "1px", "none"]);
      assert.deepEqual((await stroke('.tick[data-attempt="true"]')).slice(1, 2), ["1px"], "a recorded attempt is a hollow tick, never a filled one");
      assert.equal(await page.locator(".occluder").first().evaluate((node) => getComputedStyle(node).stroke), red);
      assert.equal(await page.locator('.tick:not([data-kind="changed"])').evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).stroke !== "rgb(242, 181, 68)")), true, "amber belongs to observed change only");
      const fill = (selector: string) => page.locator(selector).first().evaluate((node) => getComputedStyle(node).fill);
      assert.equal(await fill('.line[data-tone="loss"]'), ink, "words carry the loss; the rim carries the colour");
      assert.equal(await fill('.line[data-tone="velocity"]'), ink3, "amber's only carrier in the field is the solid tick");
      assert.equal(await fill('.line[data-tone="neutral"]'), ink3);
      assert.equal(await page.locator('.line[data-tone="velocity"]').first().textContent(), `lest for ${gap("2026-01-01T00:00:00.000Z", now)} siden`);
      assert.equal(await page.locator(".bloom, .wait").count(), 0, "nothing waits on you in this picture");
      assert.equal(await page.locator(".tick[data-kind=\"changed\"]").count(), 1);
      await body(page, "Synthetic 0").click();
      const opened = plate(page, "Synthetic 0");
      await opened.waitFor();
      assert.equal(await opened.locator(".signal").evaluate((node) => getComputedStyle(node).color), ink, "the plate's loss line stays words, never red text");
      assert.equal(await opened.locator('.status[data-kind="missing"]').evaluate((node) => getComputedStyle(node).color), red);
      assert.equal(await body(page, "Synthetic 0").locator(".ring").evaluate((node) => getComputedStyle(node).strokeWidth), "1.5px", "the approached body's ring brightens; the body never moves");
    } finally { await page.close(); }
  });
  await t.test("validated founding, every body and every stored field reach React one-for-one", async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    try {
      await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
      await page.goto(url);
      await page.locator(".body").first().waitFor();
      assert.equal(await page.locator(".body").count(), form.places.length);
      assert.equal(await page.locator('.notice[role="status"], .plate').count(), 0, "no panel exists before approach");
      const positions = await page.locator(".body .hit").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("cx"), node.getAttribute("cy")]));
      await page.reload();
      await page.locator(".body").first().waitFor();
      assert.deepEqual(await page.locator(".body .hit").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("cx"), node.getAttribute("cy")])), positions, "the same snapshot always yields the same sky");
      for (const place of form.places) {
        const star = body(page, place.name);
        assert.equal(await star.locator(".name").textContent(), place.name);
        const reading = readLine(place.sourcePicture.sources, Date.now());
        const description = await star.getAttribute("aria-description") ?? "";
        assert.equal(description, `${signal(place, []).line}. ${reading.charAt(0).toUpperCase()}${reading.slice(1)}.`);
        assert.doesNotMatch(description, /for aldri siden/u, "a body never read is not described as read 'never ago'");
        await star.focus();
        await page.keyboard.press("Enter");
        const opened = plate(page, place.name);
        await opened.waitFor();
        assert.equal(await star.getAttribute("aria-current"), "page");
        assert.equal(await opened.locator("h1").first().textContent(), place.name);
        assert.equal(await opened.locator(".domain").textContent(), place.domain);
        assert.equal(await opened.locator(".source-list li").count(), place.institution === "unreadable" ? 0 : place.sourcePicture.sources.length);
        assert.deepEqual(await opened.locator(".record-field").evaluateAll((fields) => fields.map((field) => ({
          label: field.querySelector("h3")!.textContent, values: [...field.querySelectorAll("p")].map((p) => p.textContent),
        }))), place.inspection);
        assert.equal(await opened.locator("b, script").count(), 0);
        assert.equal(await page.getByRole("button", { name: "Lukk", exact: true }).evaluate(isActive), true);
        await page.keyboard.press("Escape");
        await opened.waitFor({ state: "detached" });
        assert.equal(await star.evaluate(isActive), true);
        assert.equal(await star.getAttribute("aria-current"), null);
      }
      assert.doesNotMatch(await page.locator("body").innerText(), /\b(council|petition|decision|chat|persona)\b/iu);
      assert.equal(await page.locator("input, textarea, [contenteditable=true], [role=dialog], [role=log]").count(), 0);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });
  await t.test("arrow keys travel the field, Enter approaches, Escape returns, and reload closes the plate", async () => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    try {
      const three = snapshot.civilizations.slice(0, 3);
      const small = { ...empty, civilizations: three, sourcePictures: snapshot.sourcePictures.filter((picture) => three.some((civilization) => civilization.civilizationId === picture.civilizationId)) };
      let reads = 0;
      await page.route("**/api/world-snapshot", (route) => { reads++; return route.fulfill({ json: small }); });
      await page.goto(url);
      const first = body(page, three[0]!.name);
      await first.waitFor();
      await first.focus();
      const visited = new Set<string>();
      for (let step = 0; step < 3; step++) {
        visited.add((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) ?? "");
        await page.keyboard.press("ArrowRight");
      }
      assert.equal(visited.size, 3, "ArrowRight visits every body around the field");
      assert.equal(await first.evaluate(isActive), true, "and wraps back to where it started");
      await page.keyboard.press("ArrowDown");
      assert.equal(await body(page, three[1]!.name).evaluate(isActive), true, "ArrowDown walks founding order");
      await page.keyboard.press("ArrowUp");
      assert.equal(await first.evaluate(isActive), true);
      assert.equal(await first.evaluate((node) => node.tagName.toLowerCase()), "g");
      assert.equal(await first.locator(".hit").evaluate((node) => {
        const rect = node.getBoundingClientRect();
        return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest(".body") === node.closest(".body");
      }), true, "the body itself is the native hit target");
      await page.keyboard.press("Enter");
      const opened = plate(page, three[0]!.name);
      await opened.waitFor();
      assert.equal(await first.getAttribute("aria-current"), "page");
      await page.keyboard.press("Escape");
      await opened.waitFor({ state: "detached" });
      assert.equal(await first.evaluate(isActive), true);
      await first.click();
      await opened.waitFor();
      await page.getByRole("button", { name: "Lukk", exact: true }).click();
      await opened.waitFor({ state: "detached" });
      assert.equal(await first.evaluate(isActive), true);
      await first.click();
      await opened.waitFor();
      await page.getByRole("button", { name: "Les på nytt", exact: true }).click();
      await first.waitFor();
      assert.equal(reads, 2);
      assert.equal(await opened.count(), 0);
      assert.equal(await first.getAttribute("aria-current"), null);
    } finally { await page.close(); }
  });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await t.test(`${viewport.width}px every body stays reachable, labels stay inside the field, and nothing overflows, with and without a plate open`, async () => {
      const page = await browser.newPage({ viewport });
      try {
        await page.route("**/api/world-snapshot", (route) => route.fulfill({ json: snapshot }));
        await page.goto(url);
        await page.locator(".body").first().waitFor();
        assert.equal(await page.locator(".body").count(), form.places.length);
        for (const opened of [false, true]) {
          if (opened) {
            await body(page, "Synthetic 8").click();
            await plate(page, "Synthetic 8").waitFor();
          }
          assert.deepEqual(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]), [viewport.width, viewport.width], `no horizontal page overflow, plate open ${opened}`);
          for (const star of await page.locator(".body").all()) {
            await star.scrollIntoViewIfNeeded();
            const field = (await page.locator(".field-wrap").boundingBox())!;
            assert.equal(await star.locator(".hit").evaluate((node, field) => {
              const bounds = node.getBoundingClientRect();
              const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
              return bounds.left >= field.x - 1 && bounds.right <= field.x + field.width + 1 && hit !== null && (hit.closest(".body") === node.closest(".body"));
            }, field), true, `${await star.getAttribute("aria-label")} must sit inside the field and be its own hit target, plate open ${opened}`);
            for (const label of await star.locator("text").all()) {
              const bounds = (await label.boundingBox())!;
              assert.ok(bounds.x >= field.x - 1 && bounds.x + bounds.width <= field.x + field.width + 1, `${await label.textContent()} must stay inside the field width, plate open ${opened}`);
            }
          }
          if (opened) {
            const sheet = plate(page, "Synthetic 8");
            assert.equal(await sheet.evaluate((node) => node.scrollWidth <= node.clientWidth), true, "the plate must wrap without horizontal overflow");
            if (viewport.width >= 1144) {
              const box = (await sheet.boundingBox())!;
              const field = (await page.locator(".field-wrap").boundingBox())!;
              assert.ok(box.x >= field.x + field.width - 1, "the plate never covers the field: approach costs no reflow");
            }
          }
        }
      } finally { await page.close(); }
    });
  }
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
  await page.getByRole("heading", { name: "Ukjent verdensbilde", exact: true }).waitFor();
  assert.equal(await page.locator(".body, .plate").count(), 0);
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
  await page.getByRole("heading", { name: "Ukjent verdensbilde", exact: true }).waitFor();
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
  const allowed = new Set(["web/main.tsx", "web/App.tsx", "web/world-client.ts", "web/timing.ts", "web/sky.ts", "web/app.css", ...pureSources.map((file) => `src/${file}`)]);
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
  assert.ok(visited.has("web/timing.ts"));
  assert.ok(visited.has("web/sky.ts"));
  assert.ok(visited.has("src/world-form.ts"));
  assert.ok(visited.has("src/world-snapshot.ts"));
});

test("manifest wiring guard keeps check connected to both typechecks, tests, and the production build", async () => {
  const { scripts } = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(scripts.check, "npm run typecheck && npm run typecheck:world && npm test && npm run build:world");
  assert.equal(scripts["build:world"], "vite build");
});
