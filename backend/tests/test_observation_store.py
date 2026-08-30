import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from observation_store import CollectionAttempt, ObservationStore, Record


class ObservationStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.store = ObservationStore(
            Path(self.temporary_directory.name) / "observations.sqlite3"
        )
        self.observed_at = datetime(2026, 1, 2, 12, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.store.close()
        self.temporary_directory.cleanup()

    def record(self, **changes: object) -> Record:
        record = Record(
            adapter="synthetic-adapter",
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

    def test_unchanged_source_record_is_not_duplicated(self) -> None:
        record = self.record()
        collected_again = replace(
            record, observed_at=record.observed_at + timedelta(minutes=5)
        )

        self.assertTrue(self.store.add_observation(record))
        self.assertFalse(self.store.add_observation(collected_again))

        self.assertEqual(len(self.store.observations()), 1)
        self.assertEqual(self.store.observations()[0].observed_at, record.observed_at)

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
            adapter="synthetic-adapter",
            started_at=self.observed_at,
            completed_at=self.observed_at + timedelta(seconds=2),
            outcome="failed",
        )

        stored = self.store.record_attempt(attempt)

        self.assertGreater(stored.id, 0)
        self.assertEqual(self.store.collection_attempts(), [stored])


if __name__ == "__main__":
    unittest.main()
