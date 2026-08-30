"""Durable storage for source-independent observations and claims.

A fact is identified by its owner, kind, and subject. Provenance and source
versions identify statements about that fact, not the fact itself. A current
observation supersedes current observations for the same fact only when its
source time is strictly newer, so an out-of-order backfill cannot replace newer
truth. When an observation arrives, it also supersedes current claims for the
same fact.

Stored records are immutable through this module: supersession is recorded
separately, and the store never updates or deletes a record. This is a property
of this code, not a guarantee enforced by the database; direct SQLite clients
can update or delete rows.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, Self

EpistemicStatus = Literal["observation", "claim"]
TemporalStatus = Literal["current", "superseded", "unknown"]
AttemptOutcome = Literal["success", "failed", "skipped", "interrupted"]
JsonValue = None | bool | int | float | str | list["JsonValue"] | dict[str, "JsonValue"]


@dataclass(frozen=True)
class Record:
    connection_id: str
    reader_type: str | None
    source: str
    fact_owner: str
    source_version: str
    kind: str
    subject: str
    source_time: datetime | None
    observed_at: datetime
    temporal_status: TemporalStatus
    payload: JsonValue
    cause_type: str | None = None
    cause_id: str | None = None


@dataclass(frozen=True)
class StoredRecord(Record):
    id: int = 0
    epistemic_status: EpistemicStatus = "observation"


@dataclass(frozen=True)
class CollectionAttempt:
    connection_id: str
    started_at: datetime
    completed_at: datetime
    outcome: AttemptOutcome
    records_seen: int | None = None
    records_added: int | None = None


@dataclass(frozen=True)
class StoredCollectionAttempt(CollectionAttempt):
    id: int = 0


class ObservationConflictError(ValueError):
    """The same source identity was presented with different contents."""


class ObservationStore:
    """SQLite-backed, source-independent observation storage."""

    def __init__(self, path: str | Path) -> None:
        self._connection = sqlite3.connect(path)
        self._connection.row_factory = sqlite3.Row
        try:
            self._create_schema()
        except BaseException:
            self._connection.close()
            raise

    def close(self) -> None:
        self._connection.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def add_observation(self, record: Record) -> bool:
        return self._add_record(record, "observation")

    def add_claim(self, record: Record) -> bool:
        return self._add_record(record, "claim")

    def observations(self) -> list[StoredRecord]:
        return self._records("observation")

    def current_observations(self) -> list[StoredRecord]:
        return self._records("observation", current_only=True)

    def claims(self) -> list[StoredRecord]:
        return self._records("claim")

    def current_claims(self) -> list[StoredRecord]:
        return self._records("claim", current_only=True)

    def record_attempt(self, attempt: CollectionAttempt) -> StoredCollectionAttempt:
        _validate_attempt(attempt)
        if attempt.outcome == "interrupted":
            raise ValueError("interrupted attempts must be created with begin_attempt")
        with self._connection:
            cursor = self._connection.execute(
                """
                INSERT INTO collection_attempts (
                    connection_id, started_at, completed_at, outcome,
                    records_seen, records_added, in_progress
                ) VALUES (?, ?, ?, ?, ?, ?, 0)
                """,
                (
                    _required(attempt.connection_id, "connection_id"),
                    _time(attempt.started_at, "started_at"),
                    _time(attempt.completed_at, "completed_at"),
                    attempt.outcome,
                    attempt.records_seen,
                    attempt.records_added,
                ),
            )
        return StoredCollectionAttempt(**attempt.__dict__, id=cursor.lastrowid)

    def begin_attempt(
        self, connection_id: str, started_at: datetime
    ) -> StoredCollectionAttempt:
        """Record an attempt before source I/O so interruption remains visible."""
        started = _time(started_at, "started_at")
        with self._connection:
            cursor = self._connection.execute(
                """
                INSERT INTO collection_attempts (
                    connection_id, started_at, completed_at, outcome,
                    records_seen, records_added, in_progress
                ) VALUES (?, ?, ?, 'failed', NULL, NULL, 1)
                """,
                (_required(connection_id, "connection_id"), started, started),
            )
        return StoredCollectionAttempt(
            id=cursor.lastrowid,
            connection_id=connection_id,
            started_at=started_at,
            completed_at=started_at,
            outcome="interrupted",
        )

    def complete_attempt(
        self,
        attempt_id: int,
        *,
        completed_at: datetime,
        outcome: Literal["success", "failed", "skipped"],
        records_seen: int | None = None,
        records_added: int | None = None,
    ) -> StoredCollectionAttempt:
        row = self._connection.execute(
            "SELECT * FROM collection_attempts WHERE id = ?", (attempt_id,)
        ).fetchone()
        if row is None:
            raise ValueError("collection attempt does not exist")
        if not row["in_progress"]:
            raise ValueError("collection attempt is already complete")

        attempt = CollectionAttempt(
            connection_id=row["connection_id"],
            started_at=datetime.fromisoformat(row["started_at"]),
            completed_at=completed_at,
            outcome=outcome,
            records_seen=records_seen,
            records_added=records_added,
        )
        _validate_attempt(attempt)
        with self._connection:
            self._connection.execute(
                """
                UPDATE collection_attempts
                SET completed_at = ?, outcome = ?, records_seen = ?,
                    records_added = ?, in_progress = 0
                WHERE id = ? AND in_progress = 1
                """,
                (
                    _time(completed_at, "completed_at"),
                    outcome,
                    records_seen,
                    records_added,
                    attempt_id,
                ),
            )
        return StoredCollectionAttempt(**attempt.__dict__, id=attempt_id)

    def collection_attempts(
        self, connection_id: str | None = None
    ) -> list[StoredCollectionAttempt]:
        if connection_id is None:
            rows = self._connection.execute(
                "SELECT * FROM collection_attempts ORDER BY id"
            ).fetchall()
        else:
            rows = self._connection.execute(
                """
                SELECT * FROM collection_attempts
                WHERE connection_id = ? ORDER BY id
                """,
                (connection_id,),
            ).fetchall()
        return [_attempt_from_row(row) for row in rows]

    def records_for_connection(self, connection_id: str) -> list[StoredRecord]:
        rows = self._connection.execute(
            """
            SELECT records.*,
                   (claim_supersessions.claim_id IS NOT NULL
                    OR observation_supersessions.observation_id IS NOT NULL)
                       AS is_superseded
            FROM records
            LEFT JOIN claim_supersessions ON claim_supersessions.claim_id = records.id
            LEFT JOIN observation_supersessions
                ON observation_supersessions.observation_id = records.id
            WHERE records.connection_id = ?
            ORDER BY records.id
            """,
            (connection_id,),
        ).fetchall()
        return [_record_from_row(row) for row in rows]

    def _add_record(self, record: Record, epistemic_status: EpistemicStatus) -> bool:
        values = _record_values(record, epistemic_status)
        with self._connection:
            cursor = self._connection.execute(
                """
                INSERT OR IGNORE INTO records (
                    connection_id, reader_type, source, fact_owner,
                    source_version, kind, subject, source_time, observed_at,
                    temporal_status, epistemic_status, payload_json,
                    cause_type, cause_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                values,
            )
            if cursor.rowcount == 1:
                if epistemic_status == "observation":
                    self._supersede_observations(cursor.lastrowid, record)
                    self._supersede_claims(cursor.lastrowid, record)
                return True

            existing = self._connection.execute(
                """
                SELECT connection_id, reader_type, source, fact_owner,
                       source_version, kind, subject, source_time,
                       temporal_status, epistemic_status, payload_json,
                       cause_type, cause_id
                FROM records
                WHERE connection_id = ? AND source = ? AND kind = ? AND subject = ?
                      AND source_version = ? AND epistemic_status = ?
                """,
                (
                    record.connection_id,
                    record.source,
                    record.kind,
                    record.subject,
                    record.source_version,
                    epistemic_status,
                ),
            ).fetchone()
            source_contents = values[:8] + values[9:]
            existing_contents = list(existing)
            if existing_contents[1] is None:
                existing_contents[1] = record.reader_type
            if tuple(existing_contents) != source_contents:
                raise ObservationConflictError(
                    "source identity already exists with different contents"
                )
            if epistemic_status == "observation":
                observation_id = self._connection.execute(
                    """
                    SELECT id FROM records
                    WHERE connection_id = ? AND source = ? AND kind = ?
                          AND subject = ?
                          AND source_version = ? AND epistemic_status = 'observation'
                    """,
                    (
                        record.connection_id,
                        record.source,
                        record.kind,
                        record.subject,
                        record.source_version,
                    ),
                ).fetchone()[0]
                self._supersede_observations(observation_id, record)
                self._supersede_claims(observation_id, record)
        return False

    def _supersede_observations(self, observation_id: int, record: Record) -> None:
        if record.temporal_status != "current" or record.source_time is None:
            return

        candidates = self._connection.execute(
            """
            SELECT id, source_time FROM records
            WHERE id != ? AND epistemic_status = 'observation'
                  AND temporal_status = 'current' AND source_time IS NOT NULL
                  AND fact_owner = ? AND kind = ? AND subject = ?
            """,
            (observation_id, record.fact_owner, record.kind, record.subject),
        ).fetchall()
        earlier_ids = [
            candidate["id"]
            for candidate in candidates
            if datetime.fromisoformat(candidate["source_time"]) < record.source_time
        ]
        self._connection.executemany(
            """
            INSERT OR IGNORE INTO observation_supersessions (
                observation_id, superseding_observation_id
            ) VALUES (?, ?)
            """,
            ((earlier_id, observation_id) for earlier_id in earlier_ids),
        )
        later = max(
            (
                (datetime.fromisoformat(candidate["source_time"]), candidate["id"])
                for candidate in candidates
                if datetime.fromisoformat(candidate["source_time"]) > record.source_time
            ),
            default=None,
        )
        if later is not None:
            self._connection.execute(
                """
                INSERT OR IGNORE INTO observation_supersessions (
                    observation_id, superseding_observation_id
                ) VALUES (?, ?)
                """,
                (observation_id, later[1]),
            )

    def _supersede_claims(self, observation_id: int, record: Record) -> None:
        self._connection.execute(
            """
            INSERT OR IGNORE INTO claim_supersessions (claim_id, observation_id)
            SELECT id, ? FROM records
            WHERE epistemic_status = 'claim' AND temporal_status = 'current'
                  AND fact_owner = ? AND kind = ? AND subject = ?
            """,
            (observation_id, record.fact_owner, record.kind, record.subject),
        )

    def _records(
        self, epistemic_status: EpistemicStatus, current_only: bool = False
    ) -> list[StoredRecord]:
        supersession_column = (
            "claim_supersessions.claim_id"
            if epistemic_status == "claim"
            else "observation_supersessions.observation_id"
        )
        current_filter = (
            f" AND records.temporal_status = 'current'"
            f" AND {supersession_column} IS NULL"
            if current_only
            else ""
        )
        rows = self._connection.execute(
            f"""
            SELECT records.*,
                   ({supersession_column} IS NOT NULL) AS is_superseded
            FROM records
            LEFT JOIN claim_supersessions ON claim_supersessions.claim_id = records.id
            LEFT JOIN observation_supersessions
                ON observation_supersessions.observation_id = records.id
            WHERE epistemic_status = ?{current_filter}
            ORDER BY id
            """,
            (epistemic_status,),
        ).fetchall()
        return [_record_from_row(row) for row in rows]

    def _create_schema(self) -> None:
        version = self._connection.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1, 2, 3, 4):
            raise RuntimeError(
                f"unsupported observation store schema version: {version}"
            )
        if version == 4:
            return

        if version == 0:
            self._execute_schema_script(
                """
                CREATE TABLE records (
                    id INTEGER PRIMARY KEY,
                    connection_id TEXT NOT NULL,
                    reader_type TEXT NOT NULL,
                    source TEXT NOT NULL,
                    fact_owner TEXT NOT NULL,
                    source_version TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    subject TEXT NOT NULL,
                    source_time TEXT,
                    observed_at TEXT NOT NULL,
                    temporal_status TEXT NOT NULL CHECK (
                        temporal_status IN ('current', 'superseded', 'unknown')
                    ),
                    epistemic_status TEXT NOT NULL CHECK (
                        epistemic_status IN ('observation', 'claim')
                    ),
                    payload_json TEXT NOT NULL,
                    cause_type TEXT,
                    cause_id TEXT,
                    CHECK ((cause_type IS NULL) = (cause_id IS NULL)),
                    UNIQUE (
                        connection_id, source, kind, subject, source_version,
                        epistemic_status
                    )
                );

                CREATE TABLE collection_attempts (
                    id INTEGER PRIMARY KEY,
                    connection_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    completed_at TEXT NOT NULL,
                    outcome TEXT NOT NULL CHECK (
                        outcome IN ('success', 'failed', 'skipped')
                    ),
                    records_seen INTEGER,
                    records_added INTEGER,
                    in_progress INTEGER NOT NULL DEFAULT 0 CHECK (
                        in_progress IN (0, 1)
                    )
                );
                CREATE TABLE claim_supersessions (
                    claim_id INTEGER PRIMARY KEY REFERENCES records(id),
                    observation_id INTEGER NOT NULL REFERENCES records(id)
                );
                CREATE TABLE observation_supersessions (
                    observation_id INTEGER PRIMARY KEY REFERENCES records(id),
                    superseding_observation_id INTEGER NOT NULL REFERENCES records(id)
                );
                PRAGMA user_version = 4;
                """
            )
            return

        claim_table = (
            """
            CREATE TABLE IF NOT EXISTS claim_supersessions (
                claim_id INTEGER PRIMARY KEY REFERENCES records(id),
                observation_id INTEGER NOT NULL REFERENCES records(id)
            );
            """
            if version < 2
            else ""
        )
        self._execute_schema_script(
            f"""
            {claim_table}
            CREATE TABLE IF NOT EXISTS observation_supersessions (
                observation_id INTEGER PRIMARY KEY REFERENCES records(id),
                superseding_observation_id INTEGER NOT NULL REFERENCES records(id)
            );
            ALTER TABLE records RENAME COLUMN adapter TO connection_id;
            ALTER TABLE records ADD COLUMN reader_type TEXT;
            ALTER TABLE collection_attempts
                RENAME COLUMN adapter TO connection_id;
            ALTER TABLE collection_attempts ADD COLUMN in_progress INTEGER
                NOT NULL DEFAULT 0 CHECK (in_progress IN (0, 1));
            PRAGMA user_version = 4;
            """
        )

    def _execute_schema_script(self, script: str) -> None:
        try:
            self._connection.executescript(f"BEGIN IMMEDIATE;\n{script}\nCOMMIT;")
        except BaseException:
            if self._connection.in_transaction:
                self._connection.rollback()
            raise


def _record_values(
    record: Record, epistemic_status: EpistemicStatus
) -> tuple[object, ...]:
    if record.temporal_status not in ("current", "superseded", "unknown"):
        raise ValueError(f"invalid temporal_status: {record.temporal_status}")
    if (record.cause_type is None) != (record.cause_id is None):
        raise ValueError(
            "cause_type and cause_id must either both be set or both be absent"
        )

    return (
        _required(record.connection_id, "connection_id"),
        _required(record.reader_type, "reader_type"),
        _required(record.source, "source"),
        _required(record.fact_owner, "fact_owner"),
        _required(record.source_version, "source_version"),
        _required(record.kind, "kind"),
        _required(record.subject, "subject"),
        _time(record.source_time, "source_time") if record.source_time else None,
        _time(record.observed_at, "observed_at"),
        record.temporal_status,
        epistemic_status,
        json.dumps(
            record.payload, sort_keys=True, separators=(",", ":"), allow_nan=False
        ),
        record.cause_type,
        record.cause_id,
    )


def _validate_attempt(attempt: CollectionAttempt) -> None:
    if attempt.outcome not in ("success", "failed", "skipped", "interrupted"):
        raise ValueError(f"invalid attempt outcome: {attempt.outcome}")
    if attempt.completed_at < attempt.started_at:
        raise ValueError("completed_at must not be before started_at")
    if attempt.outcome == "success":
        if attempt.records_seen is None or attempt.records_added is None:
            raise ValueError("successful attempts require seen and added record counts")
        if not 0 <= attempt.records_added <= attempt.records_seen:
            raise ValueError("record counts must satisfy 0 <= added <= seen")
    elif attempt.records_seen is not None or attempt.records_added is not None:
        raise ValueError("non-successful attempts cannot report record counts")


def _required(value: str | None, name: str) -> str:
    if not value:
        raise ValueError(f"{name} must not be empty")
    return value


def _time(value: datetime, name: str) -> str:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must include a timezone")
    return value.isoformat()


def _record_from_row(row: sqlite3.Row) -> StoredRecord:
    temporal_status = "superseded" if row["is_superseded"] else row["temporal_status"]
    return StoredRecord(
        id=row["id"],
        connection_id=row["connection_id"],
        reader_type=row["reader_type"],
        source=row["source"],
        fact_owner=row["fact_owner"],
        source_version=row["source_version"],
        kind=row["kind"],
        subject=row["subject"],
        source_time=datetime.fromisoformat(row["source_time"])
        if row["source_time"]
        else None,
        observed_at=datetime.fromisoformat(row["observed_at"]),
        temporal_status=temporal_status,
        epistemic_status=row["epistemic_status"],
        payload=json.loads(row["payload_json"]),
        cause_type=row["cause_type"],
        cause_id=row["cause_id"],
    )


def _attempt_from_row(row: sqlite3.Row) -> StoredCollectionAttempt:
    return StoredCollectionAttempt(
        id=row["id"],
        connection_id=row["connection_id"],
        started_at=datetime.fromisoformat(row["started_at"]),
        completed_at=datetime.fromisoformat(row["completed_at"]),
        outcome="interrupted" if row["in_progress"] else row["outcome"],
        records_seen=row["records_seen"],
        records_added=row["records_added"],
    )
