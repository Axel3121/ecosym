/** Source-reported metadata, never Ecosym verification or collection health. */
export type SourceEpistemicType = "observation" | "claim" | "derived";

export interface SourceReportProvenance {
  reportId: string;
  epistemicType: SourceEpistemicType;
}

/**
 * Closed public projection. IDs <= 128 chars, connectionVersion = 64 hex chars,
 * owner <= 512, selectedScope <= 2048, UTC source times <= 64 (fraction <= 43),
 * local admission times canonical milliseconds, factCount 0..1000, dimensions
 * 1..32. No notes, descriptions, endpoints, payloads, or reference arrays.
 */
export interface SourceReportSnapshot {
  reportId: string;
  bundleId: string;
  connectionId: string;
  connectionVersion: string;
  admittedFrom: string;
  admittedAt: string;
  sourceId: string;
  owner: string;
  selectedScope: string;
  producedAt: string;
  factCount: number;
  observation: {
    state: "observed";
    attemptedAt: string;
    completedAt: string;
    activity: "present" | "none";
    scopeComplete: true;
  } | {
    state: "cannot_observe";
    attemptedAt: string;
    failedAt: string;
    activity: "unknown";
    failure: "timeout" | "dns_error" | "http_error" | "malformed_source" | "incomplete_source" | "authorization_error" | "rate_limited" | "other";
    retryable: boolean;
    lastSuccessfulBundleId: string | null;
  };
  verification: {
    status: "verified" | "partially_verified" | "unverified" | "contradicted";
    scope: "availability_only" | "provenance_and_representation" | "content";
    checkedAt: string;
  };
  freshness: {
    status: "current" | "stale" | "unknown";
    basis: "source_validity" | "source_timestamp" | "retrieval_time" | "unavailable";
    evaluatedAt: string;
    sourceAsOf: string | null;
    validUntil: string | null;
  };
  uncertainty: {
    classification: "none" | "bounded" | "unknown";
    dimensions: {
      kind: "source_declared" | "extraction" | "coverage" | "temporal" | "other";
      level: "none" | "low" | "medium" | "high" | "unknown";
    }[];
  };
}
