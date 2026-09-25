import { Buffer } from "node:buffer";

import type { ConnectionConfig } from "./config.ts";
import { canonicalJson, type JsonScalar } from "./json.ts";
import type { FactInput } from "./observation-snapshot.ts";
import { FactNotDeclaredError, FactRejectedError } from "./store-errors.ts";
import type { VerificationFact } from "./store-types.ts";
import { utcInstantOrderingKey } from "./time.ts";
import { verificationFactFromInput } from "./verification-facts.ts";

export interface PreparedFact extends FactInput {
  payloadHash: string;
  payloadJson: string;
  sourceTimeKey: string;
}

export function correctionSlotKey(connectionId: string, fact: PreparedFact): string {
  return canonicalJson([
    connectionId,
    fact.factOwner,
    fact.kind,
    fact.subject,
    fact.epistemicStatus,
    fact.sourceRecordId,
    fact.sourceTimeKey,
  ]);
}

export function verificationFactsFromInputs(
  facts: readonly FactInput[],
  config: ConnectionConfig,
): VerificationFact[] {
  return facts.map((fact) => {
    const snapshot = snapshotFact(fact);
    validateFactAndDeriveSourceTimeKey(snapshot, config);
    return verificationFactFromInput(snapshot);
  });
}

export function snapshotFact(fact: FactInput): FactInput {
  if (fact === null || typeof fact !== "object" || Array.isArray(fact)) {
    throw new TypeError("Fact is not an object");
  }
  const inputPayload: unknown = fact.payload;
  if (
    inputPayload === null ||
    typeof inputPayload !== "object" ||
    Array.isArray(inputPayload)
  ) {
    throw new TypeError("Fact payload is not a JSON object");
  }
  const payloadPrototype = Object.getPrototypeOf(inputPayload);
  if (payloadPrototype !== Object.prototype && payloadPrototype !== null) {
    throw new TypeError("Fact payload is not a JSON object");
  }
  const payload = Object.create(null) as Record<string, JsonScalar>;
  for (const key of Reflect.ownKeys(inputPayload)) {
    if (typeof key !== "string") {
      throw new TypeError("Fact payload keys must be strings");
    }
    payload[key] = (inputPayload as Record<string, unknown>)[key] as JsonScalar;
  }
  return {
    epistemicStatus: fact.epistemicStatus,
    factOwner: fact.factOwner,
    kind: fact.kind,
    payload,
    sourceRecordedAt: fact.sourceRecordedAt,
    sourceRecordId: fact.sourceRecordId,
    subject: fact.subject,
  };
}

export function validateFactAndDeriveSourceTimeKey(
  fact: FactInput,
  config: ConnectionConfig,
): string {
  for (const [field, value] of [
    ["epistemicStatus", fact.epistemicStatus],
    ["factOwner", fact.factOwner],
    ["kind", fact.kind],
    ["subject", fact.subject],
    ["sourceRecordId", fact.sourceRecordId],
  ] as const) {
    if (
      typeof value !== "string" ||
      Buffer.from(value, "utf8").toString("utf8") !== value
    ) {
      throw new FactRejectedError(field, "is not a lossless SQLite string");
    }
  }
  if (fact.epistemicStatus !== "claim" && fact.epistemicStatus !== "observation") {
    const _exhaustive: never = fact.epistemicStatus;
    void _exhaustive;
    throw new FactRejectedError("epistemicStatus", "is not a valid value");
  }
  const payloadKeys = new Set(Object.keys(fact.payload));
  const isDeclared =
    fact.factOwner === config.factOwner &&
    config.facts.some(
      (declared) =>
        declared.epistemicStatus === fact.epistemicStatus &&
        declared.kind === fact.kind &&
        Object.keys(declared.payload).length === payloadKeys.size &&
        Object.keys(declared.payload).every((key) => payloadKeys.has(key)),
    );
  if (!isDeclared) {
    throw new FactNotDeclaredError();
  }
  for (const [key, value] of Object.entries(fact.payload)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))
    ) {
      throw new FactRejectedError(key, "cannot be persisted exactly");
    }
  }
  if (fact.sourceRecordedAt === null) {
    return "";
  }
  const sourceTimeKey = utcInstantOrderingKey(fact.sourceRecordedAt);
  if (sourceTimeKey === null) {
    throw new FactRejectedError("sourceRecordedAt", "is not a representable UTC instant");
  }
  return sourceTimeKey;
}

export function validateRetirementActor(value: string): void {
  validateActor(value, "retirement");
}

export function validateActor(
  value: string,
  operation: "forget" | "forget-civilization" | "retirement",
): void {
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(value)) {
    // The actor is caller input, so a malformed one is an invalid argument
    // rather than an internal fault.
    throw Object.assign(
      new TypeError(`A ${operation} actor must be a stable machine identifier`),
      { code: "invalid_arguments" },
    );
  }
}

export function safeFailureCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
  ) {
    return error.code;
  }
  return "internal_error";
}
