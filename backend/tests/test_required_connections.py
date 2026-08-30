import io
import json
import sqlite3
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

import connected_sources
from connection_config import parse_connection, state_layout
from connection_runner import collect_connection, verify_connection
from observation_store import ObservationStore


def hermes_delegations_connection(path: Path) -> dict[str, object]:
    return {
        "version": 1,
        "connection_id": "hermes-delegations",
        "inputs": [
            {
                "id": "delegations",
                "reader": {
                    "type": "sqlite",
                    "path": str(path),
                    "table": "async_delegations",
                    "columns": [
                        "delegation_id",
                        "state",
                        "dispatched_at",
                        "completed_at",
                    ],
                },
                "mappings": [
                    {
                        "id": "delegation-state",
                        "epistemic_status": "observation",
                        "fact_owner": "hermes",
                        "kind": "hermes.delegation.state",
                        "subject": "item.delegation_id",
                        "source_version": [
                            "item.delegation_id",
                            "item.state",
                            "item.dispatched_at",
                            {
                                "coalesce": [
                                    "item.completed_at",
                                    {"literal": "absent"},
                                ]
                            },
                        ],
                        "source_time": {
                            "coalesce": [
                                "item.completed_at",
                                "item.dispatched_at",
                            ],
                            "format": "unix",
                        },
                        "temporal_status": "current",
                        "payload": {
                            "state": "item.state",
                            "dispatched_at": "item.dispatched_at",
                            "completed_at": "item.completed_at",
                        },
                        "comparison": {
                            "source_mode": "rolling_snapshot",
                            "newer_is_next": True,
                        },
                    }
                ],
            }
        ],
    }


def hermes_cron_connection(path: Path) -> dict[str, object]:
    return {
        "version": 1,
        "connection_id": "hermes-cron",
        "inputs": [
            {
                "id": "executions",
                "reader": {
                    "type": "sqlite",
                    "path": str(path),
                    "table": "executions",
                    "columns": [
                        "id",
                        "job_id",
                        "status",
                        "claimed_at",
                        "started_at",
                        "finished_at",
                        {
                            "field": "error",
                            "as": "error_recorded",
                            "transform": "is_not_null",
                        },
                    ],
                },
                "mappings": [
                    {
                        "id": "execution-state",
                        "epistemic_status": "observation",
                        "fact_owner": "hermes",
                        "kind": "hermes.cron.execution.state",
                        "subject": "item.id",
                        "source_version": [
                            "item.id",
                            "item.status",
                            "item.claimed_at",
                            {
                                "coalesce": [
                                    "item.started_at",
                                    {"literal": "absent"},
                                ]
                            },
                            {
                                "coalesce": [
                                    "item.finished_at",
                                    {"literal": "absent"},
                                ]
                            },
                            "item.error_recorded",
                        ],
                        "source_time": {
                            "coalesce": [
                                "item.finished_at",
                                "item.started_at",
                                "item.claimed_at",
                            ],
                            "format": "iso8601",
                        },
                        "temporal_status": "current",
                        "payload": {
                            "job_id": "item.job_id",
                            "status": "item.status",
                            "claimed_at": "item.claimed_at",
                            "started_at": "item.started_at",
                            "finished_at": "item.finished_at",
                            "error_recorded": "item.error_recorded",
                        },
                        "comparison": {
                            "source_mode": "rolling_snapshot",
                            "newer_is_next": True,
                        },
                    }
                ],
            }
        ],
    }


def shorts_uploads_connection(
    uploads_path: Path, learning_path: Path
) -> dict[str, object]:
    return {
        "version": 1,
        "connection_id": "shorts-uploads",
        "inputs": [
            {
                "id": "uploads",
                "reader": {"type": "jsonl", "path": str(uploads_path)},
                "mappings": [
                    {
                        "id": "publication",
                        "epistemic_status": "observation",
                        "fact_owner": "youtube",
                        "kind": "youtube.upload-log.publication",
                        "subject": "item.video_id",
                        "source_version": [
                            "item.video_id",
                            "item.uploaded_at",
                        ],
                        "source_time": {
                            "field": "item.uploaded_at",
                            "format": "iso8601",
                        },
                        "temporal_status": "current",
                        "payload": {"privacy": "item.privacy"},
                        "comparison": {
                            "source_mode": "rolling_snapshot",
                            "newer_is_next": False,
                        },
                    },
                    {
                        "id": "deletion-marker",
                        "epistemic_status": "observation",
                        "fact_owner": "shorts-content",
                        "kind": "shorts-content.upload-log.deletion-marker",
                        "subject": "item.video_id",
                        "source_version": [
                            "item.video_id",
                            "item.uploaded_at",
                            "item.deleted",
                        ],
                        "source_time": None,
                        "temporal_status": "unknown",
                        "payload": {"deleted": "item.deleted"},
                        "comparison": {
                            "source_mode": "rolling_snapshot",
                            "newer_is_next": False,
                        },
                    },
                ],
            },
            {
                "id": "learning-log",
                "reader": {"type": "jsonl", "path": str(learning_path)},
                "mappings": [
                    {
                        "id": "day7-outcome",
                        "epistemic_status": "observation",
                        "fact_owner": "youtube",
                        "kind": "youtube.learning-log.day7-metrics",
                        "subject": "item.video_id",
                        "source_version": [
                            "item.video_id",
                            "item.published_at",
                            "item.day7_stats.views",
                            "item.day7_stats.avg_view_duration",
                            "item.day7_stats.swipe_away_pct",
                            "item.day7_stats.retention_curve_shape",
                        ],
                        "source_time": None,
                        "temporal_status": "unknown",
                        "payload": {
                            "views": "item.day7_stats.views",
                            "avg_view_duration": ("item.day7_stats.avg_view_duration"),
                            "swipe_away_pct": "item.day7_stats.swipe_away_pct",
                            "retention_curve_shape": (
                                "item.day7_stats.retention_curve_shape"
                            ),
                        },
                        "when": {
                            "field": "item.day7_stats",
                            "operator": "is_not_null",
                        },
                        "comparison": {
                            "source_mode": "rolling_snapshot",
                            "newer_is_next": False,
                        },
                    }
                ],
            },
        ],
    }


def _metric_mapping(
    mapping_id: str,
    kind: str,
    field: str,
    output: str,
    source_version: list[str],
    source_time: dict[str, str],
) -> dict[str, object]:
    return {
        "id": mapping_id,
        "epistemic_status": "observation",
        "fact_owner": "youtube",
        "kind": kind,
        "subject": "item.video_id",
        "source_version": source_version,
        "source_time": source_time,
        "temporal_status": "current",
        "payload": {output: field},
        "comparison": {
            "source_mode": "append_only",
            "newer_is_next": True,
        },
    }


def shorts_metrics_connection(
    snapshots_path: Path, analytics_glob: Path
) -> dict[str, object]:
    daily_version = ["root.date", "item.video_id"]
    daily_time = {"field": "root.date", "format": "iso8601"}
    analytics_version = ["root.generated_at", "item.video_id"]
    analytics_window_version = [
        "root.generated_at",
        "item.video_id",
        "item.window.start",
        "item.window.end",
    ]
    analytics_time = {"field": "root.generated_at", "format": "iso8601"}
    return {
        "version": 1,
        "connection_id": "shorts-metrics",
        "inputs": [
            {
                "id": "daily-snapshots",
                "reader": {"type": "jsonl", "path": str(snapshots_path)},
                "items": "videos",
                "mappings": [
                    _metric_mapping(
                        "daily-views",
                        "youtube.daily-snapshot.views",
                        "item.views",
                        "views",
                        daily_version,
                        daily_time,
                    ),
                    _metric_mapping(
                        "daily-likes",
                        "youtube.daily-snapshot.likes",
                        "item.likes",
                        "likes",
                        daily_version,
                        daily_time,
                    ),
                    _metric_mapping(
                        "daily-comments",
                        "youtube.daily-snapshot.comments",
                        "item.comments",
                        "comments",
                        daily_version,
                        daily_time,
                    ),
                ],
            },
            {
                "id": "analytics-reports",
                "reader": {"type": "json", "glob": str(analytics_glob)},
                "items": "videos",
                "mappings": [
                    _metric_mapping(
                        "lifetime-views",
                        "youtube.data-api.lifetime-views",
                        "item.lifetime_views",
                        "views",
                        analytics_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "lifetime-likes",
                        "youtube.data-api.lifetime-likes",
                        "item.lifetime_likes",
                        "likes",
                        analytics_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "lifetime-comments",
                        "youtube.data-api.lifetime-comments",
                        "item.lifetime_comments",
                        "comments",
                        analytics_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-views",
                        "youtube.analytics-api.window-views",
                        "item.window.views",
                        "views",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-minutes-watched",
                        "youtube.analytics-api.window-minutes-watched",
                        "item.window.estimatedMinutesWatched",
                        "minutes_watched",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-average-view-duration",
                        "youtube.analytics-api.window-average-view-duration",
                        "item.window.averageViewDuration",
                        "average_view_duration",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-average-view-percentage",
                        "youtube.analytics-api.window-average-view-percentage",
                        "item.window.averageViewPercentage",
                        "average_view_percentage",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-likes",
                        "youtube.analytics-api.window-likes",
                        "item.window.likes",
                        "likes",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-comments",
                        "youtube.analytics-api.window-comments",
                        "item.window.comments",
                        "comments",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-shares",
                        "youtube.analytics-api.window-shares",
                        "item.window.shares",
                        "shares",
                        analytics_window_version,
                        analytics_time,
                    ),
                    _metric_mapping(
                        "window-subscribers-gained",
                        "youtube.analytics-api.window-subscribers-gained",
                        "item.window.subscribersGained",
                        "subscribers_gained",
                        analytics_window_version,
                        analytics_time,
                    ),
                ],
            },
        ],
    }


class RequiredConnectionsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.layout = state_layout(self.root / "state")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_hermes_delegations_uses_exact_allowlist_without_prose(self) -> None:
        sentinel = "HERMES_PROSE_SENTINEL_MUST_NOT_LEAVE_SOURCE"
        source = self.root / "state.db"
        with sqlite3.connect(source) as connection:
            connection.execute(
                """
                CREATE TABLE async_delegations (
                    delegation_id TEXT PRIMARY KEY,
                    parent_session_id TEXT,
                    state TEXT NOT NULL,
                    dispatched_at REAL NOT NULL,
                    completed_at REAL,
                    result_json TEXT,
                    event_json TEXT,
                    task_json TEXT
                )
                """
            )
            connection.execute(
                """
                INSERT INTO async_delegations VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "delegation-1",
                    "session-not-a-delegation",
                    "dispatched",
                    1767355140,
                    None,
                    sentinel,
                    sentinel,
                    sentinel,
                ),
            )
        connection.close()
        before = source.read_bytes()
        before_mtime = source.stat().st_mtime_ns
        raw = hermes_delegations_connection(source)

        codes, output, errors = self._install_collect_verify(raw)

        self.assertEqual(codes, (0, 0, 0))
        self.assertEqual(errors, "")
        self.assertIn("hermes-delegations: collected seen=1 added=1", output)
        with ObservationStore(self.layout.database) as store:
            records = store.observations()
        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0].payload,
            {
                "state": "dispatched",
                "dispatched_at": 1767355140,
                "completed_at": None,
            },
        )
        reader = parse_connection(raw).inputs[0].reader
        self.assertEqual(
            [column.field for column in reader.columns],
            ["delegation_id", "state", "dispatched_at", "completed_at"],
        )
        self._assert_source_unchanged(source, before, before_mtime)
        self._assert_absent_from_store_and_output(sentinel, output + errors)

    def test_sqlite_blob_identity_is_unread_instead_of_crashing(self) -> None:
        source = self.root / "blob-identity.db"
        connection = sqlite3.connect(source)
        try:
            with connection:
                connection.execute(
                    """
                    CREATE TABLE async_delegations (
                        delegation_id BLOB PRIMARY KEY,
                        state TEXT NOT NULL,
                        dispatched_at REAL NOT NULL,
                        completed_at REAL
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO async_delegations VALUES (?, ?, ?, ?)",
                    (sqlite3.Binary(b"not-json"), "dispatched", 1767355140, None),
                )
        finally:
            connection.close()

        codes, output, errors = self._install_collect_verify(
            hermes_delegations_connection(source)
        )

        self.assertEqual(codes, (0, 1, 0))
        self.assertEqual(errors, "")
        self.assertEqual(
            output.splitlines(),
            [
                "hermes-delegations: registered",
                "hermes-delegations: unread",
                "hermes-delegations: unread",
            ],
        )
        with ObservationStore(self.layout.database) as store:
            self.assertEqual(store.observations(), [])
            self.assertEqual(store.collection_attempts()[0].outcome, "failed")

    def test_hermes_cron_records_failure_without_error_text(self) -> None:
        sentinel = "CRON_ERROR_SENTINEL_MUST_NOT_LEAVE_SOURCE"
        source = self.root / "executions.db"
        with sqlite3.connect(source) as connection:
            connection.execute(
                """
                CREATE TABLE executions (
                    id TEXT PRIMARY KEY,
                    job_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    claimed_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    error TEXT
                )
                """
            )
            connection.execute(
                """
                INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "execution-1",
                    "job-1",
                    "failed",
                    "2026-01-02T11:58:00+00:00",
                    "2026-01-02T11:59:00+00:00",
                    "2026-01-02T12:00:00+00:00",
                    sentinel,
                ),
            )
            connection.execute(
                """
                INSERT INTO executions VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "execution-2",
                    "job-2",
                    "running",
                    "2026-01-02T12:01:00+00:00",
                    None,
                    None,
                    None,
                ),
            )
        connection.close()
        before = source.read_bytes()
        before_mtime = source.stat().st_mtime_ns
        raw = hermes_cron_connection(source)

        codes, output, errors = self._install_collect_verify(raw)

        self.assertEqual(codes, (0, 0, 0))
        self.assertEqual(errors, "")
        with ObservationStore(self.layout.database) as store:
            records = store.observations()
        self.assertEqual(len(records), 2)
        record = records[0]
        self.assertEqual(record.payload["status"], "failed")
        self.assertIs(record.payload["error_recorded"], True)
        self.assertNotIn("error", record.payload)
        self.assertEqual(records[1].payload["started_at"], None)
        self.assertEqual(records[1].payload["finished_at"], None)
        self._assert_source_unchanged(source, before, before_mtime)
        self._assert_absent_from_store_and_output(sentinel, output + errors)

    def test_shorts_uploads_keeps_deleted_history_and_null_day7_unknown(
        self,
    ) -> None:
        sentinel = "SHORTS_PRIVATE_TEXT_SENTINEL_MUST_NOT_LEAVE_SOURCE"
        uploads = self.root / "uploads.jsonl"
        uploads.write_text(
            json.dumps(
                {
                    "video_id": "video-deleted",
                    "uploaded_at": "2026-01-02T10:00:00Z",
                    "privacy": "public",
                    "deleted": True,
                    "title": sentinel,
                    "url": sentinel,
                    "source_file": sentinel,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        learning = self.root / "learning_log.jsonl"
        learning.write_text(
            "".join(
                json.dumps(record) + "\n"
                for record in (
                    {
                        "video_id": "video-unknown",
                        "published_at": "2026-01-01T10:00:00Z",
                        "script_summary": sentinel,
                        "structural_choices": {"private": sentinel},
                        "day7_stats": None,
                        "notes": sentinel,
                    },
                    {
                        "video_id": "video-mature",
                        "published_at": "2025-12-20T10:00:00Z",
                        "day7_stats": {
                            "views": 12,
                            "avg_view_duration": 8.5,
                            "swipe_away_pct": 34.0,
                            "retention_curve_shape": "flat",
                            "traffic_sources": {"private": sentinel},
                        },
                        "notes": sentinel,
                    },
                )
            ),
            encoding="utf-8",
        )
        raw = shorts_uploads_connection(uploads, learning)

        codes, output, errors = self._install_collect_verify(raw)

        self.assertEqual(codes, (0, 0, 0))
        self.assertEqual(errors, "")
        self.assertIn("shorts-uploads: collected seen=3 added=3", output)
        with ObservationStore(self.layout.database) as store:
            records = store.observations()
        deleted = [
            record
            for record in records
            if record.kind == "shorts-content.upload-log.deletion-marker"
        ]
        day7 = [
            record
            for record in records
            if record.kind == "youtube.learning-log.day7-metrics"
        ]
        self.assertEqual(deleted[0].payload, {"deleted": True})
        self.assertEqual(len(day7), 1)
        self.assertEqual(day7[0].subject, '"video-mature"')
        self.assertNotIn('"video-unknown"', [record.subject for record in day7])
        self.assertNotIn(0, day7[0].payload.values())
        self._assert_absent_from_store_and_output(sentinel, output + errors)

    def test_shorts_metrics_keep_measurement_methods_distinct(self) -> None:
        sentinel = "METRICS_TEXT_SENTINEL_MUST_NOT_LEAVE_SOURCE"
        snapshots = self.root / "daily_snapshots.jsonl"
        snapshots.write_text(
            json.dumps(
                {
                    "date": "2026-01-02T00:00:00Z",
                    "source": sentinel,
                    "note": sentinel,
                    "videos": [
                        {
                            "video_id": "video-1",
                            "channel": sentinel,
                            "age_hours": 24.0,
                            "views": 10,
                            "likes": 2,
                            "comments": 1,
                        }
                    ],
                }
            )
            + "\n",
            encoding="utf-8",
        )
        analytics = self.root / "analytics_20260102_120000.json"
        analytics.write_text(
            json.dumps(
                {
                    "generated_at": "2026-01-02T12:00:00Z",
                    "channel_id": sentinel,
                    "date_range": {"start": "2026-01-01", "end": "2026-01-02"},
                    "videos": [
                        {
                            "video_id": "video-1",
                            "title": sentinel,
                            "published_at": "2026-01-01T10:00:00Z",
                            "privacy": "public",
                            "lifetime_views": 11,
                            "lifetime_likes": 3,
                            "lifetime_comments": 1,
                            "window": {
                                "start": "2026-01-01",
                                "end": "2026-01-02",
                                "views": 9,
                                "estimatedMinutesWatched": 4,
                                "averageViewDuration": 8,
                                "averageViewPercentage": 52,
                                "likes": 2,
                                "comments": 1,
                                "shares": 1,
                                "subscribersGained": 1,
                            },
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
        raw = shorts_metrics_connection(snapshots, self.root / "analytics_*.json")

        codes, output, errors = self._install_collect_verify(raw)

        self.assertEqual(codes, (0, 0, 0))
        self.assertEqual(errors, "")
        self.assertIn("shorts-metrics: collected seen=14 added=14", output)
        with ObservationStore(self.layout.database) as store:
            records = store.observations()
            current = store.current_observations()
        view_kinds = {
            record.kind for record in current if record.payload.keys() == {"views"}
        }
        self.assertEqual(
            view_kinds,
            {
                "youtube.daily-snapshot.views",
                "youtube.data-api.lifetime-views",
                "youtube.analytics-api.window-views",
            },
        )
        self.assertTrue(all(record.fact_owner == "youtube" for record in records))
        self._assert_absent_from_store_and_output(sentinel, output + errors)

        with snapshots.open("a", encoding="utf-8") as stream:
            stream.write(
                json.dumps(
                    {
                        "date": "2026-01-03T00:00:00Z",
                        "source": sentinel,
                        "note": sentinel,
                        "videos": [
                            {
                                "video_id": "video-1",
                                "channel": sentinel,
                                "age_hours": 48.0,
                                "views": 15,
                                "likes": 4,
                                "comments": 2,
                            }
                        ],
                    }
                )
                + "\n"
            )
        config = parse_connection(raw)
        with ObservationStore(self.layout.database) as store:
            verification = verify_connection(config, store)
            self.assertFalse(verification.disagrees)
            self.assertEqual(verification.pending, 3)
            collection = collect_connection(config, store)
        self.assertTrue(collection.readable)
        self.assertEqual(collection.records_added, 3)

    def _install_collect_verify(
        self, raw: dict[str, object]
    ) -> tuple[tuple[int, int, int], str, str]:
        connection_id = str(raw["connection_id"])
        config_path = self.root / f"{connection_id}.json"
        config_path.write_text(json.dumps(raw), encoding="utf-8")
        output = io.StringIO()
        errors = io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            registered = connected_sources.main(
                ["--state-dir", str(self.layout.root), "register", str(config_path)]
            )
            collected = connected_sources.main(
                ["--state-dir", str(self.layout.root), "collect", connection_id]
            )
            verified = connected_sources.main(
                ["--state-dir", str(self.layout.root), "verify", connection_id]
            )
        return (registered, collected, verified), output.getvalue(), errors.getvalue()

    def _assert_absent_from_store_and_output(self, sentinel: str, output: str) -> None:
        self.assertNotIn(sentinel, output)
        self.assertNotIn(sentinel, self.layout.database.read_bytes().decode("latin-1"))

    def _assert_source_unchanged(
        self, source: Path, before: bytes, before_mtime: int
    ) -> None:
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(source.stat().st_mtime_ns, before_mtime)


if __name__ == "__main__":
    unittest.main()
