import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { parseCivilizationConfig } from "../src/institution.ts";
import { ProjectService, projectsRoot } from "../src/projects.ts";
import { ProjectError, type HarnessAdapter, type HarnessOutcome } from "../src/project-types.ts";
import { ObservationStore } from "../src/store.ts";

const bound: HarnessOutcome = { kind: "bound", binding: { externalId: "p_ab12", externalSlug: "actual-slug",
  externalArchived: false, harnessVersion: "0.21.0", harnessHome: "/synthetic/hermes", provenance: "created" } };
const body = (name = "Fjordkart") => ({ requestKey: randomUUID(), name, harness: "hermes" });
const code = (expected: string) => (error: unknown) => error instanceof ProjectError && error.message === expected;

function setup(t: TestContext, adapter?: HarnessAdapter) {
  const tmp = mkdtempSync(join(tmpdir(), "ecosym-projects-"));
  const root = join(tmp, "workspaces");
  const store = new ObservationStore(join(tmp, "state"));
  const { civilizationId: civ } = store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1,
    name: "Synthetic", domain: "Tests", sources: [], mayActAlone: [], mustEscalate: [] }));
  let calls = 0;
  const service = new ProjectService(store, { root, adapter: adapter ?? { id: "hermes",
    async provision(r) {
      calls++;
      const project = store.listProjects().find((p) => p.workspacePath === r.workspacePath)!;
      assert.equal(project.state, "external-unknown");
      assert.ok(statSync(r.workspacePath).isDirectory());
      return bound;
    }, async reconcile() { return { kind: "unknown", reason: "readback_ambiguous" }; },
  } });
  t.after(() => { store.close(); rmSync(tmp, { recursive: true, force: true }); });
  return { tmp, root, store, civ, service, calls: () => calls };
}

test("project roots are absolute siblings of state, with explicit precedence", () => {
  assert.equal(projectsRoot({}, "/tmp/home"), "/tmp/home/.local/share/ecosym-projects");
  assert.equal(projectsRoot({ XDG_DATA_HOME: "/tmp/data" }), "/tmp/data/ecosym-projects");
  assert.equal(projectsRoot({ XDG_DATA_HOME: "relative", ECOSYM_PROJECT_ROOT: "/tmp/projects" }), "/tmp/projects");
  for (const env of [{ ECOSYM_PROJECT_ROOT: "relative" }, { ECOSYM_PROJECT_ROOT: "" }, { XDG_DATA_HOME: "relative" }]) {
    assert.throws(() => projectsRoot(env), code("root_invalid"));
  }
});

test("intent precedes filesystem and unknown precedes adapter; canonical replay has one effect", async (t) => {
  const s = setup(t);
  const original = s.store.requestProject.bind(s.store);
  t.mock.method(s.store, "requestProject", (input: Parameters<typeof original>[0]) => {
    assert.equal(existsSync(s.root), false);
    return original(input);
  });
  const input = body("  Bla\u030abær  ");
  const result = await s.service.create(s.civ, input);
  t.mock.restoreAll();
  assert.equal(result.created, true);
  assert.equal(result.project.name, "Blåbær");
  assert.equal(result.project.slug, "blab-r");
  assert.equal(result.project.harness?.externalSlug, "actual-slug");
  assert.equal(result.project.state, "established");
  for (const path of [s.root, join(s.root, s.civ.slice(13)), result.project.workspacePath]) {
    assert.equal(statSync(path).mode & 0o777, 0o700);
  }
  assert.deepEqual(await s.service.create(s.civ, { ...input, name: "Blåbær" }), { ...result, created: false });
  assert.equal(s.calls(), 1);
  await assert.rejects(s.service.create(s.civ, { ...input, name: "Changed" }), code("request_key_conflict"));
  await assert.rejects(s.service.retry(result.project.projectId, { requestKey: randomUUID() }), code("invalid_request"));
});

test("invalid names, bodies and civilization paths produce no intent or effects", async (t) => {
  const s = setup(t);
  for (const name of ["", " ", "a".repeat(65), "--help", "-name", "a\n", "\u0000a", "a\u200db"]) {
    await assert.rejects(s.service.create(s.civ, body(name)), code("invalid_name"));
  }
  for (const name of ["..", "日本語", "///"]) await assert.rejects(s.service.create(s.civ, body(name)), code("slug_underivable"));
  for (const input of [null, [], {}, { ...body(), slug: "evil" }, { ...body(), workspacePath: "/tmp/evil" },
    { ...body(), requestKey: "bad" }, { ...body(), harness: "other" }]) {
    await assert.rejects(s.service.create(s.civ, input), code("invalid_request"));
  }
  await assert.rejects(s.service.create("civilization:../../escape", body()), code("civilization_unknown"));
  await assert.rejects(s.service.create(`civilization:${randomUUID()}`, body()), code("civilization_unknown"));
  s.store.dissolveCivilization(s.civ);
  await assert.rejects(s.service.create(s.civ, body()), code("civilization_dissolved"));
  assert.deepEqual(s.store.listProjects(), []);
  assert.equal(existsSync(s.root), false);
});

test("ten concurrent replays and slug collisions each cause exactly one provision", async (t) => {
  const s = setup(t);
  const input = body();
  const results = await Promise.all(Array.from({ length: 10 }, () => s.service.create(s.civ, input)));
  assert.equal(results.filter((r) => r.created).length, 1);
  assert.equal(new Set(results.map((r) => r.project.projectId)).size, 1);
  const collisions = await Promise.allSettled(Array.from({ length: 10 }, () => s.service.create(s.civ, body("Other"))));
  assert.equal(collisions.filter((r) => r.status === "fulfilled").length, 1);
  for (const r of collisions) if (r.status === "rejected") assert.ok(code("slug_taken")(r.reason));
  assert.equal(s.calls(), 2);
});

for (const kind of ["directory", "file", "workspace-link", "outside-link", "civ-link"] as const) {
  test(`filesystem rejects ${kind} without native effects or deleting external content`, async (t) => {
    const s = setup(t);
    const civPath = join(s.root, s.civ.slice(13));
    mkdirSync(civPath, { recursive: true });
    const outside = join(s.tmp, "outside");
    mkdirSync(outside);
    const path = join(civPath, "fjordkart");
    if (kind === "directory") mkdirSync(path);
    if (kind === "file") writeFileSync(path, "untouched");
    if (kind === "workspace-link") symlinkSync(civPath, path);
    if (kind === "outside-link") symlinkSync(outside, path);
    if (kind === "civ-link") { rmSync(civPath, { recursive: true }); symlinkSync(outside, civPath); }
    const { project } = await s.service.create(s.civ, body());
    assert.equal(project.state, "failed");
    assert.equal(project.reason, kind === "directory" ? "directory_exists" : kind === "file" ? "not_a_directory" : "containment_violation");
    assert.equal(s.calls(), 0);
    assert.equal(existsSync(join(outside, "fjordkart")), false);
    assert.ok(existsSync(outside));
  });
}

for (const state of ["requested", "directory-created", "external-unknown", "failed"] as const) {
  test(`retry recovers ${state}, restores same directory and reconciles before create`, async (t) => {
    const order: string[] = [];
    const s = setup(t, { id: "hermes", async reconcile() { order.push("reconcile"); return { kind: "unknown", reason: "readback_ambiguous" }; },
      async provision() { order.push("create"); return bound; } });
    const workspacePath = join(s.root, s.civ.slice(13), "fjordkart");
    const project = s.store.requestProject({ ...body(), harness: "hermes", civilizationId: s.civ,
      slug: "fjordkart", workspacePath, requestDigest: "synthetic" }).project;
    if (state !== "requested") {
      const attempt = s.store.claimProjectAttempt(project.projectId);
      s.store.appendProjectEvent(project.projectId, state, attempt, state === "failed" ? "filesystem_denied" : undefined);
      s.store.releaseProjectAttempt(project.projectId);
    }
    const result = await s.service.retry(project.projectId, { requestKey: randomUUID() });
    assert.equal(result.state, "established");
    assert.equal(result.workspacePath, workspacePath);
    assert.ok(statSync(workspacePath).isDirectory());
    assert.deepEqual(order, ["reconcile", "create"]);
  });
}

test("retry keys replay the same attempt across concurrent stores, later retries and restart", async (t) => {
  let calls = 0;
  let release!: () => void;
  const wait = new Promise<void>((done) => { release = done; });
  const adapter: HarnessAdapter = { id: "hermes",
    async reconcile() { calls++; await wait; return calls === 1 ? { kind: "unknown", reason: "harness_timeout" } : bound; },
    async provision() { assert.fail("retry must not provision after timeout or binding"); },
  };
  const s = setup(t, adapter);
  const project = s.store.requestProject({ ...body(), harness: "hermes", civilizationId: s.civ,
    slug: "fjordkart", workspacePath: join(s.root, s.civ.slice(13), "fjordkart"), requestDigest: "synthetic" }).project;
  const key = { requestKey: randomUUID() };
  const otherStore = new ObservationStore(join(s.tmp, "state"));
  t.after(() => otherStore.close());
  const other = new ProjectService(otherStore, { root: s.root, adapter });
  const first = s.service.retry(project.projectId, key);
  while (calls === 0) await new Promise((done) => setTimeout(done, 5));
  const duplicate = other.retry(project.projectId, { requestKey: key.requestKey.toUpperCase() });
  release();
  const result = await first;
  assert.deepEqual(await duplicate, result);
  assert.equal(calls, 1);
  assert.equal(result.reason, "harness_timeout");
  assert.deepEqual(await other.retry(project.projectId, key), result);
  const next = await other.retry(project.projectId, { requestKey: randomUUID() });
  assert.equal(next.state, "established");
  assert.equal(next.attempt, result.attempt + 1);
  assert.deepEqual(await s.service.retry(project.projectId, key), result);
  s.store.close();
  otherStore.close();
  const reopened = new ObservationStore(join(s.tmp, "state"));
  t.after(() => reopened.close());
  const restarted = new ProjectService(reopened, { root: s.root, adapter });
  assert.deepEqual(await restarted.retry(project.projectId, key), result);
  assert.equal(calls, 2);
  const another = reopened.requestProject({ ...body("Other"), harness: "hermes", civilizationId: s.civ,
    slug: "other", workspacePath: join(s.root, s.civ.slice(13), "other"), requestDigest: "other" }).project;
  const scoped = await restarted.retry(another.projectId, key);
  assert.equal(scoped.projectId, another.projectId);
  assert.equal(scoped.state, "established");
  assert.equal(calls, 3);
  assert.deepEqual(await restarted.retry(another.projectId, key), scoped);
  assert.equal(calls, 3);
});

test("pending retry replay stops waiting at the 120 second deadline", { timeout: 5000 }, async (t) => {
  const s = setup(t);
  const project = s.store.requestProject({ ...body(), harness: "hermes", civilizationId: s.civ,
    slug: "fjordkart", workspacePath: join(s.root, s.civ.slice(13), "fjordkart"), requestDigest: "synthetic" }).project;
  const key = { requestKey: randomUUID() };
  s.store.claimProjectAttempt(project.projectId, key.requestKey);
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  let settled = false;
  const retry = s.service.retry(project.projectId, key);
  void retry.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(retry, code("retry_in_progress"));
  t.mock.timers.tick(119_975);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(25);
  await rejected;
  assert.equal(s.store.getProjectRetry(project.projectId, key.requestKey)!.pending, true);
  assert.equal(s.calls(), 0);
  s.store.releaseProjectAttempt(project.projectId);
});

test("external success followed by throw remains unknown; retry adopts with no new registration", async (t) => {
  let creates = 0;
  const s = setup(t, { id: "hermes", async provision() { creates++; throw new Error("PRIVATE traceback /secret"); },
    async reconcile() { assert.ok(bound.kind === "bound"); return { ...bound, binding: { ...bound.binding, provenance: "adopted" } }; } });
  const first = (await s.service.create(s.civ, body())).project;
  assert.equal(first.state, "external-unknown");
  assert.equal(first.reason, "readback_ambiguous");
  rmSync(first.workspacePath, { recursive: true });
  const retry = await s.service.retry(first.projectId, { requestKey: randomUUID() });
  assert.equal(retry.harness?.externalId, "p_ab12");
  assert.equal(retry.harness?.provenance, "adopted");
  assert.equal(retry.workspacePath, first.workspacePath);
  assert.equal(creates, 1);
  assert.ok(!JSON.stringify(s.store.listProjects()).includes("PRIVATE"));
});

test("MAX4 applies across services, and durable singleflight rejects concurrent retries", async (t) => {
  let release!: () => void;
  const wait = new Promise<void>((done) => { release = done; });
  let entered = 0;
  const adapter: HarnessAdapter = { id: "hermes", async provision() { entered++; await wait; return { kind: "unknown", reason: "harness_timeout" }; },
    async reconcile() { entered++; await wait; return { kind: "unknown", reason: "harness_timeout" }; } };
  const s = setup(t, adapter);
  const pending = Array.from({ length: 4 }, (_, i) => s.service.create(s.civ, body(`Project ${i}`)));
  while (entered < 4) await new Promise((done) => setTimeout(done, 5));
  const other = new ProjectService(s.store, { root: s.root, adapter });
  await assert.rejects(other.create(s.civ, body("Fifth")), code("busy"));
  release();
  const results = await Promise.all(pending);
  assert.ok(results.every((r) => r.project.state === "external-unknown" && r.project.reason === "harness_timeout"));
  const id = results[0]!.project.projectId;
  const retry = s.service.retry(id, { requestKey: randomUUID() });
  await assert.rejects(other.retry(id, { requestKey: randomUUID() }), code("retry_in_progress"));
  await retry;
});

test("unavailable native binary does not prevent constructing service or delivering directory", async (t) => {
  const s = setup(t);
  const service = new ProjectService(s.store, { root: s.root, env: { PATH: "/nonexistent" }, home: s.tmp });
  const { project } = await service.create(s.civ, body());
  assert.equal(project.state, "external-unknown");
  assert.equal(project.reason, "harness_unavailable");
  assert.ok(statSync(project.workspacePath).isDirectory());
});
