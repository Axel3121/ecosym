import io
import json
import sqlite3
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

import connected_sources
from connection_config import state_layout


def verification_connection(connection_id: str, path: Path) -> dict[str, object]:
    return {
        "version": 1,
        "connection_id": connection_id,
        "inputs": [
            {
                "id": "measurements",
                "reader": {"type": "jsonl", "path": str(path)},
                "mappings": [
                    {
                        "id": "measurement",
                        "epistemic_status": "observation",
                        "fact_owner": "fixture-owner",
                        "kind": "fixture.measurement",
                        "subject": "item.id",
                        "source_version": ["item.id", "item.version"],
                        "source_time": {
                            "field": "item.measured_at",
                            "format": "iso8601",
                        },
                        "temporal_status": "current",
                        "payload": {"value": "item.value"},
                        "comparison": {
                            "source_mode": "append_only",
                            "newer_is_next": False,
                        },
                    }
                ],
            }
        ],
    }


class ConnectionVerificationTest(unittest.TestCase):
    def test_command_fails_for_each_corrupted_store_class(self) -> None:
        expected = {
            "missing": (
                "verify-fixture: disagree missing=1 changed=0 uncollected=0 pending=0\n"
            ),
            "changed": (
                "verify-fixture: disagree missing=0 changed=1 uncollected=0 pending=0\n"
            ),
            "uncollected": (
                "verify-fixture: disagree missing=0 changed=0 uncollected=1 pending=0\n"
            ),
        }
        for corruption, expected_output in expected.items():
            with self.subTest(corruption=corruption), TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = self._write_source(root / "measurements.jsonl")
                state = root / "state"
                self._register_and_collect(
                    verification_connection("verify-fixture", source), state, root
                )
                self._corrupt_store(state_layout(state).database, corruption)

                code, output, errors = self._main(["--state-dir", str(state), "verify"])

                self.assertEqual(code, 1)
                self.assertEqual(output, expected_output)
                self.assertEqual(errors, "")

    def test_unread_does_not_hide_a_readable_disagreement(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            source = self._write_source(root / "measurements.jsonl")
            self._register_and_collect(
                verification_connection("z-disagree", source), state, root
            )
            self._corrupt_store(state_layout(state).database, "uncollected")
            self._register(
                verification_connection("a-unread", root / "absent.jsonl"),
                state,
                root,
            )

            code, output, errors = self._main(["--state-dir", str(state), "verify"])

        self.assertEqual(code, 1)
        self.assertEqual(
            output,
            "a-unread: unread\n"
            "z-disagree: disagree missing=0 changed=0 "
            "uncollected=1 pending=0\n",
        )
        self.assertEqual(errors, "")

    def test_unread_only_exits_zero_without_a_verdict(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            state = root / "state"
            self._register(
                verification_connection("only-unread", root / "absent.jsonl"),
                state,
                root,
            )

            code, output, errors = self._main(["--state-dir", str(state), "verify"])

        self.assertEqual(code, 0)
        self.assertEqual(output, "only-unread: unread\n")
        self.assertEqual(errors, "")

    def _register_and_collect(
        self, config: dict[str, object], state: Path, root: Path
    ) -> None:
        self._register(config, state, root)
        connection_id = str(config["connection_id"])
        code, _, errors = self._main(
            ["--state-dir", str(state), "collect", connection_id]
        )
        self.assertEqual(code, 0)
        self.assertEqual(errors, "")

    def _register(self, config: dict[str, object], state: Path, root: Path) -> None:
        connection_id = str(config["connection_id"])
        config_path = root / f"{connection_id}.json"
        config_path.write_text(json.dumps(config), encoding="utf-8")
        code, _, errors = self._main(
            ["--state-dir", str(state), "register", str(config_path)]
        )
        self.assertEqual(code, 0)
        self.assertEqual(errors, "")

    @staticmethod
    def _write_source(path: Path) -> Path:
        path.write_text(
            json.dumps(
                {
                    "id": "reading-1",
                    "version": "version-1",
                    "measured_at": "2026-01-02T12:00:00Z",
                    "value": 7,
                }
            )
            + "\n",
            encoding="utf-8",
        )
        return path

    def _corrupt_store(self, path: Path, corruption: str) -> None:
        connection = sqlite3.connect(path)
        try:
            with connection:
                if corruption == "missing":
                    connection.execute(
                        """
                        INSERT INTO records (
                            connection_id, reader_type, source, fact_owner,
                            source_version, kind, subject, source_time,
                            observed_at, temporal_status, epistemic_status,
                            payload_json, cause_type, cause_id
                        )
                        SELECT connection_id, reader_type, source, fact_owner,
                               '["phantom-version"]', kind, subject, source_time,
                               observed_at, temporal_status, epistemic_status,
                               payload_json, cause_type, cause_id
                        FROM records LIMIT 1
                        """
                    )
                elif corruption == "changed":
                    connection.execute(
                        "UPDATE records SET payload_json = ?",
                        ('{"value":8}',),
                    )
                elif corruption == "uncollected":
                    connection.execute("DELETE FROM records")
                else:
                    self.fail(f"unsupported corruption: {corruption}")
        finally:
            connection.close()

    @staticmethod
    def _main(arguments: list[str]) -> tuple[int, str, str]:
        output = io.StringIO()
        errors = io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            code = connected_sources.main(arguments)
        return code, output.getvalue(), errors.getvalue()


if __name__ == "__main__":
    unittest.main()
