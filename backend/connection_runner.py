"""Map generic source rows into records, collect them, and verify reality."""

from __future__ import annotations

import json
import math
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Literal

from connection_config import ConnectionConfig, RecordMapping, ValueExpression
from observation_store import (
    JsonValue,
    ObservationConflictError,
    ObservationStore,
    Record,
    StoredRecord,
)
from source_readers import SourceRow, SourceUnreadError, read_input

HealthState = Literal["changed", "quiet", "unread"]


@dataclass(frozen=True)
class MappedRecord:
    record: Record
    epistemic_status: Literal["observation", "claim"]
    mapping: RecordMapping


@dataclass(frozen=True)
class CollectionResult:
    connection_id: str
    readable: bool
    records_seen: int | None = None
    records_added: int | None = None


@dataclass(frozen=True)
class ConnectionHealth:
    connection_id: str
    state: HealthState
    last_outcome: str


@dataclass(frozen=True)
class VerificationResult:
    connection_id: str
    readable: bool
    missing: int = 0
    changed: int = 0
    uncollected: int = 0
    pending: int = 0

    @property
    def disagrees(self) -> bool:
        return self.missing + self.changed + self.uncollected > 0


def collect_connection(
    config: ConnectionConfig,
    store: ObservationStore,
    now: Callable[[], datetime] | None = None,
) -> CollectionResult:
    clock = now or _utc_now
    started_at = clock()
    attempt = store.begin_attempt(config.connection_id, started_at)
    try:
        mapped = read_connection(config, started_at)
        _check_existing_conflicts(
            mapped, store.records_for_connection(config.connection_id)
        )
        added = 0
        for value in mapped:
            if value.epistemic_status == "observation":
                added += store.add_observation(value.record)
            else:
                added += store.add_claim(value.record)
        store.complete_attempt(
            attempt.id,
            completed_at=clock(),
            outcome="success",
            records_seen=len(mapped),
            records_added=added,
        )
        return CollectionResult(config.connection_id, True, len(mapped), added)
    except (
        SourceUnreadError,
        ObservationConflictError,
        sqlite3.Error,
        OSError,
        ValueError,
    ):
        store.complete_attempt(attempt.id, completed_at=clock(), outcome="failed")
        return CollectionResult(config.connection_id, False)


def read_connection(
    config: ConnectionConfig, observed_at: datetime | None = None
) -> list[MappedRecord]:
    seen_at = observed_at or _utc_now()
    mapped: list[MappedRecord] = []
    identities: set[tuple[str, str, str, str, str]] = set()
    for input_config in config.inputs:
        for row in read_input(input_config):
            for mapping in input_config.mappings:
                value = _map_row(config.connection_id, row, mapping, seen_at)
                if value is None:
                    continue
                identity = _mapped_identity(value)
                if identity in identities:
                    raise SourceUnreadError("source record identity is not unique")
                identities.add(identity)
                mapped.append(value)
    return mapped


def connection_health(connection_id: str, store: ObservationStore) -> ConnectionHealth:
    attempts = store.collection_attempts(connection_id)
    if not attempts:
        return ConnectionHealth(connection_id, "unread", "never-run")
    latest = attempts[-1]
    if latest.outcome != "success":
        return ConnectionHealth(connection_id, "unread", latest.outcome)
    state: HealthState = "quiet" if latest.records_added == 0 else "changed"
    return ConnectionHealth(connection_id, state, "success")


def verify_connection(
    config: ConnectionConfig, store: ObservationStore
) -> VerificationResult:
    try:
        source_records = read_connection(config)
    except SourceUnreadError:
        return VerificationResult(config.connection_id, False)

    stored_records = store.records_for_connection(config.connection_id)
    source_by_identity = {_mapped_identity(value): value for value in source_records}
    stored_by_identity = {_stored_identity(value): value for value in stored_records}
    mapping_by_kind = {
        mapping.kind: mapping
        for input_config in config.inputs
        for mapping in input_config.mappings
    }

    missing = 0
    changed = 0
    uncollected = 0
    pending = 0
    stored_fact_times: dict[tuple[str, str, str, str], list[datetime]] = {}
    for value in stored_records:
        fact = (
            value.epistemic_status,
            value.fact_owner,
            value.kind,
            value.subject,
        )
        if value.source_time is not None:
            stored_fact_times.setdefault(fact, []).append(value.source_time)

    for identity, stored in stored_by_identity.items():
        source = source_by_identity.get(identity)
        if source is not None:
            if not _same_comparable_record(source.record, stored):
                changed += 1
            continue
        mapping = mapping_by_kind.get(stored.kind)
        if mapping is None or mapping.comparison.source_mode == "append_only":
            missing += 1

    for identity, source in source_by_identity.items():
        if identity in stored_by_identity:
            continue
        record = source.record
        fact = (
            source.epistemic_status,
            record.fact_owner,
            record.kind,
            record.subject,
        )
        earlier = stored_fact_times.get(fact, [])
        if (
            source.mapping.comparison.newer_is_next
            and record.source_time is not None
            and earlier
            and record.source_time > max(earlier)
        ):
            pending += 1
        else:
            uncollected += 1

    return VerificationResult(
        config.connection_id,
        True,
        missing=missing,
        changed=changed,
        uncollected=uncollected,
        pending=pending,
    )


def format_collection(result: CollectionResult) -> str:
    if not result.readable:
        return f"{result.connection_id}: unread"
    return (
        f"{result.connection_id}: collected "
        f"seen={result.records_seen} added={result.records_added}"
    )


def format_health(health: ConnectionHealth) -> str:
    return f"{health.connection_id}: {health.state} ({health.last_outcome})"


def format_verification(result: VerificationResult) -> str:
    if not result.readable:
        return f"{result.connection_id}: unread"
    if result.disagrees:
        return (
            f"{result.connection_id}: disagree missing={result.missing} "
            f"changed={result.changed} uncollected={result.uncollected} "
            f"pending={result.pending}"
        )
    return f"{result.connection_id}: ok pending={result.pending}"


def _map_row(
    connection_id: str,
    row: SourceRow,
    mapping: RecordMapping,
    observed_at: datetime,
) -> MappedRecord | None:
    if mapping.when is not None:
        condition_value = _lookup(row, mapping.when.field)
        if mapping.when.operator == "is_null" and condition_value is not None:
            return None
        if mapping.when.operator == "is_not_null" and condition_value is None:
            return None

    subject = _required_scalar(_evaluate(row, mapping.subject), "subject")
    version_values = [
        _required_scalar(_evaluate(row, expression), "source_version")
        for expression in mapping.source_version
    ]
    source_version = json.dumps(
        version_values, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )
    source_time = (
        None
        if mapping.source_time is None
        else _timestamp(
            _evaluate(row, mapping.source_time.value), mapping.source_time.format
        )
    )
    payload: dict[str, JsonValue] = {}
    for name, expression in mapping.payload:
        value = _evaluate(row, expression)
        if isinstance(value, (dict, list)):
            raise SourceUnreadError("mapped payload values must be scalar")
        payload[name] = value
    try:
        json.dumps(payload, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise SourceUnreadError("mapped payload is not valid JSON") from exc

    record = Record(
        connection_id=connection_id,
        reader_type=row.reader_type,
        source=row.source,
        fact_owner=mapping.fact_owner,
        source_version=source_version,
        kind=mapping.kind,
        subject=_canonical_json(subject),
        source_time=source_time,
        observed_at=observed_at,
        temporal_status=mapping.temporal_status,
        payload=payload,
    )
    return MappedRecord(record, mapping.epistemic_status, mapping)


def _evaluate(row: SourceRow, expression: ValueExpression) -> JsonValue:
    if expression.has_literal:
        value = expression.literal
    elif expression.coalesce:
        value = None
        for choice in expression.coalesce:
            value = _evaluate(row, choice)
            if value is not None:
                break
    elif expression.field is not None:
        value = _lookup(row, expression.field)
    else:
        raise SourceUnreadError("value expression is incomplete")
    if expression.transform == "is_not_null":
        return value is not None
    return value


def _lookup(row: SourceRow, field: str) -> JsonValue:
    namespace, *parts = field.split(".")
    current: JsonValue
    if namespace == "item":
        current = row.item
    elif namespace == "root":
        current = row.root
    else:
        current = row.metadata
    for part in parts:
        if not isinstance(current, dict) or part not in current:
            raise SourceUnreadError("configured source field is absent")
        current = current[part]
    return current


def _timestamp(value: JsonValue, format_value: str) -> datetime | None:
    if value is None:
        return None
    try:
        if format_value == "unix":
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise ValueError
            result = datetime.fromtimestamp(value, tz=timezone.utc)
        elif format_value == "date":
            if not isinstance(value, str):
                raise ValueError
            result = datetime.combine(date.fromisoformat(value), time(), timezone.utc)
        else:
            if not isinstance(value, str):
                raise ValueError
            result = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if result.tzinfo is None or result.utcoffset() is None:
                raise ValueError
    except (ValueError, OverflowError, OSError) as exc:
        raise SourceUnreadError("configured source timestamp is invalid") from exc
    return result


def _required_scalar(value: JsonValue, context: str) -> str | int | float | bool:
    if value is None or not isinstance(value, (bool, int, float, str)):
        raise SourceUnreadError(f"mapped {context} must be a scalar")
    if isinstance(value, float) and not math.isfinite(value):
        raise SourceUnreadError(f"mapped {context} must be finite")
    if isinstance(value, str) and not value:
        raise SourceUnreadError(f"mapped {context} must not be empty")
    return value


def _mapped_identity(value: MappedRecord) -> tuple[str, str, str, str, str]:
    record = value.record
    return (
        value.epistemic_status,
        record.source,
        record.kind,
        record.subject,
        record.source_version,
    )


def _stored_identity(value: StoredRecord) -> tuple[str, str, str, str, str]:
    return (
        value.epistemic_status,
        value.source,
        value.kind,
        value.subject,
        value.source_version,
    )


def _same_comparable_record(expected: Record, stored: StoredRecord) -> bool:
    return (
        expected.fact_owner == stored.fact_owner
        and expected.source_time == stored.source_time
        and _canonical_json(expected.payload) == _canonical_json(stored.payload)
    )


def _check_existing_conflicts(
    source: list[MappedRecord], stored: list[StoredRecord]
) -> None:
    by_identity = {_stored_identity(value): value for value in stored}
    for value in source:
        existing = by_identity.get(_mapped_identity(value))
        if existing is not None and not _same_comparable_record(value.record, existing):
            raise ObservationConflictError(
                "source identity already exists with different contents"
            )


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _canonical_json(value: JsonValue) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False
    )
