import io
import json
import subprocess
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory

import connected_sources
from connection_config import state_layout
from observation_store import ObservationStore

FROZEN_CONNECTION_CONTRACT = "a0fc8716aee760fa65ec195c93b6147f1c4575e5"
PROTECTED_CORE_PATHS = (
    "backend/check.py",
    "backend/connected_sources.py",
    "backend/connection_config.py",
    "backend/connection_runner.py",
    "backend/observation_store.py",
    "backend/source_readers.py",
    "docs/connected-sources.md",
)


class FifthConnectionTest(unittest.TestCase):
    def test_nested_singleton_json_installs_without_core_changes(self) -> None:
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "cabinet-probe.json"
            source.write_text(
                json.dumps(
                    {
                        "device": {"serial": "probe-1"},
                        "sample": {
                            "sequence": 17,
                            "captured_at": "2026-01-02T12:00:00Z",
                            "healthy": True,
                        },
                    }
                ),
                encoding="utf-8",
            )
            config = self._config(source)
            config_path = root / "cabinet-probe-connection.json"
            config_path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            layout = state_layout(root / "state")
            output = io.StringIO()
            errors = io.StringIO()

            with redirect_stdout(output), redirect_stderr(errors):
                registered = connected_sources.main(
                    [
                        "--state-dir",
                        str(layout.root),
                        "register",
                        str(config_path),
                    ]
                )
                collected = connected_sources.main(
                    [
                        "--state-dir",
                        str(layout.root),
                        "collect",
                        "cabinet-probe",
                    ]
                )
                verified = connected_sources.main(
                    [
                        "--state-dir",
                        str(layout.root),
                        "verify",
                        "cabinet-probe",
                    ]
                )

            self.assertEqual((registered, collected, verified), (0, 0, 0))
            self.assertEqual(errors.getvalue(), "")
            self.assertEqual(
                output.getvalue().splitlines(),
                [
                    "cabinet-probe: registered",
                    "cabinet-probe: collected seen=1 added=1",
                    "cabinet-probe: ok pending=0",
                ],
            )
            with ObservationStore(layout.database) as store:
                records = store.observations()
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].subject, '"probe-1"')
            self.assertEqual(records[0].payload, {"healthy": True})

        repository = Path(__file__).resolve().parents[2]
        protected_diff = subprocess.run(
            [
                "git",
                "diff",
                "--name-only",
                f"{FROZEN_CONNECTION_CONTRACT}..HEAD",
                "--",
                *PROTECTED_CORE_PATHS,
            ],
            cwd=repository,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(protected_diff.stdout, "")

    @staticmethod
    def _config(path: Path) -> dict[str, object]:
        return {
            "version": 1,
            "connection_id": "cabinet-probe",
            "inputs": [
                {
                    "id": "sample",
                    "reader": {"type": "json", "path": str(path)},
                    "mappings": [
                        {
                            "id": "health",
                            "epistemic_status": "observation",
                            "fact_owner": "cabinet-probe",
                            "kind": "cabinet-probe.sample.health",
                            "subject": "root.device.serial",
                            "source_version": ["root.sample.sequence"],
                            "source_time": {
                                "field": "root.sample.captured_at",
                                "format": "iso8601",
                            },
                            "temporal_status": "current",
                            "payload": {"healthy": "root.sample.healthy"},
                            "comparison": {
                                "source_mode": "rolling_snapshot",
                                "newer_is_next": True,
                            },
                        }
                    ],
                }
            ],
        }


if __name__ == "__main__":
    unittest.main()
