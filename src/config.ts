import { canonicalJson, type JsonScalar, type JsonValue, sha256 } from "./json.ts";
import type { EpistemicStatus } from "./store.ts";

const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const PATH_SEGMENT_PATTERN = /^[a-zA-Z0-9_-]+$/;

export type Selector =
  | { scope: "record"; path: string }
  | { scope: "root"; path: string }
  | { scope: "meta"; value: "record-index" | "source-path" }
  | { coalesce: Selector[] }
  | { default: JsonScalar; selector: Selector };

export type SourceTime =
  | { unavailable: true }
  | {
      selector: Selector;
      format: "iso8601" | "date" | "unix-seconds" | "unix-milliseconds";
    };

export interface FactConfig {
  epistemicStatus: EpistemicStatus;
  kind: string;
  payload: Record<string, Selector>;
  required: Selector[];
  subject: Selector;
}

export type ReaderConfig =
  | { type: "sqlite"; path: string; table: string }
  | { type: "jsonl"; path: string }
  | { type: "json"; pathPattern: string; recordsPath: string }
  | { type: "csv"; delimiter: string; path: string };

export interface ConnectionConfig {
  schemaVersion: 1;
  id: string;
  factOwner: string;
  reader: ReaderConfig;
  sourceRecord: {
    identity: Selector[];
    retention: "history" | "latest";
    recordedAt: SourceTime;
  };
  facts: FactConfig[];
}

export interface ParsedConnectionConfig {
  config: ConnectionConfig;
  canonical: string;
  hash: string;
}

export class ConfigError extends Error {
  readonly code = "invalid_config";

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function parseConnectionConfig(input: unknown): ParsedConnectionConfig {
  const root = objectAt(input, "connection");
  exactKeys(
    root,
    ["schemaVersion", "id", "factOwner", "reader", "sourceRecord", "facts"],
    "connection",
  );
  if (root.schemaVersion !== 1) {
    throw new ConfigError("connection.schemaVersion must be 1");
  }

  const factsInput = arrayAt(root.facts, "connection.facts");
  if (factsInput.length === 0) {
    throw new ConfigError("connection.facts must not be empty");
  }

  const config: ConnectionConfig = {
    schemaVersion: 1,
    id: nameAt(root.id, "connection.id"),
    factOwner: nameAt(root.factOwner, "connection.factOwner"),
    reader: parseReader(root.reader),
    sourceRecord: parseSourceRecord(root.sourceRecord),
    facts: factsInput.map((fact, index) => parseFact(fact, index)),
  };
  if (
    config.reader.type === "sqlite" &&
    selectorsIn(config).some(
      (selector) =>
        "scope" in selector &&
        (selector.scope === "record" || selector.scope === "root") &&
        selector.path.includes("."),
    )
  ) {
    throw new ConfigError("SQLite selectors must name top-level columns");
  }
  const canonical = canonicalJson(config as unknown as JsonValue);
  return { config, canonical, hash: sha256(canonical) };
}

export function selectorsIn(config: ConnectionConfig): Selector[] {
  const selectors = [...config.sourceRecord.identity];
  if (!("unavailable" in config.sourceRecord.recordedAt)) {
    selectors.push(config.sourceRecord.recordedAt.selector);
  }
  for (const fact of config.facts) {
    selectors.push(fact.subject, ...fact.required, ...Object.values(fact.payload));
  }
  return selectors.flatMap(flattenSelector);
}

function parseReader(value: unknown): ReaderConfig {
  const reader = objectAt(value, "connection.reader");
  const type = stringAt(reader.type, "connection.reader.type");

  switch (type) {
    case "sqlite":
      exactKeys(reader, ["type", "path", "table"], "connection.reader");
      return {
        type,
        path: nonemptyStringAt(reader.path, "connection.reader.path"),
        table: identifierAt(reader.table, "connection.reader.table"),
      };
    case "jsonl":
      exactKeys(reader, ["type", "path"], "connection.reader");
      return {
        type,
        path: nonemptyStringAt(reader.path, "connection.reader.path"),
      };
    case "json":
      exactKeys(reader, ["type", "pathPattern", "recordsPath"], "connection.reader");
      return {
        type,
        pathPattern: nonemptyStringAt(reader.pathPattern, "connection.reader.pathPattern"),
        recordsPath: pathAt(reader.recordsPath, "connection.reader.recordsPath", true),
      };
    case "csv": {
      exactKeys(reader, ["type", "path", "delimiter"], "connection.reader");
      const delimiter = stringAt(reader.delimiter, "connection.reader.delimiter");
      if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\r" || delimiter === "\n") {
        throw new ConfigError(
          "connection.reader.delimiter must be one character other than quote or newline",
        );
      }
      return {
        type,
        delimiter,
        path: nonemptyStringAt(reader.path, "connection.reader.path"),
      };
    }
    default:
      throw new ConfigError(`connection.reader.type is unsupported: ${type}`);
  }
}

function parseSourceRecord(value: unknown): ConnectionConfig["sourceRecord"] {
  const sourceRecord = objectAt(value, "connection.sourceRecord");
  exactKeys(sourceRecord, ["identity", "retention", "recordedAt"], "connection.sourceRecord");
  const identity = arrayAt(sourceRecord.identity, "connection.sourceRecord.identity").map(
    (selector, index) => parseSelector(selector, `connection.sourceRecord.identity[${index}]`),
  );
  if (identity.length === 0) {
    throw new ConfigError("connection.sourceRecord.identity must not be empty");
  }

  const retention = stringAt(sourceRecord.retention, "connection.sourceRecord.retention");
  if (retention !== "history" && retention !== "latest") {
    throw new ConfigError('connection.sourceRecord.retention must be "history" or "latest"');
  }

  return {
    identity,
    retention,
    recordedAt: parseSourceTime(sourceRecord.recordedAt),
  };
}

function parseSourceTime(value: unknown): SourceTime {
  const sourceTime = objectAt(value, "connection.sourceRecord.recordedAt");
  if (sourceTime.unavailable === true) {
    exactKeys(sourceTime, ["unavailable"], "connection.sourceRecord.recordedAt");
    return { unavailable: true };
  }

  exactKeys(sourceTime, ["selector", "format"], "connection.sourceRecord.recordedAt");
  const format = stringAt(sourceTime.format, "connection.sourceRecord.recordedAt.format");
  if (
    format !== "iso8601" &&
    format !== "date" &&
    format !== "unix-seconds" &&
    format !== "unix-milliseconds"
  ) {
    throw new ConfigError("connection.sourceRecord.recordedAt.format is unsupported");
  }
  return {
    selector: parseSelector(
      sourceTime.selector,
      "connection.sourceRecord.recordedAt.selector",
    ),
    format,
  };
}

function parseFact(value: unknown, index: number): FactConfig {
  const path = `connection.facts[${index}]`;
  const fact = objectAt(value, path);
  exactKeys(fact, ["epistemicStatus", "kind", "subject", "payload", "required"], path, [
    "required",
  ]);
  const epistemicStatus = stringAt(fact.epistemicStatus, `${path}.epistemicStatus`);
  if (epistemicStatus !== "claim" && epistemicStatus !== "observation") {
    throw new ConfigError(`${path}.epistemicStatus must be "claim" or "observation"`);
  }

  const payloadInput = objectAt(fact.payload, `${path}.payload`);
  const payloadEntries = Object.entries(payloadInput);
  if (payloadEntries.length === 0) {
    throw new ConfigError(`${path}.payload must not be empty`);
  }
  const payload: Record<string, Selector> = {};
  for (const [key, selector] of payloadEntries) {
    nameAt(key, `${path}.payload key`);
    payload[key] = parseSelector(selector, `${path}.payload.${key}`);
  }

  return {
    epistemicStatus,
    kind: nameAt(fact.kind, `${path}.kind`),
    subject: parseSelector(fact.subject, `${path}.subject`),
    payload,
    required: (fact.required === undefined
      ? []
      : arrayAt(fact.required, `${path}.required`)
    ).map((selector, requiredIndex) =>
      parseSelector(selector, `${path}.required[${requiredIndex}]`),
    ),
  };
}

function parseSelector(value: unknown, path: string): Selector {
  const selector = objectAt(value, path);
  if ("scope" in selector) {
    const scope = stringAt(selector.scope, `${path}.scope`);
    if (scope === "meta") {
      exactKeys(selector, ["scope", "value"], path);
      const metaValue = stringAt(selector.value, `${path}.value`);
      if (metaValue !== "record-index" && metaValue !== "source-path") {
        throw new ConfigError(`${path}.value is unsupported`);
      }
      return { scope, value: metaValue };
    }
    if (scope === "record" || scope === "root") {
      exactKeys(selector, ["scope", "path"], path);
      return { scope, path: pathAt(selector.path, `${path}.path`) };
    }
    throw new ConfigError(`${path}.scope must be "record", "root", or "meta"`);
  }
  if ("coalesce" in selector) {
    exactKeys(selector, ["coalesce"], path);
    const choices = arrayAt(selector.coalesce, `${path}.coalesce`).map((choice, index) =>
      parseSelector(choice, `${path}.coalesce[${index}]`),
    );
    if (choices.length === 0) {
      throw new ConfigError(`${path}.coalesce must not be empty`);
    }
    return { coalesce: choices };
  }
  if ("default" in selector) {
    exactKeys(selector, ["default", "selector"], path);
    return {
      default: scalarAt(selector.default, `${path}.default`),
      selector: parseSelector(selector.selector, `${path}.selector`),
    };
  }
  throw new ConfigError(`${path} is not a recognized selector`);
}

function flattenSelector(selector: Selector): Selector[] {
  if ("coalesce" in selector) {
    return selector.coalesce.flatMap(flattenSelector);
  }
  if ("default" in selector) {
    return flattenSelector(selector.selector);
  }
  return [selector];
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${path} must be an array`);
  }
  return value;
}

function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new ConfigError(`${path} must be a string`);
  }
  return value;
}

function nonemptyStringAt(value: unknown, path: string): string {
  const result = stringAt(value, path);
  if (result.length === 0) {
    throw new ConfigError(`${path} must not be empty`);
  }
  return result;
}

function scalarAt(value: unknown, path: string): JsonScalar {
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "boolean" &&
    !(
      typeof value === "number" &&
      Number.isFinite(value) &&
      !Object.is(value, -0)
    )
  ) {
    throw new ConfigError(`${path} must be a finite JSON scalar`);
  }
  return value as JsonScalar;
}

function nameAt(value: unknown, path: string): string {
  const name = stringAt(value, path);
  if (!NAME_PATTERN.test(name)) {
    throw new ConfigError(`${path} must match ${NAME_PATTERN}`);
  }
  return name;
}

function identifierAt(value: unknown, path: string): string {
  const identifier = stringAt(value, path);
  if (!PATH_SEGMENT_PATTERN.test(identifier)) {
    throw new ConfigError(`${path} must be a simple identifier`);
  }
  return identifier;
}

function pathAt(value: unknown, path: string, allowEmpty = false): string {
  const fieldPath = stringAt(value, path);
  if (allowEmpty && fieldPath === "") {
    return fieldPath;
  }
  if (
    fieldPath.length === 0 ||
    fieldPath.split(".").some((segment) => !PATH_SEGMENT_PATTERN.test(segment))
  ) {
    throw new ConfigError(`${path} must be a dot-separated field path`);
  }
  return fieldPath;
}

function exactKeys(
  object: Record<string, unknown>,
  allowed: string[],
  path: string,
  optional: string[] = [],
): void {
  const allowedSet = new Set(allowed);
  const optionalSet = new Set(optional);
  for (const key of Object.keys(object)) {
    if (!allowedSet.has(key)) {
      throw new ConfigError(`${path}.${key} is not allowed`);
    }
  }
  for (const key of allowed) {
    if (!optionalSet.has(key) && !(key in object)) {
      throw new ConfigError(`${path}.${key} is required`);
    }
  }
}
