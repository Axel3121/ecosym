import type { ConnectionConfig } from "./config.ts";
import type { MandateConfig } from "./institution.ts";
import type { EpistemicStatus, FactInput } from "./observation-snapshot.ts";
import type { RecordIndexModeEvidence } from "./record-index-evidence.ts";
import type { JsonlRecordIndexMode } from "./readers.ts";

export interface ActiveConnection {
  activationId: string;
  config: ConnectionConfig;
  configHash: string;
  connectedAt: string;
  jsonlRecordIndexMode: JsonlRecordIndexMode | "unknown";
}

export interface QueryOptions {
  activeOnly?: boolean;
  afterId?: number;
  connectionId?: string;
  factOwner?: string;
  kind?: string;
  limit?: number;
  order?: "asc" | "desc";
  subject?: string;
}

export interface CollectionResult {
  attemptId: string;
  completedAt: string;
  factsAdded: number;
  factsChanged: number;
  factsSeen: number;
  outcome: "success";
  sourceRecordsSeen: number;
  startedAt: string;
}

export interface CollectionAttempt {
  activationId: string;
  attemptId: string;
  completedAt: null | string;
  connectionId: string;
  connectionVersion: string;
  factsAdded: number;
  factsChanged: number;
  factsSeen: number;
  failureCode: null | string;
  outcome: "failed" | "retired" | "running" | "skipped" | "success";
  sourceRecordsSeen: number;
  startedAt: string;
}

export interface CollectionAttemptRetirement {
  attemptId: string;
  connectionId: string;
  connectionVersion: string;
  retiredAt: string;
  retiredBy: string;
  retirementId: string;
}

export interface CollectionAttemptRetirementPlan {
  attemptId: string;
  confirmationToken: string;
  connectionId: string;
  connectionVersion: string;
  retiredBy: string;
  startedAt: string;
}

export type CollectionAttemptRetirementSnapshot = Omit<
  CollectionAttemptRetirementPlan,
  "confirmationToken"
> & { stateFingerprint: string };

export interface VerificationFact {
  epistemicStatus: EpistemicStatus;
  factOwner: string;
  kind: string;
  payloadHash: string;
  sourceRecordedAt: null | string;
  sourceRecordId: string;
  subject: string;
}

export interface VerificationSnapshot {
  currentnessKnown: boolean;
  facts: VerificationFact[];
  jsonlRecordIndexMode: JsonlRecordIndexMode | "unknown";
  payloadHashesValid: boolean;
  sourceTimeKeysValid: boolean;
}

export interface RecordIndexModeResolution {
  affectedFactIds: number[];
  collectionAttemptIds: string[];
  collectionAttemptsRecorded: number;
  connectionId: string;
  connectionVersion: string;
  factsAffected: number;
  previousRecordIndexMode: JsonlRecordIndexMode | "unknown";
  recordIndexMode: JsonlRecordIndexMode;
  resolutionId: string;
  resolvedAt: string;
}

export interface RecordIndexModeResolutionPlan {
  affectedFactIds: number[];
  collectionAttemptIds: string[];
  collectionAttemptsRecorded: number;
  confirmationToken: string;
  connectionId: string;
  connectionVersion: string;
  currentRecordIndexMode: JsonlRecordIndexMode | "unknown";
  factsAffected: number;
  recordIndexMode: JsonlRecordIndexMode;
  storedIndexEvidence: RecordIndexModeEvidence;
}

export interface ForgetInventory {
  sourceReportIds?: string[];
  sourceReportFacts?: { reportId: string; factId: number; sourceFactId: string }[];
  sourceReportAdmissions?: { reportId: string; attemptId: string }[];
  collectionAttemptIds: string[];
  collectionAttemptRetirementIds: string[];
  connectionId: string;
  connectionVersions: string[];
  counts: {
    sourceReports?: number;
    sourceReportFacts?: number;
    sourceReportAdmissions?: number;
    collectionAttemptRetirements: number;
    collectionAttempts: number;
    connectionVersions: number;
    facts: number;
    recordIndexModeResolutions: number;
  };
  factIds: number[];
  recordIndexModeResolutionIds: string[];
}

export interface ForgetPlan extends ForgetInventory {
  confirmationToken: string;
  consequence: string;
  inventoryDigest: string;
  forgottenBy: string;
}

export interface ForgetRecord extends ForgetInventory {
  exportDigest: string;
  forgetId: string;
  forgottenAt: string;
  forgottenBy: string;
  inventoryDigest: string;
}

export interface CivilizationRevisionIdentity {
  civilizationId: string;
  mandateId: string;
  revision: string;
}

export interface CivilizationForgetInventory {
  civilizationId: string;
  counts: {
    civilizations: 1;
    mandateRevisions: number;
    projects?: number;
    projectProvisioningEvents?: number;
    projectHarnessBindings?: number;
  };
  mandateRevisions: CivilizationRevisionIdentity[];
  projects?: { projectId: string; workspacePath: string }[];
  projectProvisioningEventIds?: string[];
  projectHarnessBindingIds?: string[];
}

export interface CivilizationForgetPlan extends CivilizationForgetInventory {
  confirmationToken: string;
  consequence: string;
  forgottenBy: string;
  inventoryDigest: string;
}

export interface CivilizationForgetRecord extends CivilizationForgetInventory {
  exportDigest: string;
  forgetId: string;
  forgottenAt: string;
  forgottenBy: string;
  inventoryDigest: string;
}

export type CivilizationForgetSnapshot = CivilizationForgetInventory & {
  inventoryDigest: string;
  stateFingerprint: string;
};

export type ForgetSnapshot = ForgetInventory & {
  inventoryDigest: string;
  stateFingerprint: string;
};

export type RecordIndexModeResolutionSnapshot = Omit<
  RecordIndexModeResolutionPlan,
  "confirmationToken"
> & { stateFingerprint: string };

export interface CollectionSink {
  recordSourceRecord(facts: () => readonly FactInput[]): void;
}

export interface ResolvedAuthorityContext {
  authorityContext: {
    civilizationId: string;
    authorityContext: {
      mandateId: string;
      mandateRevision: string;
      mandateDigest: string;
    };
  };
  mandate: MandateConfig;
}

export interface OpenWorkClaim {
  claimId: string;
  civilizationId: string;
  resourceId: string;
  claimedBy: string;
  claimedAt: string;
  expiresAt: string;
}

export interface ContentionBudget {
  remainingMilliseconds: number;
}
