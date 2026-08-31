import { open, glob } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";

import { selectorsIn, type ConnectionConfig, type Selector } from "./config.ts";

export interface SourceRecord {
  meta: {
    recordIndex: number;
    sourcePath: string;
  };
  numericLexemes?: WeakMap<object, Map<string, string>>;
  record: Record<string, unknown>;
  root: unknown;
}

export class SourceReadError extends Error {
  readonly code:
    | "source_absent"
    | "source_locked"
    | "source_malformed"
    | "source_mapping_invalid"
    | "source_unreadable";

  constructor(code: SourceReadError["code"], _cause?: unknown) {
    super(code.replaceAll("_", " "));
    this.name = "SourceReadError";
    this.code = code;
  }
}

export async function* readSource(config: ConnectionConfig): AsyncGenerator<SourceRecord> {
  switch (config.reader.type) {
    case "sqlite":
      yield* readSqlite(config);
      return;
    case "jsonl":
      yield* readJsonLines(config);
      return;
    case "json":
      yield* readJsonFiles(config);
      return;
    case "csv":
      yield* readCsv(config);
  }
}

export function openSqliteReadOnly(path: string): DatabaseSync {
  const uri = pathToFileURL(path);
  uri.searchParams.set("mode", "ro");
  try {
    return new DatabaseSync(uri, { readOnly: true, timeout: 250 });
  } catch (error) {
    throw sourceError(error);
  }
}

export async function openFileReadOnly(path: string): Promise<FileHandle> {
  try {
    return await open(path, "r");
  } catch (error) {
    throw sourceError(error);
  }
}

async function* readSqlite(config: ConnectionConfig): AsyncGenerator<SourceRecord> {
  if (config.reader.type !== "sqlite") {
    return;
  }
  const columns = selectedSqliteColumns(config);
  const projection =
    columns.length === 0
      ? "1 AS __ecosym_record"
      : columns.map((column) => quoteIdentifier(column)).join(", ");
  let database: DatabaseSync | undefined;
  try {
    database = openSqliteReadOnly(config.reader.path);
    const statement = database.prepare(
      `SELECT ${projection} FROM ${quoteIdentifier(config.reader.table)}`,
    );
    let recordIndex = 0;
    for (const row of statement.iterate()) {
      const record = row as Record<string, unknown>;
      yield {
        meta: { recordIndex, sourcePath: config.reader.path },
        record,
        root: record,
      };
      recordIndex += 1;
    }
  } catch (error) {
    if (error instanceof SourceReadError) {
      throw error;
    }
    throw sourceError(error);
  } finally {
    database?.close();
  }
}

async function* readJsonLines(config: ConnectionConfig): AsyncGenerator<SourceRecord> {
  if (config.reader.type !== "jsonl") {
    return;
  }
  const handle = await openFileReadOnly(config.reader.path);
  try {
    const lines = createInterface({
      crlfDelay: Number.POSITIVE_INFINITY,
      input: handle.createReadStream({ autoClose: false, encoding: "utf8" }),
    });
    let recordIndex = 0;
    for await (const line of lines) {
      if (line.trim() === "") {
        continue;
      }
      const parsed = parseRecord(line);
      yield {
        meta: { recordIndex, sourcePath: config.reader.path },
        numericLexemes: parsed.numericLexemes,
        record: parsed.record,
        root: parsed.record,
      };
      recordIndex += 1;
    }
  } finally {
    await handle.close();
  }
}

async function* readJsonFiles(config: ConnectionConfig): AsyncGenerator<SourceRecord> {
  if (config.reader.type !== "json") {
    return;
  }
  let paths: string[];
  try {
    paths = [];
    for await (const path of glob(config.reader.pathPattern)) {
      paths.push(path);
    }
  } catch (error) {
    throw sourceError(error);
  }
  paths.sort();
  if (paths.length === 0) {
    throw new SourceReadError("source_absent");
  }

  for (const path of paths) {
    const handle = await openFileReadOnly(path);
    try {
      let parsed: ParsedJson;
      try {
        parsed = parseJson(await handle.readFile({ encoding: "utf8" }));
      } catch (error) {
        throw new SourceReadError("source_malformed", error);
      }
      const root = parsed.value;
      const records =
        config.reader.recordsPath === ""
          ? root
          : valueAtPath(requireRecord(root), config.reader.recordsPath);
      if (!Array.isArray(records)) {
        throw new SourceReadError("source_malformed");
      }
      for (const [recordIndex, value] of records.entries()) {
        yield {
          meta: { recordIndex, sourcePath: path },
          numericLexemes: parsed.numericLexemes,
          record: requireRecord(value),
          root,
        };
      }
    } finally {
      await handle.close();
    }
  }
}

async function* readCsv(config: ConnectionConfig): AsyncGenerator<SourceRecord> {
  if (config.reader.type !== "csv") {
    return;
  }
  const handle = await openFileReadOnly(config.reader.path);
  try {
    let contents: string;
    try {
      contents = await handle.readFile({ encoding: "utf8" });
    } catch (error) {
      throw sourceError(error);
    }
    const rows = parseCsv(contents, config.reader.delimiter);
    const headers = rows.shift();
    if (headers === undefined || headers.length === 0) {
      throw new SourceReadError("source_malformed");
    }
    const uniqueHeaders = new Set(headers);
    if (uniqueHeaders.size !== headers.length || headers.some((header) => header === "")) {
      throw new SourceReadError("source_malformed");
    }
    for (const [recordIndex, row] of rows.entries()) {
      if (row.length !== headers.length) {
        throw new SourceReadError("source_malformed");
      }
      const record = Object.create(null) as Record<string, unknown>;
      for (const [index, header] of headers.entries()) {
        record[header] = row[index];
      }
      yield {
        meta: { recordIndex, sourcePath: config.reader.path },
        record,
        root: record,
      };
    }
  } finally {
    await handle.close();
  }
}

function selectedSqliteColumns(config: ConnectionConfig): string[] {
  const columns = new Set<string>();
  for (const selector of selectorsIn(config)) {
    if (!("scope" in selector) || (selector.scope !== "record" && selector.scope !== "root")) {
      continue;
    }
    if (selector.path.includes(".")) {
      throw new SourceReadError("source_mapping_invalid");
    }
    columns.add(selector.path);
  }
  return [...columns].sort();
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parseRecord(text: string): ParsedJson & { record: Record<string, unknown> } {
  try {
    const parsed = parseJson(text);
    return { ...parsed, record: requireRecord(parsed.value) };
  } catch (error) {
    if (error instanceof SourceReadError) {
      throw error;
    }
    throw new SourceReadError("source_malformed", error);
  }
}

interface ParsedJson {
  numericLexemes: WeakMap<object, Map<string, string>>;
  value: unknown;
}

interface JsonReviverContext {
  source?: string;
}

type JsonParseWithSource = (
  text: string,
  reviver: (
    this: object,
    key: string,
    value: unknown,
    context: JsonReviverContext,
  ) => unknown,
) => unknown;

function parseJson(text: string): ParsedJson {
  const numericLexemes = new WeakMap<object, Map<string, string>>();
  const parseWithSource = JSON.parse as JsonParseWithSource;
  const value = parseWithSource(text, function (key, parsed, context) {
    if (typeof parsed === "number" && typeof context.source === "string") {
      let lexemes = numericLexemes.get(this);
      if (lexemes === undefined) {
        lexemes = new Map();
        numericLexemes.set(this, lexemes);
      }
      lexemes.set(key, context.source);
    }
    return parsed;
  });
  return { numericLexemes, value };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new SourceReadError("source_malformed");
  }
  return value as Record<string, unknown>;
}

function valueAtPath(root: Record<string, unknown>, path: string): unknown {
  let value: unknown = root;
  for (const segment of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) {
      throw new SourceReadError("source_malformed");
    }
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let quoteClosed = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
          quoteClosed = true;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (quoteClosed) {
      if (character === delimiter) {
        row.push(field);
        field = "";
        quoteClosed = false;
      } else if (character === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        quoteClosed = false;
      } else if (character !== "\r" || text[index + 1] !== "\n") {
        throw new SourceReadError("source_malformed");
      }
      continue;
    }

    if (character === '"') {
      if (field !== "") {
        throw new SourceReadError("source_malformed");
      }
      quoted = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\r") {
      if (text[index + 1] !== "\n") {
        throw new SourceReadError("source_malformed");
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      index += 1;
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new SourceReadError("source_malformed");
  }
  if (field !== "" || row.length > 0 || quoteClosed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sourceError(error: unknown): SourceReadError {
  if (error instanceof SourceReadError) {
    return error;
  }
  if (isErrorCode(error, "ENOENT")) {
    return new SourceReadError("source_absent", error);
  }
  if (sqliteErrorCode(error) === 5 || sqliteErrorCode(error) === 6) {
    return new SourceReadError("source_locked", error);
  }
  if (isErrorCode(error, "EACCES") || isErrorCode(error, "EPERM")) {
    return new SourceReadError("source_unreadable", error);
  }
  if (sqliteErrorCode(error) === 11 || sqliteErrorCode(error) === 26) {
    return new SourceReadError("source_malformed", error);
  }
  return new SourceReadError("source_unreadable", error);
}

function isErrorCode(error: unknown, code: string): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}

function sqliteErrorCode(error: unknown): number | undefined {
  if (
    error !== null &&
    typeof error === "object" &&
    "errcode" in error &&
    typeof error.errcode === "number"
  ) {
    return error.errcode;
  }
  return undefined;
}
