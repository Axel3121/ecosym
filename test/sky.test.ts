import assert from "node:assert/strict";
import { test } from "node:test";
import { angularOrder, brightness, brightnessLevel, isDense, LATTICE_BOTTOM, LATTICE_TOP, placeBodies, tickArc, wrapLine } from "../web/sky.ts";

// The app's own fields: a sparse desktop sky keeps room for a label beside each body; a dense one is a compact lattice.
const desktop = { width: 896, height: 750, minDx: 370, minDy: 130, labelReserve: 310 };
const dense = { width: 896, height: 750, minDx: 300, minDy: 150, lattice: true };
const phone = { width: 390, height: LATTICE_TOP + LATTICE_BOTTOM + 7 * 190, minDx: 390, minDy: 190, lattice: true };
const ids = ["civ:utvikling", "civ:husholdning", "civ:handel", "civ:arkiv", "civ:reise", "civ:helse", "civ:musikk", "civ:hage"];

test("the same founding order always yields the same sky, and a new founding never moves an older body", () => {
  for (const field of [desktop, dense]) {
    const count = field === desktop ? 4 : ids.length;
    const first = placeBodies(ids.slice(0, count), field);
    assert.deepEqual(placeBodies(ids.slice(0, count), field), first);
    const grown = placeBodies([...ids.slice(0, count), "civ:ny"], field);
    assert.deepEqual(grown.slice(0, count), first);
    assert.notDeepEqual(placeBodies([...ids.slice(0, count)].reverse(), field).map((body) => body.id), first.map((body) => body.id));
  }
});

test("bodies keep their label boxes apart and stay inside the field at both sizes", () => {
  for (const field of [desktop, dense, phone]) {
    const bodies = placeBodies(field === desktop ? ids.slice(0, 4) : ids, field);
    for (const [index, a] of bodies.entries()) {
      assert.ok(a.x >= 0 && a.x <= field.width && a.y >= 0 && a.y <= field.height, `${a.id} inside ${field.width}x${field.height}`);
      for (const b of bodies.slice(index + 1)) {
        assert.ok(Math.abs(a.x - b.x) >= field.minDx || Math.abs(a.y - b.y) >= field.minDy, `${a.id} and ${b.id} overlap at ${field.width}px`);
      }
    }
  }
});

test("brightness is a strict step of time since the latest read, never a gradient", () => {
  const now = Date.parse("2026-09-16T22:00:00.000Z");
  const at = (ms: number) => new Date(now - ms).toISOString();
  assert.equal(brightness(null, now), "never");
  assert.equal(brightness("not a date", now), "never");
  assert.equal(brightness(at(0), now), "now");
  assert.equal(brightness(at(59 * 60_000), now), "now");
  assert.equal(brightness(at(61 * 60_000), now), "hours");
  assert.equal(brightness(at(47 * 3_600_000), now), "hours");
  assert.equal(brightness(at(49 * 3_600_000), now), "days");
  assert.equal(brightness(at(59 * 86_400_000), now), "days");
  assert.equal(brightness(at(61 * 86_400_000), now), "months");
  assert.deepEqual(Object.values(brightnessLevel), [1, 0.7, 0.4, 0.2, 0]);
});

test("a single column fills top-down in founding order, with no empty slot before a body", () => {
  const bodies = placeBodies(ids.slice(0, 4), { width: 390, height: LATTICE_TOP + LATTICE_BOTTOM + 3 * 190, minDx: 390, minDy: 190, lattice: true });
  assert.deepEqual(bodies.map((body) => body.x), [195, 195, 195, 195]);
  const ys = bodies.map((body) => body.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.deepEqual(ys.slice(1).map((y, index) => y - ys[index]!), [190, 190, 190]);
});

test("a sparse sky keeps its bodies clear of the label reserve, and long labels break without a widow", () => {
  for (const body of placeBodies(ids.slice(0, 4), desktop)) assert.ok(body.x <= desktop.width - desktop.labelReserve, `${body.id} leaves room for its label`);
  assert.deepEqual(wrapLine("Ingen signal: finn-listings mangler", 28), ["Ingen signal: ", "finn-listings mangler"]);
  assert.deepEqual(wrapLine("Ingen signal: lesing av synthetic-source:7 feilet", 28), ["Ingen signal: lesing av ", "synthetic-source:7 feilet"]);
  assert.deepEqual(wrapLine("lest for 4 min siden", 28), ["lest for 4 min siden"]);
  assert.equal(wrapLine("Ingen signal: finn-listings mangler", 28).join(""), "Ingen signal: finn-listings mangler");
});

test("a sparse sky stays sparse up to its capacity, then the field is dense", () => {
  assert.equal(isDense(5, desktop), false);
  assert.equal(isDense(6, desktop), true);
  const five = placeBodies(ids.slice(0, 5), desktop);
  for (const [index, a] of five.entries()) for (const b of five.slice(index + 1)) {
    assert.ok(Math.abs(a.x - b.x) >= desktop.minDx || Math.abs(a.y - b.y) >= desktop.minDy, `${a.id} and ${b.id} stay apart at capacity`);
  }
  assert.deepEqual(placeBodies(ids.slice(0, 6), dense).slice(0, 5).length, 5);
});

test("angular order walks the field around its centre and ticks spread from the top", () => {
  const order = angularOrder([{ id: "e", x: 100, y: 50 }, { id: "n", x: 50, y: 0 }, { id: "w", x: 0, y: 50 }, { id: "s", x: 50, y: 100 }], { width: 100, height: 100 });
  assert.deepEqual(order.map((body) => body.id), ["n", "e", "s", "w"]);
  const first = tickArc(0, 3, "changed");
  assert.ok(first.from < -Math.PI / 2 && first.to > -Math.PI / 2, "the first tick straddles the top");
  assert.ok(tickArc(0, 3, "quiet").to - tickArc(0, 3, "quiet").from < first.to - first.from, "a quiet tick is shorter than a changed one");
});
