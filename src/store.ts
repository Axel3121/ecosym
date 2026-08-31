import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

import {
  parseConnectionConfig,
  type ConnectionConfig,
  type ParsedConnectionConfig,
} from "./config.ts";
import { canonicalJson, type JsonScalar, type JsonValue, sha256 } from "./json.ts";
import { defaultStateDirectory } from "./paths.ts";
import { utcInstantOrderingKey } from "./time.ts";

const STORE_SCHEMA_VERSION = 6;
const STORE_FILENAME = "observations.sqlite";
const BUSY_RETRY_WINDOW_MILLISECONDS = 250;

export interface ActiveConnection {
  activationId: string;
  config: ConnectionConfig;
  configHash: string;
  connectedAt: string;
}

export interface FactInput {
  epistemicStatus: "claim" | "observation";
  factOwner: string;
  kind: string;
  payload: Record<string, JsonScalar>;
  sourceRecordedAt: null | string;
  sourceRecordId: string;
  subject: string;
}

export interface StoredFact extends FactInput {
  id: number;
  collectedAt: string;
  connectionId: string;
  connectionVersion: string;
  temporalStatus: "current" | "historical" | "unknown";
}

export interface QueryOptions {
  afterId?: number;
  connectionId?: string;
  factOwner?: string;
  kind?: string;
  limit?: number;
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

export interface ConnectionStatus {
  connectionId: string;
  lastAttemptAt: null | string;
  reason:
    | "collected"
    | "failed"
    | "incomplete"
    | "never-run"
    | "nothing-new"
    | "skipped";
  status: "changed" | "quiet" | "unread";
}

export interface VerificationFact {
  epistemicStatus: "claim" | "observation";
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
  payloadHashesValid: boolean;
  sourceTimeKeysValid: boolean;
}

export interface CollectionSink {
  recordSourceRecord(facts: () => readonly FactInput[]): void;
}

export class ConnectionConflictError extends Error {
  readonly code = "connection_conflict";

  constructor(_connectionId: string) {
    super("A different configuration is already connected under this id");
    this.name = "ConnectionConflictError";
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
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(
    stateDirectory = defaultStateDirectory(),
    busyTimeoutMilliseconds = BUSY_RETRY_WINDOW_MILLISECONDS,
  ) {
    if (!Number.isInteger(busyTimeoutMilliseconds) || busyTimeoutMilliseconds < 0) {
      throw new RangeError("SQLite busy timeout must be a nonnegative integer");
    }
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    chmodSync(stateDirectory, 0o700);
    this.path = join(stateDirectory, STORE_FILENAME);
    this.#database = new DatabaseSync(this.path, { timeout: busyTimeoutMilliseconds });
    chmodSync(this.path, 0o600);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#migrate();
    this.#database.exec("PRAGMA journal_mode = WAL");
  }

  close(): void {
    if (!this.#closed) {
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
          `INSERT OR IGNORE INTO connection_versions
             (connection_id, config_hash, config_json, registered_at)
           VALUES (?, ?, ?, ?)`,
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

  getConnection(connectionId: string): ActiveConnection {
    const row = this.#database
      .prepare(
        `SELECT c.config_hash, c.activation_id, c.connected_at, v.config_json
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
        };
    if (row === undefined) {
      throw new ConnectionNotFoundError(connectionId);
    }
    return {
      activationId: row.activation_id,
      config: parseStoredConfig(row.config_json, row.config_hash),
      configHash: row.config_hash,
      connectedAt: row.connected_at,
    };
  }

  listConnections(): ActiveConnection[] {
    const rows = this.#database
      .prepare(
        `SELECT c.config_hash, c.activation_id, c.connected_at, v.config_json
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
    }[];
    return rows.map((row) => ({
      activationId: row.activation_id,
      config: parseStoredConfig(row.config_json, row.config_hash),
      configHash: row.config_hash,
      connectedAt: row.connected_at,
    }));
  }

  async collect(
    connection: ActiveConnection,
    producer: (sink: CollectionSink) => Promise<void> | void,
    now: () => Date = () => new Date(),
  ): Promise<CollectionResult> {
    const attemptId = randomUUID();
    let sourceRecordsSeen = 0;
    let factsSeen = 0;
    let factsAdded = 0;
    let factsChanged = 0;
    const preparedFacts: PreparedFact[] = [];
    let admitted: { attemptOrder: number; startedAt: string };

    try {
      admitted = await this.#recordRunningAttempt(connection, attemptId, now);
    } catch (error) {
      throw new CollectionFailedError(attemptId, safeFailureCode(error));
    }
    const { attemptOrder, startedAt } = admitted;

    try {
      const declaredConfig = this.#registeredConfig(connection);
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
      this.#transaction(() => {
        this.#assertActive(connection);
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
            factsAdded += 1;
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
            factsChanged += 1;
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
            factsAdded,
            factsChanged,
            attemptId,
          );
        if (numberOfChanges(completed) !== 1) {
          throw new Error("Collection attempt is not running");
        }
      });
      return {
        attemptId,
        completedAt,
        factsAdded,
        factsChanged,
        factsSeen,
        outcome: "success",
        sourceRecordsSeen,
        startedAt,
      };
    } catch (error) {
      const failureCode = safeFailureCode(error);
      const completedAt = now().toISOString();
      try {
        this.#transaction(() => {
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
      } catch {
        // A durable running marker still makes the connection unread if failure recording is blocked.
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
        `SELECT c.connection_id, COALESCE(a.completed_at, a.started_at) AS last_attempt_at,
                a.outcome, a.facts_added, a.facts_changed
           FROM active_connections c
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
      connection_id: string;
      facts_added: null | number;
      facts_changed: null | number;
      last_attempt_at: null | string;
      outcome: null | "failed" | "running" | "skipped" | "success";
    }[];

    return rows.map((row) => {
      if (row.outcome === null) {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: null,
          reason: "never-run",
          status: "unread",
        };
      }
      if (row.outcome === "running") {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: row.last_attempt_at,
          reason: "incomplete",
          status: "unread",
        };
      }
      if (row.outcome === "failed" || row.outcome === "skipped") {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: row.last_attempt_at,
          reason: row.outcome,
          status: "unread",
        };
      }
      if (row.facts_added === 0 && row.facts_changed === 0) {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: row.last_attempt_at,
          reason: "nothing-new",
          status: "quiet",
        };
      }
      return {
        connectionId: row.connection_id,
        lastAttemptAt: row.last_attempt_at,
        reason: "collected",
        status: "changed",
      };
    });
  }

  queryObservations(options: QueryOptions = {}): StoredFact[] {
    return this.#queryFacts("observation", options);
  }

  queryClaims(options: QueryOptions = {}): StoredFact[] {
    return this.#queryFacts("claim", options);
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

  factsForVerification(connection: ActiveConnection): VerificationSnapshot {
    this.#assertActive(connection);
    const snapshot = this.#readTransaction(() => this.#verificationSnapshot(connection));
    this.#assertActive(connection);
    return snapshot;
  }

  #verificationSnapshot(connection: ActiveConnection): VerificationSnapshot {
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
        `SELECT source_recorded_at, source_time_key, payload_json, payload_hash
           FROM facts
          WHERE connection_id = ?`,
      )
      .all(connection.config.id) as Record<string, unknown>[];
    let payloadHashesValid = true;
    let sourceTimeKeysValid = true;
    for (const record of integrityRows) {
      const expectedSourceTimeKey =
        record.source_recorded_at === null
          ? ""
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
          epistemicStatus: record.epistemic_status as "claim" | "observation",
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
      payloadHashesValid,
      sourceTimeKeysValid,
    };
  }

  #queryFacts(
    epistemicStatus: "claim" | "observation",
    options: QueryOptions,
  ): StoredFact[] {
    const limit = options.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
      throw new RangeError("Query limit must be an integer from 1 through 1000");
    }
    const conditions = ["f.epistemic_status = ?"];
    const parameters: (number | string)[] = [epistemicStatus];
    addFilter(conditions, parameters, "f.fact_id > ?", options.afterId);
    addFilter(conditions, parameters, "f.connection_id = ?", options.connectionId);
    addFilter(conditions, parameters, "f.fact_owner = ?", options.factOwner);
    addFilter(conditions, parameters, "f.kind = ?", options.kind);
    addFilter(conditions, parameters, "f.subject = ?", options.subject);
    parameters.push(limit);

    const rows = this.#database
      .prepare(
        `SELECT f.fact_id, f.connection_id, f.config_hash, f.fact_owner, f.kind,
                f.subject, f.epistemic_status, f.source_record_id,
                f.source_recorded_at, f.payload_json, f.collected_at,
                CASE
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
          WHERE ${conditions.join(" AND ")}
          ORDER BY f.fact_id
          LIMIT ?`,
      )
      .all(...parameters) as unknown as StoredFactRow[];

    return rows.map(storedFactFromRow);
  }

  #migrate(): void {
    this.#transaction(() => {
      const row = this.#database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      if (row.user_version === STORE_SCHEMA_VERSION) {
        return;
      }
      if (
        row.user_version !== 0 &&
        row.user_version !== 1 &&
        row.user_version !== 2 &&
        row.user_version !== 3 &&
        row.user_version !== 4 &&
        row.user_version !== 5
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

        CREATE TABLE collection_attempts (
          attempt_order INTEGER PRIMARY KEY,
          attempt_id TEXT NOT NULL UNIQUE,
          connection_id TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          activation_id TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('running', 'success', 'failed', 'skipped')),
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
            (outcome IN ('running', 'success') AND failure_code IS NULL)
          )
        ) STRICT;

        CREATE INDEX collection_attempts_latest
          ON collection_attempts(
            connection_id, config_hash, activation_id, attempt_order DESC
          );

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

      if (row.user_version === 5) {
        this.#database.exec(`
          CREATE INDEX facts_identity_source_time
            ON facts(
              connection_id, fact_owner, kind, subject, epistemic_status,
              source_time_key
            );
          PRAGMA user_version = ${STORE_SCHEMA_VERSION};
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
        CREATE INDEX facts_identity_source_time
          ON facts(
            connection_id, fact_owner, kind, subject, epistemic_status,
            source_time_key
          );
        PRAGMA user_version = ${STORE_SCHEMA_VERSION};
      `);
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

  async #recordRunningAttempt(
    connection: ActiveConnection,
    attemptId: string,
    now: () => Date,
  ): Promise<{ attemptOrder: number; startedAt: string }> {
    const retryDeadline = performance.now() + BUSY_RETRY_WINDOW_MILLISECONDS;
    while (true) {
      try {
        return this.#transaction(() => {
          this.#assertActive(connection);
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
      } catch (error) {
        if (!isSqliteBusy(error)) {
          throw error;
        }
        const retryDelay = Math.min(10, retryDeadline - performance.now());
        if (retryDelay <= 0) {
          throw new StoreContentionError(error);
        }
        await delay(retryDelay);
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

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
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

interface StoredFactRow {
  collected_at: string;
  config_hash: string;
  connection_id: string;
  epistemic_status: "claim" | "observation";
  fact_id: number;
  fact_owner: string;
  kind: string;
  payload_json: string;
  source_record_id: string;
  source_recorded_at: null | string;
  subject: string;
  temporal_status: "current" | "historical" | "unknown";
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

function storedFactFromRow(row: StoredFactRow): StoredFact {
  return {
    id: row.fact_id,
    collectedAt: row.collected_at,
    connectionId: row.connection_id,
    connectionVersion: row.config_hash,
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
    ["subject", fact.subject],
    ["sourceRecordId", fact.sourceRecordId],
  ] as const) {
    if (
      typeof value !== "string" ||
      Buffer.from(value, "utf8").toString("utf8") !== value
    ) {
      throw new TypeError(`Fact ${field} is not a lossless SQLite string`);
    }
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
    throw new TypeError("Fact is not declared by the registered connection");
  }
  for (const [key, value] of Object.entries(fact.payload)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))
    ) {
      throw new TypeError(`Fact payload ${key} cannot be persisted exactly`);
    }
  }
  if (fact.sourceRecordedAt === null) {
    return "";
  }
  const sourceTimeKey = utcInstantOrderingKey(fact.sourceRecordedAt);
  if (sourceTimeKey === null) {
    throw new TypeError("Fact sourceRecordedAt is not a representable UTC instant");
  }
  return sourceTimeKey;
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

function numberOfChanges(result: StatementResultingChanges): number {
  return Number(result.changes);
}

function isSqliteBusy(error: unknown): boolean {
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
