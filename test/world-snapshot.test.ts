import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseCivilizationConfig } from "../src/institution.ts";
import { ObservationStore } from "../src/store.ts";
import { composeWorldSnapshot } from "../src/world-application.ts";
import { worldForm } from "../src/world-form.ts";
import { validateWorldSnapshot, WORLD_FACT_SEMANTICS_CAVEAT, type WorldSnapshot } from "../src/world-snapshot.ts";
import type { WorldProjectSnapshot } from "../src/project-types.ts";

const instant = "2026-01-01T00:00:00.000Z";
const project: WorldProjectSnapshot = {
  projectId: "project:synthetic", civilizationId: "civilization:synthetic", name: "Fjordkart", slug: "fjordkart",
  workspacePath: "/synthetic/fjordkart", state: "established", attempt: 1, reason: null,
  harness: { id: "hermes", externalId: "p_ab12cd34", externalSlug: "fjordkart-2", externalArchived: true,
    provenance: "adopted", observedAt: instant },
};
function snapshot(): WorldSnapshot {
  return { schemaVersion: 2, projects: [structuredClone(project)],
    civilizations: [{ civilizationId: project.civilizationId, name: "Synthetic", foundedAt: instant,
      bodyReadable: true, domain: "Synthetic", sources: [], mayActAlone: [], mustEscalate: [],
      mandate: { status: "active", mandateId: "mandate:synthetic", revision: "v1", recordedAt: instant } }],
    sourcePictures: [{ civilizationId: project.civilizationId, sources: [] }], observationsTruncated: false, claimsTruncated: false };
}

test("schema 2 projects are detached declared state, not source observations or activity marks", () => {
  const input = snapshot();
  const validated = validateWorldSnapshot(input);
  assert.deepEqual(validated, input);
  assert.notEqual(validated.projects![0], input.projects![0]);
  assert.notEqual(validated.projects![0]!.harness, input.projects![0]!.harness);
  assert.match(WORLD_FACT_SEMANTICS_CAVEAT, /A project is a declared place/);
  assert.match(WORLD_FACT_SEMANTICS_CAVEAT, /never a present-tense claim/);
  assert.match(WORLD_FACT_SEMANTICS_CAVEAT, /never evidence of work, activity, or an admitted mandate/);
  assert.deepEqual(worldForm(input).places, worldForm({ ...input, projects: [] }).places);
  for (const state of ["requested", "directory-created", "external-unknown", "failed"] as const) {
    input.projects = [{ ...project, state, attempt: state === "requested" ? 0 : 1, harness: null,
      reason: state === "failed" ? "filesystem_denied" : state === "external-unknown" ? "harness_timeout" : null }];
    assert.deepEqual(validateWorldSnapshot(input).projects, input.projects);
  }
});

test("all snapshot versions without projects remain valid TypeScript and retain their runtime shape", () => {
  const { civilizations, sourcePictures, observationsTruncated, claimsTruncated } = snapshot();
  for (const schemaVersion of [1, 2, 3] as const) {
    const legacy: WorldSnapshot = { schemaVersion, civilizations, sourcePictures, observationsTruncated, claimsTruncated };
    for (const input of [legacy, JSON.parse(JSON.stringify(legacy))]) {
      const validated = validateWorldSnapshot(input);
      assert.deepEqual(validated, legacy);
      assert.equal(Object.hasOwn(validated, "projects"), false);
      assert.notEqual(validated.civilizations[0], input.civilizations[0]);
      assert.deepEqual(worldForm(input).snapshot, legacy);
      assert.deepEqual(worldForm(input).places, worldForm({ ...legacy, schemaVersion: 2, projects: [] }).places);
    }
  }
  assert.deepEqual(validateWorldSnapshot({ ...snapshot(), projects: [] }).projects, []);
});

test("legacy schema 1 keeps its closed shape and rejects projects even when empty or undefined", () => {
  for (const projects of [[], [project], undefined, null]) {
    for (const boundary of [validateWorldSnapshot, worldForm]) {
      assert.throws(() => boundary({ ...snapshot(), schemaVersion: 1, projects }));
    }
  }
});

test("collection failureCode is required only in schema 3 and is closed and reason-bound", () => {
  const legacyCollection = { connectionId: "source", connectionVersion: "v1", lastAttemptAt: instant,
    reason: "failed", status: "unread" };
  const input = snapshot();
  input.civilizations[0]!.sources = ["source"];
  const withCollection = (schemaVersion: number, collection: unknown) => ({
    ...input, schemaVersion,
    ...(schemaVersion === 1 ? {} : { projects: input.projects }),
    sourcePictures: [{ civilizationId: project.civilizationId, sources: [{ connectionId: "source",
      collection, attemptsInProgress: [], observations: [], claims: [] }] }],
  });
  for (const schemaVersion of [1, 2]) {
    const legacy = withCollection(schemaVersion, legacyCollection);
    if (schemaVersion === 1) delete legacy.projects;
    for (const value of [legacy, JSON.parse(JSON.stringify(legacy))]) {
      assert.deepEqual(validateWorldSnapshot(value), legacy);
      for (const failureCode of [null, "source_unreadable"]) {
        const invalid = structuredClone(value);
        invalid.sourcePictures[0].sources[0].collection.failureCode = failureCode;
        assert.throws(() => validateWorldSnapshot(invalid), /Invalid world snapshot fields/);
      }
    }
  }
  for (const failureCode of [null, "source_unreadable", "source_malformed", "a", "a".repeat(64)]) {
    const valid = withCollection(3, { ...legacyCollection, failureCode });
    assert.deepEqual(validateWorldSnapshot(JSON.parse(JSON.stringify(valid))), valid);
  }
  assert.throws(() => validateWorldSnapshot(withCollection(3, legacyCollection)), /Invalid world snapshot fields/);
  for (const failureCode of [undefined, "", "Bad_code", "source-unreadable", "private\ntext", "a".repeat(65), 1, false, {}, []]) {
    assert.throws(() => validateWorldSnapshot(withCollection(3, { ...legacyCollection, failureCode })), /Invalid collection failure code/);
  }
  assert.throws(() => validateWorldSnapshot(withCollection(3, { ...legacyCollection, failureCode: null, extra: true })), /Invalid world snapshot fields/);
  for (const reason of ["collected", "nothing-new", "never-run", "incomplete", "retired", "skipped", "record-index-unknown"]) {
    const valid = withCollection(3, { ...legacyCollection, reason, failureCode: null,
      status: reason === "collected" ? "changed" : reason === "nothing-new" ? "quiet" : "unread",
      lastAttemptAt: reason === "never-run" ? null : instant });
    if (reason === "incomplete") Object.assign(valid.sourcePictures[0]!.sources[0]!, {
      attemptsInProgress: [{ attemptId: "attempt", connectionId: "source", connectionVersion: "v1", startedAt: instant }],
    });
    assert.deepEqual(validateWorldSnapshot(valid), valid);
    Object.assign(valid.sourcePictures[0]!.sources[0]!.collection!, { failureCode: "source_unreadable" });
    assert.throws(() => validateWorldSnapshot(valid), /Invalid collection failure code/);
  }
});

test("project contracts reject missing and extra keys, accessors, invalid values and inconsistent links", () => {
  const rejects = (value: unknown) => assert.throws(() => validateWorldSnapshot(value));
  const input = snapshot();
  rejects({ ...input, schemaVersion: 4 });
  rejects({ ...input, projects: undefined });
  rejects({ ...input, projects: null });
  rejects({ ...input, projects: {} });
  // A getter that throws would satisfy the bare assert.throws above by itself,
  // so each getter counts its calls and returns the valid value instead: the
  // accessor alone must cause the rejection, and it must never be invoked.
  let getterCalls = 0;
  const projectsAccessor = { ...input };
  Object.defineProperty(projectsAccessor, "projects", { enumerable: true, get() { getterCalls += 1; return input.projects; } });
  rejects(projectsAccessor);
  assert.equal(getterCalls, 0, "projects getter");
  rejects({ ...input, projects: new Array(1) });
  for (const key of Object.keys(project)) {
    const value = { ...project } as Record<string, unknown>;
    delete value[key];
    rejects({ ...input, projects: [value] });
  }
  for (const key of Object.keys(project.harness!)) {
    const binding = { ...project.harness } as Record<string, unknown>;
    delete binding[key];
    rejects({ ...input, projects: [{ ...project, harness: binding }] });
  }
  for (const invalid of [
    { ...project, extra: true }, { ...project, requestKey: "private" },
    { ...project, state: "active" }, { ...project, state: "failed", harness: null },
    { ...project, harness: null }, { ...project, state: "requested" },
    { ...project, attempt: -1 }, { ...project, attempt: 1.5 }, { ...project, attempt: Infinity },
    { ...project, reason: "private stderr" }, { ...project, reason: "harness_refused" },
    { ...project, name: "-help" }, { ...project, name: "bad\nname" }, { ...project, name: "a".repeat(65) },
    { ...project, slug: "../outside" }, { ...project, civilizationId: "missing" },
    { ...project, harness: { ...project.harness, harnessHome: "/private" } },
    { ...project, harness: { ...project.harness, id: "other" } },
    { ...project, harness: { ...project.harness, externalArchived: "false" } },
    { ...project, harness: { ...project.harness, provenance: "asserted" } },
    { ...project, harness: { ...project.harness, observedAt: "yesterday" } },
  ]) rejects({ ...input, projects: [invalid] });
  rejects({ ...input, projects: [project, project] });
  const accessor = { ...project };
  Object.defineProperty(accessor, "name", { enumerable: true, get() { getterCalls += 1; return project.name; } });
  rejects({ ...input, projects: [accessor] });
  assert.equal(getterCalls, 0, "project name getter");
  const bindingAccessor = { ...project.harness };
  Object.defineProperty(bindingAccessor, "externalId", { enumerable: true, get() { getterCalls += 1; return project.harness!.externalId; } });
  rejects({ ...input, projects: [{ ...project, harness: bindingAccessor }] });
  assert.equal(getterCalls, 0, "binding externalId getter");
});

test("owner composition requires listProjects and an open work claim changes no project depiction", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-world-projects-"));
  const store = new ObservationStore(join(directory, "state"));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const { civilizationId } = store.foundCivilization(parseCivilizationConfig({ schemaVersion: 1, name: "Synthetic",
    domain: "Synthetic", sources: [], mayActAlone: [], mustEscalate: [] }));
  const { project: requested } = store.requestProject({ civilizationId, name: "Fjordkart", slug: "fjordkart",
    workspacePath: join(directory, "fjordkart"), harness: "hermes", requestKey: "synthetic-key", requestDigest: "synthetic-digest" });
  const attempt = store.claimProjectAttempt(requested.projectId);
  store.bindProject(requested.projectId, attempt, { externalId: "p_ab12cd34", externalSlug: "fjordkart-2",
    externalArchived: true, provenance: "adopted", harnessHome: join(directory, "hermes"), harnessVersion: "0.21.0" });
  store.releaseProjectAttempt(requested.projectId);
  const before = composeWorldSnapshot(store);
  assert.equal(before.schemaVersion, 3);
  assert.equal(before.projects![0]!.state, "established");
  assert.deepEqual(before.sourcePictures, [{ civilizationId, sources: [] }]);
  store.claimResource(civilizationId, "synthetic-resource", "synthetic-agent");
  assert.deepEqual(composeWorldSnapshot(store), before);
  assert.deepEqual(worldForm(composeWorldSnapshot(store)), worldForm(before));
  assert.throws(() => composeWorldSnapshot({ listFoundedCivilizations: () => [], narrate: () => ({ connections: [],
    attemptsInProgress: [], observations: [], claims: [], observationsTruncated: false, claimsTruncated: false }) } as never));
});
