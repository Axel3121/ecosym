import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { parseCivilizationConfig } from "../src/institution.ts";
import { ProjectError, type ProjectRequest } from "../src/project-types.ts";
import { ObservationStore } from "../src/store.ts";
import { validateWorldProjectSnapshot } from "../src/world-snapshot.ts";

function setup(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "ecosym-project-store-"));
  const directory = join(root, "state");
  const store = new ObservationStore(directory);
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }); });
  const { civilizationId } = store.foundCivilization(parseCivilizationConfig({
    schemaVersion: 1, name: "Engineering", domain: "synthetic software",
    sources: [], mayActAlone: [], mustEscalate: [],
  }));
  const input: ProjectRequest = {
    civilizationId, name: "Fjordkart", slug: "fjordkart", workspacePath: join(root, "workspace"),
    harness: "hermes", requestKey: "request-one", requestDigest: "digest-one",
  };
  return { root, directory, store, input };
}

function code(expected: string) {
  return (error: unknown) => error instanceof ProjectError && error.code === expected && error.message === expected;
}

const binding = {
  externalId: "p_ab12cd34", externalSlug: "fjordkart-2", externalArchived: true,
  harnessHome: "/synthetic/isolated-hermes", harnessVersion: "0.21.0", provenance: "adopted" as const,
};

for (const field of ["externalId", "externalSlug"] as const) {
  test(`binding rejects oversized ${field} atomically and accepts the 128-character boundary`, (t) => {
    const { store, input } = setup(t);
    const id = store.requestProject(input).project.projectId;
    const attempt = store.claimProjectAttempt(id);
    const before = store.getProject(id)!;
    assert.throws(() => store.bindProject(id, attempt, { ...binding, [field]: "a".repeat(129) }), code("invalid_request"));
    assert.deepEqual(store.getProject(id), before);
    store.bindProject(id, attempt, { ...binding, [field]: "a".repeat(128) });
    assert.equal(store.getProject(id)!.harness![field].length, 128);
    assert.deepEqual(validateWorldProjectSnapshot(store.getProject(id)), store.getProject(id));
    store.releaseProjectAttempt(id);
  });
}

for (const state of ["requested", "directory-created"] as const) {
  test(`${state} rejects failure reasons without changing the persisted snapshot`, (t) => {
    const { store, input } = setup(t);
    const id = store.requestProject(input).project.projectId;
    const attempt = store.claimProjectAttempt(id);
    const before = store.getProject(id)!;
    assert.throws(() => store.appendProjectEvent(id, state, attempt, "filesystem_denied"), code("invalid_request"));
    assert.deepEqual(store.getProject(id), before);
    store.appendProjectEvent(id, state, attempt);
    assert.deepEqual(validateWorldProjectSnapshot(store.getProject(id)), store.getProject(id));
    store.releaseProjectAttempt(id);
  });
}

test("fresh project store persists intent and idempotency without claiming observed activity", (t) => {
  const { directory, store, input } = setup(t);
  const { project, created } = store.requestProject(input);
  assert.equal(created, true);
  assert.deepEqual(project, {
    projectId: project.projectId, civilizationId: input.civilizationId,
    name: input.name, slug: input.slug, workspacePath: input.workspacePath,
    state: "requested", attempt: 0, reason: null, harness: null,
  });
  store.claimResource(input.civilizationId, "synthetic-resource", "synthetic-agent");
  assert.deepEqual(store.listProjects(), [project]);
  assert.deepEqual(store.requestProject(input), { project, created: false });
  assert.throws(() => store.requestProject({ ...input, requestDigest: "changed" }), code("request_key_conflict"));
  const { civilizationId: otherCivilizationId } = store.foundCivilization(parseCivilizationConfig({
    schemaVersion: 1, name: "Research", domain: "synthetic research",
    sources: [], mayActAlone: [], mustEscalate: [],
  }));
  assert.throws(() => store.requestProject({
    ...input, civilizationId: otherCivilizationId, slug: "fjordkart-research",
    workspacePath: join(directory, "other-workspace"),
  }), code("request_key_conflict"));
  assert.throws(() => store.requestProject({ ...input, requestKey: "other" }), code("slug_taken"));
  assert.throws(() => store.requestProject({ ...input, requestKey: "other", slug: "other" }), code("path_taken"));
  assert.throws(() => store.requestProject({ ...input, requestKey: "other", civilizationId: "missing" }), code("civilization_unknown"));
  store.dissolveCivilization(input.civilizationId);
  assert.deepEqual(store.requestProject(input), { project, created: false });
  assert.throws(() => store.requestProject({ ...input, requestKey: "other" }), code("civilization_dissolved"));
  store.close();
  const reopened = new ObservationStore(directory);
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getProject(project.projectId), project);
  assert.equal(reopened.getProject("missing"), undefined);
});

for (const state of ["requested", "directory-created", "external-unknown", "failed"] as const) {
  test(`retry from ${state} retains path, increments attempt and binds atomically`, (t) => {
    const { store, input, directory } = setup(t);
    const id = store.requestProject(input).project.projectId;
    const attempt = store.claimProjectAttempt(id);
    assert.equal(attempt, 1);
    store.appendProjectEvent(id, state, attempt, state === "failed" ? "filesystem_denied" : undefined);
    store.releaseProjectAttempt(id);
    const retry = store.claimProjectAttempt(id);
    assert.equal(retry, 2);
    assert.equal(store.getProject(id)!.workspacePath, input.workspacePath);
    assert.throws(() => store.appendProjectEvent(id, "failed", retry), code("invalid_request"));
    assert.throws(() => store.appendProjectEvent(id, "failed", retry, "raw stderr" as never), code("invalid_request"));
    assert.throws(() => store.appendProjectEvent(id, "established", retry), code("invalid_request"));
    assert.throws(() => store.bindProject(id, attempt, binding), code("invalid_request"));
    assert.throws(() => store.bindProject(id, retry, { ...binding, externalId: "" }), code("invalid_request"));
    assert.equal(store.getProject(id)!.harness, null);
    store.bindProject(id, retry, binding);
    store.releaseProjectAttempt(id);
    const project = store.getProject(id)!;
    assert.equal(project.state, "established");
    assert.deepEqual(project.harness, {
      id: "hermes", externalId: binding.externalId, externalSlug: binding.externalSlug,
      externalArchived: true, provenance: "adopted", observedAt: project.harness!.observedAt,
    });
    assert.throws(() => store.claimProjectAttempt(id), code("invalid_request"));
    assert.throws(() => store.appendProjectEvent(id, "failed", retry, "harness_refused"), code("invalid_request"));
    const database = new DatabaseSync(join(directory, "observations.sqlite"));
    t.after(() => database.close());
    const events = database.prepare("SELECT state, attempt FROM project_provisioning_events ORDER BY event_order").all();
    assert.equal(events[0]!.state, "requested");
    assert.equal(events[0]!.attempt, 0);
    assert.equal(events.at(-1)!.state, "established");
  });
}

test("dissolution refuses a new project attempt without changing its history", (t) => {
  const { store, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const attempt = store.claimProjectAttempt(id);
  store.appendProjectEvent(id, "external-unknown", attempt, "harness_unavailable");
  store.releaseProjectAttempt(id);
  store.dissolveCivilization(input.civilizationId);
  const before = store.exportOwnedState().bundle.institutionStore.projectProvisioningEvents;
  assert.throws(() => store.claimProjectAttempt(id, "retry-after-dissolution"), code("civilization_dissolved"));
  assert.deepEqual(store.exportOwnedState().bundle.institutionStore.projectProvisioningEvents, before);
});

for (const errorCode of ["EPERM", "ESRCH", "ENOENT", "EIO"]) {
  test(`${errorCode} ${errorCode === "ESRCH" ? "permits" : "blocks"} retry and forget of a durable project owner`, (t) => {
    const { store, directory, input } = setup(t);
    const id = store.requestProject(input).project.projectId;
    const database = new DatabaseSync(join(directory, "observations.sqlite"));
    t.after(() => database.close());
    database.prepare("UPDATE project_provisioning_events SET event_id = ?, retry_request_key = ? WHERE project_id = ?")
      .run(`project-owner:${process.pid}:previous-process-identity:synthetic-owner:event`, "old-retry", id);
    const kill = t.mock.method(process, "kill", () => { throw Object.assign(new Error(errorCode), { code: errorCode }); });
    assert.equal(store.getProjectRetry(id, "old-retry")!.pending, errorCode !== "ESRCH");
    if (errorCode === "ESRCH") {
      assert.equal(store.claimProjectAttempt(id, "new-retry"), 1);
    } else {
      assert.throws(() => store.claimProjectAttempt(id, "new-retry"), code("retry_in_progress"));
    }
    store.dissolveCivilization(input.civilizationId);
    if (errorCode === "ESRCH") {
      assert.equal(store.planForgetCivilization(input.civilizationId, "user").counts.projects, 1);
    } else {
      assert.throws(() => store.planForgetCivilization(input.civilizationId, "user"), code("retry_in_progress"));
    }
    assert.ok(kill.mock.callCount() >= 3);
    store.releaseProjectAttempt(id);
  });
}

test("create replay claims cannot restart a newer attempt or a changed state", (t) => {
  const { store, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const attempt = store.claimProjectAttempt(id, "retry");
  store.releaseProjectAttempt(id);
  assert.throws(() => store.claimProjectAttempt(id, undefined, 0), code("retry_in_progress"));
  const next = store.claimProjectAttempt(id);
  store.appendProjectEvent(id, "failed", next, "filesystem_denied");
  store.releaseProjectAttempt(id);
  assert.throws(() => store.claimProjectAttempt(id, undefined, next), code("retry_in_progress"));
  assert.equal(store.getProject(id)!.attempt, attempt + 1);
});

test("single-flight spans store instances and refuses non-owner writes and release", async (t) => {
  const { store, directory, input } = setup(t);
  const other = new ObservationStore(directory);
  t.after(() => other.close());
  const requests = await Promise.all(Array.from({ length: 10 }, () => Promise.resolve().then(() => other.requestProject(input))));
  assert.equal(requests.filter((result) => result.created).length, 1);
  const id = requests[0]!.project.projectId;
  const results = await Promise.allSettled([store, other].map((owner) => Promise.resolve().then(() => owner.claimProjectAttempt(id))));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((results[1] as PromiseRejectedResult).reason.code, "retry_in_progress");
  assert.throws(() => other.appendProjectEvent(id, "directory-created", 1), code("invalid_request"));
  other.releaseProjectAttempt(id);
  assert.throws(() => other.claimProjectAttempt(id), code("retry_in_progress"));
  store.releaseProjectAttempt(id);
  assert.equal(other.claimProjectAttempt(id), 2);
  other.releaseProjectAttempt(id);
});

for (const state of ["requested", "directory-created", "external-unknown", "failed"] as const) {
  test(`dead process ownership is recoverable from ${state} only by explicit retry`, (t) => {
    const { store, directory, input } = setup(t);
    const id = store.requestProject(input).project.projectId;
    const script = `import { ObservationStore } from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)};
      const s = new ObservationStore(${JSON.stringify(directory)});
      const a = s.claimProjectAttempt(${JSON.stringify(id)}, "interrupted-retry");
      s.appendProjectEvent(${JSON.stringify(id)}, ${JSON.stringify(state)}, a, ${state === "failed" ? '"filesystem_denied"' : "undefined"});
      process.exit(0);`;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(store.getProject(id)!.state, state);
    assert.equal(store.getProject(id)!.attempt, 1);
    const replay = store.getProjectRetry(id, "interrupted-retry")!;
    assert.equal(replay.pending, false);
    assert.deepEqual(replay.project, store.getProject(id));
    assert.throws(() => store.claimProjectAttempt(id, "interrupted-retry"), code("retry_in_progress"));
    assert.equal(store.claimProjectAttempt(id), 2);
    assert.deepEqual(store.getProjectRetry(id, "interrupted-retry"), replay);
    store.releaseProjectAttempt(id);
  });
}

test("live process ownership refuses a second process, SIGKILL permits retry", async (t) => {
  const { store, directory, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const script = `import { ObservationStore } from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)};
    const s = new ObservationStore(${JSON.stringify(directory)});
    s.claimProjectAttempt(${JSON.stringify(id)});
    process.stdout.write("claimed"); setInterval(() => {}, 1000);`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => child.kill("SIGKILL"));
  await once(child.stdout, "data");
  assert.throws(() => store.claimProjectAttempt(id), code("retry_in_progress"));
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.equal(store.claimProjectAttempt(id), 2);
  store.releaseProjectAttempt(id);
});

for (const sameKey of [true, false]) {
  test(`ten concurrent process requests ${sameKey ? "deduplicate one key" : "refuse slug collisions"}`, async (t) => {
    const { store, directory, input } = setup(t);
    const results = await Promise.all(Array.from({ length: 10 }, async (_, index) => {
      const script = `import { ObservationStore } from ${JSON.stringify(new URL("../src/store.ts", import.meta.url).href)};
        const s = new ObservationStore(${JSON.stringify(directory)});
        try { process.stdout.write(JSON.stringify(s.requestProject(${JSON.stringify({ ...input, requestKey: sameKey ? input.requestKey : `request-${index}` })}))); }
        catch (error) { process.stdout.write(JSON.stringify({ error: error.code })); }
        finally { s.close(); }`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      const [status] = await once(child, "exit");
      assert.equal(status, 0, stderr);
      return JSON.parse(output);
    }));
    assert.equal(results.filter((result) => result.created).length, 1);
    assert.equal(store.listProjects().length, 1);
    assert.equal(results.filter((result) => sameKey ? result.created === false : result.error === "slug_taken").length, 9);
  });
}

test("project contention is a stable error and cannot leave a partial claim", (t) => {
  const { store, directory, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const database = new DatabaseSync(join(directory, "observations.sqlite"));
  t.after(() => database.close());
  database.exec("BEGIN IMMEDIATE");
  assert.throws(() => store.claimProjectAttempt(id), code("busy"));
  database.exec("ROLLBACK");
  assert.equal(store.getProject(id)!.attempt, 0);
  assert.equal(store.claimProjectAttempt(id), 1);
  store.releaseProjectAttempt(id);
});

test("a failed release clears this process owner so an immediate retry can recover", (t) => {
  const { store, directory, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const attempt = store.claimProjectAttempt(id);
  const database = new DatabaseSync(join(directory, "observations.sqlite"));
  t.after(() => database.close());
  database.exec("BEGIN IMMEDIATE");
  assert.throws(() => store.releaseProjectAttempt(id), code("busy"));
  database.exec("ROLLBACK");
  assert.equal(store.claimProjectAttempt(id), attempt + 1);
  store.releaseProjectAttempt(id);
});

test("binding and established event roll back together if either write fails", (t) => {
  const { store, directory, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const attempt = store.claimProjectAttempt(id);
  store.appendProjectEvent(id, "external-unknown", attempt);
  const database = new DatabaseSync(join(directory, "observations.sqlite"));
  t.after(() => database.close());
  database.exec(`CREATE TRIGGER refuse_established BEFORE INSERT ON project_provisioning_events
    WHEN NEW.state = 'established' BEGIN SELECT RAISE(ABORT, 'test refusal'); END`);
  assert.throws(() => store.bindProject(id, attempt, binding), /test refusal/);
  assert.equal(store.getProject(id)!.state, "external-unknown");
  assert.equal(store.getProject(id)!.harness, null);
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM project_harness_bindings").get()!.n, 0);
  database.exec("DROP TRIGGER refuse_established");
  store.bindProject(id, attempt, binding);
  store.releaseProjectAttempt(id);
});

test("PID reuse does not retain an abandoned durable owner", (t) => {
  const { store, directory, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const database = new DatabaseSync(join(directory, "observations.sqlite"));
  t.after(() => database.close());
  database.prepare("UPDATE project_provisioning_events SET event_id = ? WHERE project_id = ?")
    .run(`project-owner:${process.pid}:previous-process-identity:synthetic-owner:event`, id);
  assert.equal(store.claimProjectAttempt(id), 1);
  store.releaseProjectAttempt(id);
});

for (const version of [15, 16]) {
  test(`schema ${version} migrates to 18 with exact project columns and preserved history`, (t) => {
    const { store, directory, input } = setup(t);
    store.dissolveCivilization(input.civilizationId);
    store.close();
    const path = join(directory, "observations.sqlite");
    const historical = new DatabaseSync(path);
    const before = historical.prepare("SELECT * FROM mandate_revisions ORDER BY revision_order").all();
    historical.exec(`DROP TABLE project_harness_bindings; DROP TABLE project_provisioning_events; DROP TABLE projects;
      ${version === 15 ? "DROP TABLE source_report_facts; DROP TABLE source_report_admissions; DROP TABLE source_reports;" : ""}
      PRAGMA user_version = ${version};`);
    historical.close();
    const migrated = new ObservationStore(directory);
    t.after(() => migrated.close());
    assert.deepEqual(migrated.listProjects(), []);
    const database = new DatabaseSync(path);
    t.after(() => database.close());
    assert.equal(database.prepare("PRAGMA user_version").get()!.user_version, 18);
    assert.deepEqual(database.prepare("SELECT * FROM mandate_revisions ORDER BY revision_order").all(), before);
    for (const [table, columns] of Object.entries({
      projects: "project_order project_id civilization_id name slug workspace_path harness request_key request_digest requested_at",
      project_provisioning_events: "event_order event_id project_id state attempt reason recorded_at retry_request_key",
      project_harness_bindings: "project_id harness harness_home harness_version external_id external_slug external_archived provenance observed_at",
    })) {
      assert.deepEqual(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name), columns.split(" "));
      assert.ok(database.prepare(`PRAGMA foreign_key_list(${table})`).all().every((row) => row.on_delete === "NO ACTION"));
    }
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
  });
}

test("schema 17 adds retry keys without changing existing project history", (t) => {
  const { store, directory, input } = setup(t);
  const project = store.requestProject(input).project;
  store.close();
  const historical = new DatabaseSync(join(directory, "observations.sqlite"));
  historical.exec(`DROP INDEX project_retry_requests;
    ALTER TABLE project_provisioning_events DROP COLUMN retry_request_key;
    PRAGMA user_version = 17;`);
  const before = historical.prepare("SELECT * FROM project_provisioning_events ORDER BY event_order").all();
  historical.close();
  const migrated = new ObservationStore(directory);
  t.after(() => migrated.close());
  assert.deepEqual(migrated.getProject(project.projectId), project);
  const events = migrated.exportOwnedState().bundle.institutionStore.projectProvisioningEvents!;
  assert.deepEqual(events.map(({ retry_request_key, ...event }) => {
    assert.equal(retry_request_key, null);
    return event;
  }), before.map((event) => ({ ...event })));
  const attempt = migrated.claimProjectAttempt(project.projectId, "new-retry");
  migrated.releaseProjectAttempt(project.projectId);
  assert.equal(migrated.getProjectRetry(project.projectId, "new-retry")!.project.attempt, attempt);
});

test("forget inventories and exports projects, deletes all project rows transactionally, never directories", async (t) => {
  const { store, directory, input } = setup(t);
  mkdirSync(input.workspacePath);
  const file = join(input.workspacePath, "user-work.txt");
  writeFileSync(file, "user-owned contents");
  const id = store.requestProject(input).project.projectId;
  const attempt = store.claimProjectAttempt(id, "exported-retry");
  store.bindProject(id, attempt, binding);
  store.releaseProjectAttempt(id);
  store.dissolveCivilization(input.civilizationId);
  const plan = store.planForgetCivilization(input.civilizationId, "user");
  assert.deepEqual(plan.projects, [{ projectId: id, workspacePath: input.workspacePath }]);
  assert.equal(plan.counts.projects, 1);
  assert.equal(plan.counts.projectHarnessBindings, 1);
  assert.match(plan.consequence, /directories.*remain untouched/);
  const exported = store.exportOwnedState();
  const institution = exported.bundle.institutionStore;
  assert.equal(institution.projects![0]!.project_id, id);
  assert.equal(institution.projectProvisioningEvents!.length, plan.counts.projectProvisioningEvents);
  assert.equal(institution.projectHarnessBindings![0]!.harness_home, binding.harnessHome);
  assert.equal(exported.counts.projects, institution.projects!.length);
  assert.equal(exported.counts.projectProvisioningEvents, institution.projectProvisioningEvents!.length);
  assert.equal(exported.counts.projectHarnessBindings, institution.projectHarnessBindings!.length);
  assert.ok(institution.projectProvisioningEvents!.some((event) => event.retry_request_key === "exported-retry"));
  const database = new DatabaseSync(join(directory, "observations.sqlite"));
  t.after(() => database.close());
  database.exec("CREATE TRIGGER refuse_project_forget BEFORE DELETE ON projects BEGIN SELECT RAISE(ABORT, 'test refusal'); END");
  await assert.rejects(store.forgetCivilization(input.civilizationId, "user", exported.digest, plan.confirmationToken), /test refusal/);
  assert.equal(store.getProject(id)!.state, "established");
  assert.equal(store.getProject(id)!.harness!.externalId, binding.externalId);
  database.exec("DROP TRIGGER refuse_project_forget");
  const forgotten = await store.forgetCivilization(input.civilizationId, "user", exported.digest, plan.confirmationToken);
  assert.deepEqual(forgotten.projects, plan.projects);
  assert.deepEqual(store.civilizationForgetRecords()[0]!.projects, plan.projects);
  for (const table of ["projects", "project_provisioning_events", "project_harness_bindings"]) {
    assert.equal(database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0);
  }
  assert.deepEqual(store.listProjects(), []);
  assert.equal(store.getProjectRetry(id, "exported-retry"), undefined);
  assert.equal(readFileSync(file, "utf8"), "user-owned contents");
});

test("forget cannot race a live provisioning attempt and stale project export is refused", async (t) => {
  const { store, input } = setup(t);
  const id = store.requestProject(input).project.projectId;
  const attempt = store.claimProjectAttempt(id);
  store.dissolveCivilization(input.civilizationId);
  const stale = store.exportOwnedState();
  assert.throws(() => store.planForgetCivilization(input.civilizationId, "user"), code("retry_in_progress"));
  store.releaseProjectAttempt(id);
  const plan = store.planForgetCivilization(input.civilizationId, "user");
  assert.equal(store.getProject(id)!.attempt, attempt);
  await assert.rejects(store.forgetCivilization(input.civilizationId, "user", stale.digest, plan.confirmationToken), { code: "forget_civilization_export_coverage_mismatch" });
});
