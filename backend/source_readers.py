"""Read-only generic readers for declarative connected sources."""

from __future__ import annotations

import glob
import json
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from connection_config import InputConfig, ReaderConfig
from observation_store import JsonValue


class SourceUnreadError(RuntimeError):
    """A source could not be read completely and must not be treated as quiet."""


@dataclass(frozen=True)
class SourceRow:
    source: str
    reader_type: str
    root: JsonValue
    item: JsonValue
    metadata: dict[str, JsonValue]


def read_input(config: InputConfig) -> list[SourceRow]:
    roots = _read_roots(config.reader)
    rows: list[SourceRow] = []
    for source, root, metadata in roots:
        items = _select_items(root, config.items)
        for index, item in enumerate(items):
            item_metadata = dict(metadata)
            item_metadata["index"] = index
            rows.append(
                SourceRow(
                    source=source,
                    reader_type=config.reader.type,
                    root=root,
                    item=item,
                    metadata=item_metadata,
                )
            )
    return rows


def _read_roots(
    config: ReaderConfig,
) -> list[tuple[str, JsonValue, dict[str, JsonValue]]]:
    if config.type == "sqlite":
        return _read_sqlite(config)
    if config.type == "jsonl":
        return _read_jsonl(config)
    return _read_json(config)


def _read_sqlite(
    config: ReaderConfig,
) -> list[tuple[str, JsonValue, dict[str, JsonValue]]]:
    path = _source_path(config.path)
    table = config.table
    if table is None:
        raise SourceUnreadError("SQLite reader is incomplete")
    projections: list[str] = []
    for column in config.columns:
        source = _quote_identifier(column.field)
        output = _quote_identifier(column.output)
        if column.transform == "is_not_null":
            projections.append(
                f"CASE WHEN {source} IS NULL THEN 0 ELSE 1 END AS {output}"
            )
        elif column.field == column.output:
            projections.append(source)
        else:
            projections.append(f"{source} AS {output}")
    query = f"SELECT {', '.join(projections)} FROM {_quote_identifier(table)}"
    uri = path.as_uri() + "?mode=ro"
    source_name = path.as_uri() + "#table=" + quote(table, safe="")
    try:
        connection = sqlite3.connect(uri, uri=True, timeout=0.5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only = ON")
        database_rows = connection.execute(query).fetchall()
    except (OSError, sqlite3.Error) as exc:
        raise SourceUnreadError("SQLite source is unreadable") from exc
    finally:
        if "connection" in locals():
            connection.close()

    transformed = {
        column.output for column in config.columns if column.transform == "is_not_null"
    }
    result: list[tuple[str, JsonValue, dict[str, JsonValue]]] = []
    for database_row in database_rows:
        row = dict(database_row)
        for field in transformed:
            row[field] = bool(row[field])
        result.append((source_name, row, {}))
    return result


def _read_jsonl(
    config: ReaderConfig,
) -> list[tuple[str, JsonValue, dict[str, JsonValue]]]:
    path = _source_path(config.path)
    source = path.as_uri()
    result: list[tuple[str, JsonValue, dict[str, JsonValue]]] = []
    offset = 0
    try:
        with path.open("rb") as stream:
            for line_number, line in enumerate(stream, start=1):
                current_offset = offset
                offset += len(line)
                if not line.strip():
                    continue
                root = json.loads(
                    line.decode("utf-8"), parse_constant=_reject_json_constant
                )
                result.append(
                    (
                        source,
                        root,
                        {"offset": current_offset, "line": line_number},
                    )
                )
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise SourceUnreadError("JSONL source is unreadable") from exc
    return result


def _read_json(
    config: ReaderConfig,
) -> list[tuple[str, JsonValue, dict[str, JsonValue]]]:
    if config.path is not None:
        paths = [_source_path(config.path)]
    else:
        pattern = _expanded_absolute(config.glob)
        paths = [Path(value) for value in sorted(glob.glob(pattern))]
        if not paths:
            raise SourceUnreadError("JSON source is absent")

    result: list[tuple[str, JsonValue, dict[str, JsonValue]]] = []
    try:
        for path in paths:
            with path.open("r", encoding="utf-8") as stream:
                root = json.load(stream, parse_constant=_reject_json_constant)
            result.append((path.resolve(strict=True).as_uri(), root, {}))
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError) as exc:
        raise SourceUnreadError("JSON source is unreadable") from exc
    return result


def _select_items(root: JsonValue, selector: str | None) -> list[JsonValue]:
    if selector is None:
        return [root]
    selected: JsonValue = root
    if selector != "$":
        for part in selector.split("."):
            if not isinstance(selected, dict) or part not in selected:
                raise SourceUnreadError("configured JSON item field is absent")
            selected = selected[part]
    if not isinstance(selected, list):
        raise SourceUnreadError("configured JSON items are not a list")
    return selected


def _source_path(raw: str | None) -> Path:
    expanded = _expanded_absolute(raw)
    try:
        path = Path(expanded).resolve(strict=True)
    except OSError as exc:
        raise SourceUnreadError("source is absent") from exc
    if not path.is_file():
        raise SourceUnreadError("source is not a file")
    return path


def _expanded_absolute(raw: str | None) -> str:
    if raw is None:
        raise SourceUnreadError("source path is absent")
    if not Path(raw).is_absolute():
        raise SourceUnreadError("source path must be absolute")
    return raw


def _quote_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def _reject_json_constant(_: str) -> None:
    raise ValueError("non-finite JSON number")
