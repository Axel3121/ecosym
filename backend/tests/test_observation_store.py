import sqlite3
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from observation_store import CollectionAttempt, ObservationStore, Record


class ObservationStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.store_path = Path(self.temporary_directory.name) / "observations.sqlite3"
        self.store = ObservationStore(self.store_path)
        self.observed_at = datetime(2026, 1, 2, 12, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.store.close()
        self.temporary_directory.cleanup()

    def record(self, **changes: object) -> Record:
        record = Record(
            connection_id="synthetic-connection",
            reader_type="jsonl",
            source="fixture://synthetic/events",
            fact_owner="synthetic-owner",
            source_version="event-1",
            kind="synthetic.measurement",
            subject="synthetic-subject-1",
            source_time=self.observed_at - timedelta(minutes=1),
            observed_at=self.observed_at,
            temporal_status="current",
            payload={"value": 7},
            cause_type="synthetic-request",
            cause_id="request-1",
        )
        return replace(record, **changes)

    def test_observation_round_trips_with_provenance(self) -> None:
        record = self.record()

        self.assertTrue(self.store.add_observation(record))

        stored = self.store.observations()
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0].epistemic_status, "observation")
        for field, expected in record.__dict__.items():
            self.assertEqual(getattr(stored[0], field), expected)

    def test_claim_is_not_returned_as_an_observation(self) -> None:
        claim = self.record(cause_type=None, cause_id=None)

        self.assertTrue(self.store.add_claim(claim))

        self.assertEqual(self.store.observations(), [])
        self.assertEqual(len(self.store.claims()), 1)
        self.assertEqual(self.store.claims()[0].epistemic_status, "claim")

    def test_observation_supersedes_current_claim_for_the_same_fact(self) -> None:
        claim = self.record(cause_type=None, cause_id=None)
        observation = self.record(
            connection_id="evidence-connection",
            source="fixture://owner/measurements",
            source_version="measurement-9",
            payload={"value": 9},
        )

        self.assertTrue(self.store.add_claim(claim))
        self.assertTrue(self.store.add_observation(observation))

        self.assertEqual(self.store.current_claims(), [])
        historical_claims = self.store.claims()
        self.assertEqual(len(historical_claims), 1)
        self.assertEqual(historical_claims[0].temporal_status, "superseded")
        self.assertEqual(len(self.store.observations()), 1)

    def test_newer_observation_retires_earlier_without_removing_it(self) -> None:
        earlier = self.record()
        newer = self.record(
            source_version="event-2",
            source_time=earlier.source_time + timedelta(hours=1),
            observed_at=earlier.observed_at + timedelta(hours=1),
            payload={"value": 12},
        )

        self.store.add_observation(earlier)
        self.store.add_observation(newer)

        self.assertEqual(
            self.store.current_observations(), [self.store.observations()[1]]
        )
        history = self.store.observations()
        self.assertEqual(
            [record.payload for record in history], [{"value": 7}, {"value": 12}]
        )
        self.assertEqual(
            [record.temporal_status for record in history], ["superseded", "current"]
        )

    def test_out_of_order_observation_does_not_replace_newer_current_truth(
        self,
    ) -> None:
        newer = self.record(
            source_version="event-2",
            source_time=self.observed_at + timedelta(hours=1),
            payload={"value": 12},
        )
        backfill = self.record(observed_at=self.observed_at + timedelta(hours=2))

        self.store.add_observation(newer)
        self.store.add_observation(backfill)

        self.assertEqual(
            [record.payload for record in self.store.current_observations()],
            [{"value": 12}],
        )
        self.assertEqual(
            [record.temporal_status for record in self.store.observations()],
            ["current", "superseded"],
        )

    def test_unchanged_source_record_is_not_duplicated(self) -> None:
        record = self.record()
        collected_again = replace(
            record, observed_at=record.observed_at + timedelta(minutes=5)
        )

        self.assertTrue(self.store.add_observation(record))
        self.assertFalse(self.store.add_observation(collected_again))

        self.assertEqual(len(self.store.observations()), 1)
        self.assertEqual(self.store.observations()[0].observed_at, record.observed_at)

    def test_unchanged_source_record_is_not_duplicated_after_reopening(self) -> None:
        record = self.record()
        collected_again = replace(
            record, observed_at=record.observed_at + timedelta(minutes=5)
        )

        self.assertTrue(self.store.add_observation(record))
        self.store.close()
        self.store = ObservationStore(self.store_path)

        self.assertFalse(self.store.add_observation(collected_again))
        self.assertEqual(len(self.store.observations()), 1)
        self.assertEqual(self.store.observations()[0].observed_at, record.observed_at)

    def test_version_one_store_migrates_without_rewriting_records(self) -> None:
        claim = self.record(cause_type=None, cause_id=None)
        self.store.add_claim(claim)
        self.store.close()
        with sqlite3.connect(self.store_path) as connection:
            self._restore_legacy_column_names(connection)
            connection.execute("DROP TABLE claim_supersessions")
            connection.execute("DROP TABLE observation_supersessions")
            connection.execute("PRAGMA user_version = 1")

        self.store = ObservationStore(self.store_path)

        self.assertEqual(len(self.store.current_claims()), 1)
        self.store.add_observation(
            self.record(source="fixture://owner/measurements", source_version="v2")
        )
        self.assertEqual(self.store.current_claims(), [])
        self.assertEqual(self.store.claims()[0].temporal_status, "superseded")

    def test_version_two_store_migrates_without_rewriting_records(self) -> None:
        record = self.record()
        self.store.add_observation(record)
        original = self.store.observations()[0]
        self.store.close()
        with sqlite3.connect(self.store_path) as connection:
            self._restore_legacy_column_names(connection)
            connection.execute("DROP TABLE observation_supersessions")
            connection.execute("PRAGMA user_version = 2")

        self.store = ObservationStore(self.store_path)

        self.assertEqual(
            self.store.observations(),
            [replace(original, reader_type=record.connection_id)],
        )
        with sqlite3.connect(self.store_path) as connection:
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 4)

    def test_version_three_store_migrates_identity_without_rewriting_rows(self) -> None:
        record = self.record()
        self.store.add_observation(record)
        self.store.record_attempt(
            CollectionAttempt(
                connection_id=record.connection_id,
                started_at=self.observed_at,
                completed_at=self.observed_at + timedelta(seconds=1),
                outcome="success",
                records_seen=1,
                records_added=1,
            )
        )
        self.store.close()
        with sqlite3.connect(self.store_path) as connection:
            self._restore_legacy_column_names(connection)
            before_record = connection.execute("SELECT * FROM records").fetchone()
            before_attempt = connection.execute(
                "SELECT * FROM collection_attempts"
            ).fetchone()
            connection.execute("PRAGMA user_version = 3")

        self.store = ObservationStore(self.store_path)

        migrated_record = self.store.observations()[0]
        migrated_attempt = self.store.collection_attempts()[0]
        self.assertEqual(migrated_record.id, before_record[0])
        self.assertEqual(migrated_record.connection_id, before_record[1])
        self.assertEqual(migrated_record.reader_type, before_record[1])
        self.assertEqual(migrated_record.payload, record.payload)
        self.assertEqual(migrated_attempt.id, before_attempt[0])
        self.assertEqual(migrated_attempt.connection_id, before_attempt[1])
        with sqlite3.connect(self.store_path) as connection:
            after_record = connection.execute(
                """
                SELECT id, connection_id, source, fact_owner, source_version,
                       kind, subject, source_time, observed_at, temporal_status,
                       epistemic_status, payload_json, cause_type, cause_id
                FROM records
                """
            ).fetchone()
            after_attempt = connection.execute(
                """
                SELECT id, connection_id, started_at, completed_at, outcome,
                       records_seen, records_added
                FROM collection_attempts
                """
            ).fetchone()
            self.assertEqual(after_record, before_record)
            self.assertEqual(after_attempt, before_attempt)
            self.assertEqual(connection.total_changes, 0)
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 4)

    def test_changed_value_adds_to_the_time_series(self) -> None:
        first = self.record()
        second = self.record(
            source_version="event-2",
            source_time=self.observed_at + timedelta(hours=1),
            observed_at=self.observed_at + timedelta(hours=1, minutes=1),
            payload={"value": 12},
        )

        self.store.add_observation(first)
        self.store.add_observation(second)

        stored = self.store.observations()
        self.assertEqual(
            [record.payload for record in stored], [{"value": 7}, {"value": 12}]
        )
        self.assertEqual(
            [record.source_version for record in stored], ["event-1", "event-2"]
        )

    def test_failed_collection_attempt_is_recorded(self) -> None:
        attempt = CollectionAttempt(
            connection_id="synthetic-connection",
            started_at=self.observed_at,
            completed_at=self.observed_at + timedelta(seconds=2),
            outcome="failed",
        )

        stored = self.store.record_attempt(attempt)

        self.assertGreater(stored.id, 0)
        self.assertEqual(self.store.collection_attempts(), [stored])

    def test_unfinished_collection_attempt_survives_as_interrupted(self) -> None:
        started = self.store.begin_attempt("synthetic-connection", self.observed_at)

        self.store.close()
        self.store = ObservationStore(self.store_path)

        self.assertEqual(started.outcome, "interrupted")
        self.assertEqual(self.store.collection_attempts()[0].outcome, "interrupted")

    @staticmethod
    def _restore_legacy_column_names(connection: sqlite3.Connection) -> None:
        connection.execute("ALTER TABLE records RENAME COLUMN connection_id TO adapter")
        connection.execute("ALTER TABLE records DROP COLUMN reader_type")
        connection.execute(
            "ALTER TABLE collection_attempts RENAME COLUMN connection_id TO adapter"
        )
        connection.execute("ALTER TABLE collection_attempts DROP COLUMN in_progress")


if __name__ == "__main__":
    unittest.main()
