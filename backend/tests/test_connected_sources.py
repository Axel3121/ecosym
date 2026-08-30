import io
import json
import os
import sqlite3
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import connected_sources
from connection_config import (
    ConnectionConfigError,
    disconnect_connection,
    parse_connection,
    register_connection,
    registered_connections,
    state_layout,
)
from connection_runner import (
    collect_connection,
    connection_health,
    format_collection,
    format_verification,
    read_connection,
    verify_connection,
)
from observation_store import ObservationStore


class ConnectedSourcesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.layout = state_layout(self.root / "state")
        self.layout.root.mkdir()
        self.observed_at = datetime(2026, 1, 2, 12, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_registration_binds_identity_and_disconnect_keeps_the_binding(self) -> None:
        source = self.root / "events.jsonl"
        source.write_text("", encoding="utf-8")
        config = parse_connection(self.jsonl_config("fixture-a", source))

        self.assertTrue(register_connection(config, self.layout))
        self.assertFalse(register_connection(config, self.layout))
        self.assertEqual(registered_connections(self.layout), [config])
        self.assertEqual(
            (self.layout.connections / "fixture-a.json").stat().st_mode & 0o777,
            0o600,
        )

        self.assertTrue(disconnect_connection("fixture-a", self.layout))
        self.assertEqual(registered_connections(self.layout), [])
        changed = self.jsonl_config("fixture-a", self.root / "other.jsonl")
        with self.assertRaises(ConnectionConfigError):
            register_connection(parse_connection(changed), self.layout)
        self.assertTrue(register_connection(config, self.layout))

    def test_configuration_rejects_executable_or_unknown_mechanisms(self) -> None:
        source = self.root / "events.jsonl"
        raw = self.jsonl_config("fixture-a", source)
        raw["python"] = "payload.py"

        with self.assertRaises(ConnectionConfigError):
            parse_connection(raw)

        raw.pop("python")
        raw["inputs"][0]["reader"]["type"] = "python"
        with self.assertRaises(ConnectionConfigError):
            parse_connection(raw)

    def test_registry_rejects_configuration_changed_outside_registration(self) -> None:
        source = self.root / "events.jsonl"
        source.write_text("", encoding="utf-8")
        raw = self.jsonl_config("tamper-fixture", source)
        config = parse_connection(raw)
        register_connection(config, self.layout)
        raw["inputs"][0]["mappings"][0]["fact_owner"] = "different-owner"
        registered_path = self.layout.connections / "tamper-fixture.json"
        registered_path.write_text(json.dumps(raw), encoding="utf-8")

        with self.assertRaises(ConnectionConfigError):
            registered_connections(self.layout)

    def test_source_time_can_coalesce_explicit_allowed_fields(self) -> None:
        source = self.root / "events.jsonl"
        source.write_text(
            json.dumps(
                {
                    "id": "reading-1",
                    "completed_at": None,
                    "measured_at": "2026-01-02T11:59:00+00:00",
                    "value": 7,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        raw = self.jsonl_config("coalesce-fixture", source)
        raw["inputs"][0]["mappings"][0]["source_time"] = {
            "coalesce": ["item.completed_at", "item.measured_at"],
            "format": "iso8601",
        }

        record = read_connection(parse_connection(raw), self.observed_at)[0].record

        self.assertEqual(
            record.source_time,
            datetime(2026, 1, 2, 11, 59, tzinfo=timezone.utc),
        )

    def test_sqlite_collection_is_read_only_and_selects_only_allowed_fields(
        self,
    ) -> None:
        sentinel = "SENTINEL_MUST_NOT_LEAVE_SOURCE"
        source = self.root / "source.sqlite3"
        with sqlite3.connect(source) as connection:
            connection.execute(
                """
                CREATE TABLE measurements (
                    id TEXT, measured_at TEXT, value INTEGER, secret TEXT
                )
                """
            )
            connection.execute(
                "INSERT INTO measurements VALUES (?, ?, ?, ?)",
                ("reading-1", "2026-01-02T11:59:00+00:00", 7, sentinel),
            )
        before = source.read_bytes()
        before_mtime = source.stat().st_mtime_ns
        raw = self.jsonl_config("sqlite-fixture", source)
        raw["inputs"][0]["reader"] = {
            "type": "sqlite",
            "path": str(source),
            "table": "measurements",
            "columns": ["id", "measured_at", "value"],
        }
        config = parse_connection(raw)

        with ObservationStore(self.layout.database) as store:
            result = collect_connection(config, store, now=lambda: self.observed_at)
            records = store.observations()
            output = format_collection(result)

        self.assertTrue(result.readable)
        self.assertEqual(records[0].payload, {"value": 7})
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(source.stat().st_mtime_ns, before_mtime)
        self.assertNotIn(sentinel, self.layout.database.read_bytes().decode("latin-1"))
        self.assertNotIn(sentinel, output)

    def test_json_reader_maps_a_top_level_array(self) -> None:
        source = self.root / "inventory.json"
        source.write_text(
            json.dumps(
                [
                    {
                        "id": "bin-1",
                        "measured_at": "2026-01-02T11:59:00+00:00",
                        "value": 3,
                    }
                ]
            ),
            encoding="utf-8",
        )
        raw = self.jsonl_config("json-fixture", source)
        raw["inputs"][0]["reader"] = {"type": "json", "path": str(source)}
        raw["inputs"][0]["items"] = "$"
        config = parse_connection(raw)

        records = read_connection(config, self.observed_at)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].record.subject, '"bin-1"')
        self.assertEqual(records[0].record.payload, {"value": 3})

    def test_source_locator_is_normalized_before_identity_is_bound(self) -> None:
        first_root = self.root / "first"
        second_root = self.root / "second"
        first_root.mkdir()
        second_root.mkdir()
        first_source = first_root / "events.jsonl"
        second_source = second_root / "events.jsonl"
        first_source.write_text("", encoding="utf-8")
        second_source.write_text("", encoding="utf-8")
        raw = self.jsonl_config("bound-source", Path("$AXEY_FIXTURE_ROOT/events.jsonl"))

        with patch.dict(os.environ, {"AXEY_FIXTURE_ROOT": str(first_root)}):
            config = parse_connection(raw)
            register_connection(config, self.layout)
        with patch.dict(os.environ, {"AXEY_FIXTURE_ROOT": str(second_root)}):
            registered = registered_connections(self.layout)[0]

        self.assertEqual(registered.inputs[0].reader.path, str(first_source))
        self.assertNotIn("AXEY_FIXTURE_ROOT", registered.canonical_json)

    def test_state_layout_never_uses_a_relative_data_home(self) -> None:
        with patch.dict(
            os.environ,
            {"HOME": str(self.root), "XDG_DATA_HOME": "relative-data"},
        ):
            self.assertEqual(
                state_layout().root,
                self.root / ".local" / "share" / "axey",
            )
        with self.assertRaises(ConnectionConfigError):
            state_layout("relative-state")

    def test_payload_cannot_copy_an_undeclared_nested_object(self) -> None:
        sentinel = "NESTED_SENTINEL_MUST_NOT_LEAVE_SOURCE"
        source = self.root / "nested.jsonl"
        source.write_text(
            json.dumps(
                {
                    "id": "reading-1",
                    "measured_at": "2026-01-02T11:59:00+00:00",
                    "bundle": {"secret": sentinel},
                }
            )
            + "\n",
            encoding="utf-8",
        )
        raw = self.jsonl_config("nested-source", source)
        raw["inputs"][0]["mappings"][0]["payload"] = {"bundle": "item.bundle"}

        with ObservationStore(self.layout.database) as store:
            result = collect_connection(
                parse_connection(raw), store, now=lambda: self.observed_at
            )
            self.assertEqual(store.observations(), [])

        self.assertFalse(result.readable)
        self.assertNotIn(sentinel, self.layout.database.read_bytes().decode("latin-1"))

    def test_subject_identity_preserves_json_scalar_type(self) -> None:
        source = self.root / "typed-subjects.jsonl"
        records = [
            {
                "id": 1,
                "measured_at": "2026-01-02T11:58:00+00:00",
                "value": 7,
            },
            {
                "id": "1",
                "measured_at": "2026-01-02T11:59:00+00:00",
                "value": 8,
            },
        ]
        source.write_text(
            "".join(json.dumps(record) + "\n" for record in records),
            encoding="utf-8",
        )
        config = parse_connection(self.jsonl_config("typed-subjects", source))

        with ObservationStore(self.layout.database) as store:
            result = collect_connection(config, store, now=lambda: self.observed_at)
            subjects = [record.subject for record in store.current_observations()]

        self.assertEqual(result.records_added, 2)
        self.assertEqual(subjects, ["1", '"1"'])

    def test_repeated_known_records_and_empty_scan_are_quiet(self) -> None:
        source = self.root / "events.jsonl"
        source.write_text(
            json.dumps(
                {
                    "id": "reading-1",
                    "measured_at": "2026-01-02T11:59:00+00:00",
                    "value": 7,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        config = parse_connection(self.jsonl_config("known-record", source))
        empty_source = self.root / "empty.jsonl"
        empty_source.write_text("", encoding="utf-8")
        empty = parse_connection(self.jsonl_config("empty-source", empty_source))

        with ObservationStore(self.layout.database) as store:
            first = collect_connection(config, store, now=lambda: self.observed_at)
            second = collect_connection(config, store, now=lambda: self.observed_at)
            empty_result = collect_connection(
                empty, store, now=lambda: self.observed_at
            )

            self.assertEqual(first.records_added, 1)
            self.assertEqual(second.records_added, 0)
            self.assertEqual(
                connection_health(config.connection_id, store).state, "quiet"
            )
            self.assertEqual(empty_result.records_seen, 0)
            self.assertEqual(
                connection_health(empty.connection_id, store).state, "quiet"
            )

    def test_connections_sharing_reader_have_independent_quiet_and_unread_status(
        self,
    ) -> None:
        quiet_source = self.root / "quiet.jsonl"
        quiet_source.write_text("", encoding="utf-8")
        quiet = parse_connection(self.jsonl_config("quiet-connection", quiet_source))
        unread = parse_connection(
            self.jsonl_config("unread-connection", self.root / "absent.jsonl")
        )

        with ObservationStore(self.layout.database) as store:
            collect_connection(quiet, store, now=lambda: self.observed_at)
            collect_connection(unread, store, now=lambda: self.observed_at)

            self.assertEqual(
                connection_health(quiet.connection_id, store).state, "quiet"
            )
            self.assertEqual(
                connection_health(unread.connection_id, store).state, "unread"
            )

    def test_quiet_connection_becomes_unread_after_source_failure(self) -> None:
        source = self.root / "events.jsonl"
        source.write_text("", encoding="utf-8")
        config = parse_connection(self.jsonl_config("failing-source", source))

        with ObservationStore(self.layout.database) as store:
            collect_connection(config, store, now=lambda: self.observed_at)
            self.assertEqual(
                connection_health(config.connection_id, store).state, "quiet"
            )
            source.unlink()
            failed = collect_connection(config, store, now=lambda: self.observed_at)

            self.assertFalse(failed.readable)
            self.assertEqual(
                connection_health(config.connection_id, store).state, "unread"
            )
            self.assertEqual(
                connection_health(config.connection_id, store).last_outcome, "failed"
            )

    def test_never_run_and_interrupted_connections_are_unread(self) -> None:
        with ObservationStore(self.layout.database) as store:
            self.assertEqual(connection_health("never-run", store).state, "unread")
            store.begin_attempt("interrupted", self.observed_at)
            health = connection_health("interrupted", store)

        self.assertEqual(health.state, "unread")
        self.assertEqual(health.last_outcome, "interrupted")

    def test_claim_mapping_does_not_enter_observation_results(self) -> None:
        source = self.root / "claims.jsonl"
        source.write_text(
            json.dumps(
                {
                    "id": "claim-1",
                    "measured_at": "2026-01-02T11:59:00+00:00",
                    "value": 7,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        raw = self.jsonl_config("claim-source", source)
        raw["inputs"][0]["mappings"][0]["epistemic_status"] = "claim"
        config = parse_connection(raw)

        with ObservationStore(self.layout.database) as store:
            collect_connection(config, store, now=lambda: self.observed_at)

            self.assertEqual(store.observations(), [])
            self.assertEqual(len(store.claims()), 1)

    def test_verification_detects_each_disagreement_class(self) -> None:
        source = self.root / "events.jsonl"
        original = {
            "id": "reading-1",
            "measured_at": "2026-01-02T11:59:00+00:00",
            "value": 7,
        }
        source.write_text(json.dumps(original) + "\n", encoding="utf-8")
        config = parse_connection(self.jsonl_config("verify-source", source))

        with ObservationStore(self.layout.database) as store:
            collect_connection(config, store, now=lambda: self.observed_at)
            self.assertFalse(verify_connection(config, store).disagrees)

            changed = dict(original, value=8)
            source.write_text(json.dumps(changed) + "\n", encoding="utf-8")
            payload_result = verify_connection(config, store)
            self.assertEqual(payload_result.changed, 1)

            source.write_text("", encoding="utf-8")
            missing_result = verify_connection(config, store)
            self.assertEqual(missing_result.missing, 1)

        other_source = self.root / "uncollected.jsonl"
        other_source.write_text(json.dumps(original) + "\n", encoding="utf-8")
        other_config = parse_connection(
            self.jsonl_config("uncollected-source", other_source)
        )
        with ObservationStore(self.root / "other.sqlite3") as store:
            uncollected_result = verify_connection(other_config, store)

        self.assertEqual(uncollected_result.uncollected, 1)
        self.assertEqual(
            format_verification(uncollected_result),
            "uncollected-source: disagree missing=0 changed=0 uncollected=1 pending=0",
        )

    def test_verification_compares_json_types(self) -> None:
        source = self.root / "typed-values.jsonl"
        original = {
            "id": "reading-1",
            "measured_at": "2026-01-02T11:59:00+00:00",
            "value": 1,
        }
        source.write_text(json.dumps(original) + "\n", encoding="utf-8")
        config = parse_connection(self.jsonl_config("typed-values", source))

        with ObservationStore(self.layout.database) as store:
            collect_connection(config, store, now=lambda: self.observed_at)
            source.write_text(
                json.dumps(dict(original, value=True)) + "\n", encoding="utf-8"
            )
            result = verify_connection(config, store)

        self.assertTrue(result.disagrees)
        self.assertEqual(result.changed, 1)

    def test_strictly_newer_series_point_is_pending_not_disagreement(self) -> None:
        source = self.root / "series.jsonl"
        first = {
            "id": "reading-1",
            "measured_at": "2026-01-02T11:00:00+00:00",
            "value": 7,
        }
        second = {
            "id": "reading-1",
            "measured_at": "2026-01-02T12:00:00+00:00",
            "value": 9,
        }
        source.write_text(json.dumps(first) + "\n", encoding="utf-8")
        config = parse_connection(self.jsonl_config("series-source", source))

        with ObservationStore(self.layout.database) as store:
            collect_connection(config, store, now=lambda: self.observed_at)
            source.write_text(
                json.dumps(first) + "\n" + json.dumps(second) + "\n",
                encoding="utf-8",
            )
            result = verify_connection(config, store)

        self.assertFalse(result.disagrees)
        self.assertEqual(result.pending, 1)
        self.assertEqual(format_verification(result), "series-source: ok pending=1")

    def test_rolling_snapshot_may_stop_exposing_an_old_point(self) -> None:
        source = self.root / "snapshot.jsonl"
        source.write_text(
            json.dumps(
                {
                    "id": "reading-1",
                    "measured_at": "2026-01-02T11:59:00+00:00",
                    "value": 7,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        raw = self.jsonl_config("rolling-source", source)
        raw["inputs"][0]["mappings"][0]["comparison"]["source_mode"] = (
            "rolling_snapshot"
        )
        config = parse_connection(raw)

        with ObservationStore(self.layout.database) as store:
            collect_connection(config, store, now=lambda: self.observed_at)
            source.write_text("", encoding="utf-8")
            result = verify_connection(config, store)

        self.assertFalse(result.disagrees)
        self.assertEqual(result.missing, 0)

    def test_unread_verification_does_not_invent_a_verdict(self) -> None:
        config = parse_connection(
            self.jsonl_config("unread-verification", self.root / "absent.jsonl")
        )

        with ObservationStore(self.layout.database) as store:
            result = verify_connection(config, store)

        self.assertFalse(result.readable)
        self.assertFalse(result.disagrees)
        self.assertEqual(format_verification(result), "unread-verification: unread")

    def test_cli_uses_external_registration_path_and_stable_output(self) -> None:
        source = self.root / "events.jsonl"
        source.write_text("", encoding="utf-8")
        config_path = self.root / "user-connection.json"
        config_path.write_text(
            json.dumps(self.jsonl_config("cli-fixture", source)), encoding="utf-8"
        )
        output = io.StringIO()
        errors = io.StringIO()

        with redirect_stdout(output), redirect_stderr(errors):
            registered = connected_sources.main(
                ["--state-dir", str(self.layout.root), "register", str(config_path)]
            )
            collected = connected_sources.main(
                ["--state-dir", str(self.layout.root), "collect"]
            )
            status = connected_sources.main(
                ["--state-dir", str(self.layout.root), "status"]
            )

        self.assertEqual((registered, collected, status), (0, 0, 0))
        self.assertEqual(errors.getvalue(), "")
        self.assertEqual(
            output.getvalue().splitlines(),
            [
                "cli-fixture: registered",
                "cli-fixture: collected seen=0 added=0",
                "cli-fixture: quiet (success)",
            ],
        )

    @staticmethod
    def jsonl_config(connection_id: str, source: Path) -> dict[str, object]:
        return {
            "version": 1,
            "connection_id": connection_id,
            "inputs": [
                {
                    "id": "measurements",
                    "reader": {"type": "jsonl", "path": str(source)},
                    "mappings": [
                        {
                            "id": "measurement",
                            "epistemic_status": "observation",
                            "fact_owner": "fixture-owner",
                            "kind": "fixture.measurement",
                            "subject": "item.id",
                            "source_version": ["item.id", "item.measured_at"],
                            "source_time": {
                                "field": "item.measured_at",
                                "format": "iso8601",
                            },
                            "temporal_status": "current",
                            "payload": {"value": "item.value"},
                            "comparison": {
                                "source_mode": "append_only",
                                "newer_is_next": True,
                            },
                        }
                    ],
                }
            ],
        }


if __name__ == "__main__":
    unittest.main()
