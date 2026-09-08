import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadWorld } from "../web/world-client.ts";
import type { WorldSnapshot } from "../src/world-snapshot.ts";
import { inspectSourceFields, worldForm } from "../src/world-form.ts";

const instant = "2026-01-01T00:00:00.000Z";
function snapshot(): WorldSnapshot {
  return { schemaVersion: 2, civilizations: [], sourcePictures: [], projects: [], observationsTruncated: false, claimsTruncated: false };
}
const respond = (value: unknown): typeof fetch => async () => Response.json(value);

test("HTTP, invalid response, request failure and loaded empty are distinct", async () => {
  const empty = await loadWorld({ fetch: respond(snapshot()) });
  assert.equal(empty.kind, "loaded");
  assert.deepEqual(empty, { kind: "loaded", form: { snapshot: snapshot(), terrain: null, places: [] } });
  for (const value of [null, {}, { ...snapshot(), extra: true }, { ...snapshot(), claimsTruncated: "false" }]) {
    assert.deepEqual(await loadWorld({ fetch: respond(value) }), { kind: "failure", reason: "invalid-response" });
  }
  assert.deepEqual(await loadWorld({ fetch: async () => new Response("not json") }), { kind: "failure", reason: "invalid-response" });
  assert.deepEqual(await loadWorld({ fetch: async () => new Response("not json", { status: 503 }) }), { kind: "failure", reason: "http", status: 503 });
  assert.deepEqual(await loadWorld({ fetch: async () => { throw new TypeError("synthetic"); } }), { kind: "failure", reason: "request" });
  assert.deepEqual(await loadWorld({ fetch: async () => new Response(new ReadableStream({ start(controller) { controller.error(new SyntaxError("transport, not JSON")); } })) }), { kind: "failure", reason: "request" });
});

for (const rejects of [false, true]) {
  test(`HTTP failure cancels its body even when cancellation ${rejects ? "rejects" : "succeeds"}`, async () => {
    let cancellations = 0;
    const response = new Response(new ReadableStream({
      cancel() {
        cancellations++;
        return rejects ? Promise.reject(new Error("private cancellation details")) : Promise.resolve();
      },
    }), { status: 503 });
    assert.deepEqual(await loadWorld({ fetch: async () => response }), { kind: "failure", reason: "http", status: 503 });
    assert.equal(cancellations, 1);
  });
}

test("HTTP failure without a body preserves its status", async () => {
  assert.deepEqual(await loadWorld({ fetch: async () => new Response(null, { status: 500 }) }), { kind: "failure", reason: "http", status: 500 });
});

test("the exposed form retains every truth axis and pairs exact validated objects", async () => {
  const input = snapshot();
  const reasons = [null, "never-run", "nothing-new", "failed", "incomplete", "retired", "skipped", "record-index-unknown", "collected"] as const;
  for (const [index, reason] of reasons.entries()) {
    const connectionId = `source:${index}`;
    input.sourcePictures.push({ civilizationId: `civilization:${index}`, sources: [{
      connectionId,
      collection: reason === null ? null : { connectionId, connectionVersion: "v1", reason,
        status: reason === "nothing-new" ? "quiet" : reason === "collected" ? "changed" : "unread",
        lastAttemptAt: reason === "never-run" ? null : instant },
      attemptsInProgress: reason === "incomplete" ? [{ attemptId: "running", connectionId, connectionVersion: "v1", startedAt: instant }] : [],
      observations: [], claims: [],
    }] });
    input.civilizations.push({ civilizationId: `civilization:${index}`, name: "Synthetic", foundedAt: instant,
      bodyReadable: true, domain: "Synthetic", sources: [connectionId], mayActAlone: [], mustEscalate: [], mandate: { status: "active", mandateId: `mandate:${index}`, revision: "v1", recordedAt: instant } });
  }
  for (const bodyReadable of [true, false]) {
    const civilizationId = `civilization:body:${bodyReadable}`;
    input.civilizations.push({ civilizationId, name: "Synthetic", foundedAt: instant, bodyReadable, domain: "", sources: [], mayActAlone: [], mustEscalate: [], mandate: bodyReadable ? { status: "active", mandateId: "mandate:empty", revision: "v1", recordedAt: instant } : { status: "unreadable" } });
    input.sourcePictures.push({ civilizationId, sources: [] });
  }
  const source = input.sourcePictures.at(-3)!.sources[0]!;
  for (const [index, temporalStatus] of (["unknown", "current", "historical"] as const).entries()) {
    for (const epistemicStatus of ["observation", "claim"] as const) {
      source[epistemicStatus === "claim" ? "claims" : "observations"].push({ id: index * 2 + (epistemicStatus === "claim" ? 2 : 1),
        collectedAt: instant, connectionId: source.connectionId, connectionVersion: "v1", collectionAsOf: null,
        epistemicStatus, factOwner: "synthetic", kind: "record", payload: { status: "done" }, sourceRecordedAt: temporalStatus === "unknown" ? null : instant,
        sourceRecordId: `record:${index}`, subject: "synthetic", temporalStatus });
    }
  }
  input.observationsTruncated = input.claimsTruncated = true;
  input.sourcePictures.reverse();
  const result = await loadWorld({ fetch: respond(input) });
  assert.equal(result.kind, "loaded");
  if (result.kind !== "loaded") return;
  assert.equal(result.form.places.length, input.civilizations.length);
  assert.deepEqual(result.form.snapshot, input);
  assert.equal(result.form.terrain, null);
  assert.deepEqual(Object.keys(result.form).sort(), ["places", "snapshot", "terrain"]);
  for (const [index, place] of result.form.places.entries()) {
    assert.deepEqual(Object.keys(place).sort(), ["declaration", "domain", "id", "inspection", "institution", "marks", "name", "sourcePicture"]);
    assert.equal(place.declaration, result.form.snapshot.civilizations[index]);
    assert.equal(place.sourcePicture, result.form.snapshot.sourcePictures.find((picture) => picture.civilizationId === place.declaration.civilizationId));
    assert.equal(place.id, place.declaration.civilizationId);
    assert.equal(place.name, place.declaration.name);
    assert.equal(place.domain, place.declaration.bodyReadable ? place.declaration.domain : "unknown");
    assert.equal(place.institution, place.declaration.mandate.status);
    const sourceFields = inspectSourceFields(place.sourcePicture, result.form.snapshot);
    assert.deepEqual(place.inspection.slice(-sourceFields.length), sourceFields);
    assert.deepEqual(place.inspection.find((field) => field.label === "sources")?.values,
      !place.declaration.bodyReadable ? ["unknown"] : place.declaration.sources.length ? place.declaration.sources : ["[]"]);
    assert.deepEqual(place.marks.filter((mark) => mark.axis === "limits").map((mark) => mark.kind), ["observations-truncated", "claims-truncated"]);
    assert.deepEqual(place.marks.filter((mark) => mark.axis === "collection").map((mark) => mark.kind),
      [index >= reasons.length ? "unknown" : place.sourcePicture.sources[0]!.collection?.status ?? "missing"]);
    const attempts = place.marks.filter((mark) => mark.axis === "attempt");
    assert.equal(attempts.length, reasons[index] === "incomplete" ? 1 : 0);
    if (attempts.length) {
      assert.equal(attempts[0]!.kind, "in-progress");
      assert.match(attempts[0]!.label, /running; not proof of a live collector/);
    }
    const epistemic = place.marks.filter((mark) => mark.axis === "epistemic");
    const temporal = place.marks.filter((mark) => mark.axis === "temporal");
    assert.deepEqual(epistemic.map((mark) => mark.kind), index === 8 ? ["observation", "claim"] : []);
    assert.deepEqual(temporal.map((mark) => mark.kind), index === 8 ? ["unknown", "current", "historical", "unknown", "current", "historical"] : []);
    if (index === 8) {
      assert.ok(temporal.slice(0, 3).every((mark) => mark.label.includes("observation")));
      assert.ok(temporal.slice(3).every((mark) => mark.label.includes("claim")));
    }
  }
});

test("declaration inspection preserves metadata and distinguishes unreadable bodies from empty declarations", () => {
  for (const status of ["active", "dissolved", "unreadable"] as const) {
    for (const bodyReadable of status === "unreadable" ? [false] : [true, false]) {
      const input = snapshot();
      const declaration = { civilizationId: "civilization:trace", name: "Trace", foundedAt: instant,
        bodyReadable, domain: bodyReadable ? "Declared domain" : "", sources: [],
        mayActAlone: bodyReadable ? ["Read records"] : [], mustEscalate: bodyReadable ? ["Change policy"] : [],
        mandate: status === "unreadable" ? { status } : { status, mandateId: "mandate:trace", revision: "v2", recordedAt: instant } };
      input.civilizations.push(declaration);
      input.sourcePictures.push({ civilizationId: declaration.civilizationId, sources: [] });
      const place = worldForm(input).places.find((place) => place.id === declaration.civilizationId)!;
      const fields = Object.fromEntries(place.inspection.map((field) => [field.label, field.values]));
      assert.equal(place.institution, status);
      assert.deepEqual(place.marks.map(({ axis, kind }) => ({ axis, kind })), [
        { axis: "institution", kind: status }, { axis: "collection", kind: "unknown" },
      ]);
      assert.deepEqual(fields.Institution, [place.marks[0]!.label]);
      assert.deepEqual(fields["Civilization ID"], [declaration.civilizationId]);
      assert.deepEqual(fields.Name, [declaration.name]);
      assert.deepEqual(fields["Founded at"], [instant]);
      assert.deepEqual(fields["Declaration body readable"], [String(bodyReadable)]);
      assert.deepEqual(fields["Mandate status"], [status]);
      assert.deepEqual(fields["Mandate ID"], [status === "unreadable" ? "unknown" : "mandate:trace"]);
      assert.deepEqual(fields["Mandate revision"], [status === "unreadable" ? "unknown" : "v2"]);
      assert.deepEqual(fields["Mandate recorded at"], [status === "unreadable" ? "unknown" : instant]);
      assert.deepEqual(fields.Domain, [bodyReadable ? "Declared domain" : "unknown"]);
      assert.deepEqual(fields.sources, [bodyReadable ? "[]" : "unknown"]);
      assert.deepEqual(fields.mayActAlone, [bodyReadable ? "Read records" : "unknown"]);
      assert.deepEqual(fields.mustEscalate, [bodyReadable ? "Change policy" : "unknown"]);
      for (const axis of ["observations", "claims"] as const) {
        input[`${axis}Truncated`] = true;
        assert.deepEqual(worldForm(input).places.find((place) => place.id === declaration.civilizationId)!.marks.filter((mark) => mark.axis === "limits").map((mark) => mark.kind), [`${axis}-truncated`]);
        input[`${axis}Truncated`] = false;
      }
    }
  }
});

for (const bodyRead of [false, true]) {
  for (const cause of ["caller", "timeout", "tie"] as const) {
    test(`${cause} abort during ${bodyRead ? "body read" : "fetch"} is bounded and releases resources`, async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const caller = new AbortController();
      const add = t.mock.method(caller.signal, "addEventListener");
      const remove = t.mock.method(caller.signal, "removeEventListener");
      const clear = t.mock.method(globalThis, "clearTimeout");
      let requestSignal: AbortSignal | undefined;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => { entered = resolve; });
      const pending = loadWorld({ signal: caller.signal, fetch: async (url, options) => {
        assert.equal(url, "/api/world-snapshot");
        assert.equal(options?.cache, "no-store");
        assert.equal(options?.method, "GET");
        requestSignal = options?.signal as AbortSignal;
        if (!bodyRead) { entered(); return new Promise<Response>(() => {}); }
        return { ok: true, text: () => { entered(); return new Promise<string>(() => {}); } } as Response;
      } });
      await ready;
      if (cause !== "caller") {
        t.mock.timers.tick(9999);
        assert.equal(requestSignal?.aborted, false);
        t.mock.timers.tick(1);
      }
      if (cause !== "timeout") caller.abort();
      assert.deepEqual(await pending, cause === "timeout" ? { kind: "failure", reason: "request" } : { kind: "cancelled" });
      assert.equal(requestSignal?.aborted, true);
      assert.equal(add.mock.callCount(), remove.mock.callCount());
      assert.equal(clear.mock.callCount(), 1);
    });
  }
}

test("the default request is bounded even without a caller signal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal: AbortSignal | undefined;
  const pending = loadWorld({ fetch: async (_, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise<Response>(() => {});
  } });
  t.mock.timers.tick(9999);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await pending, { kind: "failure", reason: "request" });
  assert.equal(signal?.aborted, true);
});

test("pre-cancelled calls do not fetch; completed calls remove timer and caller listener", async (t) => {
  const caller = new AbortController();
  caller.abort();
  assert.deepEqual(await loadWorld({ signal: caller.signal, fetch: async () => { assert.fail("must not fetch"); } }), { kind: "cancelled" });
  for (const fetcher of [respond(snapshot()), respond({}), async () => new Response("", { status: 500 }), async () => { throw new Error("synthetic"); }]) {
    const controller = new AbortController();
    const remove = t.mock.method(controller.signal, "removeEventListener");
    const clear = t.mock.method(globalThis, "clearTimeout");
    await loadWorld({ signal: controller.signal, fetch: fetcher });
    assert.equal(remove.mock.callCount(), 1);
    assert.equal(clear.mock.callCount(), 1);
    clear.mock.restore();
  }
});

test("client import closure contains only product contracts, form and pure contract validation", () => {
  const allowed = new Set(["web/world-client.ts", "src/world-form.ts", "src/world-snapshot.ts", "src/project-types.ts", "src/institution-snapshot.ts", "src/observation-snapshot.ts", "src/validate-institution-snapshot.ts", "src/time.ts", "src/source-report.ts", "src/source-report-time.ts"]);
  const visited = new Set<string>();
  function visit(path: string): void {
    assert.ok(allowed.has(path), `Unexpected client dependency: ${path}`);
    if (visited.has(path)) return;
    visited.add(path);
    const url = new URL(`../${path}`, import.meta.url);
    const file = ts.createSourceFile(path, readFileSync(url, "utf8"), ts.ScriptTarget.Latest);
    function walk(node: ts.Node): void {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const dependency = new URL(node.moduleSpecifier.text, url);
        visit(dependency.pathname.slice(new URL("../", import.meta.url).pathname.length));
      }
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(file) === "require")) assert.fail("Unexpected dynamic dependency");
      ts.forEachChild(node, walk);
    }
    walk(file);
  }
  visit("web/world-client.ts");
});
