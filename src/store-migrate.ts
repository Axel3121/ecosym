import type { DatabaseSync } from "node:sqlite";

import { canonicalJson, sha256 } from "./json.ts";
import { parseStoredConfig, usesJsonlRecordIndex } from "./store-rows.ts";
import {
  CREATE_CIVILIZATION_FORGET_RECORDS,
  CREATE_COLLECTION_ATTEMPT_RETIREMENTS,
  CREATE_COLLECTION_ATTEMPTS,
  CREATE_COLLECTION_ATTEMPTS_LATEST_INDEX,
  CREATE_CONFIRMATION_PREVIEWS,
  CREATE_FORGET_RECORDS,
  CREATE_INSTITUTION,
  CREATE_OWNED_STATE_EXPORTS,
  CREATE_PROJECTS,
  CREATE_RECORD_INDEX_MODE_RESOLUTIONS,
  CREATE_SOURCE_REPORTS,
  CREATE_WORK_CLAIMS,
  LEGACY_REBUILD_SCHEMA_VERSION,
  STORE_SCHEMA_VERSION,
} from "./store-schema.ts";
import { runImmediateTransaction, withBusyTimeout } from "./store-sqlite.ts";

/** How long an opener waits for another opener's upgrade to release the write lock. */
export const MIGRATION_BUSY_TIMEOUT_MILLISECONDS = 30_000;

// Defensive bound on dispatch iterations; a legitimate upgrade needs at most a handful.
const MAXIMUM_MIGRATION_ITERATIONS = 32;

/** Bring an opened observation store up to STORE_SCHEMA_VERSION. */
export function migrateStore(database: DatabaseSync, busyTimeoutMilliseconds: number): void {
  new StoreMigration(database).migrate(busyTimeoutMilliseconds);
}

class StoreMigration {
  readonly #database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.#database = database;
  }

  migrate(busyTimeoutMilliseconds: number): void {
    if (this.#userVersion() === STORE_SCHEMA_VERSION) {
      return;
    }
    withBusyTimeout(
      this.#database,
      busyTimeoutMilliseconds,
      MIGRATION_BUSY_TIMEOUT_MILLISECONDS,
      () => this.#migrate(),
    );
  }

  #transaction<T>(operation: () => T): T {
    return runImmediateTransaction(this.#database, operation);
  }

  #userVersion(): number {
    const row = this.#database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    return row.user_version;
  }

  /**
   * Run one step inside the write lock only if the store is still at the
   * version the step upgrades from; another opener may have moved it on.
   */
  #step(from: number, apply: () => void): void {
    this.#transaction(() => {
      if (this.#userVersion() !== from) {
        return;
      }
      apply();
    });
  }

  /**
   * Each pass reads the version outside the lock only as a hint for which step
   * to try; the step itself decides again inside the lock.
   */
  #migrate(): void {
    for (let iteration = 0; iteration < MAXIMUM_MIGRATION_ITERATIONS; iteration += 1) {
      const version = this.#userVersion();
      if (version === STORE_SCHEMA_VERSION) {
        return;
      }
      this.#migrateStep(version);
    }
    throw new Error("Observation store migration did not converge");
  }

  #migrateStep(version: number): void {
    if (version === 17) {
      this.#step(17, () => {
        this.#database.exec(`ALTER TABLE project_provisioning_events ADD COLUMN retry_request_key TEXT;
          CREATE UNIQUE INDEX project_retry_requests
            ON project_provisioning_events(project_id, retry_request_key) WHERE retry_request_key IS NOT NULL;
          PRAGMA user_version = 18;`);
      });
      return;
    }
    if (version === 15) {
      this.#step(15, () => {
        this.#database.exec(CREATE_SOURCE_REPORTS);
        this.#database.exec("PRAGMA user_version = 16");
      });
      return;
    }
    if (version === 16) {
      this.#step(16, () => {
        this.#database.exec(CREATE_PROJECTS);
        this.#database.exec("PRAGMA user_version = 18");
      });
      return;
    }
    if (version === 13) {
      this.#migrateSchemaThirteen();
      return;
    }
    if (version === 14) {
      this.#migrateSchemaFourteen();
      return;
    }
    if (version === 12) {
      this.#step(12, () => {
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
      return;
    }
    if (version === 11) {
      this.#step(11, () => {
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
      return;
    }
    if (version === 10) {
      this.#step(10, () => {
        this.#database.exec(`
          ${CREATE_CONFIRMATION_PREVIEWS}
          ${CREATE_INSTITUTION}
          ${CREATE_OWNED_STATE_EXPORTS}
          ${CREATE_FORGET_RECORDS}
          PRAGMA user_version = 13;
        `);
      });
      return;
    }
    if (version === 9) {
      this.#migrateSchemaNine();
      return;
    }
    this.#migrateLegacy();
  }

  #migrateLegacy(): void {
    this.#transaction(() => {
      const row = this.#database.prepare("PRAGMA user_version").get() as {
        user_version: number;
      };
      // Another opener has already moved past the legacy steps; dispatch continues from there.
      if (
        row.user_version >= LEGACY_REBUILD_SCHEMA_VERSION &&
        row.user_version <= STORE_SCHEMA_VERSION
      ) {
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
  }

  #migrateSchemaNine(): void {
    this.#database.exec("PRAGMA foreign_keys = OFF");
    try {
      this.#step(LEGACY_REBUILD_SCHEMA_VERSION, () => {
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
  }

  #migrateSchemaThirteen(): void {
    this.#step(13, () => {
      const columns = this.#database.prepare("PRAGMA table_info(owned_state_exports)").all() as {
        name: string;
      }[];
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
  }

  #migrateSchemaFourteen(): void {
    this.#step(14, () => {
      this.#database.exec(CREATE_WORK_CLAIMS);
      this.#database.exec(CREATE_SOURCE_REPORTS);
      this.#database.exec("PRAGMA user_version = 16");
    });
  }
}
