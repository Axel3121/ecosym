import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "./arena-observation-bundle-v1.schema.json" with { type: "json" };
import { sha256, type JsonValue } from "./json.ts";
import type { SourceEpistemicType, SourceReportSnapshot } from "./source-report.ts";
import { sourceReportInstantOrderingKey } from "./source-report-time.ts";

export interface ArenaBundle {
  schemaVersion: 1;
  bundleId: string;
  source: { sourceId: string; owner: string; system: string; endpoint: string; selectedScope: string; license: string };
  observation: SourceReportSnapshot["observation"];
  provenance: { inputs: { inputId: string; role: string; uri: string; retrievalStatus: string; retrievedAt: string | null; mediaType: string | null; digest: string | null; failureCode: string | null }[] };
  processing: {
    pipeline: { name: string; version: string };
    rules: { ruleId: string; name: string; version: string; status: string }[];
    models: { modelRunId: string; role: string; provider: string; modelId: string; configurationVersion: string; status: string; outputDigest: string | null }[];
  };
  verification: SourceReportSnapshot["verification"] & { methods: { methodId: string; name: string; version: string }[]; notes: string };
  freshness: SourceReportSnapshot["freshness"];
  uncertainty: { classification: SourceReportSnapshot["uncertainty"]["classification"]; dimensions: (SourceReportSnapshot["uncertainty"]["dimensions"][number] & { description: string })[] };
  facts: { factId: string; epistemicType: SourceEpistemicType; factOwner: string; kind: string; subject: string; sourceRecordedAt: string | null; validFrom: string | null; validUntil: string | null; inputRefs: string[]; processingRefs: string[]; payload: Record<string, JsonValue> }[];
  producedAt: string;
}

// The producer schema uses applicators without repeated type/required declarations.
// Disable those lint checks, not validation of any schema keyword or format.
const ajv = new Ajv2020({ strict: true, strictTypes: false, strictRequired: false, allErrors: false });
addFormats.default(ajv);
const validate = ajv.compile<ArenaBundle>(schema);

export class ArenaAdmissionError extends Error {
  readonly code: "arena_invalid" | "arena_conflict";
  constructor(code: "arena_invalid" | "arena_conflict" = "arena_invalid") {
    super("Arena report admission refused");
    this.name = "ArenaAdmissionError";
    this.code = code;
  }
}

/** Internal adapter, not a persistence API. Only the store owns expected identity. */
export function parseArenaBundle(input: string | Uint8Array, expected: { sourceId: string; owner: string }): { bundle: ArenaBundle; canonical: string; digest: string } {
  try {
    if (typeof input !== "string" && !(input instanceof Uint8Array)) throw new ArenaAdmissionError();
    if ((typeof input === "string" ? Buffer.byteLength(input, "utf8") : input.byteLength) > 2 * 1024 * 1024) throw new ArenaAdmissionError();
    const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
    if (!text.isWellFormed()) throw new ArenaAdmissionError();
    let items = 0;
    const detach = (value: unknown, depth: number): JsonValue => {
      if (depth > 32 || ++items > 100_000) throw new ArenaAdmissionError();
      if (value === null || typeof value === "boolean") return value;
      if (typeof value === "string" && value.isWellFormed()) return value;
      if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)
        && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
      if (Array.isArray(value)) {
        if (value.length > 10_000) throw new ArenaAdmissionError();
        return value.map((item) => detach(item, depth + 1));
      }
      if (value !== null && typeof value === "object") {
        const entries = Object.entries(value);
        if (entries.length > 10_000) throw new ArenaAdmissionError();
        const copy: Record<string, JsonValue> = Object.create(null);
        for (const [key, item] of entries) {
          if (!key.isWellFormed()) throw new ArenaAdmissionError();
          Object.defineProperty(copy, key, { value: detach(item, depth + 1), enumerable: true, writable: true, configurable: true });
        }
        return copy;
      }
      throw new ArenaAdmissionError();
    };
    const bundle: unknown = detach(JSON.parse(text), 0);
    if (!validate(bundle) || bundle.source.sourceId !== expected.sourceId || bundle.source.owner !== expected.owner) throw new ArenaAdmissionError();
    validateSemantics(bundle);
    // fromEntries defines data properties, including __proto__, rather than
    // invoking Object.prototype setters while sorting the validated tree.
    const canonical = JSON.stringify(bundle, (_key, value: unknown) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
        : value);
    return { bundle, canonical, digest: sha256(canonical) };
  } catch {
    throw new ArenaAdmissionError();
  }
}

function validateSemantics(bundle: ArenaBundle): void {
  const unique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new ArenaAdmissionError();
  };
  unique(bundle.facts.map((fact) => fact.factId));
  unique(bundle.provenance.inputs.map((input) => input.inputId));
  unique([...bundle.processing.rules.map((rule) => rule.ruleId), ...bundle.processing.models.map((model) => model.modelRunId)]);
  unique(bundle.verification.methods.map((method) => method.methodId));
  const inputs = new Set(bundle.provenance.inputs.filter((input) => input.retrievalStatus === "retrieved").map((input) => input.inputId));
  const processing = new Set([
    ...bundle.processing.rules.filter((rule) => rule.status === "completed").map((rule) => rule.ruleId),
    ...bundle.processing.models.filter((model) => model.status === "completed").map((model) => model.modelRunId),
  ]);
  const key = (value: string): bigint => {
    const result = sourceReportInstantOrderingKey(value);
    if (result === null) throw new ArenaAdmissionError();
    return result;
  };
  const before = (first: string | null, last: string | null) => {
    if (first !== null) key(first);
    if (last !== null) key(last);
    if (first !== null && last !== null && key(first) > key(last)) throw new ArenaAdmissionError();
  };
  const observation = bundle.observation;
  const ended = observation.state === "observed" ? observation.completedAt : observation.failedAt;
  before(observation.attemptedAt, ended);
  before(ended, bundle.producedAt);
  before(observation.attemptedAt, bundle.verification.checkedAt);
  before(bundle.verification.checkedAt, bundle.producedAt);
  before(observation.attemptedAt, bundle.freshness.evaluatedAt);
  before(bundle.freshness.evaluatedAt, bundle.producedAt);
  before(bundle.freshness.sourceAsOf, bundle.freshness.evaluatedAt);
  before(bundle.freshness.sourceAsOf, bundle.freshness.validUntil);
  if (bundle.freshness.status === "current") before(bundle.freshness.evaluatedAt, bundle.freshness.validUntil);
  if (bundle.freshness.status === "stale" && bundle.freshness.validUntil !== null && key(bundle.freshness.validUntil) >= key(bundle.freshness.evaluatedAt)) throw new ArenaAdmissionError();
  if (observation.state === "cannot_observe" && observation.lastSuccessfulBundleId === bundle.bundleId) throw new ArenaAdmissionError();
  for (const input of bundle.provenance.inputs) {
    before(input.retrievedAt, ended);
    // Previous bundles may have been retrieved before this attempt, and need
    // not exist in the local store when a source is first connected.
    if (input.role !== "previous_bundle") before(observation.attemptedAt, input.retrievedAt);
    if (input.role === "previous_bundle" && (input.inputId === bundle.bundleId || decodeURIComponent(input.uri).split(/[:/#?=&]/).includes(bundle.bundleId))) throw new ArenaAdmissionError();
  }
  for (const fact of bundle.facts) {
    if ([fact.factOwner, fact.subject].some((value) => value.includes("\u0000"))) throw new ArenaAdmissionError();
    if (!fact.inputRefs.every((id) => inputs.has(id)) || !fact.processingRefs.every((id) => processing.has(id))) throw new ArenaAdmissionError();
    before(fact.sourceRecordedAt, ended);
    before(fact.validFrom, fact.validUntil);
  }
}

export function sourceReportProjection(bundle: ArenaBundle, local: Pick<SourceReportSnapshot, "reportId" | "connectionId" | "connectionVersion" | "admittedFrom" | "admittedAt">): SourceReportSnapshot {
  return {
    ...local, bundleId: bundle.bundleId,
    sourceId: bundle.source.sourceId, owner: bundle.source.owner,
    selectedScope: bundle.source.selectedScope, producedAt: bundle.producedAt,
    factCount: bundle.facts.length, observation: bundle.observation,
    verification: { status: bundle.verification.status, scope: bundle.verification.scope, checkedAt: bundle.verification.checkedAt },
    freshness: bundle.freshness,
    uncertainty: { classification: bundle.uncertainty.classification, dimensions: bundle.uncertainty.dimensions.map(({ kind, level }) => ({ kind, level })) },
  };
}
