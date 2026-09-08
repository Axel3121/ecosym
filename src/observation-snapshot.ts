import type { SourceReportProvenance, SourceReportSnapshot } from "./source-report.ts";

export type EpistemicStatus = "claim" | "observation";

export interface FactInput {
  epistemicStatus: EpistemicStatus;
  factOwner: string;
  kind: string;
  payload: Record<string, null | boolean | number | string>;
  sourceRecordedAt: null | string;
  sourceRecordId: string;
  subject: string;
}

export interface StoredFact extends FactInput {
  sourceReport?: SourceReportProvenance;
  id: number;
  collectedAt: string;
  connectionId: string;
  connectionVersion: string;
  collectionAsOf: null | {
    attemptId: string;
    activationId: string;
    startedAt: string;
    completedAt: string;
  };
  temporalStatus: "current" | "historical" | "unknown";
}

export interface NarrationAttempt {
  attemptId: string;
  connectionId: string;
  connectionVersion: string;
  startedAt: string;
}

export interface NarrationSnapshot {
  sourceReports?: SourceReportSnapshot[];
  connections: ConnectionStatus[];
  attemptsInProgress: NarrationAttempt[];
  observations: StoredFact[];
  observationsTruncated: boolean;
  claims: StoredFact[];
  claimsTruncated: boolean;
}

export interface ConnectionStatus {
  connectionId: string;
  connectionVersion: string;
  lastAttemptAt: null | string;
  reason:
    | "collected"
    | "failed"
    | "incomplete"
    | "never-run"
    | "nothing-new"
    | "record-index-unknown"
    | "retired"
    | "skipped";
  status: "changed" | "quiet" | "unread";
}
