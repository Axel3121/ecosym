import { Buffer } from "node:buffer";
import { ArenaAdmissionError, parseArenaBundle, sourceReportProjection, type ArenaBundle } from "./arena-adapter.ts";
import type { SourceReportSnapshot, SourceReportProvenance } from "./source-report.ts";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  parseConnectionConfig,
  type ConnectionConfig,
  type ParsedConnectionConfig,
} from "./config.ts";
import { canonicalJson, type JsonValue, sha256 } from "./json.ts";
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
  type ParsedMandateConfig,
} from "./institution.ts";
import {
  createOwnedStateExport,
  type OwnedStateBundle,
  type OwnedStateExport,
} from "./owned-state.ts";
import { defaultStateDirectory } from "./paths.ts";
import { recordIndexModeEvidence } from "./record-index-evidence.ts";
import type { JsonlRecordIndexMode } from "./readers.ts";
import { utcInstantOrderingKey } from "./time.ts";
import { sourceReportFactTimeKey } from "./source-report-time.ts";
import { PROJECT_ERROR_CODES, ProjectError, type ProjectErrorCode, type ProjectState, type ProjectRequest, type HarnessBinding, type WorldProjectSnapshot } from "./project-types.ts";
export { ProjectError } from "./project-types.ts";
export { createCollectionContentionBudget, isSqliteContentionError } from "./store-sqlite.ts";
import {
  sameVerificationFactSet,
  verificationFactKey,
} from "./verification-facts.ts";
import {
  CivilizationDissolvedError,
  CivilizationNotFoundError,
  CollectionAttemptNotRunningError,
  CollectionFailedError,
  ConfirmationAlreadySpentError,
  ConfirmationPreviewNotFoundError,
  ConnectionConflictError,
  ConnectionInactiveError,
  ConnectionNotFoundError,
  FactNotDeclaredError,
  ForgetCivilizationExportCoverageError,
  ForgetCivilizationNotDissolvedError,
  ForgetCivilizationNotFoundError,
  ForgetCivilizationStateChangedError,
  ForgetConnectionActiveError,
  ForgetConnectionNotFoundError,
  ForgetExportCoverageError,
  ForgetStateChangedError,
  MandateUnreadableError,
  RecordIndexResolutionCollectionRunningError,
  RecordIndexResolutionStateChangedError,
  SourceRevisionChangedError,
  StoreContentionError,
  StoredRecordIndexModeChangedError,
  StoredRecordIndexModeKnownError,
  StoredRecordIndexModeUnknownError,
  WorkClaimConflictError,
} from "./store-errors.ts";

export {
  CivilizationDissolvedError,
  CivilizationNotFoundError,
  CollectionAttemptNotRunningError,
  CollectionFailedError,
  ConfirmationAlreadySpentError,
  ConfirmationPreviewNotFoundError,
  ConnectionConflictError,
  ConnectionInactiveError,
  ConnectionNotFoundError,
  FactNotDeclaredError,
  FactRejectedError,
  ForgetCivilizationExportCoverageError,
  ForgetCivilizationNotDissolvedError,
  ForgetCivilizationNotFoundError,
  ForgetCivilizationStateChangedError,
  ForgetConnectionActiveError,
  ForgetConnectionNotFoundError,
  ForgetExportCoverageError,
  ForgetStateChangedError,
  MandateUnreadableError,
  RecordIndexResolutionCollectionRunningError,
  RecordIndexResolutionStateChangedError,
  SourceRevisionChangedError,
  StoredRecordIndexModeChangedError,
  StoredRecordIndexModeKnownError,
  StoredRecordIndexModeUnknownError,
  WorkClaimConflictError,
} from "./store-errors.ts";
import type {
  ActiveConnection,
  CivilizationForgetInventory,
  CivilizationForgetPlan,
  CivilizationForgetRecord,
  CivilizationForgetSnapshot,
  CollectionAttempt,
  CollectionAttemptRetirement,
  CollectionAttemptRetirementPlan,
  CollectionAttemptRetirementSnapshot,
  CollectionResult,
  CollectionSink,
  ContentionBudget,
  ForgetInventory,
  ForgetPlan,
  ForgetRecord,
  ForgetSnapshot,
  OpenWorkClaim,
  QueryOptions,
  RecordIndexModeResolution,
  RecordIndexModeResolutionPlan,
  RecordIndexModeResolutionSnapshot,
  ResolvedAuthorityContext,
  VerificationFact,
  VerificationSnapshot,
} from "./store-types.ts";
import { migrateStore } from "./store-migrate.ts";
import { FACT_COLLECTION_AS_OF_JOIN, STORE_SCHEMA_VERSION } from "./store-schema.ts";
import {
  BUSY_RETRY_WINDOW_MILLISECONDS,
  createCollectionContentionBudget,
  numberOfChanges,
  retryTransactionWithinContentionBudget,
  runImmediateTransaction,
  runReadTransaction,
} from "./store-sqlite.ts";
import {
  addFilter,
  collectionAttemptFromRow,
  parseCivilizationExportInventories,
  parseCivilizationForgetInventory,
  parseExportInventories,
  parseForgetInventory,
  parseJsonlRecordIndexMode,
  parseStoredConfig,
  parseStoredIntegerArray,
  parseStoredMandate,
  parseStoredStringArray,
  storedFactFromRow,
  usesJsonlRecordIndex,
  type CollectionAttemptRetirementRow,
  type CollectionAttemptRow,
  type ConfirmationPreviewRow,
  type FoundedMandateRow,
  type MandateRevisionRow,
  type StoredFactRow,
} from "./store-rows.ts";
import {
  correctionSlotKey,
  safeFailureCode,
  snapshotFact,
  validateActor,
  validateFactAndDeriveSourceTimeKey,
  validateRetirementActor,
  verificationFactsFromInputs,
  type PreparedFact,
} from "./store-validation.ts";

export type {
  ActiveConnection,
  CivilizationForgetInventory,
  CivilizationForgetPlan,
  CivilizationForgetRecord,
  CivilizationRevisionIdentity,
  CollectionAttempt,
  CollectionAttemptRetirement,
  CollectionAttemptRetirementPlan,
  CollectionResult,
  CollectionSink,
  ContentionBudget,
  ForgetInventory,
  ForgetPlan,
  ForgetRecord,
  OpenWorkClaim,
  QueryOptions,
  RecordIndexModeResolution,
  RecordIndexModeResolutionPlan,
  ResolvedAuthorityContext,
  VerificationFact,
  VerificationSnapshot,
} from "./store-types.ts";

export type {
  ConnectionStatus,
  EpistemicStatus,
  FactInput,
  NarrationAttempt,
  NarrationSnapshot,
  StoredFact,
} from "./observation-snapshot.ts";

const STORE_FILENAME = "observations.sqlite";
const WORK_CLAIM_TTL_MILLISECONDS = 30 * 60 * 1000; // 30 minutes, first guess
const CONFIRMATION_CONTENTION_BUDGET_MILLISECONDS = 2_000;
const projectAttemptOwners = new Map<string, string>();

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
  const pid = Number(match[1]);
  if (process.platform === "linux") {
    try {
      return projectProcessIdentity(pid) === match[2];
    } catch {
      // Unreadable identity is inconclusive; only ESRCH proves the PID is gone.
    }
  }
  try {
    process.kill(pid, 0);
    return process.platform === "linux" || projectProcessIdentity(pid) === match[2];
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
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
    migrateStore(this.#database);
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

  getProjectRetry(projectId: string, requestKey: string): { project: WorldProjectSnapshot; pending: boolean } | undefined {
    return this.#readTransaction(() => {
      const event = this.#database.prepare(`SELECT event_id, state, attempt, reason FROM project_provisioning_events
        WHERE project_id = ? AND attempt = (
          SELECT attempt FROM project_provisioning_events WHERE project_id = ? AND retry_request_key = ?)
        ORDER BY event_order DESC LIMIT 1`).get(projectId, projectId, requestKey) as
        { event_id: string; state: ProjectState; attempt: number; reason: ProjectErrorCode | null } | undefined;
      if (event === undefined) return undefined;
      const project = this.getProject(projectId)!;
      const abandonedByThisProcess = projectAttemptOwners.get(projectId) === undefined &&
        event.event_id.startsWith(`project-owner:${process.pid}:${projectProcessIdentity(process.pid)}:`);
      return { project: { ...project, state: event.state, attempt: event.attempt, reason: event.reason,
        harness: event.state === "established" ? project.harness : null },
        pending: project.attempt === event.attempt && projectOwnerAlive(event.event_id) && !abandonedByThisProcess };
    });
  }

  claimProjectAttempt(projectId: string, requestKey?: string, expectedRequestedAttempt?: number): number {
    const owner = `project-owner:${process.pid}:${projectProcessIdentity(process.pid)}:${randomUUID()}:`;
    const attempt = this.#projectTransaction(() => {
      if (requestKey !== undefined && this.#database.prepare(
        "SELECT 1 FROM project_provisioning_events WHERE project_id = ? AND retry_request_key = ?",
      ).get(projectId, requestKey)) throw new ProjectError("retry_in_progress");
      const current = this.getProject(projectId);
      // A create replay may recover requested work, but must not restart a newer retry.
      if (expectedRequestedAttempt !== undefined &&
          (current?.state !== "requested" || current.attempt !== expectedRequestedAttempt)) {
        throw new ProjectError("retry_in_progress");
      }
      if (current === undefined || current.state === "established") throw new ProjectError("invalid_request");
      const civilization = this.#database.prepare(
        "SELECT status FROM mandate_revisions WHERE civilization_id = ? ORDER BY revision_order DESC LIMIT 1",
      ).get(current.civilizationId) as { status: string } | undefined;
      if (civilization === undefined) throw new ProjectError("civilization_unknown");
      if (civilization.status === "dissolved") throw new ProjectError("civilization_dissolved");
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
      this.#insertProjectEvent(projectId, current.state, next, current.reason, owner, requestKey);
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

  #insertProjectEvent(projectId: string, state: ProjectState, attempt: number, reason: ProjectErrorCode | null, owner = "project-event:", requestKey?: string): void {
    this.#database.prepare(`INSERT INTO project_provisioning_events
      (event_id, project_id, state, attempt, reason, recorded_at, retry_request_key) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(`${owner}${randomUUID()}`, projectId, state, attempt, reason, new Date().toISOString(), requestKey ?? null);
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
          throw new CollectionAttemptNotRunningError(attemptId);
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
    return retryTransactionWithinContentionBudget(
      this.#database,
      this.#busyTimeoutMilliseconds,
      contentionBudget,
      retryableOperation,
    );
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

  #transaction<T>(operation: () => T): T {
    return runImmediateTransaction(this.#database, operation);
  }

  #readTransaction<T>(operation: () => T): T {
    return runReadTransaction(this.#database, operation);
  }
}
