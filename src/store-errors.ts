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

export class CollectionAttemptRetirementStateChangedError extends Error {
  readonly code = "collection_attempt_retirement_state_changed";

  constructor() {
    super("The collection attempt changed after retirement confirmation was requested");
    this.name = "CollectionAttemptRetirementStateChangedError";
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

// Internal to the store: store.ts does not re-export it.
export class StoreContentionError extends Error {
  readonly code = "store_contention";

  constructor(cause: unknown) {
    super("Observation store remained busy", { cause });
    this.name = "StoreContentionError";
  }
}
