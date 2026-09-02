import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveScene } from "../src/scene.ts";
import { fixture } from "../src/fixture.ts";
import { parse, suggest } from "../src/command.ts";
import { DEFAULT_SETTINGS } from "../src/desk.ts";
import type { DeskState } from "../src/desk.ts";

const scene = deriveScene(fixture);
const state: DeskState = { decisions: {}, selectedCiv: null, view: "log", section: "oversikt", lastPage: "samtaler", mode: "side", threads: {}, settings: DEFAULT_SETTINGS };

test("ja/nei/spør resolve to the newest open matter, numbered", () => {
  const c = parse(scene, state, "ja");
  assert.equal(c.kind, "decide");
  const newest = scene.capital.matters.slice().sort((a, b) => Date.parse(b.raisedAt) - Date.parse(a.raisedAt))[0]!;
  assert.equal((c as { matterId: string }).matterId, newest.id);
  assert.equal(parse(scene, state, "nei 2").kind, "decide");
  assert.equal(parse(scene, state, "ja 99").kind, "unknown");
});

test("snakk finds seats by seat name or place, and agents by label", () => {
  assert.deepEqual(parse(scene, state, "snakk curia"), { kind: "talk", target: { civ: "roma" } });
  assert.deepEqual(parse(scene, state, "snakk med roma"), { kind: "talk", target: { civ: "roma" } });
  assert.deepEqual(parse(scene, state, "snakk rådet"), { kind: "talk", target: "council" });
  const a = parse(scene, state, "spør sweep watchlist");
  assert.equal(a.kind, "talk"); assert.equal((a as { target: { runId?: string } }).target.runId, "r1");
});

test("a bare place name goes there; sheets by word; nonsense is honest", () => {
  assert.deepEqual(parse(scene, state, "Roma"), { kind: "go", civ: "roma" });
  assert.deepEqual(parse(scene, state, "rådet"), { kind: "sheet", sheet: "raadet" });
  assert.equal(parse(scene, state, "blorp").kind, "unknown");
  assert.ok(suggest(scene, state, "sn").every((s) => s.text.startsWith("sn")));
});
