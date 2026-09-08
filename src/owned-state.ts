import { canonicalJson, type JsonValue, sha256 } from "./json.ts";

export const OWNED_STATE_BUNDLE_SCHEMA_VERSION = 1;

export interface OwnedStateCounts {
  sourceReports?: number;
  sourceReportFacts?: number;
  sourceReportAdmissions?: number;
  activeConnections: number;
  civilizations: number;
  civilizationForgetRecords: number;
  collectionAttemptRetirements: number;
  collectionAttempts: number;
  connectionVersions: number;
  facts: number;
  forgetRecords: number;
  mandateRevisions: number;
  recordIndexModeResolutions: number;
}

export interface OwnedStateBundle {
  schemaVersion: 1;
  exportedAt: string;
  institutionStore: {
    schemaVersion: number;
    civilizations: Record<string, JsonValue>[];
    civilizationForgetRecords: Record<string, JsonValue>[];
    mandateRevisions: Record<string, JsonValue>[];
  };
  observationStore: {
    sourceReports?: Record<string, JsonValue>[];
    sourceReportFacts?: Record<string, JsonValue>[];
    sourceReportAdmissions?: Record<string, JsonValue>[];
    schemaVersion: number;
    activeConnections: Record<string, JsonValue>[];
    collectionAttemptRetirements: Record<string, JsonValue>[];
    collectionAttempts: Record<string, JsonValue>[];
    connectionVersions: Record<string, JsonValue>[];
    facts: Record<string, JsonValue>[];
    forgetRecords: Record<string, JsonValue>[];
    recordIndexModeResolutions: Record<string, JsonValue>[];
  };
  omitted: {
    section: string;
    reason: string;
  }[];
}

export interface OwnedStateExport {
  bundle: OwnedStateBundle;
  bytes: string;
  counts: OwnedStateCounts;
  digest: string;
}

export function createOwnedStateExport(bundle: OwnedStateBundle): OwnedStateExport {
  const bytes = canonicalJson(bundle as unknown as JsonValue);
  const { institutionStore, observationStore } = bundle;
  return {
    bundle,
    bytes,
    counts: {
      ...(observationStore.sourceReports === undefined ? {} : {
        sourceReports: observationStore.sourceReports.length,
        sourceReportFacts: observationStore.sourceReportFacts!.length,
        sourceReportAdmissions: observationStore.sourceReportAdmissions!.length,
      }),
      activeConnections: observationStore.activeConnections.length,
      civilizations: institutionStore.civilizations.length,
      civilizationForgetRecords: institutionStore.civilizationForgetRecords.length,
      collectionAttemptRetirements:
        observationStore.collectionAttemptRetirements.length,
      collectionAttempts: observationStore.collectionAttempts.length,
      connectionVersions: observationStore.connectionVersions.length,
      facts: observationStore.facts.length,
      forgetRecords: observationStore.forgetRecords.length,
      mandateRevisions: institutionStore.mandateRevisions.length,
      recordIndexModeResolutions:
        observationStore.recordIndexModeResolutions.length,
    },
    digest: `sha256:${sha256(bytes)}`,
  };
}
