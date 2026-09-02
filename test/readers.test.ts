import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { parseConnectionConfig } from "../src/config.ts";
import {
  jsonlSourceMatchesRevision,
  readJsonlSourceWithRecordIndexModes,
  readSource,
  SourceReadError,
} from "../src/readers.ts";

// Guards in the reading layer that the mutation sweep found undefended: each
// check below could be removed with the suite still green. A source is
// evidence, so a reader that accepts a malformed one has invented a fact.

const directories: string[] = [];

function workspace(): string {
  const directory = mkdtempSync(join(tmpdir(), "ecosym-readers-"));
  directories.push(directory);
  return directory;
}

after(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function config(reader: unknown, extra: Record<string, unknown> = {}) {
  return parseConnectionConfig({
    schemaVersion: 1,
    id: "reader-source",
    factOwner: "external-owner",
    reader,
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: {
        selector: { scope: "record", path: "at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
    ...extra,
  }).config;
}

async function readAll(parsed: ReturnType<typeof config>) {
  const records = [];
  for await (const record of readSource(parsed)) {
    records.push(record);
  }
  return records;
}

async function readError(parsed: ReturnType<typeof config>): Promise<string> {
  try {
    await readAll(parsed);
  } catch (error) {
    assert.ok(error instanceof SourceReadError, String(error));
    return error.code;
  }
  throw new Error("expected the read to fail");
}

test("a JSONL line that is not a record object is malformed", async () => {
  const directory = workspace();
  const path = join(directory, "source.jsonl");

  // A bare scalar or an array is valid JSON and not a record. Accepting one
  // would make every selector read from something with no fields.
  for (const line of ["[1,2,3]", '"just a string"', "42", "null", "true"]) {
    writeFileSync(path, `${line}\n`);
    assert.equal(await readError(config({ type: "jsonl", path })), "source_malformed", line);
  }

  // An object on the same line still reads, so the guard is not refusing
  // everything.
  writeFileSync(
    path,
    '{"id":"r1","subject":"s","at":"2026-08-30T00:00:00.000Z","value":7}\n',
  );
  const records = await readAll(config({ type: "jsonl", path }));
  assert.equal(records.length, 1);
  assert.equal(records[0]?.record.id, "r1");
});

test("a JSON records path may not traverse a property that is absent", async () => {
  const directory = workspace();
  const path = join(directory, "source.json");
  const reader = {
    type: "json",
    pathPattern: join(directory, "*.json"),
    recordsPath: "payload.records",
  };

  // A missing own property is not an empty list of records: the source does
  // not have the shape the connection declared, and saying otherwise would
  // report "no records" for a document that was never understood.
  writeFileSync(path, JSON.stringify({ payload: {} }));
  assert.equal(await readError(config(reader)), "source_malformed");
  writeFileSync(path, JSON.stringify({ different: { records: [] } }));
  assert.equal(await readError(config(reader)), "source_malformed");

  // A polluted prototype must not supply records for a source that omitted
  // them. JSON.parse creates ordinary objects, so this exercises the exact
  // missing-own-property branch rather than adding a similarly named field.
  const inheritedRecords = "__ecosym_inherited_records__";
  Object.defineProperty(Object.prototype, inheritedRecords, {
    configurable: true,
    value: [],
  });
  try {
    writeFileSync(path, JSON.stringify({ payload: {} }));
    assert.equal(
      await readError(config({ ...reader, recordsPath: `payload.${inheritedRecords}` })),
      "source_malformed",
    );
  } finally {
    Reflect.deleteProperty(Object.prototype, inheritedRecords);
  }

  // The declared path present and holding records still reads.
  writeFileSync(
    path,
    JSON.stringify({
      payload: {
        records: [{ id: "r1", subject: "s", at: "2026-08-30T00:00:00.000Z", value: 7 }],
      },
    }),
  );
  assert.equal((await readAll(config(reader))).length, 1);
});

test("a JSON document must hold records, not an array in a record's place", async () => {
  const directory = workspace();
  const path = join(directory, "source.json");
  const reader = {
    type: "json",
    pathPattern: join(directory, "*.json"),
    recordsPath: "records",
  };

  // Each element must be a record object. An array element has no fields to
  // select, and typeof [] === "object" is exactly the confusion this rejects.
  writeFileSync(path, JSON.stringify({ records: [["id", "r1"]] }));
  assert.equal(await readError(config(reader)), "source_malformed");
  writeFileSync(path, JSON.stringify({ records: ["r1"] }));
  assert.equal(await readError(config(reader)), "source_malformed");

  writeFileSync(
    path,
    JSON.stringify({
      records: [{ id: "r1", subject: "s", at: "2026-08-30T00:00:00.000Z", value: 7 }],
    }),
  );
  assert.equal((await readAll(config(reader))).length, 1);
});

test("a JSON glob that matched no file is an absent source, not an empty one", async () => {
  const directory = workspace();
  const reader = {
    type: "json",
    pathPattern: join(directory, "nothing-*.json"),
    recordsPath: "records",
  };

  // Zero files means the source could not be read. Reporting it as an empty
  // read would let verification conclude agreement against nothing.
  assert.equal(await readError(config(reader)), "source_absent");

  writeFileSync(
    join(directory, "nothing-1.json"),
    JSON.stringify({
      records: [{ id: "r1", subject: "s", at: "2026-08-30T00:00:00.000Z", value: 7 }],
    }),
  );
  assert.equal((await readAll(config(reader))).length, 1);
});

test("a SQLite selector names a column, not a nested path", async () => {
  const directory = workspace();
  const path = join(directory, "source.db");

  // SQLite rows are flat, so a dotted path cannot be a column name. The
  // configuration layer refuses it first; the reader's own check is the second
  // line for a configuration that reached it another way. Assert the boundary
  // that actually decides, and that the reader agrees.
  assert.throws(
    () =>
      parseConnectionConfig({
        schemaVersion: 1,
        id: "sqlite-source",
        factOwner: "external-owner",
        reader: { type: "sqlite", path, table: "measurements" },
        sourceRecord: {
          identity: [{ scope: "record", path: "id" }],
          retention: "history",
          recordedAt: {
            selector: { scope: "record", path: "at" },
            format: "iso8601",
          },
        },
        facts: [
          {
            epistemicStatus: "observation",
            kind: "api.value",
            subject: { scope: "record", path: "subject" },
            payload: { value: { scope: "record", path: "nested.value" } },
          },
        ],
      }),
    /SQLite selectors must name top-level columns/,
  );

  // The reader refuses the same shape if it is handed one directly, which is
  // what stops a dotted path from being quoted as a column name.
  const parsed = parseConnectionConfig({
    schemaVersion: 1,
    id: "sqlite-source",
    factOwner: "external-owner",
    reader: { type: "sqlite", path, table: "measurements" },
    sourceRecord: {
      identity: [{ scope: "record", path: "id" }],
      retention: "history",
      recordedAt: {
        selector: { scope: "record", path: "at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "api.value",
        subject: { scope: "record", path: "subject" },
        payload: { value: { scope: "record", path: "value" } },
      },
    ],
  }).config;
  const smuggled = structuredClone(parsed) as unknown as {
    facts: { payload: Record<string, { path: string; scope: string }> }[];
  };
  smuggled.facts[0]!.payload.value = { scope: "record", path: "nested.value" };
  assert.equal(
    await readError(smuggled as unknown as ReturnType<typeof config>),
    "source_mapping_invalid",
  );
});

test("a JSONL revision is identified by size and ctime as well as inode", () => {
  const directory = workspace();
  const path = join(directory, "source.jsonl");
  writeFileSync(path, '{"id":"r1"}\n');
  const original = statSync(path, { bigint: true });
  const revision = {
    ctimeNs: original.ctimeNs,
    dev: original.dev,
    ino: original.ino,
    mtimeNs: original.mtimeNs,
    size: original.size,
  };
  assert.equal(jsonlSourceMatchesRevision(path, revision), true);

  // Size and ctime are separate fields for a reason: a rewrite can preserve
  // one while changing the other, and a revision that ignores either would
  // call two different files the same source.
  assert.equal(
    jsonlSourceMatchesRevision(path, { ...revision, size: revision.size + 1n }),
    false,
  );
  assert.equal(
    jsonlSourceMatchesRevision(path, { ...revision, ctimeNs: revision.ctimeNs + 1n }),
    false,
  );
  assert.equal(
    jsonlSourceMatchesRevision(path, { ...revision, mtimeNs: revision.mtimeNs + 1n }),
    false,
  );
  assert.equal(jsonlSourceMatchesRevision(path, { ...revision, ino: revision.ino + 1n }), false);

  // A real content change of the same length still moves ctime, so the pair of
  // checks catches what a single field would miss.
  writeFileSync(path, '{"id":"r2"}\n');
  assert.equal(jsonlSourceMatchesRevision(path, revision), false);
  assert.equal(jsonlSourceMatchesRevision(join(directory, "absent.jsonl"), revision), false);
});

test("JSONL index-mode reading refuses source metadata that changes during the read", async (t) => {
  const directory = workspace();
  const path = join(directory, "source.jsonl");
  const original = '{"id":"r1","subject":"s","at":"2026-08-30T00:00:00.000Z","value":7}\n';
  const replacement = '{"id":"r2","subject":"s","at":"2026-08-30T00:00:00.000Z","value":7}\n';
  const parsed = config({ type: "jsonl", path });

  for (const changedField of ["mtimeNs", "ctimeNs"] as const) {
    writeFileSync(path, original);
    const before = statSync(path, { bigint: true });
    const handle = await open(path, "r");
    const fileHandlePrototype = Object.getPrototypeOf(handle) as {
      stat(options: { bigint: true }): Promise<typeof before>;
    };
    await handle.close();
    let statCalls = 0;

    // Change the source immediately after the first snapshot. The second
    // snapshot models an otherwise-identical source whose only observable
    // change is the field under test, so neither check can borrow coverage
    // from the other.
    t.mock.method(fileHandlePrototype, "stat", async () => {
      statCalls += 1;
      if (statCalls === 1) {
        writeFileSync(path, replacement);
        return before;
      }
      return { ...before, [changedField]: before[changedField] + 1n };
    });

    await assert.rejects(
      readJsonlSourceWithRecordIndexModes(parsed),
      (error: unknown) => error instanceof SourceReadError && error.code === "source_changed",
      changedField,
    );
    assert.equal(statCalls, 2, changedField);
    t.mock.restoreAll();
  }
});

test("an unescaped quote inside an unquoted CSV field is malformed", async () => {
  const directory = workspace();
  const path = join(directory, "source.csv");
  const reader = { type: "csv", path, delimiter: "," };

  // A quote may only open a field. One appearing mid-field means the file does
  // not follow the quoting rules, and guessing an interpretation would invent
  // a value the source never stated.
  for (const body of [
    'id,subject,at,value\r\nr1,su"bject,2026-08-30T00:00:00.000Z,7\r\n',
    'id,subject,at,value\r\nr1,subject",2026-08-30T00:00:00.000Z,7\r\n',
    // This quote pair is balanced. If the first quote is allowed to open a
    // quoted span mid-field, the mutated parser accepts the row as "subject".
    'id,subject,at,value\r\nr1,su"bject",2026-08-30T00:00:00.000Z,7\r\n',
  ]) {
    writeFileSync(path, body);
    assert.equal(await readError(config(reader)), "source_malformed", body);
  }

  // A properly quoted field, including one containing a quote, still reads.
  writeFileSync(
    path,
    'id,subject,at,value\r\nr1,"su""bject",2026-08-30T00:00:00.000Z,7\r\n',
  );
  const records = await readAll(config(reader));
  assert.equal(records.length, 1);
  assert.equal(records[0]?.record.subject, 'su"bject');
});
