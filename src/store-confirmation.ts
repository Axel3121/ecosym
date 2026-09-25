import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, type JsonValue, sha256 } from "./json.ts";
import { ProjectError } from "./project-types.ts";
import { recordIndexModeEvidence } from "./record-index-evidence.ts";
import type { JsonlRecordIndexMode } from "./readers.ts";
import {
  CollectionAttemptNotRunningError,
  ConfirmationAlreadySpentError,
  ConfirmationPreviewNotFoundError,
  ConnectionInactiveError,
  ConnectionNotFoundError,
  ForgetCivilizationNotDissolvedError,
  ForgetCivilizationNotFoundError,
  ForgetConnectionActiveError,
  ForgetConnectionNotFoundError,
  MandateUnreadableError,
  RecordIndexResolutionCollectionRunningError,
  StoredRecordIndexModeKnownError,
} from "./store-errors.ts";
import type { OwnedStateReader } from "./store-export.ts";
import { projectOwnerAlive } from "./store-project-owner.ts";
import {
  parseJsonlRecordIndexMode,
  parseStoredConfig,
  type ConfirmationPreviewRow,
} from "./store-rows.ts";
import { numberOfChanges } from "./store-sqlite.ts";
import type {
  CivilizationForgetInventory,
  CivilizationForgetSnapshot,
  CollectionAttemptRetirementSnapshot,
  ForgetInventory,
  ForgetSnapshot,
  RecordIndexModeResolutionSnapshot,
} from "./store-types.ts";

/**
 * The plan/confirm gate: the state snapshots whose fingerprints a
 * confirmation preview binds, and the preview ledger itself. Callers run
 * these inside the store's own transactions.
 */
export class ConfirmationState {
  readonly #database: DatabaseSync;
  readonly #ownedState: OwnedStateReader;

  constructor(database: DatabaseSync, ownedState: OwnedStateReader) {
    this.#database = database;
    this.#ownedState = ownedState;
  }

  forgetSnapshot(connectionId: string, requireInactive = true): ForgetSnapshot {
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

  civilizationForgetSnapshot(
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
    const projectState = this.#ownedState.projectExport(civilizationId);
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

  collectionAttemptRetirementSnapshot(
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

  recordIndexModeResolutionSnapshot(
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

  issueConfirmationPreview(
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

  confirmationPreview(
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

  spendConfirmationPreview(confirmationToken: string, consumedAt: string): void {
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
}
