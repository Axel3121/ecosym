import type { DatabaseSync } from "node:sqlite";

import { mandateDigest } from "./institution.ts";
import { sha256, type JsonValue } from "./json.ts";
import type { OwnedStateBundle } from "./owned-state.ts";
import { MandateUnreadableError } from "./store-errors.ts";
import { parseStoredMandate } from "./store-rows.ts";
import { FACT_COLLECTION_AS_OF_JOIN, STORE_SCHEMA_VERSION } from "./store-schema.ts";

/** Reads the store's owned state for export; it never writes. */
export class OwnedStateReader {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  ownedInstitutionState(): OwnedStateBundle["institutionStore"] {
    return {
      schemaVersion: STORE_SCHEMA_VERSION,
      ...this.projectExport(),
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

  ownedObservationState(): OwnedStateBundle["observationStore"] {
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

  projectExport(civilizationId?: string): Record<string, Record<string, JsonValue>[]> {
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
}
