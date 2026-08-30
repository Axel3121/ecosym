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
