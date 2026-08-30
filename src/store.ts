import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type StatementResultingChanges } from "node:sqlite";

import {
  parseConnectionConfig,
  type ConnectionConfig,
  type ParsedConnectionConfig,
} from "./config.ts";
import { canonicalJson, type JsonScalar, type JsonValue, sha256 } from "./json.ts";
import { defaultStateDirectory } from "./paths.ts";

const STORE_SCHEMA_VERSION = 1;
const STORE_FILENAME = "observations.sqlite";

export interface ActiveConnection {
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
  factsSeen: number;
  outcome: "success";
  sourceRecordsSeen: number;
  startedAt: string;
}

export interface ConnectionStatus {
  connectionId: string;
  lastAttemptAt: null | string;
  reason: "collected" | "failed" | "never-run" | "nothing-new" | "skipped";
  status: "changed" | "quiet" | "unread";
}

export interface CollectionSink {
  recordSourceRecord(): void;
  writeFact(fact: FactInput): boolean;
}

export interface SafeFailure {
  readonly code: string;
}

export class ConnectionConflictError extends Error {
  readonly code = "connection_conflict";

  constructor(connectionId: string) {
    super(`A different configuration is already connected as ${connectionId}`);
    this.name = "ConnectionConflictError";
  }
}

export class ConnectionNotFoundError extends Error {
  readonly code = "connection_not_found";

  constructor(connectionId: string) {
    super(`No active connection is registered as ${connectionId}`);
    this.name = "ConnectionNotFoundError";
  }
}

export class CollectionFailedError extends Error {
  readonly attemptId: string;
  readonly code: string;

  constructor(attemptId: string, code: string, cause: unknown) {
    super("Collection failed", { cause });
    this.name = "CollectionFailedError";
    this.attemptId = attemptId;
    this.code = code;
  }
}

export class ObservationStore {
  readonly path: string;
  readonly #database: DatabaseSync;
  #closed = false;

  constructor(stateDirectory = defaultStateDirectory()) {
    mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
    chmodSync(stateDirectory, 0o700);
    this.path = join(stateDirectory, STORE_FILENAME);
    this.#database = new DatabaseSync(this.path, { timeout: 5_000 });
    chmodSync(this.path, 0o600);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  register(parsed: ParsedConnectionConfig, now = new Date()): "connected" | "unchanged" {
    const timestamp = now.toISOString();
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
            `INSERT INTO active_connections (connection_id, config_hash, connected_at)
             VALUES (?, ?, ?)`,
          )
          .run(parsed.config.id, parsed.hash, timestamp);
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
        `SELECT c.config_hash, c.connected_at, v.config_json
           FROM active_connections c
           JOIN connection_versions v
             ON v.connection_id = c.connection_id
            AND v.config_hash = c.config_hash
          WHERE c.connection_id = ?`,
      )
      .get(connectionId) as
      | undefined
      | { config_hash: string; config_json: string; connected_at: string };
    if (row === undefined) {
      throw new ConnectionNotFoundError(connectionId);
    }
    return {
      config: parseStoredConfig(row.config_json, row.config_hash),
      configHash: row.config_hash,
      connectedAt: row.connected_at,
    };
  }

  listConnections(): ActiveConnection[] {
    const rows = this.#database
      .prepare(
        `SELECT c.config_hash, c.connected_at, v.config_json
           FROM active_connections c
           JOIN connection_versions v
             ON v.connection_id = c.connection_id
            AND v.config_hash = c.config_hash
          ORDER BY c.connection_id`,
      )
      .all() as { config_hash: string; config_json: string; connected_at: string }[];
    return rows.map((row) => ({
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
    const startedAt = now().toISOString();
    let sourceRecordsSeen = 0;
    let factsSeen = 0;
    let factsAdded = 0;

    this.#database.exec("BEGIN IMMEDIATE");
    try {
      this.#database
        .prepare(
          `INSERT INTO collection_attempts
             (attempt_id, connection_id, config_hash, started_at, outcome,
              source_records_seen, facts_seen, facts_added)
           VALUES (?, ?, ?, ?, 'running', 0, 0, 0)`,
        )
        .run(
          attemptId,
          connection.config.id,
          connection.configHash,
          startedAt,
        );
      const insert = this.#database.prepare(
        `INSERT OR IGNORE INTO facts
           (connection_id, config_hash, attempt_id, fact_owner, kind, subject,
            epistemic_status, source_record_id, source_recorded_at, source_time_key,
            payload_json, payload_hash, collected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const sink: CollectionSink = {
        recordSourceRecord: () => {
          sourceRecordsSeen += 1;
        },
        writeFact: (fact) => {
          factsSeen += 1;
          validateFact(fact);
          const payloadJson = canonicalJson(fact.payload);
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
            fact.sourceRecordedAt ?? "",
            payloadJson,
            sha256(payloadJson),
            startedAt,
          );
          const added = numberOfChanges(result) === 1;
          if (added) {
            factsAdded += 1;
          }
          return added;
        },
      };

      await producer(sink);
      const completedAt = now().toISOString();
      this.#database
        .prepare(
          `UPDATE collection_attempts
              SET completed_at = ?, outcome = 'success', source_records_seen = ?,
                  facts_seen = ?, facts_added = ?
            WHERE attempt_id = ?`,
        )
        .run(completedAt, sourceRecordsSeen, factsSeen, factsAdded, attemptId);
      this.#database.exec("COMMIT");
      return {
        attemptId,
        completedAt,
        factsAdded,
        factsSeen,
        outcome: "success",
        sourceRecordsSeen,
        startedAt,
      };
    } catch (error) {
      if (this.#database.isTransaction) {
        this.#database.exec("ROLLBACK");
      }
      const failureCode = safeFailureCode(error);
      const completedAt = now().toISOString();
      this.#transaction(() => {
        this.#database
          .prepare(
            `INSERT INTO collection_attempts
               (attempt_id, connection_id, config_hash, started_at, completed_at,
                outcome, source_records_seen, facts_seen, facts_added, failure_code)
             VALUES (?, ?, ?, ?, ?, 'failed', 0, 0, 0, ?)`,
          )
          .run(
            attemptId,
            connection.config.id,
            connection.configHash,
            startedAt,
            completedAt,
            failureCode,
          );
      });
      throw new CollectionFailedError(attemptId, failureCode, error);
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
      this.#database
        .prepare(
          `INSERT INTO collection_attempts
             (attempt_id, connection_id, config_hash, started_at, completed_at,
              outcome, source_records_seen, facts_seen, facts_added, failure_code)
           VALUES (?, ?, ?, ?, ?, 'skipped', 0, 0, 0, ?)`,
        )
        .run(
          attemptId,
          connection.config.id,
          connection.configHash,
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
        `SELECT c.connection_id, a.completed_at, a.outcome, a.facts_added
           FROM active_connections c
           LEFT JOIN collection_attempts a ON a.attempt_id = (
             SELECT latest.attempt_id
               FROM collection_attempts latest
              WHERE latest.connection_id = c.connection_id
                AND latest.config_hash = c.config_hash
              ORDER BY latest.rowid DESC
              LIMIT 1
           )
          ORDER BY c.connection_id`,
      )
      .all() as {
      completed_at: null | string;
      connection_id: string;
      facts_added: null | number;
      outcome: null | "failed" | "running" | "skipped" | "success";
    }[];

    return rows.map((row) => {
      if (row.outcome === null || row.outcome === "running") {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: row.completed_at,
          reason: "never-run",
          status: "unread",
        };
      }
      if (row.outcome === "failed" || row.outcome === "skipped") {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: row.completed_at,
          reason: row.outcome,
          status: "unread",
        };
      }
      if (row.facts_added === 0) {
        return {
          connectionId: row.connection_id,
          lastAttemptAt: row.completed_at,
          reason: "nothing-new",
          status: "quiet",
        };
      }
      return {
        connectionId: row.connection_id,
        lastAttemptAt: row.completed_at,
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
                     WHERE newer.fact_owner = f.fact_owner
                       AND newer.kind = f.kind
                       AND newer.subject = f.subject
                       AND newer.epistemic_status = f.epistemic_status
                       AND newer.source_recorded_at > f.source_recorded_at
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
    const row = this.#database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    if (row.user_version === STORE_SCHEMA_VERSION) {
      return;
    }
    if (row.user_version !== 0) {
      throw new Error(`Unsupported observation store schema ${row.user_version}`);
    }

    this.#transaction(() => {
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
          connected_at TEXT NOT NULL,
          FOREIGN KEY (connection_id, config_hash)
            REFERENCES connection_versions(connection_id, config_hash)
        ) STRICT;

        CREATE TABLE collection_attempts (
          attempt_id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          config_hash TEXT NOT NULL,
          started_at TEXT NOT NULL,
          completed_at TEXT,
          outcome TEXT NOT NULL CHECK (outcome IN ('running', 'success', 'failed', 'skipped')),
          source_records_seen INTEGER NOT NULL CHECK (source_records_seen >= 0),
          facts_seen INTEGER NOT NULL CHECK (facts_seen >= 0),
          facts_added INTEGER NOT NULL CHECK (facts_added >= 0),
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
          ON collection_attempts(connection_id, config_hash, started_at DESC);

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
        CREATE INDEX facts_source_version
          ON facts(connection_id, config_hash, source_record_id, source_time_key);

        PRAGMA user_version = ${STORE_SCHEMA_VERSION};
      `);
    });
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

function validateFact(fact: FactInput): void {
  for (const [key, value] of Object.entries(fact.payload)) {
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))
    ) {
      throw new TypeError(`Fact payload ${key} is not a finite JSON scalar`);
    }
  }
  if (fact.sourceRecordedAt !== null && Number.isNaN(Date.parse(fact.sourceRecordedAt))) {
    throw new TypeError("Fact sourceRecordedAt is not a timestamp");
  }
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
