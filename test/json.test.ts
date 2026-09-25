import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalJson, type JsonValue } from "../src/json.ts";

test("canonicalJson keeps a parsed __proto__ key as data", () => {
  const withKey = JSON.parse('{"a":1,"__proto__":{"x":1}}') as JsonValue;
  const without = JSON.parse('{"a":1}') as JsonValue;

  assert.equal(canonicalJson(withKey), '{"__proto__":{"x":1},"a":1}');
  assert.notEqual(canonicalJson(withKey), canonicalJson(without));
  assert.equal(canonicalJson(JSON.parse('[{"__proto__":null}]') as JsonValue), '[{"__proto__":null}]');
});
