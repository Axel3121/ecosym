"""Declarative connected-source configuration and private registration state."""

from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from observation_store import EpistemicStatus, JsonValue, TemporalStatus

ReaderType = Literal["sqlite", "jsonl", "json"]
SourceMode = Literal["append_only", "rolling_snapshot"]
TimeFormat = Literal["unix", "iso8601", "date"]
Transform = Literal["identity", "is_not_null"]

_IDENTIFIER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
_FIELD_PART = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]*$")
_SQL_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class ConnectionConfigError(ValueError):
    """A connection is invalid or violates its immutable identity binding."""


@dataclass(frozen=True)
class ValueExpression:
    field: str | None = None
    literal: JsonValue = None
    has_literal: bool = False
    coalesce: tuple[ValueExpression, ...] = ()
    transform: Transform = "identity"


@dataclass(frozen=True)
class Condition:
    field: str
    operator: Literal["is_null", "is_not_null"]


@dataclass(frozen=True)
class TimestampMapping:
    value: ValueExpression
    format: TimeFormat


@dataclass(frozen=True)
class ComparisonContract:
    source_mode: SourceMode
    newer_is_next: bool


@dataclass(frozen=True)
class RecordMapping:
    mapping_id: str
    epistemic_status: EpistemicStatus
    fact_owner: str
    kind: str
    subject: ValueExpression
    source_version: tuple[ValueExpression, ...]
    source_time: TimestampMapping | None
    temporal_status: TemporalStatus
    payload: tuple[tuple[str, ValueExpression], ...]
    when: Condition | None
    comparison: ComparisonContract


@dataclass(frozen=True)
class ColumnProjection:
    field: str
    output: str
    transform: Transform


@dataclass(frozen=True)
class ReaderConfig:
    type: ReaderType
    path: str | None = None
    glob: str | None = None
    table: str | None = None
    columns: tuple[ColumnProjection, ...] = ()


@dataclass(frozen=True)
class InputConfig:
    input_id: str
    reader: ReaderConfig
    items: str | None
    mappings: tuple[RecordMapping, ...]


@dataclass(frozen=True)
class ConnectionConfig:
    connection_id: str
    inputs: tuple[InputConfig, ...]
    canonical_json: str

    @property
    def fingerprint(self) -> str:
        return hashlib.sha256(self.canonical_json.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class StateLayout:
    root: Path
    database: Path
    connections: Path
    identities: Path


def state_layout(root: str | Path | None = None) -> StateLayout:
    if root is None:
        data_home = os.environ.get("XDG_DATA_HOME")
        root_path = (
            Path(data_home).expanduser() / "axey"
            if data_home
            else Path.home() / ".local" / "share" / "axey"
        )
    else:
        root_path = Path(root).expanduser()
    return StateLayout(
        root=root_path,
        database=root_path / "observations.sqlite3",
        connections=root_path / "connections",
        identities=root_path / "connection-identities",
    )


def load_connection(path: str | Path) -> ConnectionConfig:
    try:
        text = Path(path).read_text(encoding="utf-8")
        raw = json.loads(text)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ConnectionConfigError("connection configuration is unreadable") from exc
    return parse_connection(raw)


def parse_connection(raw: object) -> ConnectionConfig:
    config = _object(raw, "connection")
    _keys(config, {"version", "connection_id", "inputs"}, "connection")
    if config.get("version") != 1:
        raise ConnectionConfigError("connection.version must be 1")
    connection_id = _identifier(config.get("connection_id"), "connection_id")
    inputs_raw = _list(config.get("inputs"), "connection.inputs")
    if not inputs_raw:
        raise ConnectionConfigError("connection.inputs must not be empty")

    inputs = tuple(_parse_input(value) for value in inputs_raw)
    _unique((value.input_id for value in inputs), "input id")
    mappings = [mapping for value in inputs for mapping in value.mappings]
    _unique((mapping.mapping_id for mapping in mappings), "mapping id")
    _unique((mapping.kind for mapping in mappings), "mapping kind")

    canonical = json.dumps(
        config, sort_keys=True, separators=(",", ":"), allow_nan=False
    )
    return ConnectionConfig(connection_id, inputs, canonical)


def register_connection(config: ConnectionConfig, layout: StateLayout) -> bool:
    _ensure_private_directory(layout.root)
    _ensure_private_directory(layout.connections)
    _ensure_private_directory(layout.identities)
    identity_path = layout.identities / f"{config.connection_id}.sha256"
    connection_path = layout.connections / f"{config.connection_id}.json"

    if identity_path.exists():
        try:
            fingerprint = identity_path.read_text(encoding="ascii").strip()
        except (OSError, UnicodeError) as exc:
            raise ConnectionConfigError(
                "connection identity record is unreadable"
            ) from exc
        if fingerprint != config.fingerprint:
            raise ConnectionConfigError(
                "connection_id is permanently bound to different configuration"
            )
    else:
        _write_private(identity_path, config.fingerprint + "\n")

    if connection_path.exists():
        existing = load_connection(connection_path)
        if existing.fingerprint != config.fingerprint:
            raise ConnectionConfigError(
                "registered connection differs from its identity binding"
            )
        return False

    _write_private(connection_path, config.canonical_json + "\n")
    return True


def disconnect_connection(connection_id: str, layout: StateLayout) -> bool:
    identity = _identifier(connection_id, "connection_id")
    path = layout.connections / f"{identity}.json"
    try:
        path.unlink()
    except FileNotFoundError:
        return False
    except OSError as exc:
        raise ConnectionConfigError(
            "registered connection could not be removed"
        ) from exc
    return True


def registered_connections(layout: StateLayout) -> list[ConnectionConfig]:
    if not layout.connections.exists():
        return []
    configs: list[ConnectionConfig] = []
    try:
        paths = sorted(layout.connections.glob("*.json"))
    except OSError as exc:
        raise ConnectionConfigError("connection registry is unreadable") from exc
    for path in paths:
        config = load_connection(path)
        if path.stem != config.connection_id:
            raise ConnectionConfigError(
                "registered filename does not match connection_id"
            )
        identity_path = layout.identities / f"{config.connection_id}.sha256"
        try:
            fingerprint = identity_path.read_text(encoding="ascii").strip()
        except (OSError, UnicodeError) as exc:
            raise ConnectionConfigError(
                "connection identity record is unreadable"
            ) from exc
        if fingerprint != config.fingerprint:
            raise ConnectionConfigError(
                "registered connection differs from its identity binding"
            )
        configs.append(config)
    return configs


def _parse_input(raw: object) -> InputConfig:
    value = _object(raw, "input")
    _keys(value, {"id", "reader", "items", "mappings"}, "input")
    input_id = _identifier(value.get("id"), "input.id")
    reader = _parse_reader(value.get("reader"))
    items = value.get("items")
    if items is not None:
        if not isinstance(items, str):
            raise ConnectionConfigError("input.items must be a field path or '$'")
        if items != "$":
            _relative_field(items, "input.items")
    mappings_raw = _list(value.get("mappings"), "input.mappings")
    if not mappings_raw:
        raise ConnectionConfigError("input.mappings must not be empty")
    mappings = tuple(_parse_mapping(item) for item in mappings_raw)
    if reader.type == "sqlite":
        fields = {column.output for column in reader.columns}
        for mapping in mappings:
            for expression in _mapping_expressions(mapping):
                if expression.field is None or expression.field.startswith("meta."):
                    continue
                source_field = expression.field.split(".", 2)[1]
                if source_field not in fields:
                    raise ConnectionConfigError(
                        "SQLite mapping references a column outside its allowlist"
                    )
    return InputConfig(input_id, reader, items, mappings)


def _parse_reader(raw: object) -> ReaderConfig:
    value = _object(raw, "reader")
    reader_type = value.get("type")
    if reader_type == "sqlite":
        _keys(value, {"type", "path", "table", "columns"}, "SQLite reader")
        path = _text(value.get("path"), "reader.path")
        table = _sql_name(value.get("table"), "reader.table")
        columns_raw = _list(value.get("columns"), "reader.columns")
        if not columns_raw:
            raise ConnectionConfigError("reader.columns must not be empty")
        columns = tuple(_parse_column(column) for column in columns_raw)
        _unique((column.output for column in columns), "SQLite output column")
        return ReaderConfig("sqlite", path=path, table=table, columns=columns)
    if reader_type == "jsonl":
        _keys(value, {"type", "path"}, "JSONL reader")
        return ReaderConfig("jsonl", path=_text(value.get("path"), "reader.path"))
    if reader_type == "json":
        _keys(value, {"type", "path", "glob"}, "JSON reader")
        path = value.get("path")
        pattern = value.get("glob")
        if (path is None) == (pattern is None):
            raise ConnectionConfigError(
                "JSON reader requires exactly one of path or glob"
            )
        return ReaderConfig(
            "json",
            path=_text(path, "reader.path") if path is not None else None,
            glob=_text(pattern, "reader.glob") if pattern is not None else None,
        )
    raise ConnectionConfigError("reader.type must be sqlite, jsonl, or json")


def _parse_column(raw: object) -> ColumnProjection:
    if isinstance(raw, str):
        name = _sql_name(raw, "reader column")
        return ColumnProjection(name, name, "identity")
    value = _object(raw, "reader column")
    _keys(value, {"field", "as", "transform"}, "reader column")
    field = _sql_name(value.get("field"), "reader column.field")
    output = _sql_name(value.get("as", field), "reader column.as")
    transform = value.get("transform", "identity")
    if transform not in ("identity", "is_not_null"):
        raise ConnectionConfigError("reader column.transform is invalid")
    return ColumnProjection(field, output, transform)


def _parse_mapping(raw: object) -> RecordMapping:
    value = _object(raw, "mapping")
    _keys(
        value,
        {
            "id",
            "epistemic_status",
            "fact_owner",
            "kind",
            "subject",
            "source_version",
            "source_time",
            "temporal_status",
            "payload",
            "when",
            "comparison",
        },
        "mapping",
    )
    epistemic_status = value.get("epistemic_status")
    if epistemic_status not in ("observation", "claim"):
        raise ConnectionConfigError("mapping.epistemic_status is invalid")
    temporal_status = value.get("temporal_status")
    if temporal_status not in ("current", "superseded", "unknown"):
        raise ConnectionConfigError("mapping.temporal_status is invalid")
    source_versions = _list(value.get("source_version"), "mapping.source_version")
    if not source_versions:
        raise ConnectionConfigError("mapping.source_version must not be empty")
    payload_raw = _object(value.get("payload"), "mapping.payload")
    payload: list[tuple[str, ValueExpression]] = []
    for name, expression in payload_raw.items():
        if not isinstance(name, str) or not _FIELD_PART.fullmatch(name):
            raise ConnectionConfigError("mapping.payload names must be identifiers")
        payload.append((name, _parse_expression(expression, f"payload.{name}")))
    comparison = _parse_comparison(value.get("comparison"))
    source_time_raw = value.get("source_time")
    return RecordMapping(
        mapping_id=_identifier(value.get("id"), "mapping.id"),
        epistemic_status=epistemic_status,
        fact_owner=_text(value.get("fact_owner"), "mapping.fact_owner"),
        kind=_text(value.get("kind"), "mapping.kind"),
        subject=_parse_expression(value.get("subject"), "mapping.subject"),
        source_version=tuple(
            _parse_expression(item, "mapping.source_version")
            for item in source_versions
        ),
        source_time=(
            None if source_time_raw is None else _parse_timestamp(source_time_raw)
        ),
        temporal_status=temporal_status,
        payload=tuple(payload),
        when=_parse_condition(value["when"]) if "when" in value else None,
        comparison=comparison,
    )


def _parse_expression(raw: object, context: str) -> ValueExpression:
    if isinstance(raw, str):
        return ValueExpression(field=_field(raw, context))
    value = _object(raw, context)
    if "literal" in value:
        _keys(value, {"literal"}, context)
        literal = value["literal"]
        _json_value(literal, context)
        return ValueExpression(literal=literal, has_literal=True)
    if "coalesce" in value:
        _keys(value, {"coalesce"}, context)
        choices = _list(value["coalesce"], f"{context}.coalesce")
        if not choices:
            raise ConnectionConfigError(f"{context}.coalesce must not be empty")
        return ValueExpression(
            coalesce=tuple(
                _parse_expression(choice, f"{context}.coalesce") for choice in choices
            )
        )
    _keys(value, {"field", "transform"}, context)
    field = _field(value.get("field"), context)
    transform = value.get("transform", "identity")
    if transform not in ("identity", "is_not_null"):
        raise ConnectionConfigError(f"{context}.transform is invalid")
    return ValueExpression(field=field, transform=transform)


def _parse_timestamp(raw: object) -> TimestampMapping:
    value = _object(raw, "mapping.source_time")
    _keys(
        value,
        {"field", "transform", "coalesce", "format"},
        "mapping.source_time",
    )
    format_value = value.get("format")
    if format_value not in ("unix", "iso8601", "date"):
        raise ConnectionConfigError("mapping.source_time.format is invalid")
    expression = _parse_expression(
        {key: item for key, item in value.items() if key != "format"},
        "mapping.source_time",
    )
    return TimestampMapping(expression, format_value)


def _parse_condition(raw: object) -> Condition:
    value = _object(raw, "mapping.when")
    _keys(value, {"field", "operator"}, "mapping.when")
    operator = value.get("operator")
    if operator not in ("is_null", "is_not_null"):
        raise ConnectionConfigError("mapping.when.operator is invalid")
    return Condition(_field(value.get("field"), "mapping.when.field"), operator)


def _parse_comparison(raw: object) -> ComparisonContract:
    value = _object(raw, "mapping.comparison")
    _keys(value, {"source_mode", "newer_is_next"}, "mapping.comparison")
    source_mode = value.get("source_mode")
    if source_mode not in ("append_only", "rolling_snapshot"):
        raise ConnectionConfigError("mapping.comparison.source_mode is invalid")
    newer = value.get("newer_is_next")
    if not isinstance(newer, bool):
        raise ConnectionConfigError("mapping.comparison.newer_is_next must be boolean")
    return ComparisonContract(source_mode, newer)


def _mapping_expressions(mapping: RecordMapping) -> list[ValueExpression]:
    expressions = [mapping.subject, *mapping.source_version]
    expressions.extend(expression for _, expression in mapping.payload)
    if mapping.source_time is not None:
        expressions.append(mapping.source_time.value)
    if mapping.when is not None:
        expressions.append(ValueExpression(field=mapping.when.field))
    return [nested for expression in expressions for nested in _expressions(expression)]


def _expressions(expression: ValueExpression) -> list[ValueExpression]:
    return [
        expression,
        *(nested for value in expression.coalesce for nested in _expressions(value)),
    ]


def _field(raw: object, context: str) -> str:
    value = _text(raw, context)
    parts = value.split(".")
    if len(parts) < 2 or parts[0] not in ("item", "root", "meta"):
        raise ConnectionConfigError(f"{context} must start with item., root., or meta.")
    if not all(_FIELD_PART.fullmatch(part) for part in parts[1:]):
        raise ConnectionConfigError(f"{context} contains an invalid field path")
    return value


def _relative_field(raw: str, context: str) -> str:
    if not all(_FIELD_PART.fullmatch(part) for part in raw.split(".")):
        raise ConnectionConfigError(f"{context} contains an invalid field path")
    return raw


def _identifier(raw: object, context: str) -> str:
    value = _text(raw, context)
    if not _IDENTIFIER.fullmatch(value):
        raise ConnectionConfigError(f"{context} is not a valid identifier")
    return value


def _sql_name(raw: object, context: str) -> str:
    value = _text(raw, context)
    if not _SQL_NAME.fullmatch(value):
        raise ConnectionConfigError(f"{context} is not a valid SQL identifier")
    return value


def _text(raw: object, context: str) -> str:
    if not isinstance(raw, str) or not raw:
        raise ConnectionConfigError(f"{context} must be a non-empty string")
    return raw


def _object(raw: object, context: str) -> dict[str, object]:
    if not isinstance(raw, dict) or not all(isinstance(key, str) for key in raw):
        raise ConnectionConfigError(f"{context} must be an object")
    return raw


def _list(raw: object, context: str) -> list[object]:
    if not isinstance(raw, list):
        raise ConnectionConfigError(f"{context} must be a list")
    return raw


def _keys(value: dict[str, object], allowed: set[str], context: str) -> None:
    unexpected = sorted(set(value) - allowed)
    if unexpected:
        raise ConnectionConfigError(
            f"{context} contains unsupported key: {unexpected[0]}"
        )


def _unique(values: Iterable[str], context: str) -> None:
    seen: set[str] = set()
    for value in values:
        if value in seen:
            raise ConnectionConfigError(f"duplicate {context}: {value}")
        seen.add(value)


def _json_value(value: object, context: str) -> None:
    try:
        json.dumps(value, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ConnectionConfigError(f"{context} is not JSON-compatible") from exc


def _ensure_private_directory(path: Path) -> None:
    try:
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.chmod(0o700)
    except OSError as exc:
        raise ConnectionConfigError(
            "Axey state directory could not be created"
        ) from exc


def _write_private(path: Path, contents: str) -> None:
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=".axey-",
            delete=False,
        ) as temporary:
            temporary.write(contents)
            temporary.flush()
            os.fsync(temporary.fileno())
            temporary_path = Path(temporary.name)
        temporary_path.chmod(0o600)
        temporary_path.replace(path)
    except OSError as exc:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)
        raise ConnectionConfigError(
            "Axey connection state could not be written"
        ) from exc
