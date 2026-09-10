import { Buffer } from "node:buffer";
import { ArenaAdmissionError, parseArenaBundle, sourceReportProjection, type ArenaBundle } from "./arena-adapter.ts";
import type { SourceReportSnapshot, SourceReportProvenance } from "./source-report.ts";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import {
  parseConnectionConfig,
  selectorsIn,
  type ConnectionConfig,
  type ParsedConnectionConfig,
} from "./config.ts";
import { canonicalJson, type JsonScalar, type JsonValue, sha256 } from "./json.ts";
import type { FoundedCivilizationSnapshot } from "./institution-snapshot.ts";
import type {
  ConnectionStatus,
  EpistemicStatus,
  FactInput,
  NarrationSnapshot,
  StoredFact,
} from "./observation-snapshot.ts";
import {
  mandateDigest,
  parseMandateConfig,
  type ParsedCivilizationConfig,
  type MandateConfig,
  type ParsedMandateConfig,
} from "./institution.ts";
import {
  createOwnedStateExport,
  type OwnedStateBundle,
  type OwnedStateExport,
} from "./owned-state.ts";
import { defaultStateDirectory } from "./paths.ts";
import {
  recordIndexModeEvidence,
  type RecordIndexModeEvidence,
} from "./record-index-evidence.ts";
import type { JsonlRecordIndexMode } from "./readers.ts";
import { utcInstantOrderingKey } from "./time.ts";
import { sourceReportFactTimeKey } from "./source-report-time.ts";
import { PROJECT_ERROR_CODES, ProjectError, type ProjectErrorCode, type ProjectState, type ProjectRequest, type HarnessBinding, type WorldProjectSnapshot } from "./project-types.ts";
export { ProjectError } from "./project-types.ts";
import {
  sameVerificationFactSet,
  verificationFactFromInput,
  verificationFactKey,
} from "./verification-facts.ts";

export type {
  ConnectionStatus,
  EpistemicStatus,
  FactInput,
  NarrationAttempt,
  NarrationSnapshot,
  StoredFact,
} from "./observation-snapshot.ts";

const STORE_SCHEMA_VERSION = 17;
const LEGACY_REBUILD_SCHEMA_VERSION = 9;
const STORE_FILENAME = "observations.sqlite";
const BUSY_RETRY_WINDOW_MILLISECONDS = 250;
const WORK_CLAIM_TTL_MILLISECONDS = 30 * 60 * 1000; // 30 minutes, first guess
const CONFIRMATION_CONTENTION_BUDGET_MILLISECONDS = 2_000;
const projectAttemptOwners = new Map<string, string>();

const CREATE_PROJECTS = `
  CREATE TABLE IF NOT EXISTS projects (
    project_order INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE,
    civilization_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    workspace_path TEXT NOT NULL UNIQUE,
    harness TEXT NOT NULL CHECK (harness IN ('hermes')),
    request_key TEXT NOT NULL UNIQUE,
    request_digest TEXT NOT NULL,
    requested_at TEXT NOT NULL,
    UNIQUE (civilization_id, slug),
    FOREIGN KEY (civilization_id) REFERENCES civilizations(civilization_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS project_provisioning_events (
    event_order INTEGER PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    project_id TEXT NOT NULL REFERENCES projects(project_id),
    state TEXT NOT NULL CHECK (state IN ('requested','directory-created','external-unknown','established','failed')),
    attempt INTEGER NOT NULL,
    reason TEXT,
    recorded_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS project_provisioning_current
    ON project_provisioning_events(project_id, event_order DESC);
  CREATE TABLE IF NOT EXISTS project_harness_bindings (
    project_id TEXT PRIMARY KEY REFERENCES projects(project_id),
    harness TEXT NOT NULL,
    harness_home TEXT NOT NULL,
    harness_version TEXT NOT NULL,
    external_id TEXT NOT NULL,
    external_slug TEXT NOT NULL,
    external_archived INTEGER NOT NULL,
    provenance TEXT NOT NULL CHECK (provenance IN ('created','adopted')),
    observed_at TEXT NOT NULL
  ) STRICT;
`;

// Opaque event identities carry ownership, not state or a public failure reason.
// Linux start ticks distinguish PID reuse; elsewhere a live PID fails closed.
function projectProcessIdentity(pid: number): string {
  if (process.platform !== "linux") return "live";
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  if (fields[0] === "Z" || fields[0] === "X") return "dead";
  return `${readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()}.${fields[19]!}`;
}

function projectOwnerAlive(eventId: string): boolean {
  const match = /^project-owner:(\d+):([^:]+):/.exec(eventId);
  if (match === null) return false;
  try {
    process.kill(Number(match[1]), 0);
    return projectProcessIdentity(Number(match[1])) === match[2];
  } catch (error) {
    return !(error instanceof Error && "code" in error &&
      (error.code === "ESRCH" || error.code === "ENOENT"));
  }
}

export function createCollectionContentionBudget(): ContentionBudget {
  return { remainingMilliseconds: BUSY_RETRY_WINDOW_MILLISECONDS };
}

const CREATE_COLLECTION_ATTEMPTS = `
  CREATE TABLE collection_attempts (
    attempt_order INTEGER PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    activation_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    outcome TEXT NOT NULL CHECK (outcome IN ('running', 'success', 'failed', 'skipped', 'retired')),
    source_records_seen INTEGER NOT NULL CHECK (source_records_seen >= 0),
    facts_seen INTEGER NOT NULL CHECK (facts_seen >= 0),
    facts_added INTEGER NOT NULL CHECK (facts_added >= 0),
    facts_changed INTEGER NOT NULL CHECK (facts_changed >= 0),
    failure_code TEXT,
    FOREIGN KEY (connection_id, config_hash)
      REFERENCES connection_versions(connection_id, config_hash),
    CHECK (
      (outcome = 'running' AND completed_at IS NULL) OR
      (outcome <> 'running' AND completed_at IS NOT NULL)
    ),
    CHECK (
      (outcome IN ('failed', 'skipped') AND failure_code IS NOT NULL) OR
      (outcome IN ('running', 'success', 'retired') AND failure_code IS NULL)
    )
  ) STRICT;
`;
const CREATE_COLLECTION_ATTEMPTS_LATEST_INDEX = `
  CREATE INDEX collection_attempts_latest
    ON collection_attempts(
      connection_id, config_hash, activation_id, attempt_order DESC
    );
`;
const CREATE_COLLECTION_ATTEMPT_RETIREMENTS = `
  CREATE TABLE IF NOT EXISTS collection_attempt_retirements (
    retirement_order INTEGER PRIMARY KEY,
    retirement_id TEXT NOT NULL UNIQUE,
    attempt_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    retired_at TEXT NOT NULL,
    retired_by TEXT NOT NULL,
    confirmation_token TEXT NOT NULL,
    FOREIGN KEY (attempt_id) REFERENCES collection_attempts(attempt_id),
    FOREIGN KEY (connection_id, config_hash)
      REFERENCES connection_versions(connection_id, config_hash)
  ) STRICT;
`;
const CREATE_RECORD_INDEX_MODE_RESOLUTIONS = `
  CREATE TABLE record_index_mode_resolutions (
    resolution_order INTEGER PRIMARY KEY,
    resolution_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    previous_mode TEXT NOT NULL
      CHECK (previous_mode IN ('physical-line', 'record-ordinal', 'unknown')),
    record_index_mode TEXT NOT NULL
      CHECK (record_index_mode IN ('physical-line', 'record-ordinal')),
    resolved_at TEXT NOT NULL,
    affected_fact_ids_json TEXT NOT NULL,
    collection_attempt_ids_json TEXT NOT NULL,
    confirmation_token TEXT NOT NULL,
    FOREIGN KEY (connection_id, config_hash)
      REFERENCES connection_versions(connection_id, config_hash)
  ) STRICT;
`;
const CREATE_CONFIRMATION_PREVIEWS = `
  CREATE TABLE IF NOT EXISTS confirmation_previews (
    confirmation_token_hash TEXT NOT NULL PRIMARY KEY,
    operation TEXT NOT NULL
      CHECK (operation IN (
        'resolve-record-index', 'retire-collection-attempt', 'forget',
        'forget-civilization'
      )),
    arguments_json TEXT NOT NULL,
    state_fingerprint TEXT NOT NULL,
    issued_at TEXT NOT NULL,
    consumed_at TEXT
  ) STRICT;
`;
const CREATE_OWNED_STATE_EXPORTS = `
  CREATE TABLE IF NOT EXISTS owned_state_exports (
    state_fingerprint TEXT NOT NULL PRIMARY KEY,
    export_digest TEXT NOT NULL UNIQUE,
    exported_at TEXT NOT NULL,
    connection_inventories_json TEXT NOT NULL,
    civilization_inventories_json TEXT NOT NULL
  ) STRICT;
`;
const CREATE_FORGET_RECORDS = `
  CREATE TABLE IF NOT EXISTS forget_records (
    forget_order INTEGER PRIMARY KEY,
    forget_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL,
    forgotten_at TEXT NOT NULL,
    forgotten_by TEXT NOT NULL,
    inventory_json TEXT NOT NULL,
    inventory_digest TEXT NOT NULL,
    export_digest TEXT NOT NULL
  ) STRICT;
`;
const CREATE_CIVILIZATION_FORGET_RECORDS = `
  CREATE TABLE IF NOT EXISTS civilization_forget_records (
    forget_order INTEGER PRIMARY KEY,
    forget_id TEXT NOT NULL UNIQUE,
    civilization_id TEXT NOT NULL,
    forgotten_at TEXT NOT NULL,
    forgotten_by TEXT NOT NULL,
    inventory_json TEXT NOT NULL,
    inventory_digest TEXT NOT NULL,
    export_digest TEXT NOT NULL
  ) STRICT;
`;

// Institutional state. Kept in tables distinct from `facts`: SECURITY.md names
// institutional records and observations as one protected class, so they share a
// store, but institutional state says what *should* exist while a fact says what
// was observed, and the two must never be queried as one thing.
//
// A mandate revision is never updated in place. Redrawing appends a row; the
// previous revision stays readable, because history and current truth are
// distinct. Dissolution appends a `status = 'dissolved'` revision without
// erasing what the civilization was.
const CREATE_INSTITUTION = `
  CREATE TABLE IF NOT EXISTS civilizations (
    civilization_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    founded_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS mandate_revisions (
    revision_order INTEGER PRIMARY KEY,
    civilization_id TEXT NOT NULL,
    mandate_id TEXT NOT NULL,
    revision TEXT NOT NULL,
    previous_revision TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'dissolved')),
    mandate_json TEXT NOT NULL,
    mandate_digest TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    UNIQUE (civilization_id, revision),
    UNIQUE (mandate_id, revision),
    FOREIGN KEY (civilization_id) REFERENCES civilizations(civilization_id),
    FOREIGN KEY (mandate_id, previous_revision)
      REFERENCES mandate_revisions(mandate_id, revision),
    CHECK (
      (revision = 'revision:1' AND previous_revision IS NULL) OR
      (revision <> 'revision:1' AND previous_revision IS NOT NULL)
    )
  ) STRICT;

  CREATE INDEX IF NOT EXISTS mandate_revisions_current
    ON mandate_revisions(civilization_id, revision_order DESC);
`;

const CREATE_WORK_CLAIMS = `
  CREATE TABLE IF NOT EXISTS work_claims (
    claim_order INTEGER PRIMARY KEY,
    claim_id TEXT NOT NULL UNIQUE,
    civilization_id TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    claimed_by TEXT NOT NULL,
    claimed_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('open','closed','expired')),
    closed_at TEXT,
    FOREIGN KEY (civilization_id) REFERENCES civilizations(civilization_id)
      ON DELETE CASCADE
  ) STRICT;

  CREATE UNIQUE INDEX IF NOT EXISTS work_claims_open_resource
    ON work_claims(civilization_id, resource_id)
    WHERE status = 'open';
`;

const CREATE_SOURCE_REPORTS = `
  CREATE TABLE IF NOT EXISTS source_reports (
    report_order INTEGER PRIMARY KEY,
    report_id TEXT NOT NULL UNIQUE,
    connection_id TEXT NOT NULL,
    config_hash TEXT NOT NULL,
    bundle_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    bundle_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    UNIQUE(connection_id, config_hash, bundle_id),
    FOREIGN KEY(connection_id, config_hash) REFERENCES connection_versions(connection_id, config_hash)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS source_report_facts (
    report_id TEXT NOT NULL REFERENCES source_reports(report_id) ON DELETE CASCADE,
    fact_id INTEGER NOT NULL REFERENCES facts(fact_id),
    source_fact_id TEXT NOT NULL,
    epistemic_type TEXT NOT NULL CHECK(epistemic_type IN ('observation','claim','derived')),
    PRIMARY KEY(report_id, source_fact_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS source_report_admissions (
    admission_order INTEGER PRIMARY KEY,
    report_id TEXT NOT NULL REFERENCES source_reports(report_id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES collection_attempts(attempt_id)
  ) STRICT;
`;

export interface ActiveConnection {
  activationId: string;
  config: ConnectionConfig;
  configHash: string;
  connectedAt: string;
  jsonlRecordIndexMode: JsonlRecordIndexMode | "unknown";
}

// A last-seen order, unlike attempt_id, advances even for identical sightings.
// Never carry absence evidence across configuration or activation boundaries.
const FACT_COLLECTION_AS_OF_JOIN = `
  LEFT JOIN collection_attempts seen
    ON seen.attempt_order = f.last_seen_attempt_order
   AND seen.connection_id = f.connection_id AND seen.config_hash = f.config_hash
   AND seen.outcome = 'success'
  LEFT JOIN collection_attempts collected
    ON collected.attempt_order = (
      SELECT MAX(attempt.attempt_order) FROM collection_attempts attempt
       WHERE attempt.connection_id = seen.connection_id
         AND attempt.config_hash = seen.config_hash
         AND attempt.activation_id = seen.activation_id
         AND attempt.outcome = 'success'
    )`;

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

type CollectionAttemptRetirementSnapshot = Omit<
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

type CivilizationForgetSnapshot = CivilizationForgetInventory & {
  inventoryDigest: string;
  stateFingerprint: string;
};

type ForgetSnapshot = ForgetInventory & {
  inventoryDigest: string;
  stateFingerprint: string;
};

type RecordIndexModeResolutionSnapshot = Omit<
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

export class CivilizationNotFoundError extends Error {
  readonly code = "civilization_not_found";

  constructor(_civilizationId: string) {
    super("No civilization is founded under this id");
    this.name = "CivilizationNotFoundError";
  }
}

export class CivilizationDissolvedError extends Error {
  readonly code = "civilization_dissolved";

  constructor(_civilizationId: string) {
    super("This civilization has been dissolved");
    this.name = "CivilizationDissolvedError";
  }
}

/**
 * A stored mandate that cannot be read back as the thing it was written as is
 * an unknown territory, and an unknown territory cannot authorize anything.
 */
export class MandateUnreadableError extends Error {
  readonly code = "mandate_unreadable";

  constructor(_civilizationId: string) {
    super("The stored mandate could not be read as a mandate");
    this.name = "MandateUnreadableError";
  }
}

export class ConnectionConflictError extends Error {
  readonly code = "connection_conflict";

  constructor(_connectionId: string) {
    super("A different configuration is already connected under this id");
    this.name = "ConnectionConflictError";
  }
}

export interface OpenWorkClaim {
  claimId: string;
  civilizationId: string;
  resourceId: string;
  claimedBy: string;
  claimedAt: string;
  expiresAt: string;
}

export class WorkClaimConflictError extends Error {
  readonly code = "work_claim_conflict";

  constructor() {
    super("An open work claim already exists for this civilization and resource");
    this.name = "WorkClaimConflictError";
  }
}

export class ConnectionNotFoundError extends Error {
  readonly code = "connection_not_found";

  constructor(_connectionId: string) {
    super("No active connection is registered under this id");
    this.name = "ConnectionNotFoundError";
  }
}

export class ConnectionInactiveError extends Error {
  readonly code = "connection_inactive";

  constructor(_connectionId: string) {
    super("The connection revision is no longer active");
    this.name = "ConnectionInactiveError";
  }
}

export class StoredRecordIndexModeUnknownError extends Error {
  readonly code = "store_record_index_mode_unknown";

  constructor(_connectionId: string) {
    super("The stored JSONL record-index mode cannot be determined");
    this.name = "StoredRecordIndexModeUnknownError";
  }
}

export class StoredRecordIndexModeKnownError extends Error {
  readonly code = "store_record_index_mode_known";

  constructor(_connectionId: string) {
    super("The stored JSONL record-index mode is already known");
    this.name = "StoredRecordIndexModeKnownError";
  }
}

export class RecordIndexResolutionStateChangedError extends Error {
  readonly code = "record_index_resolution_state_changed";

  constructor() {
    super("The record-index resolution scope changed after confirmation was requested");
    this.name = "RecordIndexResolutionStateChangedError";
  }
}

export class ConfirmationPreviewNotFoundError extends Error {
  readonly code = "confirmation_preview_not_found";

  constructor() {
    super("No matching confirmation preview was issued");
    this.name = "ConfirmationPreviewNotFoundError";
  }
}

export class ConfirmationAlreadySpentError extends Error {
  readonly code = "confirmation_already_spent";

  constructor() {
    super("The confirmation preview has already been spent");
    this.name = "ConfirmationAlreadySpentError";
  }
}

export class ForgetConnectionActiveError extends Error {
  readonly code = "forget_connection_active";

  constructor(_connectionId: string) {
    super("An active connection cannot be forgotten");
    this.name = "ForgetConnectionActiveError";
  }
}

export class ForgetConnectionNotFoundError extends Error {
  readonly code = "forget_connection_not_found";

  constructor(_connectionId: string) {
    super("No owned state exists for this connection");
    this.name = "ForgetConnectionNotFoundError";
  }
}

export class ForgetExportCoverageError extends Error {
  readonly code = "forget_export_coverage_mismatch";

  constructor() {
    super("The presented export does not cover the exact forget inventory");
    this.name = "ForgetExportCoverageError";
  }
}

export class ForgetStateChangedError extends Error {
  readonly code = "forget_state_changed";

  constructor() {
    super("The forget scope changed after confirmation was requested");
    this.name = "ForgetStateChangedError";
  }
}

export class ForgetCivilizationNotFoundError extends Error {
  readonly code = "forget_civilization_not_found";

  constructor(_civilizationId: string) {
    super("No owned institutional state exists for this civilization");
    this.name = "ForgetCivilizationNotFoundError";
  }
}

export class ForgetCivilizationNotDissolvedError extends Error {
  readonly code = "forget_civilization_not_dissolved";

  constructor(_civilizationId: string) {
    super("A civilization must be dissolved before it can be forgotten");
    this.name = "ForgetCivilizationNotDissolvedError";
  }
}

export class ForgetCivilizationExportCoverageError extends Error {
  readonly code = "forget_civilization_export_coverage_mismatch";

  constructor() {
    super("The presented export does not cover the exact civilization inventory");
    this.name = "ForgetCivilizationExportCoverageError";
  }
}

export class ForgetCivilizationStateChangedError extends Error {
  readonly code = "forget_civilization_state_changed";

  constructor() {
    super("The civilization forget scope changed after confirmation was requested");
    this.name = "ForgetCivilizationStateChangedError";
  }
}

export class StoredRecordIndexModeChangedError extends Error {
  readonly code = "store_record_index_mode_changed";

  constructor(_connectionId: string) {
    super("The stored JSONL record-index mode changed during the operation");
    this.name = "StoredRecordIndexModeChangedError";
  }
}

export class RecordIndexResolutionCollectionRunningError extends Error {
  readonly code = "record_index_resolution_collection_running";

  constructor(_connectionId: string) {
    super("A collection is still running for this connection version");
    this.name = "RecordIndexResolutionCollectionRunningError";
  }
}

export class CollectionAttemptNotRunningError extends Error {
  readonly code = "collection_attempt_not_running";

  constructor(_attemptId: string) {
    super("The collection attempt is no longer running");
    this.name = "CollectionAttemptNotRunningError";
  }
}

export class SourceRevisionChangedError extends Error {
  readonly code = "source_changed";

  constructor() {
    super("The source changed while its record-index mode was being resolved");
    this.name = "SourceRevisionChangedError";
  }
}

export class FactRejectedError extends TypeError {
  readonly code = "fact_rejected";
  readonly field: string;
  readonly reason: string;

  constructor(field: string, reason: string) {
    super(`Fact ${field} ${reason}`);
    this.name = "FactRejectedError";
    this.field = field;
    this.reason = reason;
  }
}

export class FactNotDeclaredError extends TypeError {
  readonly code = "fact_not_declared";

  constructor() {
    super("Fact is not declared by the registered connection");
    this.name = "FactNotDeclaredError";
  }
}

export class CollectionFailedError extends Error {
  readonly attemptId: string;
  readonly code: string;

  constructor(attemptId: string, code: string) {
    super("Collection failed");
    this.name = "CollectionFailedError";
    this.attemptId = attemptId;
    this.code = code;
  }
}

class StoreContentionError extends Error {
  readonly code = "store_contention";

  constructor(cause: unknown) {
    super("Observation store remained busy", { cause });
    this.name = "StoreContentionError";
  }
}

export class ObservationStore {
  readonly path: string;
  readonly #busyTimeoutMilliseconds: number;
  readonly #database: DatabaseSync;
  readonly #projectAttempts = new Map<string, { attempt: number; owner: string }>();
  #closed = false;

  constructor(
    stateDirectory = defaultStateDirectory(),
    busyTimeoutMilliseconds = BUSY_RETRY_WINDOW_MILLISECONDS,
  ) {
    if (
      !Number.isInteger(busyTimeoutMilliseconds) ||
      busyTimeoutMilliseconds < 0 ||
      busyTimeoutMilliseconds > BUSY_RETRY_WINDOW_MILLISECONDS
    ) {
      throw new RangeError(
        `SQLite busy timeout must be an integer from 0 through ${BUSY_RETRY_WINDOW_MILLISECONDS}`,
      );
    }
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    chmodSync(stateDirectory, 0o700);
    this.path = join(stateDirectory, STORE_FILENAME);
    this.#busyTimeoutMilliseconds = busyTimeoutMilliseconds;
    this.#database = new DatabaseSync(this.path, { timeout: busyTimeoutMilliseconds });
    chmodSync(this.path, 0o600);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
    this.#database.exec("PRAGMA journal_mode = WAL");
  }

  close(): void {
    if (!this.#closed) {
      for (const [projectId, attempt] of this.#projectAttempts) {
        if (projectAttemptOwners.get(projectId) === attempt.owner) {
          projectAttemptOwners.delete(projectId);
        }
      }
      this.#projectAttempts.clear();
      this.#database.close();
      this.#closed = true;
    }
  }

  register(parsed: ParsedConnectionConfig, now = new Date()): "connected" | "unchanged" {
    const timestamp = now.toISOString();
    const activationId = randomUUID();
    let connected = false;
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO connection_versions
             (connection_id, config_hash, config_json, registered_at,
              jsonl_record_index_mode)
           VALUES (?, ?, ?, ?, 'record-ordinal')
           ON CONFLICT (connection_id, config_hash) DO NOTHING`,
        )
        .run(parsed.config.id, parsed.hash, parsed.canonical, timestamp);

      const active = this.#database
        .prepare("SELECT config_hash FROM active_connections WHERE connection_id = ?")
        .get(parsed.config.id) as undefined | { config_hash: string };
      if (active !== undefined && active.config_hash !== parsed.hash) {
        throw new ConnectionConflictError(parsed.config.id);
      }
      if (active === undefined) {
        this.#database
          .prepare(
            `INSERT INTO active_connections
               (connection_id, config_hash, activation_id, connected_at)
             VALUES (?, ?, ?, ?)`,
          )
          .run(parsed.config.id, parsed.hash, activationId, timestamp);
        connected = true;
      }
    });
    return connected ? "connected" : "unchanged";
  }

  disconnect(connectionId: string): boolean {
    return this.#transaction(() => {
      const result = this.#database
        .prepare("DELETE FROM active_connections WHERE connection_id = ?")
        .run(connectionId);
      return numberOfChanges(result) === 1;
    });
  }

  registerArenaSource(connectionId: string, sourceId: string, owner: string): "connected" | "unchanged" {
    return this.register(parseConnectionConfig({
      schemaVersion: 1, id: connectionId, factOwner: owner,
      reader: { type: "arena", sourceId, owner },
      sourceRecord: { identity: [{ scope: "record", path: "factId" }], retention: "history", recordedAt: { unavailable: true } },
      facts: [],
    }));
  }

  async admitArenaBundle(connectionId: string, input: string | Uint8Array): Promise<CollectionResult & { reportId: string }> {
    const connection = this.getConnection(connectionId);
    // Snapshot bounded caller-owned bytes before the first asynchronous yield.
    if (input instanceof Uint8Array && input.byteLength <= 2 * 1024 * 1024) input = Buffer.from(input);
    const attemptId = randomUUID();
    const budget = createCollectionContentionBudget();
    let admitted: { attemptOrder: number; startedAt: string };
    try {
      admitted = await this.#recordRunningAttempt(connection, attemptId, () => new Date(), budget);
    } catch (error) {
      throw new CollectionFailedError(attemptId, safeFailureCode(error));
    }
    const { attemptOrder, startedAt } = admitted;
    try {
      const reader = this.#registeredConfig(connection).reader;
      if (reader.type !== "arena") throw new ArenaAdmissionError();
      const { bundle, canonical, digest } = parseArenaBundle(input, reader);
      const completedAt = new Date().toISOString();
      return await this.#retryTransactionWithinContentionBudget(budget, () => {
        this.#assertActive(connection);
        const existing = this.#database.prepare(`SELECT report_id, digest FROM source_reports WHERE connection_id = ? AND config_hash = ? AND bundle_id = ?`)
          .get(connectionId, connection.configHash, bundle.bundleId) as { report_id: string; digest: string } | undefined;
        if (existing !== undefined && existing.digest !== digest) throw new ArenaAdmissionError("arena_conflict");
        const reportId = existing?.report_id ?? randomUUID();
        if (existing === undefined) {
          const snapshot = sourceReportProjection(bundle, { reportId, connectionId, connectionVersion: connection.configHash, admittedFrom: startedAt, admittedAt: completedAt });
          this.#database.prepare(`INSERT INTO source_reports (report_id, connection_id, config_hash, bundle_id, digest, bundle_json, snapshot_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(reportId, connectionId, connection.configHash, bundle.bundleId, digest, canonical, canonicalJson(snapshot as unknown as JsonValue));
        }
        let factsAdded = 0;
        for (const fact of bundle.facts) {
          const key = fact.sourceRecordedAt === null ? "" : sourceReportFactTimeKey(fact.sourceRecordedAt);
          if (key === null) throw new ArenaAdmissionError();
          const identity = [connectionId, connection.configHash, fact.factOwner, fact.kind, fact.subject, fact.factId, key, sha256("{}")];
          const inserted = this.#database.prepare(`INSERT INTO facts
            (connection_id, config_hash, fact_owner, kind, subject, source_record_id, source_time_key, payload_hash,
             epistemic_status, payload_json, attempt_id, source_recorded_at, collected_at, last_seen_attempt_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'claim', '{}', ?, ?, ?, ?)
            ON CONFLICT DO NOTHING`).run(...identity, attemptId, fact.sourceRecordedAt, startedAt, attemptOrder);
          factsAdded += numberOfChanges(inserted);
          const stored = this.#database.prepare(`SELECT fact_id FROM facts WHERE connection_id = ? AND config_hash = ? AND fact_owner = ? AND kind = ? AND subject = ? AND source_record_id = ? AND source_time_key = ? AND payload_hash = ? AND epistemic_status = 'claim'`).get(...identity) as { fact_id: number };
          // Retain the admission supplying the stored spelling; identical sightings only advance last-seen.
          this.#database.prepare(`UPDATE facts SET
            attempt_id = CASE WHEN last_seen_attempt_order <= ? AND source_recorded_at IS NOT ? THEN ? ELSE attempt_id END,
            collected_at = CASE WHEN last_seen_attempt_order <= ? AND source_recorded_at IS NOT ? THEN ? ELSE collected_at END,
            source_recorded_at = CASE WHEN last_seen_attempt_order <= ? THEN ? ELSE source_recorded_at END,
            last_seen_attempt_order = MAX(last_seen_attempt_order, ?) WHERE fact_id = ?`)
            .run(attemptOrder, fact.sourceRecordedAt, attemptId, attemptOrder, fact.sourceRecordedAt, startedAt, attemptOrder, fact.sourceRecordedAt, attemptOrder, stored.fact_id);
          if (existing === undefined) this.#database.prepare(`INSERT INTO source_report_facts (report_id, fact_id, source_fact_id, epistemic_type) VALUES (?, ?, ?, ?)`).run(reportId, stored.fact_id, fact.factId, fact.epistemicType);
        }
        this.#database.prepare(`INSERT INTO source_report_admissions(report_id, attempt_id) VALUES (?, ?)`).run(reportId, attemptId);
        const updated = this.#database.prepare(`UPDATE collection_attempts SET completed_at = ?, outcome = 'success', source_records_seen = ?, facts_seen = ?, facts_added = ?, facts_changed = 0 WHERE attempt_id = ? AND outcome = 'running'`).run(completedAt, bundle.facts.length, bundle.facts.length, factsAdded, attemptId);
        if (numberOfChanges(updated) !== 1) throw new CollectionAttemptNotRunningError(attemptId);
        return { reportId, attemptId, startedAt, completedAt, factsAdded, factsChanged: 0, factsSeen: bundle.facts.length, sourceRecordsSeen: bundle.facts.length, outcome: "success" as const };
      });
    } catch (error) {
      let code = error instanceof ArenaAdmissionError ? error.code : safeFailureCode(error);
      try {
        await this.#retryTransactionWithinContentionBudget(budget, () => {
          this.#database.prepare(`UPDATE collection_attempts SET completed_at = ?, outcome = 'failed', failure_code = ? WHERE attempt_id = ? AND outcome = 'running'`).run(new Date().toISOString(), code, attemptId);
        });
      } catch (recordingError) {
        // As with ordinary collection, a durable running marker remains unread
        // if a writer prevents even the bounded failure record from committing.
        if (safeFailureCode(recordingError) === "store_contention") code = "store_contention";
      }
      throw new CollectionFailedError(attemptId, code);
    }
  }

  querySourceReport(reportId: string): { reportId: string; digest: string; bundle: ArenaBundle } | undefined {
    const row = this.#database.prepare(`SELECT r.digest, r.bundle_json, c.config_json, c.config_hash FROM source_reports r JOIN connection_versions c ON c.connection_id = r.connection_id AND c.config_hash = r.config_hash WHERE r.report_id = ?`).get(reportId) as { digest: string; bundle_json: string; config_json: string; config_hash: string } | undefined;
    if (row === undefined) return undefined;
    const reader = parseStoredConfig(row.config_json, row.config_hash).reader;
    if (reader.type !== "arena") throw new ArenaAdmissionError();
    const parsed = parseArenaBundle(row.bundle_json, reader);
    if (parsed.digest !== row.digest) throw new ArenaAdmissionError();
    return { reportId, digest: row.digest, bundle: parsed.bundle };
  }

  #sourceReports(): SourceReportSnapshot[] {
    return (this.#database.prepare(`SELECT r.snapshot_json, a.started_at, a.completed_at FROM active_connections c
      JOIN collection_attempts a ON a.attempt_id = (
        SELECT ca.attempt_id FROM source_report_admissions s
        JOIN collection_attempts ca ON ca.attempt_id = s.attempt_id
        WHERE ca.connection_id = c.connection_id AND ca.config_hash = c.config_hash
        ORDER BY s.admission_order DESC LIMIT 1)
      JOIN source_report_admissions s ON s.attempt_id = a.attempt_id
      JOIN source_reports r ON r.report_id = s.report_id ORDER BY c.connection_id`).all() as { snapshot_json: string; started_at: string; completed_at: string }[])
      .map((row) => ({ ...JSON.parse(row.snapshot_json) as SourceReportSnapshot, admittedFrom: row.started_at, admittedAt: row.completed_at }));
  }

  foundCivilization(
    parsed: ParsedCivilizationConfig,
    now = new Date(),
  ): { civilizationId: string; mandateId: string } {
    const timestamp = now.toISOString();
    const civilizationId = `civilization:${randomUUID()}`;
    const mandateId = `mandate:${randomUUID()}`;
    return this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO civilizations (civilization_id, name, founded_at)
           VALUES (?, ?, ?)`,
        )
        .run(civilizationId, parsed.config.name, timestamp);
      this.#insertMandateRevision(
        civilizationId,
        mandateId,
        "revision:1",
        null,
        "active",
        parsed.mandate,
        timestamp,
      );
      return { civilizationId, mandateId };
    });
  }

  requestProject(input: ProjectRequest): { project: WorldProjectSnapshot; created: boolean } {
    return this.#projectTransaction(() => {
      const existing = this.#database.prepare(
        "SELECT project_id, civilization_id, request_digest FROM projects WHERE request_key = ?",
      ).get(input.requestKey) as { project_id: string; civilization_id: string; request_digest: string } | undefined;
      if (existing !== undefined) {
        if (existing.civilization_id !== input.civilizationId || existing.request_digest !== input.requestDigest) {
          throw new ProjectError("request_key_conflict");
        }
        return { project: this.getProject(existing.project_id)!, created: false };
      }
      const civilization = this.#database.prepare(
        "SELECT status FROM mandate_revisions WHERE civilization_id = ? ORDER BY revision_order DESC LIMIT 1",
      ).get(input.civilizationId) as { status: string } | undefined;
      if (civilization === undefined) throw new ProjectError("civilization_unknown");
      if (civilization.status === "dissolved") throw new ProjectError("civilization_dissolved");
      if (input.harness !== "hermes" || !input.requestKey || !input.requestDigest ||
          !input.name || !input.workspacePath || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(input.slug)) {
        throw new ProjectError("invalid_request");
      }
      if (this.#database.prepare("SELECT 1 FROM projects WHERE civilization_id = ? AND slug = ?")
        .get(input.civilizationId, input.slug)) throw new ProjectError("slug_taken");
      if (this.#database.prepare("SELECT 1 FROM projects WHERE workspace_path = ?")
        .get(input.workspacePath)) throw new ProjectError("path_taken");
      const projectId = `project:${randomUUID()}`;
      this.#database.prepare(`INSERT INTO projects
        (project_id, civilization_id, name, slug, workspace_path, harness, request_key, request_digest, requested_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(projectId, input.civilizationId, input.name, input.slug, input.workspacePath,
          input.harness, input.requestKey, input.requestDigest, new Date().toISOString());
      this.#insertProjectEvent(projectId, "requested", 0, null);
      return { project: this.getProject(projectId)!, created: true };
    });
  }

  listProjects(): WorldProjectSnapshot[] {
    return this.#projectSnapshots();
  }

  getProject(projectId: string): WorldProjectSnapshot | undefined {
    return this.#projectSnapshots(projectId)[0];
  }

  #projectSnapshots(projectId?: string): WorldProjectSnapshot[] {
    return this.#database.prepare(`SELECT p.project_id AS projectId, p.civilization_id AS civilizationId,
      p.name, p.slug, p.workspace_path AS workspacePath, e.state, e.attempt, e.reason,
      b.external_id AS externalId, b.external_slug AS externalSlug, b.external_archived AS externalArchived,
      b.provenance, b.observed_at AS observedAt
      FROM projects p JOIN project_provisioning_events e ON e.event_order = (
        SELECT event_order FROM project_provisioning_events WHERE project_id = p.project_id ORDER BY event_order DESC LIMIT 1)
      LEFT JOIN project_harness_bindings b ON b.project_id = p.project_id
      ${projectId === undefined ? "" : "WHERE p.project_id = ?"} ORDER BY p.project_order`)
      .all(...(projectId === undefined ? [] : [projectId])).map((value) => {
        const row = value as unknown as Omit<WorldProjectSnapshot, "harness"> & {
          externalId: string | null; externalSlug: string; externalArchived: number;
          provenance: "created" | "adopted"; observedAt: string;
        };
        const { externalId, externalSlug, externalArchived, provenance, observedAt, ...project } = row;
        return { ...project, harness: externalId === null ? null : {
          id: "hermes", externalId, externalSlug, externalArchived: externalArchived === 1, provenance, observedAt,
        } };
      });
  }

  claimProjectAttempt(projectId: string): number {
    const owner = `project-owner:${process.pid}:${projectProcessIdentity(process.pid)}:${randomUUID()}:`;
    const attempt = this.#projectTransaction(() => {
      const current = this.getProject(projectId);
      if (current === undefined || current.state === "established") throw new ProjectError("invalid_request");
      const event = this.#database.prepare(
        "SELECT event_id FROM project_provisioning_events WHERE project_id = ? ORDER BY event_order DESC LIMIT 1",
      ).get(projectId) as { event_id: string };
      const currentOwnerPrefix = `project-owner:${process.pid}:${projectProcessIdentity(process.pid)}:`;
      const abandonedByThisProcess = projectAttemptOwners.get(projectId) === undefined &&
        event.event_id.startsWith(currentOwnerPrefix);
      if (projectOwnerAlive(event.event_id) && !abandonedByThisProcess) {
        throw new ProjectError("retry_in_progress");
      }
      const next = current.attempt + 1;
      this.#insertProjectEvent(projectId, current.state, next, current.reason, owner);
      return next;
    });
    this.#projectAttempts.set(projectId, { attempt, owner });
    projectAttemptOwners.set(projectId, owner);
    return attempt;
  }

  appendProjectEvent(projectId: string, state: ProjectState, attempt: number, reason?: ProjectErrorCode): void {
    this.#projectTransaction(() => {
      const owner = this.#assertProjectAttempt(projectId, attempt);
      if (!["requested", "directory-created", "external-unknown", "failed"].includes(state) ||
          (state === "failed" && reason === undefined) ||
          ((state === "requested" || state === "directory-created") && reason !== undefined) ||
          (reason !== undefined && !PROJECT_ERROR_CODES.includes(reason))) throw new ProjectError("invalid_request");
      this.#insertProjectEvent(projectId, state, attempt, reason ?? null, owner);
    });
  }

  bindProject(projectId: string, attempt: number, binding: HarnessBinding): void {
    this.#projectTransaction(() => {
      const owner = this.#assertProjectAttempt(projectId, attempt);
      if (!binding.externalId || !binding.externalSlug || !binding.harnessHome || !binding.harnessVersion ||
          binding.externalId.length > 128 || binding.externalSlug.length > 128 ||
          typeof binding.externalArchived !== "boolean" || !["created", "adopted"].includes(binding.provenance)) {
        throw new ProjectError("invalid_request");
      }
      this.#database.prepare(`INSERT INTO project_harness_bindings
        (project_id, harness, harness_home, harness_version, external_id, external_slug, external_archived, provenance, observed_at)
        VALUES (?, 'hermes', ?, ?, ?, ?, ?, ?, ?)`)
        .run(projectId, binding.harnessHome, binding.harnessVersion, binding.externalId,
          binding.externalSlug, Number(binding.externalArchived), binding.provenance, new Date().toISOString());
      this.#insertProjectEvent(projectId, "established", attempt, null, owner);
    });
  }

  releaseProjectAttempt(projectId: string): void {
    const owned = this.#projectAttempts.get(projectId);
    if (owned === undefined) return;
    try {
      this.#projectTransaction(() => {
        const current = this.getProject(projectId);
        if (current === undefined) return;
        this.#assertProjectAttempt(projectId, owned.attempt, true);
        this.#insertProjectEvent(projectId, current.state, current.attempt, current.reason);
      });
    } finally {
      this.#projectAttempts.delete(projectId);
      if (projectAttemptOwners.get(projectId) === owned.owner) {
        projectAttemptOwners.delete(projectId);
      }
    }
  }

  #assertProjectAttempt(projectId: string, attempt: number, allowEstablished = false): string {
    const owned = this.#projectAttempts.get(projectId);
    const event = this.#database.prepare(
      "SELECT event_id, attempt, state FROM project_provisioning_events WHERE project_id = ? ORDER BY event_order DESC LIMIT 1",
    ).get(projectId) as { event_id: string; attempt: number; state: ProjectState } | undefined;
    if (owned === undefined || owned.attempt !== attempt || event?.attempt !== attempt ||
        !event.event_id.startsWith(owned.owner) || (!allowEstablished && event.state === "established")) {
      throw new ProjectError("invalid_request");
    }
    return owned.owner;
  }

  #insertProjectEvent(projectId: string, state: ProjectState, attempt: number, reason: ProjectErrorCode | null, owner = "project-event:"): void {
    this.#database.prepare(`INSERT INTO project_provisioning_events
      (event_id, project_id, state, attempt, reason, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(`${owner}${randomUUID()}`, projectId, state, attempt, reason, new Date().toISOString());
  }

  #projectTransaction<T>(operation: () => T): T {
    try {
      return this.#transaction(operation);
    } catch (error) {
      if (error instanceof StoreContentionError) throw new ProjectError("busy");
      throw error;
    }
  }

  claimResource(
    civilizationId: string,
    resourceId: string,
    claimedBy: string,
    now = new Date(),
  ): { claimId: string; resourceId: string; expiresAt: string } {
    const timestamp = now.toISOString();
    const expiresAt = new Date(now.getTime() + WORK_CLAIM_TTL_MILLISECONDS).toISOString();
    const claimId = `claim:${randomUUID()}`;
    return this.#transaction(() => {
      const existing = this.#database
        .prepare("SELECT 1 FROM civilizations WHERE civilization_id = ?")
        .get(civilizationId);
      if (existing === undefined) {
        throw new CivilizationNotFoundError(civilizationId);
      }
      const previous = this.#database
        .prepare(
          `SELECT status FROM mandate_revisions WHERE civilization_id = ?
           ORDER BY revision_order DESC LIMIT 1`,
        )
        .get(civilizationId) as { status: "active" | "dissolved" } | undefined;
      if (previous === undefined) {
        throw new MandateUnreadableError(civilizationId);
      }
      if (previous.status === "dissolved") {
        throw new CivilizationDissolvedError(civilizationId);
      }
      this.#database
        .prepare(
          `UPDATE work_claims SET status = 'expired'
           WHERE civilization_id = ? AND resource_id = ? AND status = 'open'
             AND expires_at <= ?`,
        )
        .run(civilizationId, resourceId, timestamp);
      try {
        this.#database
          .prepare(
            `INSERT INTO work_claims
             (claim_id, civilization_id, resource_id, claimed_by, claimed_at, expires_at, status)
             VALUES (?, ?, ?, ?, ?, ?, 'open')`,
          )
          .run(claimId, civilizationId, resourceId, claimedBy, timestamp, expiresAt);
      } catch (error) {
        if (
          error instanceof Error &&
          "errcode" in error && error.errcode === 2067
        ) {
          throw new WorkClaimConflictError();
        }
        throw error;
      }
      return { claimId, resourceId, expiresAt };
    });
  }

  heartbeatClaim(claimId: string, now = new Date()): boolean {
    return this.#transaction(() => {
      const claim = this.#database
        .prepare("SELECT civilization_id FROM work_claims WHERE claim_id = ?")
        .get(claimId) as { civilization_id: string } | undefined;
      if (claim === undefined) {
        return false;
      }
      const previous = this.#database
        .prepare(
          `SELECT status FROM mandate_revisions WHERE civilization_id = ?
           ORDER BY revision_order DESC LIMIT 1`,
        )
        .get(claim.civilization_id) as { status: "active" | "dissolved" } | undefined;
      if (previous?.status === "dissolved") {
        return false;
      }
      const result = this.#database
        .prepare(
          `UPDATE work_claims SET expires_at = ?
           WHERE claim_id = ? AND status = 'open' AND expires_at > ?`,
        )
        .run(
          new Date(now.getTime() + WORK_CLAIM_TTL_MILLISECONDS).toISOString(),
          claimId,
          now.toISOString(),
        );
      return numberOfChanges(result) === 1;
    });
  }

  releaseClaim(claimId: string, now = new Date()): boolean {
    return this.#transaction(() => {
      const result = this.#database
        .prepare(
          `UPDATE work_claims SET status = 'closed', closed_at = ?
           WHERE claim_id = ? AND status = 'open' AND expires_at > ?`,
        )
        .run(now.toISOString(), claimId, now.toISOString());
      return numberOfChanges(result) === 1;
    });
  }

  queryOpenClaims(civilizationId?: string, now = new Date()): OpenWorkClaim[] {
    const statement = this.#database.prepare(
      `SELECT claim_id, civilization_id, resource_id, claimed_by, claimed_at, expires_at
       FROM work_claims WHERE status = 'open' AND expires_at > ?
       ${civilizationId === undefined ? "" : "AND civilization_id = ?"}
       ORDER BY claimed_at`,
    );
    const timestamp = now.toISOString();
    const rows = (civilizationId === undefined
      ? statement.all(timestamp)
      : statement.all(timestamp, civilizationId)) as {
      claim_id: string;
      civilization_id: string;
      resource_id: string;
      claimed_by: string;
      claimed_at: string;
      expires_at: string;
    }[];
    return rows.map((row) => ({
      claimId: row.claim_id,
      civilizationId: row.civilization_id,
      resourceId: row.resource_id,
      claimedBy: row.claimed_by,
      claimedAt: row.claimed_at,
      expiresAt: row.expires_at,
    }));
  }

  /** Replace the latest active mandate through the shared revision lookup. */
  redrawMandate(
    civilizationId: string,
    parsed: ParsedMandateConfig,
    now = new Date(),
  ): string {
    const timestamp = now.toISOString();
    return this.#transaction(() => {
      const existing = this.#database
        .prepare("SELECT 1 AS found FROM civilizations WHERE civilization_id = ?")
        .get(civilizationId) as { found: 1 } | undefined;
      if (existing === undefined) {
        throw new CivilizationNotFoundError(civilizationId);
      }
      const previous = this.#latestMandateRevision(civilizationId);
      if (previous === undefined) {
        throw new MandateUnreadableError(civilizationId);
      }
      if (previous.status === "dissolved") {
        throw new CivilizationDissolvedError(civilizationId);
      }
      const previousNumber = Number.parseInt(previous.revision.replace("revision:", ""), 10);
      if (!Number.isSafeInteger(previousNumber) || `revision:${previousNumber}` !== previous.revision) {
        throw new MandateUnreadableError(civilizationId);
      }
      const revision = `revision:${previousNumber + 1}`;
      this.#insertMandateRevision(
        civilizationId,
        previous.mandate_id,
        revision,
        previous.revision,
        "active",
        parsed,
        timestamp,
      );
      return revision;
    });
  }

  /**
   * Resolve a civilization's current authority context.
   *
   * The digest is derived here, from the bytes actually stored, on every read.
   * It is compared with the stored digest rather than trusting that column.
   * Only the mandate body is covered, not status, IDs, revision, timestamps,
   * or civilization name. Unlike the display read, this authority path refuses
   * dissolved civilizations and unreadable mandates instead of showing unknown.
   */
  resolveAuthorityContext(civilizationId: string): ResolvedAuthorityContext {
    const civilization = this.#database
      .prepare("SELECT 1 AS found FROM civilizations WHERE civilization_id = ?")
      .get(civilizationId) as { found: 1 } | undefined;
    if (civilization === undefined) {
      throw new CivilizationNotFoundError(civilizationId);
    }
    const row = this.#latestMandateRevision(civilizationId);
    if (row === undefined) {
      throw new CivilizationNotFoundError(civilizationId);
    }
    if (row.status === "dissolved") {
      throw new CivilizationDissolvedError(civilizationId);
    }
    const mandate = parseStoredMandate(row.mandate_json, civilizationId);
    const derivedDigest = mandateDigest(mandate as unknown as JsonValue);
    if (derivedDigest !== row.mandate_digest) {
      throw new MandateUnreadableError(civilizationId);
    }
    return {
      authorityContext: {
        civilizationId,
        authorityContext: {
          mandateId: row.mandate_id,
          mandateRevision: row.revision,
          mandateDigest: derivedDigest,
        },
      },
      mandate,
    };
  }

  /** Append a dissolved revision after checking the latest mandate body's digest. */
  dissolveCivilization(civilizationId: string, now = new Date()): boolean {
    return this.#transaction(() => {
      const current = this.#latestMandateRevision(civilizationId);
      if (current === undefined || current.status === "dissolved") {
        return false;
      }
      const mandate = parseStoredMandate(current.mandate_json, civilizationId);
      if (mandateDigest(mandate as unknown as JsonValue) !== current.mandate_digest) {
        throw new MandateUnreadableError(civilizationId);
      }
      const previousNumber = Number.parseInt(current.revision.replace("revision:", ""), 10);
      if (!Number.isSafeInteger(previousNumber) || `revision:${previousNumber}` !== current.revision) {
        throw new MandateUnreadableError(civilizationId);
      }
      this.#insertMandateRevision(
        civilizationId,
        current.mandate_id,
        `revision:${previousNumber + 1}`,
        current.revision,
        "dissolved",
        parseMandateConfig(mandate),
        now.toISOString(),
      );
      return true;
    });
  }

  /**
   * Enumerate institution-owned declarations in one SQL snapshot, never activity.
   * PRODUCT.md's missing/unverifiable state is presented as unknown per entry:
   * one broken mandate must not deny a view of every other civilization.
   * Dissolved entries remain visible; forgotten entries are absent. Status reports
   * what the store holds even if the body is unreadable, not a digest-protected fact.
   * Only a missing revision leaves status unknown. The digest checks only the
   * mandate body, not IDs, revision, timestamps, or civilization name, and is not
   * exposed as authority-context material on this read-only display path.
   */
  listFoundedCivilizations(): FoundedCivilizationSnapshot[] {
    return this.#latestMandateRevision().map((row) => {
      const entry: FoundedCivilizationSnapshot = {
        civilizationId: row.civilization_id,
        name: row.name,
        foundedAt: row.founded_at,
        bodyReadable: false,
        domain: "",
        sources: [],
        mayActAlone: [],
        mustEscalate: [],
        mandate: { status: "unreadable" },
      };
      // A missing revision is an invariant violation, also unknown for this entry.
      if (row.mandate_id === null) return entry;
      const revision = row as FoundedMandateRow & MandateRevisionRow;
      entry.mandate = {
        status: revision.status,
        mandateId: revision.mandate_id,
        revision: revision.revision,
        recordedAt: revision.recorded_at,
      };
      try {
        const mandate = parseStoredMandate(revision.mandate_json, row.civilization_id);
        if (mandateDigest(mandate as unknown as JsonValue) !== row.mandate_digest) {
          return entry;
        }
        return {
          ...entry,
          bodyReadable: true,
          domain: mandate.domain,
          sources: mandate.sources,
          mayActAlone: mandate.mayActAlone,
          mustEscalate: mandate.mustEscalate,
        };
      } catch (error) {
        if (!(error instanceof MandateUnreadableError)) throw error;
        return entry;
      }
    });
  }

  #latestMandateRevision(civilizationId: string): MandateRevisionRow | undefined;
  #latestMandateRevision(): FoundedMandateRow[];
  #latestMandateRevision(
    civilizationId?: string,
  ): MandateRevisionRow | undefined | FoundedMandateRow[] {
    // Both modes use the same latest-row selection. Enumeration is one statement,
    // including civilizations with no revision, so redraw cannot tear the read.
    const rows = this.#database.prepare(
      `SELECT c.civilization_id, c.name, c.founded_at,
              m.mandate_id, m.revision, m.status, m.mandate_json,
              m.mandate_digest, m.recorded_at
         FROM civilizations c
         LEFT JOIN mandate_revisions m ON m.revision_order = (
           SELECT revision_order FROM mandate_revisions
            WHERE civilization_id = c.civilization_id
            ORDER BY revision_order DESC LIMIT 1
         )
         ${civilizationId === undefined ? "" : "WHERE c.civilization_id = ?"}
         ORDER BY c.founded_at ASC, c.civilization_id ASC`,
    ).all(...(civilizationId === undefined ? [] : [civilizationId])) as FoundedMandateRow[];
    if (civilizationId === undefined) return rows;
    const row = rows[0];
    return row === undefined || row.mandate_id === null
      ? undefined
      : row as MandateRevisionRow;
  }

  #insertMandateRevision(
    civilizationId: string,
    mandateId: string,
    revision: string,
    previousRevision: null | string,
    status: "active" | "dissolved",
    parsed: ParsedMandateConfig,
    recordedAt: string,
  ): void {
    const mandateJson = canonicalJson(parsed.config as unknown as JsonValue);
    const derivedDigest = mandateDigest(parsed.config as unknown as JsonValue);
    this.#database
      .prepare(
        `INSERT INTO mandate_revisions (
           civilization_id, mandate_id, revision, previous_revision,
           status, mandate_json, mandate_digest, recorded_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        civilizationId,
        mandateId,
        revision,
        previousRevision,
        status,
        mandateJson,
        derivedDigest,
        recordedAt,
      );
  }

  exportOwnedState(
    now = new Date(),
    write?: (exported: OwnedStateExport) => void,
  ): OwnedStateExport {
    return this.#transaction(() => {
      const institutionStore = this.#ownedInstitutionState();
      const observationStore = this.#ownedObservationState();
      const omitted = [
        {
          section: "confirmationPreviews",
          reason:
            "Operational approval-gate records are omitted because they are not personal observation history and exporting them could disclose confirmation material.",
        },
        {
          section: "ownedStateExports",
          reason:
            "Operational export-evidence records are omitted so exporting unchanged owned state is deterministic and does not recursively change the bundle.",
        },
      ];
      const stateFingerprint = `sha256:${sha256(
        canonicalJson({ institutionStore, observationStore, omitted } as unknown as JsonValue),
      )}`;
      const existing = this.#database
        .prepare(
          `SELECT exported_at FROM owned_state_exports WHERE state_fingerprint = ?`,
        )
        .get(stateFingerprint) as undefined | { exported_at: string };
      const exportedAt = existing?.exported_at ?? now.toISOString();
      const bundle: OwnedStateBundle = {
        schemaVersion: 1,
        exportedAt,
        institutionStore,
        observationStore,
        omitted,
      };
      const exported = createOwnedStateExport(bundle);
      const projectState = this.#projectExport();
      if (projectState.projects!.length > 0) {
        Object.assign(exported.counts, {
          projects: projectState.projects!.length,
          projectProvisioningEvents: projectState.projectProvisioningEvents!.length,
          projectHarnessBindings: projectState.projectHarnessBindings!.length,
        });
      }
      write?.(exported);
      if (existing === undefined) {
        const connectionIds = (
          this.#database
            .prepare(
              `SELECT connection_id FROM connection_versions
               UNION
               SELECT connection_id FROM forget_records
               ORDER BY connection_id`,
            )
            .all() as { connection_id: string }[]
        ).map((row) => row.connection_id);
        const inventories = connectionIds.flatMap((connectionId) => {
          try {
            return [{
              connectionId,
              inventoryDigest: this.#forgetSnapshot(connectionId, false).inventoryDigest,
            }];
          } catch (error) {
            if (error instanceof ForgetConnectionNotFoundError) {
              return [];
            }
            throw error;
          }
        });
        const civilizationInventories = (
          this.#database
            .prepare("SELECT civilization_id FROM civilizations ORDER BY civilization_id")
            .all() as { civilization_id: string }[]
        ).map((row) => ({
          civilizationId: row.civilization_id,
          inventoryDigest: this.#civilizationForgetSnapshot(
            row.civilization_id,
            false,
          ).inventoryDigest,
        }));
        this.#database
          .prepare(
            `INSERT INTO owned_state_exports
               (state_fingerprint, export_digest, exported_at,
                connection_inventories_json, civilization_inventories_json)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            stateFingerprint,
            exported.digest,
            exportedAt,
            canonicalJson(inventories),
            canonicalJson(civilizationInventories),
          );
      }
      return exported;
    });
  }

  planForget(
    connectionId: string,
    forgottenBy: string,
    now = new Date(),
  ): ForgetPlan {
    validateActor(forgottenBy, "forget");
    return this.#transaction(() => {
      const snapshot = this.#forgetSnapshot(connectionId);
      const { stateFingerprint, ...inventory } = snapshot;
      return {
        ...inventory,
        confirmationToken: this.#issueConfirmationPreview(
          "forget",
          canonicalJson([connectionId, forgottenBy]),
          stateFingerprint,
          now.toISOString(),
        ),
        consequence:
          "This permanently deletes every connection version, fact, source report and its fact/admission links, collection attempt, attempt retirement, and record-index resolution in the listed inventory. The deletion record remains, but the deleted payloads cannot be restored by Ecosym. To recover an externally owned fact, reconnect and re-collect from the source that owns it. Source reports no longer available upstream, record-index-mode resolutions, attempt retirements, and retention-history fact versions whose source has moved on are not recoverable.",
        forgottenBy,
      };
    });
  }

  async forget(
    connectionId: string,
    forgottenBy: string,
    exportDigest: string,
    confirmationToken: string,
    now = new Date(),
  ): Promise<ForgetRecord> {
    validateActor(forgottenBy, "forget");
    const forgottenAt = now.toISOString();
    const forget = () => {
      const preview = this.#confirmationPreview(
        "forget",
        canonicalJson([connectionId, forgottenBy]),
        confirmationToken,
      );
      if (preview.consumed_at !== null) {
        throw new ConfirmationAlreadySpentError();
      }
      let snapshot: ForgetSnapshot;
      try {
        snapshot = this.#forgetSnapshot(connectionId);
      } catch (error) {
        if (
          error instanceof ForgetConnectionActiveError ||
          error instanceof ForgetConnectionNotFoundError
        ) {
          throw new ForgetStateChangedError();
        }
        throw error;
      }
      if (preview.state_fingerprint !== snapshot.stateFingerprint) {
        throw new ForgetStateChangedError();
      }
      const evidence = this.#database
        .prepare(
          `SELECT connection_inventories_json
             FROM owned_state_exports
            WHERE export_digest = ?`,
        )
        .get(exportDigest) as undefined | { connection_inventories_json: string };
      const covered = evidence === undefined
        ? undefined
        : parseExportInventories(evidence.connection_inventories_json).find(
            (item) => item.connectionId === connectionId,
          );
      if (covered?.inventoryDigest !== snapshot.inventoryDigest) {
        throw new ForgetExportCoverageError();
      }

      const { stateFingerprint: _stateFingerprint, inventoryDigest, ...inventory } = snapshot;

      this.#database.prepare("DELETE FROM source_reports WHERE connection_id = ?").run(connectionId);
      this.#database.prepare("DELETE FROM facts WHERE connection_id = ?").run(connectionId);
      this.#database
        .prepare("DELETE FROM collection_attempt_retirements WHERE connection_id = ?")
        .run(connectionId);
      this.#database
        .prepare("DELETE FROM record_index_mode_resolutions WHERE connection_id = ?")
        .run(connectionId);
      this.#database
        .prepare("DELETE FROM collection_attempts WHERE connection_id = ?")
        .run(connectionId);
      this.#database
        .prepare("DELETE FROM connection_versions WHERE connection_id = ?")
        .run(connectionId);

      const forgetOrder = (
        this.#database
          .prepare("SELECT COALESCE(MAX(forget_order), 0) + 1 AS next FROM forget_records")
          .get() as { next: number }
      ).next;
      const forgetId = randomUUID();
      const inventoryJson = canonicalJson(inventory as unknown as JsonValue);
      this.#database
        .prepare(
          `INSERT INTO forget_records
             (forget_order, forget_id, connection_id, forgotten_at, forgotten_by,
              inventory_json, inventory_digest, export_digest)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          forgetOrder,
          forgetId,
          connectionId,
          forgottenAt,
          forgottenBy,
          inventoryJson,
          inventoryDigest,
          exportDigest,
        );
      this.#spendConfirmationPreview(confirmationToken, forgottenAt);
      return {
        ...inventory,
        inventoryDigest,
        exportDigest,
        forgetId,
        forgottenAt,
        forgottenBy,
      };
    };
    return this.#retryTransactionWithinContentionBudget(
      { remainingMilliseconds: CONFIRMATION_CONTENTION_BUDGET_MILLISECONDS },
      forget,
    );
  }

  planForgetCivilization(
    civilizationId: string,
    forgottenBy: string,
    now = new Date(),
  ): CivilizationForgetPlan {
    validateActor(forgottenBy, "forget-civilization");
    return this.#transaction(() => {
      const { stateFingerprint, ...inventory } =
        this.#civilizationForgetSnapshot(civilizationId);
      return {
        ...inventory,
        confirmationToken: this.#issueConfirmationPreview(
          "forget-civilization",
          canonicalJson([civilizationId, forgottenBy]),
          stateFingerprint,
          now.toISOString(),
        ),
        consequence:
          "This permanently deletes the named civilization, its entire mandate revision chain, any recorded work claims, and its project intentions, provisioning history, and harness bindings. Project workspace directories and external harness registrations remain untouched. The deletion record remains, but Ecosym cannot restore the civilization's identifiers, revision chain, or recorded instants, and later petition attribution can become unverifiable.",
        forgottenBy,
      };
    });
  }

  async forgetCivilization(
    civilizationId: string,
    forgottenBy: string,
    exportDigest: string,
    confirmationToken: string,
    now = new Date(),
  ): Promise<CivilizationForgetRecord> {
    validateActor(forgottenBy, "forget-civilization");
    const forgottenAt = now.toISOString();
    const forget = () => {
      const preview = this.#confirmationPreview(
        "forget-civilization",
        canonicalJson([civilizationId, forgottenBy]),
        confirmationToken,
      );
      if (preview.consumed_at !== null) {
        throw new ConfirmationAlreadySpentError();
      }
      let snapshot: CivilizationForgetSnapshot;
      try {
        snapshot = this.#civilizationForgetSnapshot(civilizationId);
      } catch (error) {
        if (
          error instanceof ForgetCivilizationNotFoundError ||
          error instanceof ForgetCivilizationNotDissolvedError
        ) {
          throw new ForgetCivilizationStateChangedError();
        }
        throw error;
      }
      if (preview.state_fingerprint !== snapshot.stateFingerprint) {
        throw new ForgetCivilizationStateChangedError();
      }
      const evidence = this.#database
        .prepare(
          `SELECT civilization_inventories_json
             FROM owned_state_exports
            WHERE export_digest = ?`,
        )
        .get(exportDigest) as undefined | { civilization_inventories_json: string };
      const covered = evidence === undefined
        ? undefined
        : parseCivilizationExportInventories(
            evidence.civilization_inventories_json,
          ).find((item) => item.civilizationId === civilizationId);
      if (covered?.inventoryDigest !== snapshot.inventoryDigest) {
        throw new ForgetCivilizationExportCoverageError();
      }

      const { stateFingerprint: _stateFingerprint, inventoryDigest, ...inventory } = snapshot;
      for (const table of ["project_harness_bindings", "project_provisioning_events", "projects"]) {
        this.#database.prepare(`DELETE FROM ${table} WHERE project_id IN
          (SELECT project_id FROM projects WHERE civilization_id = ?)`).run(civilizationId);
      }
      const deletedRevisions = this.#database
        .prepare("DELETE FROM mandate_revisions WHERE civilization_id = ?")
        .run(civilizationId);
      if (numberOfChanges(deletedRevisions) !== snapshot.mandateRevisions.length) {
        throw new ForgetCivilizationStateChangedError();
      }
      const deleted = this.#database
        .prepare("DELETE FROM civilizations WHERE civilization_id = ?")
        .run(civilizationId);
      if (numberOfChanges(deleted) !== 1) {
        throw new ForgetCivilizationStateChangedError();
      }

      const forgetOrder = (
        this.#database
          .prepare(
            `SELECT COALESCE(MAX(forget_order), 0) + 1 AS next
               FROM civilization_forget_records`,
          )
          .get() as { next: number }
      ).next;
      const forgetId = randomUUID();
      this.#database
        .prepare(
          `INSERT INTO civilization_forget_records
             (forget_order, forget_id, civilization_id, forgotten_at, forgotten_by,
              inventory_json, inventory_digest, export_digest)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          forgetOrder,
          forgetId,
          civilizationId,
          forgottenAt,
          forgottenBy,
          canonicalJson(inventory as unknown as JsonValue),
          inventoryDigest,
          exportDigest,
        );
      this.#spendConfirmationPreview(confirmationToken, forgottenAt);
      return {
        ...inventory,
        exportDigest,
        forgetId,
        forgottenAt,
        forgottenBy,
        inventoryDigest,
      };
    };
    return this.#retryTransactionWithinContentionBudget(
      { remainingMilliseconds: CONFIRMATION_CONTENTION_BUDGET_MILLISECONDS },
      forget,
    );
  }

  planRecordIndexModeResolution(
    connectionId: string,
    connectionVersion: string,
    recordIndexMode: JsonlRecordIndexMode,
    now = new Date(),
  ): RecordIndexModeResolutionPlan {
    if (recordIndexMode !== "physical-line" && recordIndexMode !== "record-ordinal") {
      throw new TypeError("A record-index resolution must select a supported mode");
    }
    const issuedAt = now.toISOString();
    return this.#transaction(() => {
      const { stateFingerprint, ...plan } = this.#recordIndexModeResolutionSnapshot(
        connectionId,
        connectionVersion,
        recordIndexMode,
      );
      return {
        ...plan,
        confirmationToken: this.#issueConfirmationPreview(
          "resolve-record-index",
          canonicalJson([connectionId, connectionVersion, recordIndexMode]),
          stateFingerprint,
          issuedAt,
        ),
      };
    });
  }

  async resolveRecordIndexMode(
    connectionId: string,
    connectionVersion: string,
    recordIndexMode: JsonlRecordIndexMode,
    confirmationToken: string,
    now = new Date(),
  ): Promise<RecordIndexModeResolution> {
    if (recordIndexMode !== "physical-line" && recordIndexMode !== "record-ordinal") {
      throw new TypeError("A record-index resolution must select a supported mode");
    }
    const resolvedAt = now.toISOString();
    const resolve = () => {
      const preview = this.#confirmationPreview(
        "resolve-record-index",
        canonicalJson([connectionId, connectionVersion, recordIndexMode]),
        confirmationToken,
      );
      if (preview.consumed_at !== null) {
        throw new ConfirmationAlreadySpentError();
      }
      let snapshot: RecordIndexModeResolutionSnapshot;
      try {
        snapshot = this.#recordIndexModeResolutionSnapshot(
          connectionId,
          connectionVersion,
          recordIndexMode,
        );
      } catch (error) {
        if (error instanceof StoredRecordIndexModeKnownError) {
          throw new RecordIndexResolutionStateChangedError();
        }
        throw error;
      }
      if (preview.state_fingerprint !== snapshot.stateFingerprint) {
        throw new RecordIndexResolutionStateChangedError();
      }
      const updated = this.#database
        .prepare(
          `UPDATE connection_versions
               SET jsonl_record_index_mode = ?
             WHERE connection_id = ? AND config_hash = ?
               AND jsonl_record_index_mode = ?`,
        )
        .run(
          recordIndexMode,
          connectionId,
          connectionVersion,
          snapshot.currentRecordIndexMode,
        );
      if (numberOfChanges(updated) !== 1) {
        throw new RecordIndexResolutionStateChangedError();
      }
      const resolutionOrder = (
        this.#database
          .prepare(
            `SELECT COALESCE(MAX(resolution_order), 0) + 1 AS next
               FROM record_index_mode_resolutions`,
          )
          .get() as { next: number }
      ).next;
      const resolutionId = randomUUID();
      this.#database
        .prepare(
          `INSERT INTO record_index_mode_resolutions
             (resolution_order, resolution_id, connection_id, config_hash,
              previous_mode, record_index_mode, resolved_at,
              affected_fact_ids_json, collection_attempt_ids_json,
              confirmation_token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          resolutionOrder,
          resolutionId,
          connectionId,
          connectionVersion,
          snapshot.currentRecordIndexMode,
          recordIndexMode,
          resolvedAt,
          canonicalJson(snapshot.affectedFactIds),
          canonicalJson(snapshot.collectionAttemptIds),
          confirmationToken,
        );
      this.#spendConfirmationPreview(confirmationToken, resolvedAt);
      return {
        affectedFactIds: snapshot.affectedFactIds,
        collectionAttemptIds: snapshot.collectionAttemptIds,
        collectionAttemptsRecorded: snapshot.collectionAttemptsRecorded,
        connectionId,
        connectionVersion,
        factsAffected: snapshot.factsAffected,
        previousRecordIndexMode: snapshot.currentRecordIndexMode,
        recordIndexMode,
        resolutionId,
        resolvedAt,
      };
    };
    return this.#retryTransactionWithinContentionBudget(
      { remainingMilliseconds: CONFIRMATION_CONTENTION_BUDGET_MILLISECONDS },
      resolve,
    );
  }

  planCollectionAttemptRetirement(
    attemptId: string,
    retiredBy: string,
    now = new Date(),
  ): CollectionAttemptRetirementPlan {
    validateRetirementActor(retiredBy);
    const issuedAt = now.toISOString();
    return this.#transaction(() => {
      const { stateFingerprint, ...plan } =
        this.#collectionAttemptRetirementSnapshot(attemptId, retiredBy);
      return {
        ...plan,
        confirmationToken: this.#issueConfirmationPreview(
          "retire-collection-attempt",
          canonicalJson([attemptId, retiredBy]),
          stateFingerprint,
          issuedAt,
        ),
      };
    });
  }

  async retireCollectionAttempt(
    attemptId: string,
    retiredBy: string,
    confirmationToken: string,
    now = new Date(),
  ): Promise<CollectionAttemptRetirement> {
    validateRetirementActor(retiredBy);
    const retiredAt = now.toISOString();
    const retire = () => {
      const preview = this.#confirmationPreview(
        "retire-collection-attempt",
        canonicalJson([attemptId, retiredBy]),
        confirmationToken,
      );
      if (preview.consumed_at !== null) {
        throw new ConfirmationAlreadySpentError();
      }
      let snapshot: CollectionAttemptRetirementSnapshot;
      try {
        snapshot = this.#collectionAttemptRetirementSnapshot(attemptId, retiredBy);
      } catch (error) {
        if (error instanceof CollectionAttemptNotRunningError) {
          throw new RecordIndexResolutionStateChangedError();
        }
        throw error;
      }
      if (preview.state_fingerprint !== snapshot.stateFingerprint) {
        throw new RecordIndexResolutionStateChangedError();
      }
      const retired = this.#database
        .prepare(
          `UPDATE collection_attempts
              SET completed_at = ?, outcome = 'retired'
            WHERE attempt_id = ? AND outcome = 'running'`,
        )
        .run(retiredAt, attemptId);
      if (numberOfChanges(retired) !== 1) {
        throw new CollectionAttemptNotRunningError(attemptId);
      }
      const retirementOrder = (
        this.#database
          .prepare(
            `SELECT COALESCE(MAX(retirement_order), 0) + 1 AS next
               FROM collection_attempt_retirements`,
          )
          .get() as { next: number }
      ).next;
      const retirementId = randomUUID();
      this.#database
        .prepare(
          `INSERT INTO collection_attempt_retirements
             (retirement_order, retirement_id, attempt_id, connection_id, config_hash,
              retired_at, retired_by, confirmation_token)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          retirementOrder,
          retirementId,
          attemptId,
          snapshot.connectionId,
          snapshot.connectionVersion,
          retiredAt,
          retiredBy,
          confirmationToken,
        );
      this.#spendConfirmationPreview(confirmationToken, retiredAt);
      return {
        attemptId,
        connectionId: snapshot.connectionId,
        connectionVersion: snapshot.connectionVersion,
        retiredAt,
        retiredBy,
        retirementId,
      };
    };
    return this.#retryTransactionWithinContentionBudget(
      { remainingMilliseconds: CONFIRMATION_CONTENTION_BUDGET_MILLISECONDS },
      retire,
    );
  }

  collectionAttempts(): CollectionAttempt[] {
    const rows = this.#database
      .prepare(
        `SELECT attempt_id, connection_id, config_hash, activation_id, started_at,
                completed_at, outcome, source_records_seen, facts_seen, facts_added,
                facts_changed, failure_code
           FROM collection_attempts
          ORDER BY attempt_order`,
      )
      .all() as unknown as CollectionAttemptRow[];
    return rows.map(collectionAttemptFromRow);
  }

  collectionAttemptRetirements(): CollectionAttemptRetirement[] {
    const rows = this.#database
      .prepare(
        `SELECT retirement_id, attempt_id, connection_id, config_hash, retired_at, retired_by
           FROM collection_attempt_retirements
          ORDER BY retirement_order`,
      )
      .all() as unknown as CollectionAttemptRetirementRow[];
    return rows.map((row) => ({
      attemptId: row.attempt_id,
      connectionId: row.connection_id,
      connectionVersion: row.config_hash,
      retiredAt: row.retired_at,
      retiredBy: row.retired_by,
      retirementId: row.retirement_id,
    }));
  }

  getConnection(connectionId: string): ActiveConnection {
    const row = this.#database
      .prepare(
        `SELECT c.config_hash, c.activation_id, c.connected_at, v.config_json,
                v.jsonl_record_index_mode
           FROM active_connections c
           JOIN connection_versions v
             ON v.connection_id = c.connection_id
            AND v.config_hash = c.config_hash
          WHERE c.connection_id = ?`,
      )
      .get(connectionId) as
      | undefined
      | {
          activation_id: string;
          config_hash: string;
          config_json: string;
          connected_at: string;
          jsonl_record_index_mode: string;
        };
    if (row === undefined) {
      throw new ConnectionNotFoundError(connectionId);
    }
    return {
      activationId: row.activation_id,
      config: parseStoredConfig(row.config_json, row.config_hash),
      configHash: row.config_hash,
      connectedAt: row.connected_at,
      jsonlRecordIndexMode: parseJsonlRecordIndexMode(row.jsonl_record_index_mode),
    };
  }

  listConnections(): ActiveConnection[] {
    const rows = this.#database
      .prepare(
        `SELECT c.config_hash, c.activation_id, c.connected_at, v.config_json,
                v.jsonl_record_index_mode
           FROM active_connections c
           JOIN connection_versions v
             ON v.connection_id = c.connection_id
            AND v.config_hash = c.config_hash
          ORDER BY c.connection_id`,
      )
      .all() as {
      activation_id: string;
      config_hash: string;
      config_json: string;
      connected_at: string;
      jsonl_record_index_mode: string;
    }[];
    return rows.map((row) => ({
      activationId: row.activation_id,
      config: parseStoredConfig(row.config_json, row.config_hash),
      configHash: row.config_hash,
      connectedAt: row.connected_at,
      jsonlRecordIndexMode: parseJsonlRecordIndexMode(row.jsonl_record_index_mode),
    }));
  }

  async collect(
    connection: ActiveConnection,
    producer: (sink: CollectionSink) => Promise<void> | void,
    now: () => Date = () => new Date(),
    contentionBudget: ContentionBudget = createCollectionContentionBudget(),
  ): Promise<CollectionResult> {
    const attemptId = randomUUID();
    let sourceRecordsSeen = 0;
    let factsSeen = 0;
    const preparedFacts: PreparedFact[] = [];
    let admitted: { attemptOrder: number; startedAt: string };

    try {
      admitted = await this.#recordRunningAttempt(
        connection,
        attemptId,
        now,
        contentionBudget,
      );
    } catch (error) {
      throw new CollectionFailedError(attemptId, safeFailureCode(error));
    }
    const { attemptOrder, startedAt } = admitted;

    try {
      const declaredConfig = this.#registeredConfig(connection);
      if (declaredConfig.reader.type === "arena") throw new FactNotDeclaredError();
      const sink: CollectionSink = {
        recordSourceRecord: (recordFacts) => {
          sourceRecordsSeen += 1;
          for (const fact of recordFacts()) {
            factsSeen += 1;
            const snapshot = snapshotFact(fact);
            const sourceTimeKey = validateFactAndDeriveSourceTimeKey(
              snapshot,
              declaredConfig,
            );
            const payloadJson = canonicalJson(snapshot.payload);
            preparedFacts.push({
              ...snapshot,
              payloadJson,
              payloadHash: sha256(payloadJson),
              sourceTimeKey,
            });
          }
        },
      };

      await producer(sink);
      const completedAt = now().toISOString();
      const complete = () => {
        let transactionFactsAdded = 0;
        let transactionFactsChanged = 0;
        this.#assertActive(connection);
        this.#assertStoredRecordIndexMode(
          connection,
          connection.jsonlRecordIndexMode,
        );
        const correctionSlots = new Map<string, PreparedFact>();
        for (const fact of preparedFacts) {
          correctionSlots.set(correctionSlotKey(connection.config.id, fact), fact);
        }
        const correctionStateBefore = new Map(
          [...correctionSlots].map(([key, fact]) => [
            key,
            this.#correctionSignature(connection.config.id, fact),
          ]),
        );
        const insert = this.#database.prepare(
          `INSERT INTO facts
             (connection_id, config_hash, attempt_id, fact_owner, kind, subject,
              epistemic_status, source_record_id, source_recorded_at, source_time_key,
              payload_json, payload_hash, collected_at, last_seen_attempt_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (
              connection_id, config_hash, fact_owner, kind, subject,
              epistemic_status, source_record_id, source_time_key, payload_hash
            ) DO NOTHING`,
        );
        const markSeen = this.#database.prepare(
          `UPDATE facts
              SET attempt_id = CASE
                    WHEN last_seen_attempt_order <= ?
                     AND source_recorded_at IS NOT ? THEN ?
                    ELSE attempt_id
                  END,
                  collected_at = CASE
                    WHEN last_seen_attempt_order <= ?
                     AND source_recorded_at IS NOT ? THEN ?
                    ELSE collected_at
                  END,
                  source_recorded_at = CASE
                    WHEN last_seen_attempt_order <= ? THEN ?
                    ELSE source_recorded_at
                  END,
                  last_seen_attempt_order = MAX(last_seen_attempt_order, ?)
            WHERE connection_id = ? AND config_hash = ? AND fact_owner = ?
              AND kind = ? AND subject = ? AND epistemic_status = ?
              AND source_record_id = ? AND source_time_key = ? AND payload_hash = ?`,
        );
        for (const fact of preparedFacts) {
          const result = insert.run(
            connection.config.id,
            connection.configHash,
            attemptId,
            fact.factOwner,
            fact.kind,
            fact.subject,
            fact.epistemicStatus,
            fact.sourceRecordId,
            fact.sourceRecordedAt,
            fact.sourceTimeKey,
            fact.payloadJson,
            fact.payloadHash,
            startedAt,
            attemptOrder,
          );
          if (numberOfChanges(result) === 1) {
            transactionFactsAdded += 1;
          } else {
            markSeen.run(
              attemptOrder,
              fact.sourceRecordedAt,
              attemptId,
              attemptOrder,
              fact.sourceRecordedAt,
              startedAt,
              attemptOrder,
              fact.sourceRecordedAt,
              attemptOrder,
              connection.config.id,
              connection.configHash,
              fact.factOwner,
              fact.kind,
              fact.subject,
              fact.epistemicStatus,
              fact.sourceRecordId,
              fact.sourceTimeKey,
              fact.payloadHash,
            );
          }
        }
        for (const [key, fact] of correctionSlots) {
          if (
            correctionStateBefore.get(key) !==
            this.#correctionSignature(connection.config.id, fact)
          ) {
            transactionFactsChanged += 1;
          }
        }
        const completed = this.#database
          .prepare(
            `UPDATE collection_attempts
                SET completed_at = ?, outcome = 'success', source_records_seen = ?,
                    facts_seen = ?, facts_added = ?, facts_changed = ?
              WHERE attempt_id = ? AND outcome = 'running'`,
          )
          .run(
            completedAt,
            sourceRecordsSeen,
            factsSeen,
            transactionFactsAdded,
            transactionFactsChanged,
            attemptId,
          );
        if (numberOfChanges(completed) !== 1) {
          throw new Error("Collection attempt is not running");
        }
        return {
          factsAdded: transactionFactsAdded,
          factsChanged: transactionFactsChanged,
        };
      };
      const completion = await this.#retryTransactionWithinContentionBudget(
        contentionBudget,
        complete,
      );
      return {
        attemptId,
        completedAt,
        factsAdded: completion.factsAdded,
        factsChanged: completion.factsChanged,
        factsSeen,
        outcome: "success",
        sourceRecordsSeen,
        startedAt,
      };
    } catch (error) {
      let failureCode = safeFailureCode(error);
      const completedAt = now().toISOString();
      try {
        await this.#retryTransactionWithinContentionBudget(contentionBudget, () => {
          this.#database
            .prepare(
              `UPDATE collection_attempts
                  SET completed_at = ?, outcome = 'failed', source_records_seen = ?,
                      facts_seen = ?, facts_added = 0, facts_changed = 0,
                      failure_code = ?
                WHERE attempt_id = ? AND outcome = 'running'`,
            )
            .run(completedAt, sourceRecordsSeen, factsSeen, failureCode, attemptId);
        });
      } catch (recordingError) {
        // A durable running marker still makes the connection unread if failure recording is blocked.
        if (safeFailureCode(recordingError) === "store_contention") {
          failureCode = "store_contention";
        }
      }
      throw new CollectionFailedError(attemptId, failureCode);
    }
  }

  recordSkipped(
    connection: ActiveConnection,
    reason: string,
    now = new Date(),
  ): string {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(reason)) {
      throw new Error("A skipped-attempt reason must be a stable machine code");
    }
    const attemptId = randomUUID();
    const timestamp = now.toISOString();
    this.#transaction(() => {
      this.#assertActive(connection);
      const attemptOrder = this.#nextAttemptOrder();
      this.#database
        .prepare(
          `INSERT INTO collection_attempts
             (attempt_order, attempt_id, connection_id, config_hash, activation_id,
              started_at, completed_at, outcome, source_records_seen, facts_seen,
              facts_added, facts_changed, failure_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'skipped', 0, 0, 0, 0, ?)`,
        )
        .run(
          attemptOrder,
          attemptId,
          connection.config.id,
          connection.configHash,
          connection.activationId,
          timestamp,
          timestamp,
          reason,
        );
    });
    return attemptId;
  }

  statuses(): ConnectionStatus[] {
    const rows = this.#database
      .prepare(
        `SELECT c.connection_id, c.config_hash,
                COALESCE(a.completed_at, a.started_at) AS last_attempt_at,
                a.outcome, a.facts_added, a.facts_changed, v.jsonl_record_index_mode
           FROM active_connections c
           JOIN connection_versions v
             ON v.connection_id = c.connection_id
            AND v.config_hash = c.config_hash
           LEFT JOIN collection_attempts a ON a.attempt_id = (
             SELECT latest.attempt_id
               FROM collection_attempts latest
               WHERE latest.connection_id = c.connection_id
                 AND latest.config_hash = c.config_hash
                 AND latest.activation_id = c.activation_id
               ORDER BY latest.attempt_order DESC
              LIMIT 1
           )
          ORDER BY c.connection_id`,
      )
      .all() as {
      config_hash: string;
      connection_id: string;
      facts_added: null | number;
      facts_changed: null | number;
      jsonl_record_index_mode: string;
      last_attempt_at: null | string;
      outcome: null | "failed" | "retired" | "running" | "skipped" | "success";
    }[];

    return rows.map((row) => {
      const connection = {
        connectionId: row.connection_id,
        connectionVersion: row.config_hash,
      };
      if (row.jsonl_record_index_mode === "unknown") {
        return {
          ...connection,
          lastAttemptAt: row.last_attempt_at,
          reason: "record-index-unknown",
          status: "unread",
        };
      }
      if (row.outcome === null) {
        return {
          ...connection,
          lastAttemptAt: null,
          reason: "never-run",
          status: "unread",
        };
      }
      if (row.outcome === "running") {
        return {
          ...connection,
          lastAttemptAt: row.last_attempt_at,
          reason: "incomplete",
          status: "unread",
        };
      }
      if (
        row.outcome === "failed" ||
        row.outcome === "retired" ||
        row.outcome === "skipped"
      ) {
        return {
          ...connection,
          lastAttemptAt: row.last_attempt_at,
          reason: row.outcome,
          status: "unread",
        };
      }
      if (row.facts_added === 0 && row.facts_changed === 0) {
        return {
          ...connection,
          lastAttemptAt: row.last_attempt_at,
          reason: "nothing-new",
          status: "quiet",
        };
      }
      return {
        ...connection,
        lastAttemptAt: row.last_attempt_at,
        reason: "collected",
        status: "changed",
      };
    });
  }

  recordIndexModeResolutions(): RecordIndexModeResolution[] {
    const rows = this.#database
      .prepare(
        `SELECT resolution_id, connection_id, config_hash, previous_mode,
                record_index_mode, resolved_at, affected_fact_ids_json,
                collection_attempt_ids_json
           FROM record_index_mode_resolutions
          ORDER BY resolution_order`,
      )
      .all() as {
      affected_fact_ids_json: string;
      collection_attempt_ids_json: string;
      config_hash: string;
      connection_id: string;
      previous_mode: string;
      record_index_mode: string;
      resolution_id: string;
      resolved_at: string;
    }[];
    return rows.map((row) => {
      const recordIndexMode = parseJsonlRecordIndexMode(row.record_index_mode);
      const previousRecordIndexMode = parseJsonlRecordIndexMode(row.previous_mode);
      if (recordIndexMode === "unknown") {
        throw new Error("Stored record-index resolution is invalid");
      }
      const affectedFactIds = parseStoredIntegerArray(row.affected_fact_ids_json);
      const collectionAttemptIds = parseStoredStringArray(
        row.collection_attempt_ids_json,
      );
      return {
        affectedFactIds,
        collectionAttemptIds,
        collectionAttemptsRecorded: collectionAttemptIds.length,
        connectionId: row.connection_id,
        connectionVersion: row.config_hash,
        factsAffected: affectedFactIds.length,
        previousRecordIndexMode,
        recordIndexMode,
        resolutionId: row.resolution_id,
        resolvedAt: row.resolved_at,
      };
    });
  }

  forgetRecords(): ForgetRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT forget_id, connection_id, forgotten_at, forgotten_by,
                inventory_json, inventory_digest, export_digest
           FROM forget_records
          ORDER BY forget_order`,
      )
      .all() as {
      connection_id: string;
      export_digest: string;
      forget_id: string;
      forgotten_at: string;
      forgotten_by: string;
      inventory_digest: string;
      inventory_json: string;
    }[];
    return rows.map((row) => ({
      ...parseForgetInventory(row.inventory_json),
      exportDigest: row.export_digest,
      forgetId: row.forget_id,
      forgottenAt: row.forgotten_at,
      forgottenBy: row.forgotten_by,
      inventoryDigest: row.inventory_digest,
    }));
  }

  civilizationForgetRecords(): CivilizationForgetRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT forget_id, civilization_id, forgotten_at, forgotten_by,
                inventory_json, inventory_digest, export_digest
           FROM civilization_forget_records
          ORDER BY forget_order`,
      )
      .all() as {
      civilization_id: string;
      export_digest: string;
      forget_id: string;
      forgotten_at: string;
      forgotten_by: string;
      inventory_digest: string;
      inventory_json: string;
    }[];
    return rows.map((row) => ({
      ...parseCivilizationForgetInventory(row.inventory_json),
      exportDigest: row.export_digest,
      forgetId: row.forget_id,
      forgottenAt: row.forgotten_at,
      forgottenBy: row.forgotten_by,
      inventoryDigest: row.inventory_digest,
    }));
  }

  queryObservations(options: QueryOptions = {}): StoredFact[] {
    return this.#queryFacts("observation", options);
  }

  queryClaims(options: QueryOptions = {}): StoredFact[] {
    return this.#queryFacts("claim", options);
  }

  narrate(limit = 100): NarrationSnapshot {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Narration limit must be an integer from 1 through 1000");
    }
    return this.#readTransaction(() => {
      const connections = this.statuses();

      // Only current activations qualify. Deliberately more conservative than
      // statuses(): an earlier running attempt can remain after a later success
      // on the same activation, so it still makes the picture partial.
      const attemptsInProgress = this.#database
        .prepare(
          `SELECT ca.attempt_id, ca.connection_id, ca.config_hash, ca.started_at
             FROM collection_attempts ca
             JOIN active_connections ac
               ON ac.connection_id = ca.connection_id
              AND ac.config_hash = ca.config_hash
              AND ac.activation_id = ca.activation_id
            WHERE ca.outcome = 'running'
            ORDER BY ca.started_at, ca.attempt_id`,
        )
        .all() as { attempt_id: string; connection_id: string; config_hash: string; started_at: string }[];

      // Facts have no activation_id: same-config reconnects can retain prior
      // activation facts. Their never-run connection status still makes the
      // picture partial; activeOnly is not statuses()'s three-key scoping.
      const observations = this.queryObservations({ activeOnly: true, limit, order: "desc" });
      const claims = this.queryClaims({ activeOnly: true, limit, order: "desc" });
      const observationsTotal = this.#countMatchingFacts("observation", { activeOnly: true });
      const claimsTotal = this.#countMatchingFacts("claim", { activeOnly: true });

      return {
        connections,
        sourceReports: this.#sourceReports(),
        attemptsInProgress: attemptsInProgress.map((row) => ({
          attemptId: row.attempt_id,
          connectionId: row.connection_id,
          connectionVersion: row.config_hash,
          startedAt: row.started_at,
        })),
        observations,
        observationsTruncated: observationsTotal > observations.length,
        claims,
        claimsTruncated: claimsTotal > claims.length,
      };
    });
  }

  countFacts(connectionId?: string): number {
    if (connectionId === undefined) {
      const row = this.#database.prepare("SELECT count(*) AS count FROM facts").get() as {
        count: number;
      };
      return row.count;
    }
    const row = this.#database
      .prepare("SELECT count(*) AS count FROM facts WHERE connection_id = ?")
      .get(connectionId) as { count: number };
    return row.count;
  }

  assertConnectionActive(connection: ActiveConnection): void {
    this.#assertActive(connection);
  }

  assertConnectionRecordIndexMode(
    connection: ActiveConnection,
    expectedMode: JsonlRecordIndexMode,
  ): void {
    this.#assertActive(connection);
    this.#assertStoredRecordIndexMode(connection, expectedMode);
  }

  factsForVerification(connection: ActiveConnection): VerificationSnapshot {
    this.#assertActive(connection);
    const snapshot = this.#readTransaction(() => this.#verificationSnapshot(connection));
    this.#assertActive(connection);
    return snapshot;
  }

  async resolveRecordIndexModeFromEquivalentFacts(
    connection: ActiveConnection,
    physicalLineFacts: readonly (readonly FactInput[])[],
    recordOrdinalFacts: readonly (readonly FactInput[])[],
    sourceMatchesRevision: () => boolean,
    contentionBudget?: ContentionBudget,
  ): Promise<boolean> {
    const resolve = () => {
      this.#assertActive(connection);
      if (this.#storedRecordIndexMode(connection) !== "unknown") {
        return true;
      }
      const config = this.#registeredConfig(connection);
      if (!usesJsonlRecordIndex(config)) {
        return false;
      }
      if (!sourceMatchesRevision()) {
        throw new SourceRevisionChangedError();
      }
      if (physicalLineFacts.length !== recordOrdinalFacts.length) {
        return false;
      }
      const agreedFactPositions = new Map<string, number>();
      for (let index = 0; index < physicalLineFacts.length; index += 1) {
        const physicalLines = verificationFactsFromInputs(physicalLineFacts[index]!, config);
        const recordOrdinals = verificationFactsFromInputs(recordOrdinalFacts[index]!, config);
        if (sameVerificationFactSet(physicalLines, recordOrdinals)) {
          for (const fact of physicalLines) {
            const key = verificationFactKey(fact);
            const existingPosition = agreedFactPositions.get(key);
            if (existingPosition !== undefined && existingPosition !== index) {
              return false;
            }
            agreedFactPositions.set(key, index);
          }
        }
      }
      const snapshot = this.#verificationSnapshot(connection);
      const storedFactPositions = new Set<number>();
      if (
        !snapshot.payloadHashesValid ||
        !snapshot.sourceTimeKeysValid ||
        !snapshot.facts.every((fact) => {
          const position = agreedFactPositions.get(verificationFactKey(fact));
          if (position === undefined) {
            return false;
          }
          storedFactPositions.add(position);
          return true;
        }) ||
        ![...storedFactPositions].every((position) => position < storedFactPositions.size)
      ) {
        return false;
      }
      const updated = this.#database
        .prepare(
          `UPDATE connection_versions
              SET jsonl_record_index_mode = 'record-ordinal'
            WHERE connection_id = ? AND config_hash = ?
              AND jsonl_record_index_mode = 'unknown'`,
        )
        .run(connection.config.id, connection.configHash);
      if (!sourceMatchesRevision()) {
        throw new SourceRevisionChangedError();
      }
      return numberOfChanges(updated) === 1;
    };
    return contentionBudget === undefined
      ? this.#transaction(resolve)
      : this.#retryTransactionWithinContentionBudget(contentionBudget, resolve);
  }

  #verificationSnapshot(connection: ActiveConnection): VerificationSnapshot {
    const jsonlRecordIndexMode = this.#storedRecordIndexMode(connection);
    const currentness = this.#database
      .prepare(
        `SELECT NOT EXISTS (
           SELECT 1
             FROM facts f
            WHERE f.connection_id = ? AND f.config_hash = ?
              AND (
                SELECT MAX(known.last_seen_attempt_order)
                  FROM facts known
                 WHERE known.connection_id = f.connection_id
                   AND known.fact_owner = f.fact_owner
                   AND known.kind = f.kind
                   AND known.subject = f.subject
                   AND known.epistemic_status = f.epistemic_status
                   AND known.source_record_id = f.source_record_id
                   AND known.source_time_key = f.source_time_key
              ) = 0
         ) AS known`,
      )
      .get(connection.config.id, connection.configHash) as { known: number };
    const integrityRows = this.#database
      .prepare(
        `SELECT source_recorded_at, source_time_key, payload_json, payload_hash,
                EXISTS (SELECT 1 FROM source_report_facts r WHERE r.fact_id = f.fact_id) AS source_reported
           FROM facts f
          WHERE connection_id = ?`,
      )
      .all(connection.config.id) as Record<string, unknown>[];
    let payloadHashesValid = true;
    let sourceTimeKeysValid = true;
    for (const record of integrityRows) {
      const expectedSourceTimeKey =
        record.source_recorded_at === null
          ? ""
          : record.source_reported === 1
            ? sourceReportFactTimeKey(record.source_recorded_at)
            : utcInstantOrderingKey(record.source_recorded_at);
      if (
        expectedSourceTimeKey === null ||
        expectedSourceTimeKey !== record.source_time_key
      ) {
        sourceTimeKeysValid = false;
      }
      if (
        typeof record.payload_json !== "string" ||
        record.payload_hash !== sha256(record.payload_json)
      ) {
        payloadHashesValid = false;
      }
    }
    const facts = this.#database
      .prepare(
        `SELECT f.epistemic_status, f.fact_owner, f.kind, f.subject,
                f.source_record_id, f.source_recorded_at, f.payload_hash
           FROM facts f
          WHERE f.connection_id = ? AND f.config_hash = ?
            AND f.last_seen_attempt_order = (
              SELECT MAX(current.last_seen_attempt_order)
                FROM facts current
               WHERE current.fact_owner = f.fact_owner
                 AND current.connection_id = f.connection_id
                 AND current.kind = f.kind
                 AND current.subject = f.subject
                 AND current.epistemic_status = f.epistemic_status
                 AND current.source_record_id = f.source_record_id
                 AND current.source_time_key = f.source_time_key
            )
          ORDER BY f.fact_id`,
      )
      .all(connection.config.id, connection.configHash)
      .map((row) => {
        const record = row as Record<string, unknown>;
        return {
          epistemicStatus: record.epistemic_status as EpistemicStatus,
          factOwner: record.fact_owner as string,
          kind: record.kind as string,
          payloadHash: record.payload_hash as string,
          sourceRecordedAt: record.source_recorded_at as null | string,
          sourceRecordId: record.source_record_id as string,
          subject: record.subject as string,
        };
      });
    return {
      currentnessKnown: currentness.known === 1,
      facts,
      jsonlRecordIndexMode,
      payloadHashesValid,
      sourceTimeKeysValid,
    };
  }

  #factFilters(epistemicStatus: EpistemicStatus, options: QueryOptions): {
    conditions: string[];
    parameters: (number | string)[];
  } {
    const conditions = ["f.epistemic_status = ?"];
    const parameters: (number | string)[] = [epistemicStatus];
    addFilter(conditions, parameters, "f.fact_id > ?", options.afterId);
    addFilter(conditions, parameters, "f.connection_id = ?", options.connectionId);
    addFilter(conditions, parameters, "f.fact_owner = ?", options.factOwner);
    addFilter(conditions, parameters, "f.kind = ?", options.kind);
    addFilter(conditions, parameters, "f.subject = ?", options.subject);
    if (options.activeOnly === true) {
      conditions.push(
        "EXISTS (SELECT 1 FROM active_connections ac WHERE ac.connection_id = f.connection_id AND ac.config_hash = f.config_hash)",
      );
    }
    return { conditions, parameters };
  }

  #countMatchingFacts(epistemicStatus: EpistemicStatus, options: QueryOptions): number {
    const { conditions, parameters } = this.#factFilters(epistemicStatus, options);
    const row = this.#database
      .prepare(`SELECT COUNT(*) AS total FROM facts f WHERE ${conditions.join(" AND ")}`)
      .get(...parameters) as { total: number };
    return row.total;
  }

  #queryFacts(
    epistemicStatus: EpistemicStatus,
    options: QueryOptions,
  ): StoredFact[] {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Query limit must be an integer from 1 through 1000");
    }
    const { conditions, parameters } = this.#factFilters(epistemicStatus, options);
    parameters.push(limit);

    const rows = this.#database
      .prepare(
        `SELECT f.fact_id, f.connection_id, f.config_hash, f.fact_owner, f.kind,
                f.subject, f.epistemic_status, f.source_record_id,
                f.source_recorded_at, f.payload_json, f.collected_at,
                collected.attempt_id AS as_of_attempt_id,
                collected.activation_id AS as_of_activation_id,
                collected.started_at AS as_of_started_at,
                collected.completed_at AS as_of_completed_at,
                CASE
                  WHEN collected.attempt_order > f.last_seen_attempt_order THEN 'historical'
                  WHEN f.source_recorded_at IS NULL THEN 'unknown'
                  WHEN EXISTS (
                    SELECT 1 FROM facts newer
                     WHERE newer.connection_id = f.connection_id
                       AND newer.fact_owner = f.fact_owner
                       AND newer.kind = f.kind
                       AND newer.subject = f.subject
                        AND newer.epistemic_status = f.epistemic_status
                        AND newer.source_time_key > f.source_time_key
                  ) THEN 'historical'
                  WHEN (
                    SELECT MAX(known.last_seen_attempt_order)
                     FROM facts known
                     WHERE known.connection_id = f.connection_id
                       AND known.fact_owner = f.fact_owner
                       AND known.kind = f.kind
                       AND known.subject = f.subject
                       AND known.epistemic_status = f.epistemic_status
                       AND known.source_record_id = f.source_record_id
                       AND known.source_time_key = f.source_time_key
                  ) = 0 THEN 'unknown'
                  WHEN (
                    SELECT COUNT(*)
                      FROM facts tied
                     WHERE tied.connection_id = f.connection_id
                       AND tied.fact_owner = f.fact_owner
                       AND tied.kind = f.kind
                       AND tied.subject = f.subject
                       AND tied.epistemic_status = f.epistemic_status
                       AND tied.source_record_id = f.source_record_id
                       AND tied.source_time_key = f.source_time_key
                       AND tied.last_seen_attempt_order = (
                         SELECT MAX(latest.last_seen_attempt_order)
                           FROM facts latest
                          WHERE latest.connection_id = f.connection_id
                            AND latest.fact_owner = f.fact_owner
                            AND latest.kind = f.kind
                            AND latest.subject = f.subject
                            AND latest.epistemic_status = f.epistemic_status
                            AND latest.source_record_id = f.source_record_id
                            AND latest.source_time_key = f.source_time_key
                       )
                  ) > 1 THEN 'unknown'
                  WHEN EXISTS (
                    SELECT 1 FROM facts corrected
                     WHERE corrected.connection_id = f.connection_id
                       AND corrected.fact_owner = f.fact_owner
                       AND corrected.kind = f.kind
                       AND corrected.subject = f.subject
                       AND corrected.epistemic_status = f.epistemic_status
                       AND corrected.source_record_id = f.source_record_id
                       AND corrected.source_time_key = f.source_time_key
                       AND corrected.last_seen_attempt_order > f.last_seen_attempt_order
                  ) THEN 'historical'
                  ELSE 'current'
                END AS temporal_status
           FROM facts f
           ${FACT_COLLECTION_AS_OF_JOIN}
          WHERE ${conditions.join(" AND ")}
          ORDER BY f.fact_id${options.order === "desc" ? " DESC" : ""}
          LIMIT ?`,
      )
      .all(...parameters) as unknown as StoredFactRow[];

    if (rows.length === 0) return [];
    const provenanceRows = this.#database.prepare(`
      SELECT fact_id, report_id, epistemic_type FROM (
        SELECT f.fact_id, f.report_id, f.epistemic_type,
               ROW_NUMBER() OVER (PARTITION BY f.fact_id ORDER BY a.admission_order DESC) AS rank
          FROM source_report_facts f
          JOIN source_report_admissions a ON a.report_id = f.report_id
         WHERE f.fact_id IN (${rows.map(() => "?").join(", ")})
      ) WHERE rank = 1`).all(...rows.map((row) => row.fact_id)) as {
        fact_id: number;
        report_id: string;
        epistemic_type: SourceReportProvenance["epistemicType"];
      }[];
    const provenanceByFact = new Map(provenanceRows.map((row) => [row.fact_id, {
      reportId: row.report_id, epistemicType: row.epistemic_type,
    }]));
    return rows.map((row) => {
      const fact = storedFactFromRow(row);
      const sourceReport = provenanceByFact.get(fact.id);
      return sourceReport === undefined ? fact : { ...fact, sourceReport };
    });
  }

  #migrate(): void {
    const version = this.#database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (version.user_version === STORE_SCHEMA_VERSION) {
      return;
    }
    if (version.user_version === 15) {
      this.#transaction(() => {
        this.#database.exec(CREATE_SOURCE_REPORTS);
        this.#database.exec("PRAGMA user_version = 16");
      });
      this.#migrate();
      return;
    }
    if (version.user_version === 16) {
      this.#transaction(() => {
        this.#database.exec(CREATE_PROJECTS);
        this.#database.exec("PRAGMA user_version = 17");
      });
      return;
    }
    if (version.user_version === 13) {
      this.#migrateSchemaThirteen();
      return;
    }
    if (version.user_version === 14) {
      this.#migrateSchemaFourteen();
      return;
    }
    if (version.user_version === 12) {
      this.#transaction(() => {
        this.#database.exec(`
          ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v12;
          ${CREATE_CONFIRMATION_PREVIEWS}
          INSERT INTO confirmation_previews
            SELECT * FROM confirmation_previews_v12;
          DROP TABLE confirmation_previews_v12;
          ${CREATE_INSTITUTION}
          ${CREATE_OWNED_STATE_EXPORTS}
          ${CREATE_FORGET_RECORDS}
          PRAGMA user_version = 13;
        `);
      });
      this.#migrateSchemaThirteen();
      return;
    }
    if (version.user_version === 11) {
      this.#transaction(() => {
        this.#database.exec(`
          ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v11;
          ${CREATE_CONFIRMATION_PREVIEWS}
          INSERT INTO confirmation_previews
            SELECT * FROM confirmation_previews_v11;
          DROP TABLE confirmation_previews_v11;
          ${CREATE_INSTITUTION}
          ${CREATE_OWNED_STATE_EXPORTS}
          ${CREATE_FORGET_RECORDS}
          PRAGMA user_version = 13;
        `);
      });
      this.#migrateSchemaThirteen();
      return;
    }
    if (version.user_version === 10) {
      this.#transaction(() => {
        this.#database.exec(`
          ${CREATE_CONFIRMATION_PREVIEWS}
          ${CREATE_INSTITUTION}
          ${CREATE_OWNED_STATE_EXPORTS}
          ${CREATE_FORGET_RECORDS}
          PRAGMA user_version = 13;
        `);
      });
      this.#migrateSchemaThirteen();
      return;
    }
    if (version.user_version === 9) {
      this.#migrateSchemaNine();
      return;
    }
    this.#transaction(() => {
      const row = this.#database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (row.user_version === STORE_SCHEMA_VERSION) {
        return;
      }
      if (row.user_version === 8) {
        this.#database.exec(`
          ${CREATE_RECORD_INDEX_MODE_RESOLUTIONS}
          PRAGMA user_version = ${LEGACY_REBUILD_SCHEMA_VERSION};
        `);
        return;
      }
      // Schema 7 was the rejected candidate that guessed a mode for schema-six rows.
      if (row.user_version === 7) {
        throw new Error(
          "Observation store schema 7 does not record a trustworthy JSONL record-index mode",
        );
      }
      if (
        row.user_version !== 0 &&
        row.user_version !== 1 &&
        row.user_version !== 2 &&
        row.user_version !== 3 &&
        row.user_version !== 4 &&
        row.user_version !== 5 &&
        row.user_version !== 6
      ) {
        throw new Error(`Unsupported observation store schema ${row.user_version}`);
      }
      if (row.user_version === 0) {
        this.#database.exec(`
        CREATE TABLE connection_versions (
          connection_id TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          config_json TEXT NOT NULL,
          registered_at TEXT NOT NULL,
          jsonl_record_index_mode TEXT NOT NULL DEFAULT 'record-ordinal'
            CHECK (jsonl_record_index_mode IN ('physical-line', 'record-ordinal', 'unknown')),
          PRIMARY KEY (connection_id, config_hash)
        ) STRICT;

        CREATE TABLE active_connections (
          connection_id TEXT PRIMARY KEY,
          config_hash TEXT NOT NULL,
          activation_id TEXT NOT NULL,
          connected_at TEXT NOT NULL,
          FOREIGN KEY (connection_id, config_hash)
            REFERENCES connection_versions(connection_id, config_hash)
        ) STRICT;

        ${CREATE_RECORD_INDEX_MODE_RESOLUTIONS}

        ${CREATE_CONFIRMATION_PREVIEWS}

        ${CREATE_INSTITUTION}
        ${CREATE_WORK_CLAIMS}
        ${CREATE_PROJECTS}
        ${CREATE_OWNED_STATE_EXPORTS}
        ${CREATE_FORGET_RECORDS}
        ${CREATE_CIVILIZATION_FORGET_RECORDS}

        ${CREATE_COLLECTION_ATTEMPTS}
        ${CREATE_SOURCE_REPORTS}
        ${CREATE_COLLECTION_ATTEMPTS_LATEST_INDEX}
        ${CREATE_COLLECTION_ATTEMPT_RETIREMENTS}

        CREATE TABLE facts (
          fact_id INTEGER PRIMARY KEY,
          connection_id TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          attempt_id TEXT NOT NULL,
          fact_owner TEXT NOT NULL,
          kind TEXT NOT NULL,
          subject TEXT NOT NULL,
          epistemic_status TEXT NOT NULL CHECK (epistemic_status IN ('observation', 'claim')),
          source_record_id TEXT NOT NULL,
          source_recorded_at TEXT,
          source_time_key TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          payload_hash TEXT NOT NULL,
          collected_at TEXT NOT NULL,
          last_seen_attempt_order INTEGER NOT NULL,
          FOREIGN KEY (attempt_id) REFERENCES collection_attempts(attempt_id),
          FOREIGN KEY (connection_id, config_hash)
            REFERENCES connection_versions(connection_id, config_hash),
          UNIQUE (
            connection_id, config_hash, fact_owner, kind, subject,
            epistemic_status, source_record_id, source_time_key, payload_hash
          )
        ) STRICT;

        CREATE INDEX facts_query
          ON facts(epistemic_status, fact_id);
        CREATE INDEX facts_identity_time
          ON facts(fact_owner, kind, subject, epistemic_status, source_recorded_at);
        CREATE INDEX facts_identity_source_time
          ON facts(
            connection_id, fact_owner, kind, subject, epistemic_status,
            source_time_key
          );
        CREATE INDEX facts_source_version
          ON facts(connection_id, config_hash, source_record_id, source_time_key);
        CREATE INDEX facts_correction_slot
          ON facts(
            connection_id, fact_owner, kind, subject, epistemic_status,
            source_record_id, source_time_key, last_seen_attempt_order
          );

        PRAGMA user_version = ${STORE_SCHEMA_VERSION};
      `);
        return;
      }

      if (row.user_version === 6) {
        this.#database.exec(`
          ALTER TABLE connection_versions ADD COLUMN jsonl_record_index_mode TEXT
            NOT NULL DEFAULT 'unknown'
            CHECK (jsonl_record_index_mode IN ('physical-line', 'record-ordinal', 'unknown'));
        `);
        const versions = this.#database
          .prepare("SELECT connection_id, config_hash, config_json FROM connection_versions")
          .all() as {
          config_hash: string;
          config_json: string;
          connection_id: string;
        }[];
        const hasFacts = this.#database.prepare(
          `SELECT EXISTS (
             SELECT 1 FROM facts WHERE connection_id = ? AND config_hash = ?
           ) AS stored`,
        );
        const updateMode = this.#database.prepare(
          `UPDATE connection_versions SET jsonl_record_index_mode = ?
            WHERE connection_id = ? AND config_hash = ?`,
        );
        for (const version of versions) {
          const config = parseStoredConfig(version.config_json, version.config_hash);
          const stored = hasFacts.get(version.connection_id, version.config_hash) as {
            stored: number;
          };
          const mode =
            stored.stored === 1 && usesJsonlRecordIndex(config)
              ? "unknown"
              : "record-ordinal";
          updateMode.run(mode, version.connection_id, version.config_hash);
        }
        this.#database.exec(`
          ${CREATE_RECORD_INDEX_MODE_RESOLUTIONS}
          PRAGMA user_version = ${LEGACY_REBUILD_SCHEMA_VERSION};
        `);
        return;
      }

      if (row.user_version === 5) {
        this.#database.exec(`
          CREATE INDEX facts_identity_source_time
            ON facts(
              connection_id, fact_owner, kind, subject, epistemic_status,
              source_time_key
            );
          ALTER TABLE connection_versions ADD COLUMN jsonl_record_index_mode TEXT
            NOT NULL DEFAULT 'physical-line'
            CHECK (jsonl_record_index_mode IN ('physical-line', 'record-ordinal', 'unknown'));
          ${CREATE_RECORD_INDEX_MODE_RESOLUTIONS}
          PRAGMA user_version = ${LEGACY_REBUILD_SCHEMA_VERSION};
        `);
        return;
      }

      if (row.user_version === 1 || row.user_version === 2) {
        this.#database.exec(`
          ALTER TABLE collection_attempts ADD COLUMN attempt_order INTEGER;
          UPDATE collection_attempts SET attempt_order = rowid;
          CREATE UNIQUE INDEX collection_attempts_order
            ON collection_attempts(attempt_order);
          DROP INDEX collection_attempts_latest;
          ALTER TABLE active_connections
            ADD COLUMN activation_id TEXT NOT NULL DEFAULT '';
          ALTER TABLE collection_attempts
            ADD COLUMN activation_id TEXT NOT NULL DEFAULT '';
        `);

        const pairs = this.#database
          .prepare(
            `SELECT connection_id, config_hash FROM active_connections
             UNION
             SELECT connection_id, config_hash FROM collection_attempts`,
          )
          .all() as { config_hash: string; connection_id: string }[];
        const updateActive = this.#database.prepare(
          `UPDATE active_connections SET activation_id = ?
            WHERE connection_id = ? AND config_hash = ?`,
        );
        const updateAttempts = this.#database.prepare(
          `UPDATE collection_attempts SET activation_id = ?
            WHERE connection_id = ? AND config_hash = ?`,
        );
        for (const pair of pairs) {
          const suffix = sha256(canonicalJson([pair.connection_id, pair.config_hash]));
          updateActive.run(
            `legacy-current:${suffix}`,
            pair.connection_id,
            pair.config_hash,
          );
          updateAttempts.run(
            `legacy-history:${suffix}`,
            pair.connection_id,
            pair.config_hash,
          );
        }
      }

      if (row.user_version === 1) {
        this.#database.exec(`
          ALTER TABLE facts
            ADD COLUMN last_seen_attempt_order INTEGER NOT NULL DEFAULT 0;
          UPDATE facts AS target
             SET last_seen_attempt_order = COALESCE(
               (SELECT attempt_order
                  FROM collection_attempts
                 WHERE collection_attempts.attempt_id = target.attempt_id),
               0
             )
           WHERE NOT EXISTS (
              SELECT 1
               FROM facts other
              WHERE other.fact_id <> target.fact_id
                AND other.connection_id = target.connection_id
                AND other.fact_owner = target.fact_owner
                 AND other.kind = target.kind
                AND other.subject = target.subject
                AND other.epistemic_status = target.epistemic_status
                AND other.source_record_id = target.source_record_id
                AND other.source_time_key = target.source_time_key
           );
        `);
      } else if (row.user_version === 2) {
        this.#database.exec(`
          UPDATE facts AS target
             SET last_seen_attempt_order = 0
           WHERE EXISTS (
              SELECT 1
               FROM facts other
              WHERE other.fact_id <> target.fact_id
                AND other.connection_id = target.connection_id
                AND other.fact_owner = target.fact_owner
                 AND other.kind = target.kind
                AND other.subject = target.subject
                AND other.epistemic_status = target.epistemic_status
                AND other.source_record_id = target.source_record_id
                AND other.source_time_key = target.source_time_key
           );
        `);
      }

      if (row.user_version <= 3) {
        this.#database.exec(`
          ALTER TABLE collection_attempts
            ADD COLUMN facts_changed INTEGER NOT NULL DEFAULT 0;
          UPDATE collection_attempts AS attempt
             SET facts_changed = CASE
               WHEN attempt.facts_added > 0 THEN attempt.facts_added
               WHEN attempt.outcome = 'success' AND EXISTS (
                 SELECT 1
                   FROM facts current
                  WHERE current.last_seen_attempt_order = attempt.attempt_order
                    AND current.connection_id = attempt.connection_id
                    AND EXISTS (
                      SELECT 1
                        FROM facts other
                       WHERE other.connection_id = current.connection_id
                         AND other.fact_owner = current.fact_owner
                         AND other.kind = current.kind
                         AND other.subject = current.subject
                         AND other.epistemic_status = current.epistemic_status
                         AND other.source_record_id = current.source_record_id
                         AND other.source_time_key = current.source_time_key
                         AND other.payload_hash <> current.payload_hash
                         AND other.last_seen_attempt_order < current.last_seen_attempt_order
                    )
               ) THEN 1
               ELSE 0
             END;
        `);
      }
      if (row.user_version === 1 || row.user_version === 2) {
        this.#database.exec(`
          CREATE INDEX collection_attempts_latest
            ON collection_attempts(
              connection_id, config_hash, activation_id, attempt_order DESC
            );
        `);
      }
      this.#database.exec(`
        CREATE INDEX facts_correction_slot
          ON facts(
            connection_id, fact_owner, kind, subject, epistemic_status,
            source_record_id, source_time_key, last_seen_attempt_order
          );
      `);
      const activeRows = this.#database
        .prepare(
          "SELECT connection_id, config_hash, activation_id FROM active_connections",
        )
        .all() as {
        activation_id: string;
        config_hash: string;
        connection_id: string;
      }[];
      const resetActivation = this.#database.prepare(
        "UPDATE active_connections SET activation_id = ? WHERE connection_id = ?",
      );
      for (const active of activeRows) {
        const activationId = `migration-v5:${sha256(
          canonicalJson([
            active.connection_id,
            active.config_hash,
            active.activation_id,
          ]),
        )}`;
        resetActivation.run(activationId, active.connection_id);
      }
      this.#database.exec(`
        ALTER TABLE connection_versions ADD COLUMN jsonl_record_index_mode TEXT
          NOT NULL DEFAULT 'physical-line'
          CHECK (jsonl_record_index_mode IN ('physical-line', 'record-ordinal', 'unknown'));
        CREATE INDEX facts_identity_source_time
          ON facts(
            connection_id, fact_owner, kind, subject, epistemic_status,
            source_time_key
          );
        ${CREATE_RECORD_INDEX_MODE_RESOLUTIONS}
        PRAGMA user_version = ${LEGACY_REBUILD_SCHEMA_VERSION};
      `);
    });
    if (version.user_version !== 0) {
      this.#migrateSchemaNine();
    }
  }

  #migrateSchemaNine(): void {
    this.#database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.#transaction(() => {
        this.#database.exec(
          CREATE_COLLECTION_ATTEMPTS.replace(
            "CREATE TABLE collection_attempts",
            "CREATE TABLE collection_attempts_replacement",
          ),
        );
        this.#database.exec(`
          INSERT INTO collection_attempts_replacement (
            attempt_order, attempt_id, connection_id, config_hash, activation_id,
            started_at, completed_at, outcome, source_records_seen, facts_seen,
            facts_added, facts_changed, failure_code
          )
          SELECT
            attempt_order, attempt_id, connection_id, config_hash, activation_id,
            started_at, completed_at, outcome, source_records_seen, facts_seen,
            facts_added, facts_changed, failure_code
          FROM collection_attempts;
          DROP TABLE collection_attempts;
          ALTER TABLE collection_attempts_replacement RENAME TO collection_attempts;
        `);
        this.#database.exec(CREATE_COLLECTION_ATTEMPTS_LATEST_INDEX);
        this.#database.exec(CREATE_COLLECTION_ATTEMPT_RETIREMENTS);
        this.#database.exec(CREATE_CONFIRMATION_PREVIEWS);
        this.#database.exec(CREATE_INSTITUTION);
        this.#database.exec(CREATE_OWNED_STATE_EXPORTS);
        this.#database.exec(CREATE_FORGET_RECORDS);
        this.#database.exec(CREATE_CIVILIZATION_FORGET_RECORDS);
        this.#database.exec("PRAGMA user_version = 14");
      });
    } finally {
      this.#database.exec("PRAGMA foreign_keys = ON");
    }
    this.#migrateSchemaFourteen();
  }

  #migrateSchemaThirteen(): void {
    const columns = this.#database.prepare("PRAGMA table_info(owned_state_exports)").all() as {
      name: string;
    }[];
    this.#transaction(() => {
      this.#database.exec(`
        ALTER TABLE confirmation_previews RENAME TO confirmation_previews_v13;
        ${CREATE_CONFIRMATION_PREVIEWS}
        INSERT INTO confirmation_previews SELECT * FROM confirmation_previews_v13;
        DROP TABLE confirmation_previews_v13;
      `);
      if (!columns.some((column) => column.name === "civilization_inventories_json")) {
        this.#database.exec(
          "ALTER TABLE owned_state_exports ADD COLUMN civilization_inventories_json TEXT NOT NULL DEFAULT '[]'",
        );
      }
      this.#database.exec(CREATE_CIVILIZATION_FORGET_RECORDS);
      this.#database.exec("PRAGMA user_version = 14");
    });
    this.#migrateSchemaFourteen();
  }

  #migrateSchemaFourteen(): void {
    this.#transaction(() => {
      this.#database.exec(CREATE_WORK_CLAIMS);
      this.#database.exec(CREATE_SOURCE_REPORTS);
      this.#database.exec("PRAGMA user_version = 16");
    });
    this.#migrate();
  }

  #assertActive(connection: ActiveConnection): void {
    const active = this.#database
      .prepare(
        "SELECT config_hash, activation_id FROM active_connections WHERE connection_id = ?",
      )
      .get(connection.config.id) as
      | undefined
      | { activation_id: string; config_hash: string };
    if (
      active?.config_hash !== connection.configHash ||
      active.activation_id !== connection.activationId
    ) {
      throw new ConnectionInactiveError(connection.config.id);
    }
  }

  #registeredConfig(connection: ActiveConnection): ConnectionConfig {
    const row = this.#database
      .prepare(
        `SELECT config_json
           FROM connection_versions
          WHERE connection_id = ? AND config_hash = ?`,
      )
      .get(connection.config.id, connection.configHash) as undefined | { config_json: string };
    if (row === undefined) {
      throw new Error("Registered connection configuration is missing");
    }
    return parseStoredConfig(row.config_json, connection.configHash);
  }

  #ownedInstitutionState(): OwnedStateBundle["institutionStore"] {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      ...this.#projectExport(),
      civilizations: this.#exportRows(
        `SELECT civilization_id AS civilizationId, name, founded_at AS foundedAt
           FROM civilizations ORDER BY civilization_id`,
      ),
      civilizationForgetRecords: this.#database
        .prepare(
          `SELECT forget_order, forget_id, civilization_id, forgotten_at,
                  forgotten_by, inventory_json, inventory_digest, export_digest
             FROM civilization_forget_records ORDER BY forget_order`,
        )
        .all()
        .map((value) => {
          const row = value as Record<string, JsonValue> & { inventory_json: string };
          return {
            forgetOrder: row.forget_order,
            forgetId: row.forget_id,
            civilizationId: row.civilization_id,
            forgottenAt: row.forgotten_at,
            forgottenBy: row.forgotten_by,
            inventory: JSON.parse(row.inventory_json) as JsonValue,
            inventoryDigest: row.inventory_digest,
            exportDigest: row.export_digest,
          } as Record<string, JsonValue>;
        }),
      mandateRevisions: this.#database
        .prepare(
          `SELECT revision_order, civilization_id, mandate_id, revision,
                  previous_revision, status, mandate_json, mandate_digest, recorded_at
             FROM mandate_revisions ORDER BY revision_order`,
        )
        .all()
        .map((value) => {
          const row = value as Record<string, JsonValue> & {
            civilization_id: string;
            mandate_digest: string;
            mandate_json: string;
          };
          const mandate = parseStoredMandate(row.mandate_json, row.civilization_id);
          const derivedDigest = mandateDigest(mandate as unknown as JsonValue);
          if (derivedDigest !== row.mandate_digest) {
            throw new MandateUnreadableError(row.civilization_id);
          }
          return {
            revisionOrder: row.revision_order,
            civilizationId: row.civilization_id,
            mandateId: row.mandate_id,
            revision: row.revision,
            previousRevision: row.previous_revision,
            status: row.status,
            mandate: mandate as unknown as JsonValue,
            mandateDigest: derivedDigest,
            recordedAt: row.recorded_at,
          } as Record<string, JsonValue>;
        }),
    };
  }

  #ownedObservationState(): OwnedStateBundle["observationStore"] {
    const sourceReports = this.#exportRows("SELECT * FROM source_reports ORDER BY report_order");
    const connectionVersions = this.#database
      .prepare(
        `SELECT connection_id, config_hash, config_json, registered_at,
                jsonl_record_index_mode
           FROM connection_versions
          ORDER BY connection_id, config_hash`,
      )
      .all()
      .map((value) => {
        const row = value as Record<string, JsonValue> & { config_json: string };
        return {
          connectionId: row.connection_id,
          connectionVersion: row.config_hash,
          config: JSON.parse(row.config_json) as JsonValue,
          registeredAt: row.registered_at,
          jsonlRecordIndexMode: row.jsonl_record_index_mode,
        } as Record<string, JsonValue>;
      });
    const activeConnections = this.#database
      .prepare(
        `SELECT connection_id, config_hash, activation_id, connected_at
           FROM active_connections
          ORDER BY connection_id`,
      )
      .all()
      .map((value) => {
        const row = value as Record<string, JsonValue>;
        return {
          connectionId: row.connection_id,
          connectionVersion: row.config_hash,
          activationId: row.activation_id,
          connectedAt: row.connected_at,
        } as Record<string, JsonValue>;
      });
    const facts = this.#database
      .prepare(
        `SELECT f.fact_id, f.connection_id, f.config_hash, f.attempt_id,
                f.fact_owner, f.kind, f.subject, f.epistemic_status,
                f.source_record_id, f.source_recorded_at, f.source_time_key,
                f.payload_json, f.payload_hash, f.collected_at,
                f.last_seen_attempt_order,
                CASE
                  WHEN collected.attempt_order > f.last_seen_attempt_order THEN 'historical'
                  WHEN f.source_recorded_at IS NULL THEN 'unknown'
                  WHEN EXISTS (
                    SELECT 1 FROM facts newer
                     WHERE newer.connection_id = f.connection_id
                       AND newer.fact_owner = f.fact_owner
                       AND newer.kind = f.kind
                       AND newer.subject = f.subject
                       AND newer.epistemic_status = f.epistemic_status
                       AND newer.source_time_key > f.source_time_key
                  ) THEN 'historical'
                  WHEN (
                    SELECT MAX(known.last_seen_attempt_order) FROM facts known
                     WHERE known.connection_id = f.connection_id
                       AND known.fact_owner = f.fact_owner
                       AND known.kind = f.kind
                       AND known.subject = f.subject
                       AND known.epistemic_status = f.epistemic_status
                       AND known.source_record_id = f.source_record_id
                       AND known.source_time_key = f.source_time_key
                  ) = 0 THEN 'unknown'
                  WHEN (
                    SELECT COUNT(*) FROM facts tied
                     WHERE tied.connection_id = f.connection_id
                       AND tied.fact_owner = f.fact_owner
                       AND tied.kind = f.kind
                       AND tied.subject = f.subject
                       AND tied.epistemic_status = f.epistemic_status
                       AND tied.source_record_id = f.source_record_id
                       AND tied.source_time_key = f.source_time_key
                       AND tied.last_seen_attempt_order = (
                         SELECT MAX(latest.last_seen_attempt_order) FROM facts latest
                          WHERE latest.connection_id = f.connection_id
                            AND latest.fact_owner = f.fact_owner
                            AND latest.kind = f.kind
                            AND latest.subject = f.subject
                            AND latest.epistemic_status = f.epistemic_status
                            AND latest.source_record_id = f.source_record_id
                            AND latest.source_time_key = f.source_time_key
                       )
                  ) > 1 THEN 'unknown'
                  WHEN EXISTS (
                    SELECT 1 FROM facts corrected
                     WHERE corrected.connection_id = f.connection_id
                       AND corrected.fact_owner = f.fact_owner
                       AND corrected.kind = f.kind
                       AND corrected.subject = f.subject
                       AND corrected.epistemic_status = f.epistemic_status
                       AND corrected.source_record_id = f.source_record_id
                       AND corrected.source_time_key = f.source_time_key
                       AND corrected.last_seen_attempt_order > f.last_seen_attempt_order
                  ) THEN 'historical'
                  ELSE 'current'
                END AS temporal_status
           FROM facts f
           ${FACT_COLLECTION_AS_OF_JOIN}
          ORDER BY f.fact_id`,
      )
      .all()
      .map((value) => {
        const row = value as Record<string, JsonValue> & { payload_json: string };
        return {
          id: row.fact_id,
          connectionId: row.connection_id,
          connectionVersion: row.config_hash,
          attemptId: row.attempt_id,
          factOwner: row.fact_owner,
          kind: row.kind,
          subject: row.subject,
          epistemicStatus: row.epistemic_status,
          sourceRecordId: row.source_record_id,
          sourceRecordedAt: row.source_recorded_at,
          sourceTimeKey: row.source_time_key,
          payload: JSON.parse(row.payload_json) as JsonValue,
          payloadHash: row.payload_hash,
          collectedAt: row.collected_at,
          lastSeenAttemptOrder: row.last_seen_attempt_order,
          temporalStatus: row.temporal_status,
        } as Record<string, JsonValue>;
      });
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      activeConnections,
      ...(sourceReports.length === 0 ? {} : {
        sourceReports,
        sourceReportFacts: this.#exportRows("SELECT * FROM source_report_facts ORDER BY report_id, source_fact_id"),
        sourceReportAdmissions: this.#exportRows("SELECT * FROM source_report_admissions ORDER BY admission_order"),
      }),
      collectionAttemptRetirements: this.#exportRows(
        `SELECT retirement_order AS retirementOrder, retirement_id AS retirementId,
                attempt_id AS attemptId, connection_id AS connectionId,
                config_hash AS connectionVersion, retired_at AS retiredAt,
                retired_by AS retiredBy, confirmation_token AS confirmationToken
           FROM collection_attempt_retirements ORDER BY retirement_order`,
      ).map((row) => {
        const { confirmationToken, ...retirement } = row;
        return {
          ...retirement,
          confirmationTokenDigest: sha256(confirmationToken as string),
        };
      }),
      collectionAttempts: this.#exportRows(
        `SELECT attempt_order AS attemptOrder, attempt_id AS attemptId,
                connection_id AS connectionId, config_hash AS connectionVersion,
                activation_id AS activationId, started_at AS startedAt,
                completed_at AS completedAt, outcome, source_records_seen AS sourceRecordsSeen,
                facts_seen AS factsSeen, facts_added AS factsAdded,
                facts_changed AS factsChanged, failure_code AS failureCode
           FROM collection_attempts ORDER BY attempt_order`,
      ),
      connectionVersions,
      facts,
      forgetRecords: this.#database
        .prepare(
          `SELECT forget_order, forget_id, connection_id, forgotten_at, forgotten_by,
                  inventory_json, inventory_digest, export_digest
             FROM forget_records ORDER BY forget_order`,
        )
        .all()
        .map((value) => {
          const row = value as Record<string, JsonValue> & { inventory_json: string };
          return {
            forgetOrder: row.forget_order,
            forgetId: row.forget_id,
            connectionId: row.connection_id,
            forgottenAt: row.forgotten_at,
            forgottenBy: row.forgotten_by,
            inventory: JSON.parse(row.inventory_json) as JsonValue,
            inventoryDigest: row.inventory_digest,
            exportDigest: row.export_digest,
          } as Record<string, JsonValue>;
        }),
      recordIndexModeResolutions: this.#database
        .prepare(
          `SELECT resolution_order, resolution_id, connection_id, config_hash,
                  previous_mode, record_index_mode, resolved_at,
                  affected_fact_ids_json, collection_attempt_ids_json,
                  confirmation_token
             FROM record_index_mode_resolutions ORDER BY resolution_order`,
        )
        .all()
        .map((value) => {
          const row = value as Record<string, JsonValue> & {
            affected_fact_ids_json: string;
            collection_attempt_ids_json: string;
            confirmation_token: string;
          };
          return {
            resolutionOrder: row.resolution_order,
            resolutionId: row.resolution_id,
            connectionId: row.connection_id,
            connectionVersion: row.config_hash,
            previousRecordIndexMode: row.previous_mode,
            recordIndexMode: row.record_index_mode,
            resolvedAt: row.resolved_at,
            affectedFactIds: JSON.parse(row.affected_fact_ids_json) as JsonValue,
            collectionAttemptIds: JSON.parse(row.collection_attempt_ids_json) as JsonValue,
            confirmationTokenDigest: sha256(row.confirmation_token),
          } as Record<string, JsonValue>;
        }),
    };
  }

  #exportRows(sql: string): Record<string, JsonValue>[] {
    return this.#database.prepare(sql).all() as Record<string, JsonValue>[];
  }

  #projectExport(civilizationId?: string): Record<string, Record<string, JsonValue>[]> {
    const result: Record<string, Record<string, JsonValue>[]> = {};
    for (const [key, table, order] of [
      ["projects", "projects", "project_order"],
      ["projectProvisioningEvents", "project_provisioning_events", "event_order"],
      ["projectHarnessBindings", "project_harness_bindings", "project_id"],
    ] as const) {
      result[key] = this.#database.prepare(`SELECT * FROM ${table}
        ${civilizationId === undefined ? "" : "WHERE project_id IN (SELECT project_id FROM projects WHERE civilization_id = ?)"}
        ORDER BY ${order}`).all(...(civilizationId === undefined ? [] : [civilizationId])) as Record<string, JsonValue>[];
    }
    return result;
  }

  #forgetSnapshot(connectionId: string, requireInactive = true): ForgetSnapshot {
    const active = this.#database
      .prepare("SELECT 1 AS active FROM active_connections WHERE connection_id = ?")
      .get(connectionId);
    if (requireInactive && active !== undefined) {
      throw new ForgetConnectionActiveError(connectionId);
    }
    const connectionVersions = (
      this.#database
        .prepare(
          `SELECT config_hash FROM connection_versions
            WHERE connection_id = ? ORDER BY config_hash`,
        )
        .all(connectionId) as { config_hash: string }[]
    ).map((row) => row.config_hash);
    if (connectionVersions.length === 0) {
      throw new ForgetConnectionNotFoundError(connectionId);
    }
    const factIds = (
      this.#database
        .prepare("SELECT fact_id FROM facts WHERE connection_id = ? ORDER BY fact_id")
        .all(connectionId) as { fact_id: number }[]
    ).map((row) => row.fact_id);
    const collectionAttemptIds = (
      this.#database
        .prepare(
          `SELECT attempt_id FROM collection_attempts
            WHERE connection_id = ? ORDER BY attempt_order`,
        )
        .all(connectionId) as { attempt_id: string }[]
    ).map((row) => row.attempt_id);
    const collectionAttemptRetirementIds = (
      this.#database
        .prepare(
          `SELECT retirement_id FROM collection_attempt_retirements
            WHERE connection_id = ? ORDER BY retirement_order`,
        )
        .all(connectionId) as { retirement_id: string }[]
    ).map((row) => row.retirement_id);
    const recordIndexModeResolutionIds = (
      this.#database
        .prepare(
          `SELECT resolution_id FROM record_index_mode_resolutions
            WHERE connection_id = ? ORDER BY resolution_order`,
        )
        .all(connectionId) as { resolution_id: string }[]
    ).map((row) => row.resolution_id);
    const sourceReportIds = (this.#database.prepare("SELECT report_id FROM source_reports WHERE connection_id = ? ORDER BY report_order").all(connectionId) as { report_id: string }[]).map((row) => row.report_id);
    const sourceReportFacts = this.#database.prepare(`SELECT f.report_id AS reportId, f.fact_id AS factId, f.source_fact_id AS sourceFactId FROM source_report_facts f JOIN source_reports r ON r.report_id = f.report_id WHERE r.connection_id = ? ORDER BY r.report_order, f.source_fact_id`).all(connectionId) as { reportId: string; factId: number; sourceFactId: string }[];
    const sourceReportAdmissions = this.#database.prepare(`SELECT a.report_id AS reportId, a.attempt_id AS attemptId FROM source_report_admissions a JOIN source_reports r ON r.report_id = a.report_id WHERE r.connection_id = ? ORDER BY a.admission_order`).all(connectionId) as { reportId: string; attemptId: string }[];
    const inventory: ForgetInventory = {
      ...(sourceReportIds.length === 0 ? {} : { sourceReportIds, sourceReportFacts, sourceReportAdmissions }),
      collectionAttemptIds,
      collectionAttemptRetirementIds,
      connectionId,
      connectionVersions,
      counts: {
        ...(sourceReportIds.length === 0 ? {} : { sourceReports: sourceReportIds.length, sourceReportFacts: sourceReportFacts.length, sourceReportAdmissions: sourceReportAdmissions.length }),
        collectionAttemptRetirements: collectionAttemptRetirementIds.length,
        collectionAttempts: collectionAttemptIds.length,
        connectionVersions: connectionVersions.length,
        facts: factIds.length,
        recordIndexModeResolutions: recordIndexModeResolutionIds.length,
      },
      factIds,
      recordIndexModeResolutionIds,
    };
    const inventoryDigest = `sha256:${sha256(
      canonicalJson(inventory as unknown as JsonValue),
    )}`;
    return { ...inventory, inventoryDigest, stateFingerprint: inventoryDigest };
  }

  #civilizationForgetSnapshot(
    civilizationId: string,
    requireDissolved = true,
  ): CivilizationForgetSnapshot {
    const civilization = this.#database
      .prepare("SELECT 1 AS found FROM civilizations WHERE civilization_id = ?")
      .get(civilizationId);
    if (civilization === undefined) {
      throw new ForgetCivilizationNotFoundError(civilizationId);
    }
    const revisions = this.#database
      .prepare(
        `SELECT civilization_id, mandate_id, revision, status
           FROM mandate_revisions
          WHERE civilization_id = ?
          ORDER BY revision_order`,
      )
      .all(civilizationId) as {
      civilization_id: string;
      mandate_id: string;
      revision: string;
      status: "active" | "dissolved";
    }[];
    if (revisions.length === 0) {
      throw new MandateUnreadableError(civilizationId);
    }
    if (requireDissolved && revisions.at(-1)?.status !== "dissolved") {
      throw new ForgetCivilizationNotDissolvedError(civilizationId);
    }
    const mandateRevisions = revisions.map((row) => ({
      civilizationId: row.civilization_id,
      mandateId: row.mandate_id,
      revision: row.revision,
    }));
    const projectState = this.#projectExport(civilizationId);
    if (requireDissolved && projectState.projects!.some((project) => {
      const latest = projectState.projectProvisioningEvents!.filter((event) => event.project_id === project.project_id).at(-1);
      return latest !== undefined && projectOwnerAlive(latest.event_id as string);
    })) throw new ProjectError("retry_in_progress");
    const projects = projectState.projects!.map((row) => ({
      projectId: row.project_id as string, workspacePath: row.workspace_path as string,
    }));
    const projectProvisioningEventIds = projectState.projectProvisioningEvents!.map((row) => row.event_id as string);
    const projectHarnessBindingIds = projectState.projectHarnessBindings!.map((row) => row.project_id as string);
    const inventory: CivilizationForgetInventory = {
      civilizationId,
      ...(projects.length === 0 ? {} : { projects, projectProvisioningEventIds, projectHarnessBindingIds }),
      counts: {
        civilizations: 1,
        mandateRevisions: mandateRevisions.length,
        ...(projects.length === 0 ? {} : {
          projects: projects.length,
          projectProvisioningEvents: projectProvisioningEventIds.length,
          projectHarnessBindings: projectHarnessBindingIds.length,
        }),
      },
      mandateRevisions,
    };
    const inventoryDigest = `sha256:${sha256(
      canonicalJson(inventory as unknown as JsonValue),
    )}`;
    return { ...inventory, inventoryDigest, stateFingerprint: projects.length === 0 ? inventoryDigest :
      `sha256:${sha256(canonicalJson({ inventoryDigest, projectState } as unknown as JsonValue))}` };
  }

  #collectionAttemptRetirementSnapshot(
    attemptId: string,
    retiredBy: string,
  ): CollectionAttemptRetirementSnapshot {
    const attempt = this.#database
      .prepare(
        `SELECT connection_id, config_hash, started_at, outcome
           FROM collection_attempts
          WHERE attempt_id = ?`,
      )
      .get(attemptId) as
      | undefined
      | {
          config_hash: string;
          connection_id: string;
          outcome: "failed" | "retired" | "running" | "skipped" | "success";
          started_at: string;
        };
    if (attempt?.outcome !== "running") {
      throw new CollectionAttemptNotRunningError(attemptId);
    }
    return {
      attemptId,
      stateFingerprint: `sha256:${sha256(
        canonicalJson([
          attemptId,
          attempt.connection_id,
          attempt.config_hash,
          attempt.started_at,
          attempt.outcome,
          retiredBy,
        ]),
      )}`,
      connectionId: attempt.connection_id,
      connectionVersion: attempt.config_hash,
      retiredBy,
      startedAt: attempt.started_at,
    };
  }

  #recordIndexModeResolutionSnapshot(
    connectionId: string,
    connectionVersion: string,
    recordIndexMode: JsonlRecordIndexMode,
  ): RecordIndexModeResolutionSnapshot {
    const active = this.#database
      .prepare(
        `SELECT c.config_hash, v.config_json, v.jsonl_record_index_mode
           FROM active_connections c
           JOIN connection_versions v
             ON v.connection_id = c.connection_id
            AND v.config_hash = c.config_hash
          WHERE c.connection_id = ?`,
      )
      .get(connectionId) as
      | undefined
      | { config_hash: string; config_json: string; jsonl_record_index_mode: string };
    if (active === undefined) {
      throw new ConnectionNotFoundError(connectionId);
    }
    if (active.config_hash !== connectionVersion) {
      throw new ConnectionInactiveError(connectionId);
    }
    const currentRecordIndexMode = parseJsonlRecordIndexMode(
      active.jsonl_record_index_mode,
    );
    const resolutions = this.#database
      .prepare(
        `SELECT count(*) AS count,
                COALESCE(MAX(resolution_order), 0) AS latest_order
           FROM record_index_mode_resolutions
          WHERE connection_id = ? AND config_hash = ?`,
      )
      .get(connectionId, connectionVersion) as {
      count: number;
      latest_order: number;
    };
    if (
      currentRecordIndexMode === recordIndexMode ||
      (currentRecordIndexMode !== "unknown" && resolutions.count === 0)
    ) {
      throw new StoredRecordIndexModeKnownError(connectionId);
    }
    const facts = this.#database
      .prepare(
        `SELECT fact_id, last_seen_attempt_order
           FROM facts
          WHERE connection_id = ? AND config_hash = ?
          ORDER BY fact_id`,
      )
      .all(connectionId, connectionVersion) as {
      fact_id: number;
      last_seen_attempt_order: number;
    }[];
    const attempts = this.#database
      .prepare(
        `SELECT attempt_id, attempt_order, outcome
           FROM collection_attempts
          WHERE connection_id = ? AND config_hash = ?
          ORDER BY attempt_order`,
      )
      .all(connectionId, connectionVersion) as {
      attempt_id: string;
      attempt_order: number;
      outcome: "failed" | "retired" | "running" | "skipped" | "success";
    }[];
    if (attempts.some((attempt) => attempt.outcome === "running")) {
      throw new RecordIndexResolutionCollectionRunningError(connectionId);
    }
    const config = parseStoredConfig(active.config_json, connectionVersion);
    const storedIndexEvidence = recordIndexModeEvidence(
      this.#database,
      config,
      connectionId,
      connectionVersion,
    );
    const affectedFactIds = facts.map((fact) => fact.fact_id);
    const collectionAttemptIds = attempts.map((attempt) => attempt.attempt_id);
    // source_records_seen changes only when an attempt is added or completes;
    // those changes already alter the attempt tuples included below.
    const stateFingerprint = `sha256:${sha256(
      canonicalJson([
        connectionId,
        connectionVersion,
        currentRecordIndexMode,
        recordIndexMode,
        facts.map((fact) => [fact.fact_id, fact.last_seen_attempt_order]),
        attempts.map((attempt) => [
          attempt.attempt_id,
          attempt.attempt_order,
          attempt.outcome,
        ]),
        resolutions.count,
        resolutions.latest_order,
      ]),
    )}`;
    return {
      affectedFactIds,
      collectionAttemptIds,
      collectionAttemptsRecorded: collectionAttemptIds.length,
      connectionId,
      connectionVersion,
      currentRecordIndexMode,
      factsAffected: affectedFactIds.length,
      recordIndexMode,
      stateFingerprint,
      storedIndexEvidence,
    };
  }

  #issueConfirmationPreview(
    operation:
      | "forget"
      | "forget-civilization"
      | "resolve-record-index"
      | "retire-collection-attempt",
    argumentsJson: string,
    stateFingerprint: string,
    issuedAt: string,
  ): string {
    const confirmationToken = `confirmation:${randomUUID()}`;
    this.#database
      .prepare(
        `INSERT INTO confirmation_previews
           (confirmation_token_hash, operation, arguments_json, state_fingerprint,
            issued_at, consumed_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        sha256(confirmationToken),
        operation,
        argumentsJson,
        stateFingerprint,
        issuedAt,
      );
    return confirmationToken;
  }

  #confirmationPreview(
    operation:
      | "forget"
      | "forget-civilization"
      | "resolve-record-index"
      | "retire-collection-attempt",
    argumentsJson: string,
    confirmationToken: string,
  ): ConfirmationPreviewRow {
    const preview = this.#database
      .prepare(
        `SELECT state_fingerprint, consumed_at
           FROM confirmation_previews
          WHERE confirmation_token_hash = ?
            AND operation = ?
            AND arguments_json = ?`,
      )
      .get(sha256(confirmationToken), operation, argumentsJson) as
      | ConfirmationPreviewRow
      | undefined;
    if (preview === undefined) {
      throw new ConfirmationPreviewNotFoundError();
    }
    return preview;
  }

  #spendConfirmationPreview(confirmationToken: string, consumedAt: string): void {
    const spent = this.#database
      .prepare(
        `UPDATE confirmation_previews
            SET consumed_at = ?
          WHERE confirmation_token_hash = ? AND consumed_at IS NULL`,
      )
      .run(consumedAt, sha256(confirmationToken));
    if (numberOfChanges(spent) !== 1) {
      throw new ConfirmationAlreadySpentError();
    }
  }

  #assertStoredRecordIndexMode(
    connection: ActiveConnection,
    expectedMode: JsonlRecordIndexMode | "unknown",
  ): void {
    const storedMode = this.#storedRecordIndexMode(connection);
    if (storedMode === "unknown") {
      throw new StoredRecordIndexModeUnknownError(connection.config.id);
    }
    if (expectedMode === "unknown" || storedMode !== expectedMode) {
      throw new StoredRecordIndexModeChangedError(connection.config.id);
    }
  }

  #storedRecordIndexMode(
    connection: ActiveConnection,
  ): JsonlRecordIndexMode | "unknown" {
    const row = this.#database
      .prepare(
        `SELECT jsonl_record_index_mode
           FROM connection_versions
          WHERE connection_id = ? AND config_hash = ?`,
      )
      .get(connection.config.id, connection.configHash) as
      | undefined
      | { jsonl_record_index_mode: string };
    if (row === undefined) {
      throw new Error("Registered connection configuration is missing");
    }
    return parseJsonlRecordIndexMode(row.jsonl_record_index_mode);
  }

  async #recordRunningAttempt(
    connection: ActiveConnection,
    attemptId: string,
    now: () => Date,
    contentionBudget: ContentionBudget,
  ): Promise<{ attemptOrder: number; startedAt: string }> {
    return this.#retryTransactionWithinContentionBudget(contentionBudget, () => {
      this.#assertActive(connection);
      this.#assertStoredRecordIndexMode(
        connection,
        connection.jsonlRecordIndexMode,
      );
      const attemptOrder = this.#nextAttemptOrder();
      const startedAt = now().toISOString();
      this.#database
        .prepare(
          `INSERT INTO collection_attempts
              (attempt_order, attempt_id, connection_id, config_hash, activation_id,
               started_at, outcome, source_records_seen, facts_seen, facts_added,
               facts_changed)
           VALUES (?, ?, ?, ?, ?, ?, 'running', 0, 0, 0, 0)`,
        )
        .run(
          attemptOrder,
          attemptId,
          connection.config.id,
          connection.configHash,
          connection.activationId,
          startedAt,
        );
      return { attemptOrder, startedAt };
    });
  }

  async #retryTransactionWithinContentionBudget<T>(
    contentionBudget: ContentionBudget,
    retryableOperation: () => T,
  ): Promise<T> {
    while (true) {
      const attemptTimeoutMilliseconds = Math.min(
        this.#busyTimeoutMilliseconds,
        Math.max(0, Math.floor(contentionBudget.remainingMilliseconds)),
      );
      const attemptStartedAt = performance.now();
      let chargedMilliseconds = 0;
      try {
        return this.#withBusyTimeout(attemptTimeoutMilliseconds, () =>
          this.#transaction(retryableOperation, (elapsedMilliseconds) => {
            chargedMilliseconds += elapsedMilliseconds;
            consumeContentionBudget(contentionBudget, elapsedMilliseconds);
          }),
        );
      } catch (error) {
        if (!isSqliteContentionError(error)) {
          throw error;
        }
        consumeContentionBudget(
          contentionBudget,
          Math.max(0, performance.now() - attemptStartedAt - chargedMilliseconds),
        );
        const retryDelay = Math.min(10, contentionBudget.remainingMilliseconds);
        if (retryDelay <= 0) {
          throw new StoreContentionError(error);
        }
        const retryStartedAt = performance.now();
        await delay(retryDelay);
        consumeContentionBudget(
          contentionBudget,
          performance.now() - retryStartedAt,
        );
      }
    }
  }

  #correctionSignature(connectionId: string, fact: PreparedFact): string {
    const rows = this.#database
      .prepare(
        `SELECT payload_hash, last_seen_attempt_order
           FROM facts
          WHERE connection_id = ? AND fact_owner = ? AND kind = ? AND subject = ?
            AND epistemic_status = ? AND source_record_id = ? AND source_time_key = ?`,
      )
      .all(
        connectionId,
        fact.factOwner,
        fact.kind,
        fact.subject,
        fact.epistemicStatus,
        fact.sourceRecordId,
        fact.sourceTimeKey,
      ) as { last_seen_attempt_order: number; payload_hash: string }[];
    const latest = Math.max(0, ...rows.map((row) => row.last_seen_attempt_order));
    return canonicalJson(
      rows
        .filter((row) => row.last_seen_attempt_order === latest)
        .map((row) => row.payload_hash)
        .sort(),
    );
  }

  #nextAttemptOrder(): number {
    const row = this.#database
      .prepare("SELECT COALESCE(MAX(attempt_order), 0) + 1 AS next FROM collection_attempts")
      .get() as { next: number };
    return row.next;
  }

  #transaction<T>(operation: () => T, recordWait?: (milliseconds: number) => void): T {
    const startedAt = performance.now();
    try {
      this.#database.exec("BEGIN IMMEDIATE");
    } catch (error) {
      if (isSqliteContentionError(error)) {
        throw new StoreContentionError(error);
      }
      throw error;
    } finally {
      recordWait?.(performance.now() - startedAt);
    }
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec("ROLLBACK");
      }
      if (isSqliteContentionError(error)) {
        throw new StoreContentionError(error);
      }
      throw error;
    }
  }

  #withBusyTimeout<T>(timeoutMilliseconds: number, operation: () => T): T {
    if (timeoutMilliseconds === this.#busyTimeoutMilliseconds) {
      return operation();
    }
    this.#database.exec(`PRAGMA busy_timeout = ${timeoutMilliseconds}`);
    try {
      return operation();
    } finally {
      this.#database.exec(`PRAGMA busy_timeout = ${this.#busyTimeoutMilliseconds}`);
    }
  }

  #readTransaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec("ROLLBACK");
      }
      throw error;
    }
  }
}

interface MandateRevisionRow {
  mandate_id: string;
  revision: string;
  status: "active" | "dissolved";
  mandate_json: string;
  mandate_digest: string;
  recorded_at: string;
}

type FoundedMandateRow = {
  civilization_id: string;
  name: string;
  founded_at: string;
} & { [Key in keyof MandateRevisionRow]: MandateRevisionRow[Key] | null };

interface CollectionAttemptRow {
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

interface CollectionAttemptRetirementRow {
  attempt_id: string;
  config_hash: string;
  connection_id: string;
  retired_at: string;
  retired_by: string;
  retirement_id: string;
}

interface ConfirmationPreviewRow {
  consumed_at: null | string;
  state_fingerprint: string;
}

interface StoredFactRow {
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

export interface ContentionBudget {
  remainingMilliseconds: number;
}

interface PreparedFact extends FactInput {
  payloadHash: string;
  payloadJson: string;
  sourceTimeKey: string;
}

function correctionSlotKey(connectionId: string, fact: PreparedFact): string {
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

function collectionAttemptFromRow(row: CollectionAttemptRow): CollectionAttempt {
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

function storedFactFromRow(row: StoredFactRow): StoredFact {
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

function parseStoredConfig(configJson: string, expectedHash: string): ConnectionConfig {
  const parsed = parseConnectionConfig(JSON.parse(configJson) as unknown);
  if (parsed.hash !== expectedHash) {
    throw new Error("Stored connection configuration does not match its identity");
  }
  return parsed.config;
}

function parseStoredIntegerArray(value: string): number[] {
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

function parseStoredStringArray(value: string): string[] {
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

function parseJsonlRecordIndexMode(
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

function usesJsonlRecordIndex(config: ConnectionConfig): boolean {
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

function verificationFactsFromInputs(
  facts: readonly FactInput[],
  config: ConnectionConfig,
): VerificationFact[] {
  return facts.map((fact) => {
    const snapshot = snapshotFact(fact);
    validateFactAndDeriveSourceTimeKey(snapshot, config);
    return verificationFactFromInput(snapshot);
  });
}

function snapshotFact(fact: FactInput): FactInput {
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

function validateFactAndDeriveSourceTimeKey(
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

function validateRetirementActor(value: string): void {
  validateActor(value, "retirement");
}

function validateActor(
  value: string,
  operation: "forget" | "forget-civilization" | "retirement",
): void {
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(value)) {
    throw new TypeError(`A ${operation} actor must be a stable machine identifier`);
  }
}

function parseExportInventories(
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

function parseCivilizationExportInventories(
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

function parseForgetInventory(value: string): ForgetInventory {
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

function parseCivilizationForgetInventory(value: string): CivilizationForgetInventory {
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

function safeFailureCode(error: unknown): string {
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

/**
 * Read a stored mandate back as a mandate, or refuse.
 *
 * Re-parsing on the read path is what makes the digest honest: it is derived
 * from bytes that have been proven to still be a mandate, so content edited
 * underneath the store fails closed here rather than producing a confident
 * digest of something nobody validated.
 */
function parseStoredMandate(mandateJson: string, civilizationId: string): MandateConfig {
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

function numberOfChanges(result: StatementResultingChanges): number {
  return Number(result.changes);
}

export function isSqliteContentionError(error: unknown): boolean {
  if (error instanceof StoreContentionError) {
    return true;
  }
  if (
    error === null ||
    typeof error !== "object" ||
    !("errcode" in error) ||
    typeof error.errcode !== "number"
  ) {
    return false;
  }
  const primaryResultCode = error.errcode & 0xff;
  return primaryResultCode === 5 || primaryResultCode === 6;
}

function consumeContentionBudget(
  budget: ContentionBudget,
  elapsedMilliseconds: number,
): void {
  budget.remainingMilliseconds = Math.max(
    0,
    budget.remainingMilliseconds - elapsedMilliseconds,
  );
}

function addFilter(
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
