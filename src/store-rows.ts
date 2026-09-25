import {
  parseConnectionConfig,
  selectorsIn,
  type ConnectionConfig,
} from "./config.ts";
import type { JsonScalar } from "./json.ts";
import { parseMandateConfig, type MandateConfig } from "./institution.ts";
import type { EpistemicStatus, StoredFact } from "./observation-snapshot.ts";
import type { JsonlRecordIndexMode } from "./readers.ts";
import { MandateUnreadableError } from "./store-errors.ts";
import type {
  CivilizationForgetInventory,
  CollectionAttempt,
  ForgetInventory,
} from "./store-types.ts";

export interface MandateRevisionRow {
  mandate_id: string;
  revision: string;
  status: "active" | "dissolved";
  mandate_json: string;
  mandate_digest: string;
  recorded_at: string;
}

export type FoundedMandateRow = {
  civilization_id: string;
  name: string;
  founded_at: string;
} & { [Key in keyof MandateRevisionRow]: MandateRevisionRow[Key] | null };

export interface CollectionAttemptRow {
  activation_id: string;
  attempt_id: string;
  completed_at: null | string;
  config_hash: string;
  connection_id: string;
  facts_added: number;
  facts_changed: number;
  facts_seen: number;
  failure_code: null | string;
  outcome: "failed" | "retired" | "running" | "skipped" | "success";
  source_records_seen: number;
  started_at: string;
}

export interface CollectionAttemptRetirementRow {
  attempt_id: string;
  config_hash: string;
  connection_id: string;
  retired_at: string;
  retired_by: string;
  retirement_id: string;
}

export interface ConfirmationPreviewRow {
  consumed_at: null | string;
  state_fingerprint: string;
}

export interface StoredFactRow {
  as_of_attempt_id: null | string;
  as_of_activation_id: null | string;
  as_of_started_at: null | string;
  as_of_completed_at: null | string;
  collected_at: string;
  config_hash: string;
  connection_id: string;
  epistemic_status: EpistemicStatus;
  fact_id: number;
  fact_owner: string;
  kind: string;
  payload_json: string;
  source_record_id: string;
  source_recorded_at: null | string;
  subject: string;
  temporal_status: "current" | "historical" | "unknown";
}

export function collectionAttemptFromRow(row: CollectionAttemptRow): CollectionAttempt {
  return {
    activationId: row.activation_id,
    attemptId: row.attempt_id,
    completedAt: row.completed_at,
    connectionId: row.connection_id,
    connectionVersion: row.config_hash,
    factsAdded: row.facts_added,
    factsChanged: row.facts_changed,
    factsSeen: row.facts_seen,
    failureCode: row.failure_code,
    outcome: row.outcome,
    sourceRecordsSeen: row.source_records_seen,
    startedAt: row.started_at,
  };
}

export function storedFactFromRow(row: StoredFactRow): StoredFact {
  return {
    id: row.fact_id,
    collectedAt: row.collected_at,
    connectionId: row.connection_id,
    connectionVersion: row.config_hash,
    collectionAsOf: row.as_of_attempt_id === null ? null : {
      attemptId: row.as_of_attempt_id,
      activationId: row.as_of_activation_id!,
      startedAt: row.as_of_started_at!,
      completedAt: row.as_of_completed_at!,
    },
    epistemicStatus: row.epistemic_status,
    factOwner: row.fact_owner,
    kind: row.kind,
    payload: JSON.parse(row.payload_json) as Record<string, JsonScalar>,
    sourceRecordedAt: row.source_recorded_at,
    sourceRecordId: row.source_record_id,
    subject: row.subject,
    temporalStatus: row.temporal_status,
  };
}

export function parseStoredConfig(configJson: string, expectedHash: string): ConnectionConfig {
  const parsed = parseConnectionConfig(JSON.parse(configJson) as unknown);
  if (parsed.hash !== expectedHash) {
    throw new Error("Stored connection configuration does not match its identity");
  }
  return parsed.config;
}

export function parseStoredIntegerArray(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) => !Number.isSafeInteger(item) || (item as number) < 1,
    ) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error("Stored record-index fact inventory is invalid");
  }
  return parsed as number[];
}

export function parseStoredStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error("Stored record-index attempt inventory is invalid");
  }
  return parsed as string[];
}

export function parseJsonlRecordIndexMode(
  value: string,
): JsonlRecordIndexMode | "unknown" {
  if (
    value !== "physical-line" &&
    value !== "record-ordinal" &&
    value !== "unknown"
  ) {
    throw new Error("Stored JSONL record-index mode is invalid");
  }
  return value;
}

export function usesJsonlRecordIndex(config: ConnectionConfig): boolean {
  return (
    config.reader.type === "jsonl" &&
    selectorsIn(config).some(
      (selector) =>
        "scope" in selector &&
        selector.scope === "meta" &&
        selector.value === "record-index",
    )
  );
}

export function parseExportInventories(
  value: string,
): { connectionId: string; inventoryDigest: string }[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as Record<string, unknown>).connectionId !== "string" ||
        typeof (item as Record<string, unknown>).inventoryDigest !== "string",
    )
  ) {
    throw new Error("Stored export coverage is invalid");
  }
  return parsed as { connectionId: string; inventoryDigest: string }[];
}

export function parseCivilizationExportInventories(
  value: string,
): { civilizationId: string; inventoryDigest: string }[] {
  const parsed = JSON.parse(value) as unknown;
  if (
    !Array.isArray(parsed) ||
    parsed.some(
      (item) =>
        item === null ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof (item as Record<string, unknown>).civilizationId !== "string" ||
        typeof (item as Record<string, unknown>).inventoryDigest !== "string",
    )
  ) {
    throw new Error("Stored civilization export coverage is invalid");
  }
  return parsed as { civilizationId: string; inventoryDigest: string }[];
}

export function parseForgetInventory(value: string): ForgetInventory {
  const parsed = JSON.parse(value) as ForgetInventory;
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof parsed.connectionId !== "string" ||
    !Array.isArray(parsed.connectionVersions) ||
    !Array.isArray(parsed.factIds) ||
    !Array.isArray(parsed.collectionAttemptIds) ||
    !Array.isArray(parsed.collectionAttemptRetirementIds) ||
    !Array.isArray(parsed.recordIndexModeResolutionIds) ||
    parsed.counts === null ||
    typeof parsed.counts !== "object"
  ) {
    throw new Error("Stored forget inventory is invalid");
  }
  return parsed;
}

export function parseCivilizationForgetInventory(value: string): CivilizationForgetInventory {
  const parsed = JSON.parse(value) as CivilizationForgetInventory;
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    typeof parsed.civilizationId !== "string" ||
    !Array.isArray(parsed.mandateRevisions) ||
    parsed.counts === null ||
    typeof parsed.counts !== "object"
  ) {
    throw new Error("Stored civilization forget inventory is invalid");
  }
  return parsed;
}

/**
 * Read a stored mandate back as a mandate, or refuse.
 *
 * Re-parsing on the read path is what makes the digest honest: it is derived
 * from bytes that have been proven to still be a mandate, so content edited
 * underneath the store fails closed here rather than producing a confident
 * digest of something nobody validated.
 */
export function parseStoredMandate(mandateJson: string, civilizationId: string): MandateConfig {
  let decoded: unknown;
  try {
    decoded = JSON.parse(mandateJson) as unknown;
  } catch {
    throw new MandateUnreadableError(civilizationId);
  }
  try {
    const parsed = parseMandateConfig(decoded);
    if (parsed.canonical !== mandateJson) {
      throw new MandateUnreadableError(civilizationId);
    }
    return parsed.config;
  } catch {
    throw new MandateUnreadableError(civilizationId);
  }
}

export function addFilter(
  conditions: string[],
  parameters: (number | string)[],
  expression: string,
  value: number | string | undefined,
): void {
  if (value !== undefined) {
    conditions.push(expression);
    parameters.push(value);
  }
}
