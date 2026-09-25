export const STORE_SCHEMA_VERSION = 18;
export const LEGACY_REBUILD_SCHEMA_VERSION = 9;

export const CREATE_PROJECTS = `
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
    recorded_at TEXT NOT NULL,
    retry_request_key TEXT
  ) STRICT;
  CREATE INDEX IF NOT EXISTS project_provisioning_current
    ON project_provisioning_events(project_id, event_order DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS project_retry_requests
    ON project_provisioning_events(project_id, retry_request_key) WHERE retry_request_key IS NOT NULL;
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

export const CREATE_COLLECTION_ATTEMPTS = `
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
export const CREATE_COLLECTION_ATTEMPTS_LATEST_INDEX = `
  CREATE INDEX collection_attempts_latest
    ON collection_attempts(
      connection_id, config_hash, activation_id, attempt_order DESC
    );
`;
export const CREATE_COLLECTION_ATTEMPT_RETIREMENTS = `
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
export const CREATE_RECORD_INDEX_MODE_RESOLUTIONS = `
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
export const CREATE_CONFIRMATION_PREVIEWS = `
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
export const CREATE_OWNED_STATE_EXPORTS = `
  CREATE TABLE IF NOT EXISTS owned_state_exports (
    state_fingerprint TEXT NOT NULL PRIMARY KEY,
    export_digest TEXT NOT NULL UNIQUE,
    exported_at TEXT NOT NULL,
    connection_inventories_json TEXT NOT NULL,
    civilization_inventories_json TEXT NOT NULL
  ) STRICT;
`;
export const CREATE_FORGET_RECORDS = `
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
export const CREATE_CIVILIZATION_FORGET_RECORDS = `
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
export const CREATE_INSTITUTION = `
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

export const CREATE_WORK_CLAIMS = `
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

export const CREATE_SOURCE_REPORTS = `
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

// A last-seen order, unlike attempt_id, advances even for identical sightings.
// Never carry absence evidence across configuration or activation boundaries.
export const FACT_COLLECTION_AS_OF_JOIN = `
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
