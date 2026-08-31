import type { ConnectionConfig, Selector, SourceTime } from "./config.ts";
import { canonicalJson, isJsonScalar, type JsonScalar } from "./json.ts";
import type { SourceRecord } from "./readers.ts";
import type { FactInput } from "./store.ts";
import { sha256 } from "./json.ts";
import { isRepresentableUtcInstant, parseCalendarInstant } from "./time.ts";

const MISSING = Symbol("missing source field");

export class SourceMappingError extends Error {
  readonly code = "source_malformed";

  constructor() {
    super("source record does not satisfy its connection mapping");
    this.name = "SourceMappingError";
  }
}

export function materializeFacts(
  config: ConnectionConfig,
  source: SourceRecord,
): FactInput[] {
  const identity = config.sourceRecord.identity.map((selector) => {
    const value = requiredScalar(selector, source);
    if (value === null) {
      throw new SourceMappingError();
    }
    return value;
  });
  const sourceRecordId = `sha256:${sha256(canonicalJson(identity))}`;
  const sourceRecordedAt = materializeTime(config.sourceRecord.recordedAt, source);
  const facts: FactInput[] = [];

  for (const fact of config.facts) {
    if (
      fact.required.some((selector) => {
        const value = select(selector, source);
        return value === MISSING || value === null;
      })
    ) {
      continue;
    }
    const subject = requiredScalar(fact.subject, source);
    if (typeof subject !== "string" || subject.length === 0) {
      throw new SourceMappingError();
    }
    const payload: Record<string, JsonScalar> = {};
    for (const [name, selector] of Object.entries(fact.payload)) {
      payload[name] = requiredScalar(selector, source);
    }
    facts.push({
      epistemicStatus: fact.epistemicStatus,
      factOwner: config.factOwner,
      kind: fact.kind,
      payload,
      sourceRecordedAt,
      sourceRecordId,
      subject,
    });
  }
  return facts;
}

function materializeTime(sourceTime: SourceTime, source: SourceRecord): null | string {
  if ("unavailable" in sourceTime) {
    return null;
  }
  const value = select(sourceTime.selector, source);
  if (value === MISSING) {
    throw new SourceMappingError();
  }
  if (value === null) {
    return null;
  }

  let milliseconds: number;
  switch (sourceTime.format) {
    case "iso8601":
      if (!isRepresentableUtcInstant(value)) {
        throw new SourceMappingError();
      }
      return value;
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new SourceMappingError();
      }
      milliseconds = parseCalendarInstant(`${value}T00:00:00.000Z`) ?? Number.NaN;
      break;
    case "unix-seconds":
      if (typeof value !== "number") {
        throw new SourceMappingError();
      }
      milliseconds = value * 1_000;
      break;
    case "unix-milliseconds":
      if (typeof value !== "number") {
        throw new SourceMappingError();
      }
      milliseconds = value;
  }
  if (!Number.isFinite(milliseconds)) {
    throw new SourceMappingError();
  }
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) {
    throw new SourceMappingError();
  }
  const timestamp = date.toISOString();
  if (!isRepresentableUtcInstant(timestamp)) {
    throw new SourceMappingError();
  }
  return timestamp;
}

function requiredScalar(selector: Selector, source: SourceRecord): JsonScalar {
  const value = select(selector, source);
  if (value === MISSING || !isJsonScalar(value)) {
    throw new SourceMappingError();
  }
  return value;
}

function select(selector: Selector, source: SourceRecord): unknown | typeof MISSING {
  if ("coalesce" in selector) {
    let foundNull = false;
    for (const choice of selector.coalesce) {
      const value = select(choice, source);
      if (value === null) {
        foundNull = true;
      } else if (value !== MISSING) {
        return value;
      }
    }
    return foundNull ? null : MISSING;
  }
  if ("default" in selector) {
    const value = select(selector.selector, source);
    return value === MISSING || value === null ? selector.default : value;
  }
  if (selector.scope === "meta") {
    return selector.value === "record-index"
      ? source.meta.recordIndex
      : source.meta.sourcePath;
  }

  let value: unknown = selector.scope === "record" ? source.record : source.root;
  for (const segment of selector.path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      return MISSING;
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}
