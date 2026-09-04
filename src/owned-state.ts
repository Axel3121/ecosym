import { canonicalJson, type JsonValue, sha256 } from "./json.ts";

export const OWNED_STATE_BUNDLE_SCHEMA_VERSION = 1;

export interface OwnedStateCounts {
  activeConnections: number;
  civilizations: number;
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
    mandateRevisions: Record<string, JsonValue>[];
  };
  observationStore: {
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
      activeConnections: observationStore.activeConnections.length,
      civilizations: institutionStore.civilizations.length,
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
