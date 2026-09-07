import type { FoundedCivilizationSnapshot } from "./institution-snapshot.ts";
import type { ConnectionStatus, NarrationAttempt, StoredFact } from "./observation-snapshot.ts";
import { isRepresentableUtcInstant } from "./time.ts";
import { validateInstitutionSnapshot } from "./validate-institution-snapshot.ts";

export const WORLD_SNAPSHOT_SCHEMA_VERSION = 1;

export const WORLD_FACT_SEMANTICS_CAVEAT = "Observations describe the source owner's recorded fields at collection, not completed work, operational success or civilization activity. Runtime prose reports remain claims. Temporal status describes stored collection evidence, not live source truth. collectionAsOf is the latest successful collection interval in the fact's last-seen connection/configuration/activation lifetime; null means unknown. collectedAt is provenance, never a substitute for sourceRecordedAt. Verify does not reconcile this picture; recollect to advance it. Running attempts and truncated results can leave the picture partial.";

export interface WorldSourceSnapshot {
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
  /** Owner-wide limits, not per-civilization completeness assessments. */
  observationsTruncated: boolean;
  claimsTruncated: boolean;
}

function record(value: unknown, keys?: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("Invalid world snapshot object");
  }
  const ownKeys = Reflect.ownKeys(value);
  if ((keys && (ownKeys.length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))))
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
    "epistemicStatus", "factOwner", "kind", "payload", "sourceRecordedAt", "sourceRecordId", "subject", "temporalStatus"]);
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
    sourceRecordedAt: entry.sourceRecordedAt === null ? null : timestamp(entry.sourceRecordedAt),
    sourceRecordId: text(entry.sourceRecordId), subject: text(entry.subject), temporalStatus,
  };
}

/** Reject extra fields, accessors and inconsistent links; return recursively detached data. */
export function validateWorldSnapshot(value: unknown): WorldSnapshot {
  const snapshot = record(value, ["schemaVersion", "civilizations", "sourcePictures", "observationsTruncated", "claimsTruncated"]);
  if (snapshot.schemaVersion !== WORLD_SNAPSHOT_SCHEMA_VERSION) throw new Error("Invalid world snapshot version");
  const { civilizations } = validateInstitutionSnapshot({ schemaVersion: 1, civilizations: snapshot.civilizations });
  const civilizationsById = new Map(civilizations.map((entry) => [entry.civilizationId, entry]));
  if (civilizationsById.size !== civilizations.length) throw new Error("Duplicate civilization ID");
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
      const source = record(value, ["connectionId", "collection", "attemptsInProgress", "observations", "claims"]);
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
      };
      const linked = [...normalized.attemptsInProgress, ...normalized.observations, ...normalized.claims];
      if ((normalized.collection !== null && normalized.collection.connectionId !== connectionId)
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
    schemaVersion: WORLD_SNAPSHOT_SCHEMA_VERSION, civilizations, sourcePictures,
    observationsTruncated: boolean(snapshot.observationsTruncated), claimsTruncated: boolean(snapshot.claimsTruncated),
  };
}
