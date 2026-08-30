"""Register, collect, inspect, and verify declarative source connections."""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

from connection_config import (
    ConnectionConfig,
    ConnectionConfigError,
    disconnect_connection,
    load_connection,
    register_connection,
    registered_connections,
    state_layout,
)
from connection_runner import (
    collect_connection,
    connection_health,
    format_collection,
    format_health,
    format_verification,
    verify_connection,
)
from observation_store import ObservationStore


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    arguments = parser.parse_args(argv)
    try:
        layout = state_layout(arguments.state_dir)
        if arguments.command == "register":
            config = load_connection(arguments.config)
            created = register_connection(config, layout)
            action = "registered" if created else "already registered"
            print(f"{config.connection_id}: {action}")
            return 0
        if arguments.command == "disconnect":
            removed = disconnect_connection(arguments.connection_id, layout)
            action = "disconnected" if removed else "not connected"
            print(f"{arguments.connection_id}: {action}")
            return 0

        configs = _select_configs(
            registered_connections(layout), arguments.connection_ids
        )
        if not configs:
            print("no connections")
            return 0
        if arguments.command == "list":
            for config in configs:
                print(config.connection_id)
            return 0

        layout.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with ObservationStore(layout.database) as store:
            if arguments.command == "collect":
                results = [collect_connection(config, store) for config in configs]
                for result in results:
                    print(format_collection(result))
                return int(any(not result.readable for result in results))
            if arguments.command == "status":
                for config in configs:
                    print(format_health(connection_health(config.connection_id, store)))
                return 0
            results = [verify_connection(config, store) for config in configs]
            for result in results:
                print(format_verification(result))
            return int(any(result.disagrees for result in results if result.readable))
    except (ConnectionConfigError, OSError, sqlite3.Error, ValueError):
        print("error: connected-source operation failed", file=sys.stderr)
        return 2


def _select_configs(
    configs: list[ConnectionConfig], connection_ids: list[str]
) -> list[ConnectionConfig]:
    if not connection_ids:
        return configs
    requested = set(connection_ids)
    selected = [config for config in configs if config.connection_id in requested]
    if {config.connection_id for config in selected} != requested:
        raise ConnectionConfigError("requested connection is not registered")
    return selected


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="connected_sources.py")
    parser.add_argument(
        "--state-dir",
        type=Path,
        help="override Axey's XDG state directory (primarily for isolated checks)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    register = subparsers.add_parser("register")
    register.add_argument("config", type=Path)
    disconnect = subparsers.add_parser("disconnect")
    disconnect.add_argument("connection_id")
    for command in ("list", "collect", "status", "verify"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("connection_ids", nargs="*")
    return parser


if __name__ == "__main__":
    raise SystemExit(main())
