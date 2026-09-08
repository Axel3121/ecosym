import type { FoundedCivilizationSnapshot } from "./institution-snapshot.ts";
import type { ConnectionStatus, NarrationAttempt, StoredFact } from "./observation-snapshot.ts";
import { isRepresentableUtcInstant } from "./time.ts";
import { validateInstitutionSnapshot } from "./validate-institution-snapshot.ts";
import type { SourceReportProvenance, SourceReportSnapshot } from "./source-report.ts";
import { sourceReportInstantOrderingKey } from "./source-report-time.ts";
import { PROJECT_ERROR_CODES, type WorldProjectSnapshot } from "./project-types.ts";

export const WORLD_SNAPSHOT_SCHEMA_VERSION = 2;

export const WORLD_FACT_SEMANTICS_CAVEAT = "Observations describe the source owner's recorded fields at collection, not completed work, operational success or civilization activity. Runtime prose reports remain claims. Temporal status describes stored collection evidence, not live source truth. collectionAsOf is the latest successful collection interval in the fact's last-seen connection/configuration/activation lifetime; null means unknown. collectedAt is provenance, never a substitute for sourceRecordedAt. Verify does not reconcile this picture; recollect to advance it. Running attempts and truncated results can leave the picture partial. A project is a declared place and its provisioning state. Its harness binding is what was observed at observedAt, never a present-tense claim, and never evidence of work, activity, or an admitted mandate in any runtime.";

export interface WorldSourceSnapshot {
  sourceReport?: SourceReportSnapshot;
  connectionId: string;
  collection: ConnectionStatus | null;
  attemptsInProgress: NarrationAttempt[];
  observations: StoredFact[];
  claims: StoredFact[];
}

export interface WorldSourcePicture {
  civilizationId: string;
  sources: WorldSourceSnapshot[];
}

export interface WorldSnapshot {
  schemaVersion: typeof WORLD_SNAPSHOT_SCHEMA_VERSION;
  civilizations: FoundedCivilizationSnapshot[];
  sourcePictures: WorldSourcePicture[];
  projects: WorldProjectSnapshot[];
  /** Owner-wide limits, not per-civilization completeness assessments. */
  observationsTruncated: boolean;
  claimsTruncated: boolean;
}

function record(value: unknown, keys?: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("Invalid world snapshot object");
  }
  const ownKeys = Reflect.ownKeys(value);
  if ((keys && (ownKeys.some((key) => !keys.includes(String(key)) && !optional.includes(String(key)))
    || keys.some((key) => !Object.hasOwn(value, key))))
    || ownKeys.some((key) => typeof key !== "string"
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) {
    throw new Error("Invalid world snapshot fields");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid world snapshot string");
  return value;
}

function timestamp(value: unknown): string {
  const result = text(value);
  if (!isRepresentableUtcInstant(result)) throw new Error("Invalid world snapshot timestamp");
  return result;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid world snapshot boolean");
  return value;
}

function boundedText(value: unknown, maximum: number): string {
  const result = text(value);
  if (result.length === 0 || result.length > maximum) throw new Error("Invalid source report string bounds");
  return result;
}

function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (!choices.includes(value as T)) throw new Error("Invalid source report enum");
  return value as T;
}

function reportTime(value: unknown, local = false): string {
  const result = text(value);
  if (sourceReportInstantOrderingKey(result) === null
    || (local && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result))) {
    throw new Error("Invalid source report timestamp");
  }
  return result;
}

function report(value: unknown): SourceReportSnapshot {
  const entry = record(value, ["reportId", "bundleId", "connectionId", "connectionVersion", "admittedFrom", "admittedAt",
    "sourceId", "owner", "selectedScope", "producedAt", "factCount", "observation", "verification", "freshness", "uncertainty"]);
  const connectionVersion = text(entry.connectionVersion);
  if (!/^[a-f0-9]{64}$/.test(connectionVersion)) throw new Error("Invalid source report connection version");
  if (typeof entry.factCount !== "number" || !Number.isInteger(entry.factCount) || entry.factCount < 0 || entry.factCount > 1000) {
    throw new Error("Invalid source report fact count");
  }
  const rawObservation = record(entry.observation);
  let observation: SourceReportSnapshot["observation"];
  if (rawObservation.state === "observed") {
    const observed = record(rawObservation, ["state", "attemptedAt", "completedAt", "activity", "scopeComplete"]);
    if (observed.scopeComplete !== true) throw new Error("Invalid source report scope completeness");
    observation = { state: "observed", attemptedAt: reportTime(observed.attemptedAt), completedAt: reportTime(observed.completedAt),
      activity: choice(observed.activity, ["present", "none"]), scopeComplete: true };
    if ((observation.activity === "none") !== (entry.factCount === 0)) throw new Error("Inconsistent source report activity");
  } else {
    const failed = record(rawObservation, ["state", "attemptedAt", "failedAt", "activity", "failure", "retryable", "lastSuccessfulBundleId"]);
    if (failed.state !== "cannot_observe" || failed.activity !== "unknown" || entry.factCount !== 0) throw new Error("Invalid upstream failure");
    observation = { state: "cannot_observe", attemptedAt: reportTime(failed.attemptedAt), failedAt: reportTime(failed.failedAt),
      activity: "unknown", failure: choice(failed.failure, ["timeout", "dns_error", "http_error", "malformed_source", "incomplete_source", "authorization_error", "rate_limited", "other"]),
      retryable: boolean(failed.retryable), lastSuccessfulBundleId: failed.lastSuccessfulBundleId === null ? null : boundedText(failed.lastSuccessfulBundleId, 128) };
    if (observation.lastSuccessfulBundleId === entry.bundleId) throw new Error("Self-referential source report");
  }
  const verification = record(entry.verification, ["status", "scope", "checkedAt"]);
  const freshness = record(entry.freshness, ["status", "basis", "evaluatedAt", "sourceAsOf", "validUntil"]);
  const uncertainty = record(entry.uncertainty, ["classification", "dimensions"]);
  if (!Array.isArray(uncertainty.dimensions) || uncertainty.dimensions.length < 1 || uncertainty.dimensions.length > 32) {
    throw new Error("Invalid source report dimensions bounds");
  }
  const normalized: SourceReportSnapshot = {
    reportId: boundedText(entry.reportId, 128), bundleId: boundedText(entry.bundleId, 128), connectionId: boundedText(entry.connectionId, 128),
    connectionVersion, admittedFrom: reportTime(entry.admittedFrom, true), admittedAt: reportTime(entry.admittedAt, true),
    sourceId: boundedText(entry.sourceId, 128), owner: boundedText(entry.owner, 512), selectedScope: boundedText(entry.selectedScope, 2048),
    producedAt: reportTime(entry.producedAt), factCount: entry.factCount, observation,
    verification: { status: choice(verification.status, ["verified", "partially_verified", "unverified", "contradicted"]),
      scope: choice(verification.scope, ["availability_only", "provenance_and_representation", "content"]), checkedAt: reportTime(verification.checkedAt) },
    freshness: { status: choice(freshness.status, ["current", "stale", "unknown"]),
      basis: choice(freshness.basis, ["source_validity", "source_timestamp", "retrieval_time", "unavailable"]), evaluatedAt: reportTime(freshness.evaluatedAt),
      sourceAsOf: freshness.sourceAsOf === null ? null : reportTime(freshness.sourceAsOf), validUntil: freshness.validUntil === null ? null : reportTime(freshness.validUntil) },
    uncertainty: { classification: choice(uncertainty.classification, ["none", "bounded", "unknown"]),
      dimensions: list(uncertainty.dimensions, (value) => {
        const dimension = record(value, ["kind", "level"]);
        return { kind: choice(dimension.kind, ["source_declared", "extraction", "coverage", "temporal", "other"]),
          level: choice(dimension.level, ["none", "low", "medium", "high", "unknown"]) };
      }) },
  };
  const before = (start: string | null, end: string | null) => {
    if (start !== null && end !== null && sourceReportInstantOrderingKey(start)! > sourceReportInstantOrderingKey(end)!) {
      throw new Error("Inconsistent source report chronology");
    }
  };
  const fresh = normalized.freshness;
  before(normalized.admittedFrom, normalized.admittedAt);
  const ended = observation.state === "observed" ? observation.completedAt : observation.failedAt;
  before(observation.attemptedAt, ended);
  before(ended, normalized.producedAt);
  before(observation.attemptedAt, normalized.verification.checkedAt);
  before(normalized.verification.checkedAt, normalized.producedAt);
  before(observation.attemptedAt, fresh.evaluatedAt);
  before(fresh.evaluatedAt, normalized.producedAt);
  before(fresh.sourceAsOf, fresh.evaluatedAt);
  before(fresh.sourceAsOf, fresh.validUntil);
  if (fresh.status !== "unknown" && fresh.validUntil === null) {
    throw new Error("Missing source report freshness validity bound");
  }
  if (fresh.status === "current") before(fresh.evaluatedAt, fresh.validUntil);
  if (fresh.status === "stale" && fresh.validUntil !== null
    && sourceReportInstantOrderingKey(fresh.validUntil)! >= sourceReportInstantOrderingKey(fresh.evaluatedAt)!) {
    throw new Error("Inconsistent source report staleness");
  }
  if (observation.state === "observed" ? fresh.basis === "unavailable" || fresh.sourceAsOf === null
    : fresh.status !== "unknown" || fresh.basis !== "unavailable" || fresh.sourceAsOf !== null || fresh.validUntil !== null
      || !normalized.uncertainty.dimensions.some((dimension) => dimension.kind === "coverage" && ["unknown", "high"].includes(dimension.level))) {
    throw new Error("Inconsistent source report coverage");
  }
  return normalized;
}

function list<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error("Invalid world snapshot array");
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Invalid world snapshot array entry");
    return parse(descriptor.value);
  });
}

function collection(value: unknown): ConnectionStatus | null {
  if (value === null) return null;
  const entry = record(value, ["connectionId", "connectionVersion", "lastAttemptAt", "reason", "status"]);
  const reason = entry.reason;
  if (reason !== "collected" && reason !== "failed" && reason !== "incomplete" && reason !== "never-run"
    && reason !== "nothing-new" && reason !== "record-index-unknown" && reason !== "retired" && reason !== "skipped") {
    throw new Error("Invalid collection reason");
  }
  const status = reason === "collected" ? "changed" : reason === "nothing-new" ? "quiet" : "unread";
  if (entry.status !== status || (reason === "never-run" && entry.lastAttemptAt !== null)
    || (reason !== "never-run" && reason !== "record-index-unknown" && entry.lastAttemptAt === null)) {
    throw new Error("Inconsistent collection status");
  }
  return {
    connectionId: text(entry.connectionId), connectionVersion: text(entry.connectionVersion),
    lastAttemptAt: entry.lastAttemptAt === null ? null : timestamp(entry.lastAttemptAt), reason, status,
  };
}

function fact(value: unknown, epistemicStatus: "observation" | "claim"): StoredFact {
  const entry = record(value, ["id", "collectedAt", "connectionId", "connectionVersion", "collectionAsOf",
    "epistemicStatus", "factOwner", "kind", "payload", "sourceRecordedAt", "sourceRecordId", "subject", "temporalStatus"], ["sourceReport"]);
  if (entry.epistemicStatus !== epistemicStatus) throw new Error("Miscategorized world fact");
  if (typeof entry.id !== "number" || !Number.isSafeInteger(entry.id) || entry.id < 1) {
    throw new Error("Invalid fact ID");
  }
  const temporalStatus = entry.temporalStatus;
  if (temporalStatus !== "current" && temporalStatus !== "historical" && temporalStatus !== "unknown") {
    throw new Error("Invalid fact temporal status");
  }
  if (temporalStatus === "current" && entry.sourceRecordedAt === null) throw new Error("Undated current fact");
  const payload = record(entry.payload);
  let sourceReport: SourceReportProvenance | undefined;
  if (Object.hasOwn(entry, "sourceReport")) {
    const provenance = record(entry.sourceReport, ["reportId", "epistemicType"]);
    sourceReport = { reportId: boundedText(provenance.reportId, 128),
      epistemicType: choice(provenance.epistemicType, ["observation", "claim", "derived"]) };
    if (epistemicStatus !== "claim" || Reflect.ownKeys(payload).length !== 0) throw new Error("Invalid source-report claim");
  }
  const normalizedPayload: StoredFact["payload"] = {};
  for (const key of Object.getOwnPropertyNames(payload).sort()) {
    const scalar = payload[key];
    if (scalar !== null && typeof scalar !== "string" && typeof scalar !== "boolean"
      && !(typeof scalar === "number" && Number.isFinite(scalar))) throw new Error("Invalid fact payload scalar");
    Object.defineProperty(normalizedPayload, key, { value: scalar, enumerable: true, writable: true, configurable: true });
  }
  let collectionAsOf: StoredFact["collectionAsOf"] = null;
  if (entry.collectionAsOf !== null) {
    const asOf = record(entry.collectionAsOf, ["attemptId", "activationId", "startedAt", "completedAt"]);
    collectionAsOf = {
      attemptId: text(asOf.attemptId), activationId: text(asOf.activationId),
      startedAt: timestamp(asOf.startedAt), completedAt: timestamp(asOf.completedAt),
    };
  }
  return {
    id: entry.id, collectedAt: timestamp(entry.collectedAt), connectionId: text(entry.connectionId),
    connectionVersion: text(entry.connectionVersion), collectionAsOf, epistemicStatus,
    factOwner: text(entry.factOwner), kind: text(entry.kind), payload: normalizedPayload,
    sourceRecordedAt: entry.sourceRecordedAt === null ? null : sourceReport ? reportTime(entry.sourceRecordedAt) : timestamp(entry.sourceRecordedAt),
    sourceRecordId: text(entry.sourceRecordId), subject: text(entry.subject), temporalStatus,
    ...(sourceReport ? { sourceReport } : {}),
  };
}

export function validateWorldProjectSnapshot(value: unknown): WorldProjectSnapshot {
  const entry = record(value, ["projectId", "civilizationId", "name", "slug", "workspacePath", "state", "attempt", "reason", "harness"]);
  const state = choice(entry.state, ["requested", "directory-created", "external-unknown", "established", "failed"]);
  if (typeof entry.attempt !== "number" || !Number.isSafeInteger(entry.attempt) || entry.attempt < 0) {
    throw new Error("Invalid project attempt");
  }
  const reason = entry.reason === null ? null : choice(entry.reason, PROJECT_ERROR_CODES);
  let harness: WorldProjectSnapshot["harness"] = null;
  if (entry.harness !== null) {
    const binding = record(entry.harness, ["id", "externalId", "externalSlug", "externalArchived", "provenance", "observedAt"]);
    harness = { id: choice(binding.id, ["hermes"]), externalId: boundedText(binding.externalId, 128),
      externalSlug: boundedText(binding.externalSlug, 128), externalArchived: boolean(binding.externalArchived),
      provenance: choice(binding.provenance, ["created", "adopted"]), observedAt: timestamp(binding.observedAt) };
  }
  if ((state === "established") !== (harness !== null) || (state === "failed" && reason === null)
    || ((state === "established" || state === "requested" || state === "directory-created") && reason !== null)) {
    throw new Error("Inconsistent project provisioning state");
  }
  const name = text(entry.name);
  const slug = text(entry.slug);
  if (name !== name.normalize("NFC").trim() || [...name].length < 1 || [...name].length > 64
    || /\p{C}/u.test(name) || name.startsWith("-") || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(slug)) {
    throw new Error("Invalid project name or slug");
  }
  return { projectId: boundedText(entry.projectId, 128), civilizationId: boundedText(entry.civilizationId, 128),
    name, slug, workspacePath: boundedText(entry.workspacePath, 4096), state, attempt: entry.attempt, reason, harness };
}

/** Reject extra fields, accessors and inconsistent links; return recursively detached data. */
export function validateWorldSnapshot(value: unknown): WorldSnapshot {
  const snapshot = record(value, ["schemaVersion", "civilizations", "sourcePictures", "projects", "observationsTruncated", "claimsTruncated"]);
  if (snapshot.schemaVersion !== WORLD_SNAPSHOT_SCHEMA_VERSION) throw new Error("Invalid world snapshot version");
  const { civilizations } = validateInstitutionSnapshot({ schemaVersion: 1, civilizations: snapshot.civilizations });
  const civilizationsById = new Map(civilizations.map((entry) => [entry.civilizationId, entry]));
  if (civilizationsById.size !== civilizations.length) throw new Error("Duplicate civilization ID");
  const projects = list(snapshot.projects, validateWorldProjectSnapshot);
  if (new Set(projects.map((project) => project.projectId)).size !== projects.length
    || projects.some((project) => !civilizationsById.has(project.civilizationId))) {
    throw new Error("Invalid project link");
  }
  const seenCivilizations = new Set<string>();
  const sharedSources = new Map<string, string>();
  const sourcePictures = list(snapshot.sourcePictures, (value): WorldSourcePicture => {
    const picture = record(value, ["civilizationId", "sources"]);
    const civilizationId = text(picture.civilizationId);
    const civilization = civilizationsById.get(civilizationId);
    if (!civilization || seenCivilizations.has(civilizationId)) throw new Error("Invalid civilization link");
    seenCivilizations.add(civilizationId);
    const expectedSources = new Set(civilization.sources);
    const seenSources = new Set<string>();
    const sources = list(picture.sources, (value): WorldSourceSnapshot => {
      const source = record(value, ["connectionId", "collection", "attemptsInProgress", "observations", "claims"], ["sourceReport"]);
      const connectionId = text(source.connectionId);
      if (!expectedSources.has(connectionId) || seenSources.has(connectionId)) throw new Error("Invalid source link");
      seenSources.add(connectionId);
      const normalized: WorldSourceSnapshot = {
        connectionId, collection: collection(source.collection),
        attemptsInProgress: list(source.attemptsInProgress, (value) => {
          const attempt = record(value, ["attemptId", "connectionId", "connectionVersion", "startedAt"]);
          return {
            attemptId: text(attempt.attemptId), connectionId: text(attempt.connectionId),
            connectionVersion: text(attempt.connectionVersion), startedAt: timestamp(attempt.startedAt),
          };
        }),
        observations: list(source.observations, (value) => fact(value, "observation")),
        claims: list(source.claims, (value) => fact(value, "claim")),
        ...(Object.hasOwn(source, "sourceReport") ? { sourceReport: report(source.sourceReport) } : {}),
      };
      const linked = [...normalized.attemptsInProgress, ...normalized.observations, ...normalized.claims,
        ...(normalized.sourceReport ? [normalized.sourceReport] : [])];
      if ((normalized.collection !== null && normalized.collection.connectionId !== connectionId)
        || (normalized.sourceReport && (normalized.observations.length !== 0 || normalized.claims.some((claim) => !claim.sourceReport)))
        || (normalized.collection?.reason === "incomplete" && normalized.attemptsInProgress.length === 0)
        || (normalized.collection?.reason === "never-run" && normalized.attemptsInProgress.length !== 0)
        || linked.some((entry) => entry.connectionId !== connectionId || normalized.collection === null
          || entry.connectionVersion !== normalized.collection.connectionVersion)
        || new Set(normalized.attemptsInProgress.map((entry) => entry.attemptId)).size !== normalized.attemptsInProgress.length
        || new Set([...normalized.observations, ...normalized.claims].map((entry) => entry.id)).size
          !== normalized.observations.length + normalized.claims.length) {
        throw new Error("Inconsistent source records");
      }
      const encoded = JSON.stringify(normalized);
      if (sharedSources.has(connectionId) && sharedSources.get(connectionId) !== encoded) {
        throw new Error("Inconsistent shared source picture");
      }
      sharedSources.set(connectionId, encoded);
      return normalized;
    });
    if (seenSources.size !== expectedSources.size) throw new Error("Missing source picture");
    return { civilizationId, sources };
  });
  if (seenCivilizations.size !== civilizations.length) throw new Error("Missing civilization picture");
  return {
    schemaVersion: WORLD_SNAPSHOT_SCHEMA_VERSION, civilizations, sourcePictures, projects,
    observationsTruncated: boolean(snapshot.observationsTruncated), claimsTruncated: boolean(snapshot.claimsTruncated),
  };
}
