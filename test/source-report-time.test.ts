import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceReportFactTimeKey, sourceReportInstantOrderingKey } from "../src/source-report-time.ts";
import { utcInstantOrderingKey } from "../src/time.ts";
import { sameVerificationFactSet, verificationFactKey } from "../src/verification-facts.ts";
import type { VerificationFact } from "../src/store.ts";

const fact: VerificationFact = {
  epistemicStatus: "claim", factOwner: "owner", kind: "alert",
  subject: "subject", sourceRecordId: "fact", sourceRecordedAt: null, payloadHash: "hash",
};

test("verification identities equate millisecond spellings and preserve legacy UTC offsets", () => {
  const canonical = "2026-09-01T11:59:59.123Z";
  for (const time of [canonical, "2026-09-01T11:59:59.123000Z", "2026-09-01T11:59:59.123+00:00"]) {
    assert.equal(verificationFactKey({ ...fact, sourceRecordedAt: time }), verificationFactKey({ ...fact, sourceRecordedAt: canonical }));
    assert.equal(sameVerificationFactSet([{ ...fact, sourceRecordedAt: time }], [{ ...fact, sourceRecordedAt: canonical }]), true);
  }
  assert.equal(sourceReportFactTimeKey("2026-09-01T11:59:59.123000Z"), sourceReportFactTimeKey(canonical));
  assert.equal(sourceReportInstantOrderingKey("2026-09-01T11:59:59.123+00:00"), null);
});

test("malformed verification timestamps cannot share null or valid exact-time identities", () => {
  const valid = { ...fact, sourceRecordedAt: "2026-09-01T11:59:59.123456Z" };
  for (const time of ["", "invalid", "2026-02-30T11:59:59Z", "2026-09-01T11:59:59.123Z456"]) {
    const malformed = { ...fact, sourceRecordedAt: time };
    assert.equal(sourceReportFactTimeKey(time), null);
    assert.notEqual(verificationFactKey(malformed), verificationFactKey(fact));
    assert.notEqual(verificationFactKey(malformed), verificationFactKey(valid));
    assert.equal(sameVerificationFactSet([malformed], [fact]), false);
  }
});

test("source report chronology preserves arbitrary schema-bounded precision without permissive calendar parsing", () => {
  const before = sourceReportInstantOrderingKey("2026-09-08T03:45:23.913979Z");
  const after = sourceReportInstantOrderingKey("2026-09-08T03:45:23.913980Z");
  assert.ok(before !== null && after !== null && before < after);
  assert.equal(sourceReportInstantOrderingKey("2026-09-08T03:45:23.1Z"), sourceReportInstantOrderingKey("2026-09-08T03:45:23.100000Z"));
  for (const invalid of ["2026-02-30T00:00:00.000001Z", "2016-12-31T23:59:60.1Z", "2026-09-08T24:00:00Z", "2026-09-08T03:45:23+02:00", "2026-09-08T03:45:23." + "1".repeat(44) + "Z"]) {
    assert.equal(sourceReportInstantOrderingKey(invalid), null);
  }
});

test("source report fact keys preserve legacy keys and exact ordering through the schema precision limit", () => {
  const times = [
    "0000-01-01T00:00:00Z", "1969-12-31T23:59:59.999999999Z",
    "1970-01-01T00:00:00Z",
    ...["000", "0".repeat(42) + "1", "0".repeat(41) + "1", "001", "099999999",
      "1", "100000001", "123", "123000001", "123456788", "123456789",
      "12345678901", "123999999", "124", "9".repeat(43)]
      .map((fraction) => `2026-09-01T11:59:59.${fraction}Z`),
    "2026-09-01T12:00:00Z", "9999-12-31T23:59:59.999Z",
  ];
  const keys = times.map(sourceReportFactTimeKey);
  assert.ok(keys.every((key) => key !== null));
  assert.deepEqual([...keys].reverse().sort(), keys);
  for (let index = 0; index < times.length; index += 1) {
    const legacy = utcInstantOrderingKey(times[index]);
    if (legacy !== null) assert.equal(keys[index], legacy);
    if (index > 0) assert.ok(sourceReportInstantOrderingKey(times[index - 1])! < sourceReportInstantOrderingKey(times[index])!);
  }
  assert.equal(sourceReportFactTimeKey("2026-09-01T11:59:59.123000000000Z"), sourceReportFactTimeKey("2026-09-01T11:59:59.123Z"));
  assert.equal(sourceReportFactTimeKey("2026-02-30T11:59:59.123456789Z"), null);
});
