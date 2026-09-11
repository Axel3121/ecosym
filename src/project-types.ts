export const PROJECT_ERROR_CODES = [
  "invalid_name", "slug_underivable", "slug_taken", "path_taken",
  "civilization_unknown", "civilization_dissolved", "root_invalid",
  "directory_exists", "containment_violation", "not_a_directory",
  "filesystem_denied", "harness_unavailable", "harness_refused", "harness_timeout",
  "readback_ambiguous", "readback_too_large", "request_key_conflict",
  "retry_in_progress", "busy", "invalid_request", "forbidden_origin",
] as const;

export type ProjectErrorCode = typeof PROJECT_ERROR_CODES[number];
export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  constructor(code: ProjectErrorCode) {
    super(code);
    this.name = "ProjectError";
    this.code = code;
  }
}

export type ProjectState = "requested" | "directory-created" | "external-unknown" | "established" | "failed";

export interface HarnessProjectRequest {
  name: string;
  slug: string;
  workspacePath: string;
}

export interface HarnessBinding {
  externalId: string;
  externalSlug: string;
  externalArchived: boolean;
  harnessVersion: string;
  harnessHome: string;
  provenance: "created" | "adopted";
}

export type HarnessOutcome =
  | { kind: "bound"; binding: HarnessBinding }
  | { kind: "unknown"; reason: ProjectErrorCode }
  | { kind: "refused"; reason: ProjectErrorCode };

export interface HarnessAdapter {
  readonly id: "hermes";
  provision(request: HarnessProjectRequest): Promise<HarnessOutcome>;
  reconcile(request: HarnessProjectRequest): Promise<HarnessOutcome>;
}

export interface ProjectRequest extends HarnessProjectRequest {
  civilizationId: string;
  requestKey: string;
  requestDigest: string;
  harness: "hermes";
}

export interface WorldProjectSnapshot extends HarnessProjectRequest {
  projectId: string;
  civilizationId: string;
  state: ProjectState;
  attempt: number;
  reason: ProjectErrorCode | null;
  harness: {
    id: "hermes";
    externalId: string;
    externalSlug: string;
    externalArchived: boolean;
    provenance: "created" | "adopted";
    observedAt: string;
  } | null;
}

export interface ProjectWriteService {
  create(civilizationId: string, body: unknown): Promise<{ project: WorldProjectSnapshot; created: boolean }>;
  retry(projectId: string, body: unknown): Promise<WorldProjectSnapshot>;
}
