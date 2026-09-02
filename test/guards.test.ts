import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseConnectionConfig } from "../src/config.ts";
import { canonicalJson, isJsonScalar } from "../src/json.ts";
import { materializeFacts, SourceMappingError } from "../src/materialize.ts";
import { readSource } from "../src/readers.ts";
import { ObservationStore } from "../src/store.ts";
import { parseCalendarInstant, utcInstantOrderingKey } from "../src/time.ts";

function validConfig(): unknown {
  return {
    schemaVersion: 1,
    id: "guard-source",
    factOwner: "source-owner",
    reader: { type: "jsonl", path: "/unused.jsonl" },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "example.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  };
}

async function readCsv(contents: string): Promise<unknown[]> {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-csv-guard-"));
  const path = join(directory, "source.csv");
  writeFileSync(path, contents);
  const { config } = parseConnectionConfig({
    schemaVersion: 1,
    id: "csv-guard-source",
    factOwner: "source-owner",
    reader: { type: "csv", path, delimiter: "," },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: { unavailable: true },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "example.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  });
  try {
    const records: unknown[] = [];
    for await (const record of readSource(config)) {
      records.push(record);
    }
    return records;
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("canonical JSON sorts objects at every nesting level", () => {
  assert.equal(
    canonicalJson({ z: [{ b: 2, a: 1 }], a: { d: 4, c: 3 } }),
    '{"a":{"c":3,"d":4},"z":[{"a":1,"b":2}]}',
  );
});

test("JSON scalars exclude non-finite numbers", () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(isJsonScalar(value), false, `${String(value)} must not be a JSON scalar`);
  }
});

test("connection configuration requires at least one fact", () => {
  const input = validConfig() as { facts: unknown[] };
  input.facts = [];

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.facts must not be empty",
  });
});

test("source-record configuration requires an identity selector", () => {
  const input = validConfig() as { sourceRecord: { identity: unknown[] } };
  input.sourceRecord.identity = [];

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.sourceRecord.identity must not be empty",
  });
});

test("fact configuration requires at least one payload field", () => {
  const input = validConfig() as { facts: [{ payload: Record<string, unknown> }] };
  input.facts[0].payload = {};

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.facts[0].payload must not be empty",
  });
});

test("coalesce selectors require at least one choice", () => {
  const input = validConfig() as { facts: [{ subject: unknown }] };
  input.facts[0].subject = { coalesce: [] };

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.facts[0].subject.coalesce must not be empty",
  });
});

test("observation query limits cannot exceed 1000", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-query-limit-"));
  const store = new ObservationStore(directory);
  try {
    assert.throws(() => store.queryObservations({ limit: 1_001 }), {
      name: "RangeError",
      message: "Query limit must be an integer from 1 through 1000",
    });
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("observation query limits must be safe integers", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-query-limit-"));
  const store = new ObservationStore(directory);
  try {
    assert.throws(() => store.queryObservations({ limit: 1.5 }), {
      name: "RangeError",
      message: "Query limit must be an integer from 1 through 1000",
    });
  } finally {
    store.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite busy timeouts cannot be negative", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-busy-timeout-"));
  let store: ObservationStore | undefined;
  try {
    assert.throws(
      () => {
        store = new ObservationStore(directory, -1);
      },
      {
        name: "RangeError",
        message: "SQLite busy timeout must be an integer from 0 through 250",
      },
    );
  } finally {
    store?.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("SQLite busy timeouts must be integers", () => {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-busy-timeout-"));
  let store: ObservationStore | undefined;
  try {
    assert.throws(
      () => {
        store = new ObservationStore(directory, 1.5);
      },
      {
        name: "RangeError",
        message: "SQLite busy timeout must be an integer from 0 through 250",
      },
    );
  } finally {
    store?.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("CSV headers cannot be empty", async () => {
  await assert.rejects(readCsv("id,,value\none,item,7\n"), {
    name: "SourceReadError",
    code: "source_malformed",
  });
});

test("CSV headers cannot be duplicated", async () => {
  await assert.rejects(readCsv("id,subject,subject,value\none,item,other,7\n"), {
    name: "SourceReadError",
    code: "source_malformed",
  });
});

test("CSV rows must match the header width", async (t) => {
  for (const scenario of [
    { name: "short row", source: "id,subject,value,ignored\none,item,7\n" },
    { name: "long row", source: "id,subject,value\none,item,7,ignored\n" },
  ]) {
    await t.test(scenario.name, async () => {
      await assert.rejects(readCsv(scenario.source), {
        name: "SourceReadError",
        code: "source_malformed",
      });
    });
  }
});

test("CSV quoted fields must be terminated", async () => {
  await assert.rejects(readCsv('id,subject,value\none,item,"unterminated\n'), {
    name: "SourceReadError",
    code: "source_malformed",
  });
});

test("invalid date and time components remain unrepresentable", () => {
  for (const value of [
    "2026-00-15T12:30:30Z",
    "2026-13-15T12:30:30Z",
    "2026-01-00T12:30:30Z",
    "2026-01-15T12:60:30Z",
    "2026-01-15T12:30:60Z",
    "2026-01-15T25:30:30Z",
  ]) {
    assert.equal(utcInstantOrderingKey(value), null, value);
  }
});

test("Gregorian century rules reject 1900 and accept 2000 as leap years", () => {
  assert.equal(parseCalendarInstant("1900-02-29T00:00:00Z"), null);
  assert.notEqual(parseCalendarInstant("2000-02-29T00:00:00Z"), null);
});

test("materialization rejects an empty subject", () => {
  const { config } = parseConnectionConfig(validConfig());

  assert.throws(
    () =>
      materializeFacts(config, {
        meta: { recordIndex: 0, sourcePath: "/unused.jsonl" },
        numericLexemes: null,
        record: { id: "one", subject: "", value: 7 },
        root: { id: "one", subject: "", value: 7 },
      }),
    SourceMappingError,
  );
});
