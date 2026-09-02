import assert from "node:assert/strict";
import { test } from "node:test";

import { ConfigError, parseConnectionConfig, selectorsIn } from "../src/config.ts";

function validConfig(): unknown {
  return {
    schemaVersion: 1,
    id: "example-source",
    factOwner: "external-owner",
    reader: {
      type: "sqlite",
      path: "/source.db",
      table: "events",
    },
    sourceRecord: {
      identity: [{ scope: "record", path: "event_id" }],
      retention: "latest",
      recordedAt: {
        selector: { scope: "record", path: "updated_at" },
        format: "iso8601",
      },
    },
    facts: [
      {
        epistemicStatus: "observation",
        kind: "external-api.value",
        subject: { scope: "record", path: "subject_id" },
        payload: {
          value: { scope: "record", path: "value" },
        },
      },
    ],
  };
}

test("parses and canonically fingerprints a declarative connection", () => {
  const first = parseConnectionConfig(validConfig());
  const reordered = validConfig() as Record<string, unknown>;
  const second = parseConnectionConfig({
    facts: reordered.facts,
    sourceRecord: reordered.sourceRecord,
    reader: reordered.reader,
    factOwner: reordered.factOwner,
    id: reordered.id,
    schemaVersion: reordered.schemaVersion,
  });

  assert.deepEqual(second, first);
  assert.match(first.hash, /^[a-f0-9]{64}$/);
});

test("rejects executable or undeclared configuration properties", () => {
  const config = validConfig() as Record<string, unknown>;
  config.transform = "return process.env.SECRET";

  assert.throws(() => parseConnectionConfig(config), ConfigError);
});

test("enumerates only fields explicitly selected by the connection", () => {
  const { config } = parseConnectionConfig(validConfig());

  assert.deepEqual(
    selectorsIn(config)
      .filter((selector) => "path" in selector)
      .map((selector) => ("path" in selector ? `${selector.scope}.${selector.path}` : "")),
    [
      "record.event_id",
      "record.updated_at",
      "record.subject_id",
      "record.value",
    ],
  );
});

test("requires an explicit declaration when source time is unavailable", () => {
  const input = validConfig() as {
    sourceRecord: Record<string, unknown>;
  };
  input.sourceRecord.recordedAt = { unavailable: true };

  const { config } = parseConnectionConfig(input);
  assert.deepEqual(config.sourceRecord.recordedAt, { unavailable: true });
});

test("accepts source-local position as identity when a record has no key", () => {
  const input = validConfig() as {
    sourceRecord: Record<string, unknown>;
  };
  input.sourceRecord.identity = [
    { scope: "meta", value: "source-path" },
    { scope: "meta", value: "record-index" },
  ];

  const { config } = parseConnectionConfig(input);
  assert.deepEqual(config.sourceRecord.identity, input.sourceRecord.identity);
});

test("rejects nested selectors that a SQLite reader cannot satisfy", () => {
  const input = validConfig() as {
    facts: { payload: Record<string, unknown> }[];
  };
  const firstFact = input.facts[0];
  assert.ok(firstFact);
  firstFact.payload.value = { scope: "record", path: "nested.value" };

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "SQLite selectors must name top-level columns",
  });
});

test("rejects a negative zero the store could not persist exactly", () => {
  // src/store.ts refuses -0 in a fact payload because it cannot be persisted
  // exactly. Accepting it here only moves the failure to collection time, where
  // the message no longer names the configuration field that caused it.
  const config = validConfig() as {
    facts: [{ payload: Record<string, unknown> }];
  };
  config.facts[0].payload = {
    value: { default: -0, selector: { scope: "record", path: "value" } },
  };
  assert.throws(() => parseConnectionConfig(config), ConfigError);
});

// Guards found alive by the mutation sweep: each of these had no assertion that
// failed when the check was removed. Every test below names the behaviour the
// guard exists for rather than the shape of the mutation.

function copyConfig(): Record<string, unknown> {
  return structuredClone(validConfig()) as Record<string, unknown>;
}

function firstFact(input: Record<string, unknown>): Record<string, unknown> {
  const facts = input.facts;
  assert.ok(Array.isArray(facts));
  const fact = facts[0];
  assert.ok(fact && typeof fact === "object" && !Array.isArray(fact));
  return fact as Record<string, unknown>;
}

test("rejects unsupported connection schema versions", () => {
  const input = copyConfig();
  input.schemaVersion = 2;

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.schemaVersion must be 1",
  });
});

test("rejects every CSV delimiter form the reader cannot parse unambiguously", () => {
  for (const delimiter of ["", "::", '"', "\r", "\n"]) {
    const input = copyConfig();
    input.reader = { type: "csv", path: "/source.csv", delimiter };

    assert.throws(
      () => parseConnectionConfig(input),
      {
        name: "ConfigError",
        message:
          "connection.reader.delimiter must be one character other than quote or newline",
      },
      JSON.stringify(delimiter),
    );
  }
});

test("rejects payload field names outside the configured identifier grammar", () => {
  const input = copyConfig();
  firstFact(input).payload = {
    "not a valid payload key": { scope: "record", path: "value" },
  };

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: /connection\.facts\[0\]\.payload key must match/,
  });
});

test("does not treat arrays carrying properties as configuration objects", () => {
  const input = copyConfig();
  input.reader = Object.assign([], { type: "jsonl", path: "/source.jsonl" });

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.reader must be an object",
  });
});

test("rejects names that contain characters outside the declarative name grammar", () => {
  const input = copyConfig();
  input.id = "source with spaces";

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: /connection\.id must match/,
  });
});

test("rejects SQLite table names that are not simple identifiers", () => {
  const input = copyConfig();
  input.reader = { type: "sqlite", path: "/source.db", table: "events.table" };

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.reader.table must be a simple identifier",
  });
});

test("rejects invalid segments in selectors and JSON records paths", () => {
  const invalidSelector = copyConfig();
  firstFact(invalidSelector).subject = { scope: "record", path: "subject id" };
  assert.throws(() => parseConnectionConfig(invalidSelector), {
    name: "ConfigError",
    message: "connection.facts[0].subject.path must be a dot-separated field path",
  });

  const invalidRecordsPath = copyConfig();
  invalidRecordsPath.reader = {
    type: "json",
    pathPattern: "/inputs/*.json",
    recordsPath: "records..items",
  };
  assert.throws(() => parseConnectionConfig(invalidRecordsPath), {
    name: "ConfigError",
    message: "connection.reader.recordsPath must be a dot-separated field path",
  });
});

test("reports missing required keys before later field parsing", () => {
  const input = copyConfig();
  delete input.factOwner;

  assert.throws(() => parseConnectionConfig(input), {
    name: "ConfigError",
    message: "connection.factOwner is required",
  });
});
