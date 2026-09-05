import type { DatabaseSync } from "node:sqlite";

import type { ConnectionConfig } from "./config.ts";
import { sourceRecordIdentityHash } from "./materialize.ts";

export type RecordIndexEvidenceUnavailableReason =
  | "candidate_range_too_large"
  | "identity_not_reconstructible"
  | "no_recorded_attempts";

export type RecordIndexModeEvidence =
  | { available: false; reason: RecordIndexEvidenceUnavailableReason }
  | {
      available: true;
      maxSourceRecordsSeen: number;
      recordOrdinalRefuted: boolean;
      storedIdentities: number;
      storedIdentitiesOutsideRecordOrdinalRange: number;
    };

// Bound hashing work while the caller holds the observation-store transaction.
export const RECORD_INDEX_EVIDENCE_CANDIDATE_LIMIT = 100_000;

export function recordIndexModeEvidence(
  database: DatabaseSync,
  config: ConnectionConfig,
  connectionId: string,
  connectionVersion: string,
): RecordIndexModeEvidence {
  const identity = config.sourceRecord.identity;
  if (
    config.reader.type !== "jsonl" ||
    identity.some((selector) => !("scope" in selector) || selector.scope !== "meta") ||
    !identity.some(
      (selector) =>
        "scope" in selector &&
        selector.scope === "meta" &&
        selector.value === "record-index",
    )
  ) {
    return { available: false, reason: "identity_not_reconstructible" };
  }

  const attemptBound = database
    .prepare(
      `SELECT MAX(source_records_seen) AS maximum
         FROM collection_attempts
        WHERE connection_id = ? AND config_hash = ?`,
    )
    .get(connectionId, connectionVersion) as { maximum: null | number };
  if (attemptBound.maximum === null) {
    return { available: false, reason: "no_recorded_attempts" };
  }
  if (attemptBound.maximum > RECORD_INDEX_EVIDENCE_CANDIDATE_LIMIT) {
    return { available: false, reason: "candidate_range_too_large" };
  }

  const candidateIdentities = new Set<string>();
  for (let recordIndex = 0; recordIndex < attemptBound.maximum; recordIndex += 1) {
    candidateIdentities.add(
      sourceRecordIdentityHash(config, {
        meta: { recordIndex, sourcePath: config.reader.path },
        numericLexemes: null,
        record: {},
        root: {},
      }),
    );
  }
  const storedIdentities = database
    .prepare(
      `SELECT DISTINCT source_record_id
         FROM facts
        WHERE connection_id = ? AND config_hash = ?`,
    )
    .all(connectionId, connectionVersion) as { source_record_id: string }[];
  const storedIdentitiesOutsideRecordOrdinalRange = storedIdentities.reduce(
    (count, row) => count + (candidateIdentities.has(row.source_record_id) ? 0 : 1),
    0,
  );
  return {
    available: true,
    maxSourceRecordsSeen: attemptBound.maximum,
    recordOrdinalRefuted: storedIdentitiesOutsideRecordOrdinalRange > 0,
    storedIdentities: storedIdentities.length,
    storedIdentitiesOutsideRecordOrdinalRange,
  };
}
