import { lstatSync, statSync } from "node:fs";
import { open, glob } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";

import { selectorsIn, type ConnectionConfig, type Selector } from "./config.ts";

export interface SourceRecord {
  meta: {
    recordIndex: number;
    sourcePath: string;
  };
  numericLexemes: null | WeakMap<object, Map<string, string>>;
  record: Record<string, unknown>;
  root: unknown;
}

export type JsonlRecordIndexMode = "physical-line" | "record-ordinal";

export interface JsonlSourceRevision {
  ctimeNs: bigint;
  dev: bigint;
  ino: bigint;
  mtimeNs: bigint;
  size: bigint;
}

export class SourceReadError extends Error {
  readonly code:
    | "source_absent"
    | "source_changed"
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

export async function* readSource(
  config: ConnectionConfig,
  jsonlRecordIndexMode: JsonlRecordIndexMode = "record-ordinal",
): AsyncGenerator<SourceRecord> {
  switch (config.reader.type) {
    case "arena":
      // Arena is admitted from supplied reports; no upstream reread is configured.
      throw new SourceReadError("source_unreadable");
    case "sqlite":
      yield* readSqlite(config);
      return;
    case "jsonl":
      yield* readJsonLines(config, jsonlRecordIndexMode);
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

export async function readJsonlSourceWithRecordIndexModes(
  config: ConnectionConfig,
): Promise<{
  physicalLine: SourceRecord[];
  recordOrdinal: SourceRecord[];
  revision: JsonlSourceRevision;
}> {
  if (config.reader.type !== "jsonl") {
    throw new SourceReadError("source_mapping_invalid");
  }
  const handle = await openFileReadOnly(config.reader.path);
  let stream: ReturnType<typeof utf8Text> | undefined;
  try {
    const before = await handle.stat({ bigint: true });
    stream = utf8Text(handle);
    const lines = createInterface({
      crlfDelay: Number.POSITIVE_INFINITY,
      input: stream.text,
    });
    const physicalLine: SourceRecord[] = [];
    const recordOrdinal: SourceRecord[] = [];
    let physicalLineIndex = 0;
    let recordOrdinalIndex = 0;
    for await (const line of lines) {
      if (line.trim() !== "") {
        const parsed = parseRecord(line);
        const source = {
          numericLexemes: parsed.numericLexemes,
          record: parsed.record,
          root: parsed.record,
        };
        physicalLine.push({
          ...source,
          meta: {
            recordIndex: physicalLineIndex,
            sourcePath: config.reader.path,
          },
        });
        recordOrdinal.push({
          ...source,
          meta: {
            recordIndex: recordOrdinalIndex,
            sourcePath: config.reader.path,
          },
        });
        recordOrdinalIndex += 1;
      }
      physicalLineIndex += 1;
    }
    const after = await handle.stat({ bigint: true });
    if (!sameSourceRevision(before, after)) {
      throw new SourceReadError("source_changed");
    }
    return {
      physicalLine,
      recordOrdinal,
      revision: sourceRevision(after),
    };
  } catch (error) {
    if (error instanceof SourceReadError) {
      throw error;
    }
    throw sourceError(error);
  } finally {
    closeUtf8Text(stream);
    await handle.close();
  }
}

export function jsonlSourceMatchesRevision(
  path: string,
  revision: JsonlSourceRevision,
): boolean {
  try {
    assertPathSourceRevision(path, revision);
    return true;
  } catch {
    return false;
  }
}

function sameSourceRevision(current: JsonlSourceRevision, revision: JsonlSourceRevision): boolean {
  return current.dev === revision.dev &&
    current.ino === revision.ino &&
    current.size === revision.size &&
    current.mtimeNs === revision.mtimeNs &&
    current.ctimeNs === revision.ctimeNs;
}

function assertPathSourceRevision(
  path: string,
  revision: JsonlSourceRevision,
  stat: (path: string) => JsonlSourceRevision = (path) => statSync(path, { bigint: true }),
): void {
  try {
    const current = stat(path);
    if (!sameSourceRevision(current, revision)) {
      throw new SourceReadError("source_changed");
    }
  } catch (error) {
    throw isErrorCode(error, "ENOENT")
      ? new SourceReadError("source_changed", error)
      : sourceError(error);
  }
}

function sourceRevision(stats: JsonlSourceRevision): JsonlSourceRevision {
  return {
    ctimeNs: stats.ctimeNs,
    dev: stats.dev,
    ino: stats.ino,
    mtimeNs: stats.mtimeNs,
    size: stats.size,
  };
}

// The utf8 encoding option replaces bytes that are not UTF-8 with U+FFFD,
// which would store a value the source never stated. A byte order mark is kept,
// as the utf8 option keeps it.
function utf8Decoder(): TextDecoder {
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
}

function decodeUtf8(decoder: TextDecoder, bytes?: Uint8Array, stream = false): string {
  try {
    return decoder.decode(bytes, { stream });
  } catch (error) {
    throw new SourceReadError("source_malformed", error);
  }
}

// Streams a file's text for readline, refusing bytes that are not UTF-8.
function utf8Text(handle: FileHandle): { bytes: Readable; text: Readable } {
  const bytes = handle.createReadStream({ autoClose: false });
  const decoder = utf8Decoder();
  const text = Readable.from((async function* () {
    for await (const chunk of bytes) yield decodeUtf8(decoder, chunk as Buffer, true);
    const rest = decodeUtf8(decoder);
    if (rest !== "") yield rest;
  })());
  return { bytes, text };
}

// A reader stopped early leaves the decoding stream pending on the file. Tear
// it down before the handle closes under it, so the byte stream's premature
// close has no one left to report to.
function closeUtf8Text(stream: { bytes: Readable; text: Readable } | undefined): void {
  stream?.text.destroy();
  stream?.bytes.destroy();
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
        numericLexemes: null,
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

async function* readJsonLines(
  config: ConnectionConfig,
  recordIndexMode: JsonlRecordIndexMode,
): AsyncGenerator<SourceRecord> {
  if (config.reader.type !== "jsonl") {
    return;
  }
  const handle = await openFileReadOnly(config.reader.path);
  let before: JsonlSourceRevision | undefined;
  let stream: ReturnType<typeof utf8Text> | undefined;
  try {
    before = await handle.stat({ bigint: true });
    stream = utf8Text(handle);
    const lines = createInterface({
      crlfDelay: Number.POSITIVE_INFINITY,
      input: stream.text,
    });
    let recordIndex = 0;
    for await (const line of lines) {
      if (line.trim() === "") {
        if (recordIndexMode === "physical-line") {
          recordIndex += 1;
        }
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
    await assertSourceRevision(handle, config.reader.path, before);
  } catch (error) {
    if (before !== undefined) await assertSourceRevision(handle, config.reader.path, before);
    throw sourceError(error);
  } finally {
    closeUtf8Text(stream);
    await handle.close();
  }
}

export async function* readJsonFiles(
  config: ConnectionConfig,
  stat: (path: string) => JsonlSourceRevision = (path) => statSync(path, { bigint: true }),
): AsyncGenerator<SourceRecord> {
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

  const revisions = new Map<string, JsonlSourceRevision>();
  for (const path of paths) {
    try {
      revisions.set(path, sourceRevision(statSync(path, { bigint: true })));
    } catch (error) {
      throw jsonInventoryStatError(error, path);
    }
  }
  for (const path of paths) {
    const before = revisions.get(path)!;
    assertPathSourceRevision(path, before, stat);
    let handle: FileHandle;
    try {
      handle = await openFileReadOnly(path);
    } catch (error) {
      assertPathSourceRevision(path, before, stat);
      throw error;
    }
    try {
      await assertSourceRevision(handle, path, before, stat);
      let bytes: Buffer;
      try {
        bytes = await handle.readFile();
      } catch (error) {
        throw sourceError(error);
      }
      const contents = decodeUtf8(utf8Decoder(), bytes);
      let parsed: ParsedJson;
      try {
        parsed = parseJson(contents);
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
      await assertSourceRevision(handle, path, before, stat);
    } catch (error) {
      await assertSourceRevision(handle, path, before, stat);
      throw sourceError(error);
    } finally {
      await handle.close();
    }
  }
  try {
    const afterPaths = [];
    for await (const path of glob(config.reader.pathPattern)) afterPaths.push(path);
    afterPaths.sort();
    if (afterPaths.length !== paths.length || afterPaths.some((path, index) => path !== paths[index])) {
      throw new SourceReadError("source_changed");
    }
    for (const path of paths) assertPathSourceRevision(path, revisions.get(path)!, stat);
  } catch (error) {
    throw sourceError(error);
  }
}

async function assertSourceRevision(
  handle: FileHandle,
  path: string,
  before: JsonlSourceRevision,
  stat?: (path: string) => JsonlSourceRevision,
): Promise<void> {
  if (!sameSourceRevision(await handle.stat({ bigint: true }), before)) {
    throw new SourceReadError("source_changed");
  }
  assertPathSourceRevision(path, before, stat);
}

async function* readCsv(config: ConnectionConfig): AsyncGenerator<SourceRecord> {
  if (config.reader.type !== "csv") {
    return;
  }
  const handle = await openFileReadOnly(config.reader.path);
  let before: JsonlSourceRevision | undefined;
  try {
    before = await handle.stat({ bigint: true });
    let bytes: Buffer;
    try {
      bytes = await handle.readFile();
    } catch (error) {
      throw sourceError(error);
    }
    let contents = decodeUtf8(utf8Decoder(), bytes);
    // utf8 decoding keeps a leading byte order mark; it is not part of the first header.
    if (contents.startsWith("﻿")) contents = contents.slice(1);
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
        numericLexemes: null,
        record,
        root: record,
      };
    }
    await assertSourceRevision(handle, config.reader.path, before);
  } catch (error) {
    if (before !== undefined) await assertSourceRevision(handle, config.reader.path, before);
    throw sourceError(error);
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

export function jsonInventoryStatError(
  error: unknown,
  path: string,
  lstat: (path: string) => unknown = lstatSync,
): SourceReadError {
  if (isErrorCode(error, "ENOENT")) {
    try {
      // A dangling symlink still has an entry; a vanished glob member does not.
      lstat(path);
    } catch (entryError) {
      return isErrorCode(entryError, "ENOENT")
        ? new SourceReadError("source_changed", error)
        : sourceError(entryError);
    }
  }
  return sourceError(error);
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
    // node:sqlite reports the extended result code; its low byte is the
    // primary code (SQLITE_BUSY_RECOVERY is still SQLITE_BUSY).
    return error.errcode & 0xff;
  }
  return undefined;
}
