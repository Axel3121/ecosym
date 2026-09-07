import {
  INSTITUTION_SNAPSHOT_SCHEMA_VERSION,
  type FoundedCivilizationSnapshot,
  type InstitutionSnapshot,
} from "./institution-snapshot.ts";

function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    || Reflect.ownKeys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key)
      || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))) {
    throw new Error("Invalid institution snapshot shape");
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid institution snapshot string");
  return value;
}

function list<T>(value: unknown, parse: (entry: unknown) => T): T[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
    || Reflect.ownKeys(value).length !== value.length + 1) {
    throw new Error("Invalid institution snapshot array");
  }
  return Array.from({ length: value.length }, (_, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Invalid snapshot array entry");
    return parse(descriptor.value);
  });
}

/** Reject unknown fields and return detached, closed data safe to serialize or render. */
export function validateInstitutionSnapshot(value: unknown): InstitutionSnapshot {
  const snapshot = record(value, ["schemaVersion", "civilizations"]);
  if (snapshot.schemaVersion !== INSTITUTION_SNAPSHOT_SCHEMA_VERSION) throw new Error("Invalid snapshot version");
  const civilizations = list(snapshot.civilizations, (value): FoundedCivilizationSnapshot => {
    const entry = record(value, ["civilizationId", "name", "foundedAt", "bodyReadable", "domain",
      "sources", "mayActAlone", "mustEscalate", "mandate"]);
    // Inspect the discriminator only after checking that it is a data property.
    const status = typeof entry.mandate === "object" && entry.mandate !== null
      ? Object.getOwnPropertyDescriptor(entry.mandate, "status")?.value : undefined;
    const mandate = record(entry.mandate, status === "unreadable"
      ? ["status"] : ["status", "mandateId", "revision", "recordedAt"]);
    if (status !== "active" && status !== "dissolved" && status !== "unreadable") {
      throw new Error("Invalid mandate status");
    }
    if (typeof entry.bodyReadable !== "boolean") throw new Error("Invalid body readability");
    const normalized: FoundedCivilizationSnapshot = {
      civilizationId: text(entry.civilizationId), name: text(entry.name), foundedAt: text(entry.foundedAt),
      bodyReadable: entry.bodyReadable, domain: text(entry.domain), sources: list(entry.sources, text),
      mayActAlone: list(entry.mayActAlone, text), mustEscalate: list(entry.mustEscalate, text),
      mandate: status === "unreadable" ? { status } : {
        status, mandateId: text(mandate.mandateId), revision: text(mandate.revision), recordedAt: text(mandate.recordedAt),
      },
    };
    if ((!normalized.bodyReadable && (normalized.domain !== "" || normalized.sources.length !== 0
      || normalized.mayActAlone.length !== 0 || normalized.mustEscalate.length !== 0))
      || (status === "unreadable" && normalized.bodyReadable)) {
      throw new Error("Inconsistent unknown mandate body");
    }
    return normalized;
  });
  return { schemaVersion: INSTITUTION_SNAPSHOT_SCHEMA_VERSION, civilizations };
}
