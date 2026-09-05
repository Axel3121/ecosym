import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  createPetitionEnvelope,
  createPetitionWithdrawal,
  generatePetitionId,
  generateWithdrawalId,
  isEnvelopeWithinInterval,
  parsePetitionEnvelopeBytes,
  PetitionEnvelopeRefusal,
  type PetitionEnvelopeRefusalRule,
  validateEnvelopeProofRecord,
  validatePetitionId,
  validateWithdrawalId,
  validateWithdrawalProofRecord,
} from "../src/petition-envelope.ts";
import { canonicalJson, type JsonValue } from "../src/json.ts";
import {
  DELETE_GIT_BRANCH_REQUEST_DEFINITION,
  DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
} from "../src/petition-request.ts";
import type { ResolvedAuthorityContext } from "../src/store.ts";

const PETITION_ID = `petition:${Buffer.alloc(32, 1).toString("base64url")}`;
const WITHDRAWAL_ID = `withdrawal:${Buffer.alloc(32, 2).toString("base64url")}`;
const OTHER_PETITION_ID = `petition:${Buffer.alloc(32, 3).toString("base64url")}`;
const PROFILE_DIGEST = `sha256:${"a".repeat(64)}`;

const institutionResolution = {
  authorityContext: {
    civilizationId: "civilization:synthetic",
    authorityContext: {
      mandateId: "mandate:synthetic",
      mandateRevision: "revision:1",
      mandateDigest: `sha256:${"b".repeat(64)}`,
    },
  },
  mandate: {
    schemaVersion: 1,
    domain: "synthetic.example",
    sources: ["synthetic-source"],
    mayActAlone: [],
    mustEscalate: ["delete-branch"],
  },
} satisfies ResolvedAuthorityContext;

function validRequest(): unknown {
  const request = structuredClone(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.conformanceVectors.validRequest,
  ) as Record<string, unknown>;
  (request.type as Record<string, unknown>).definitionDigest =
    DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST;
  return request;
}

function validEnvelope(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    petitionId: PETITION_ID,
    principal: { issuer: "synthetic-runtime.example", subject: "user+synthetic@example.test" },
    credentialId: `synthetic-credential-${"x".repeat(200)}`,
    proofProfile: {
      id: "synthetic.transaction-proof",
      revision: "revision:1",
      definitionDigest: PROFILE_DIGEST,
    },
    audience: {
      runtimeId: "runtime://synthetic/alpha",
      controlPlaneId: "control-plane://synthetic/alpha",
    },
    ...structuredClone(institutionResolution.authorityContext),
    authorityBasis: { type: "direct-user-petition" },
    request: validRequest(),
    notBefore: "2026-09-05T12:00:00.000Z",
    expiresAt: "2026-09-05T13:00:00.000Z",
    predecessorPetitionId: null,
  };
}

function validWithdrawal(envelopeInput: unknown = validEnvelope()): Record<string, unknown> {
  const envelope = createPetitionEnvelope(envelopeInput);
  return {
    schemaVersion: 1,
    withdrawalId: WITHDRAWAL_ID,
    petitionId: envelope.envelope.petitionId,
    envelopeDigest: envelope.envelopeDigest,
    principal: structuredClone(envelope.envelope.principal),
    credentialId: "synthetic-rotated-credential",
    proofProfile: {
      id: "synthetic.rotated-transaction-proof",
      revision: "revision:2",
      definitionDigest: `sha256:${"c".repeat(64)}`,
    },
    audience: structuredClone(envelope.envelope.audience),
    action: "withdraw",
  };
}

function validProof(subject: { proofProfile: unknown; credentialId: unknown }, digest: string) {
  return {
    schemaVersion: 1,
    proofProfile: structuredClone(subject.proofProfile),
    credentialId: subject.credentialId,
    subjectDigest: digest,
    proofBytes: Buffer.from("synthetic public proof bytes").toString("base64url"),
  };
}

function recordAt(value: unknown, path = "value"): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), path);
  return value as Record<string, unknown>;
}

function setAt(root: unknown, path: string[], value: unknown): void {
  let parent = root;
  for (const segment of path.slice(0, -1)) parent = recordAt(parent)[segment];
  const key = path.at(-1);
  assert.ok(key !== undefined);
  recordAt(parent)[key] = value;
}

function removeAt(root: unknown, path: string[]): void {
  let parent = root;
  for (const segment of path.slice(0, -1)) parent = recordAt(parent)[segment];
  const key = path.at(-1);
  assert.ok(key !== undefined);
  assert.equal(delete recordAt(parent)[key], true);
}

function expectRefusal(
  rule: PetitionEnvelopeRefusalRule,
  action: () => unknown,
  path?: string,
): PetitionEnvelopeRefusal {
  let refusal: PetitionEnvelopeRefusal | undefined;
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PetitionEnvelopeRefusal);
    assert.equal(error.code, "petition_envelope_refused");
    assert.equal(error.rule, rule);
    if (path !== undefined) assert.equal(error.fieldPath, path);
    refusal = error;
    return true;
  });
  assert.ok(refusal !== undefined);
  return refusal;
}

test("constructs, canonicalizes, digests, and reparses a version-one envelope", () => {
  const first = createPetitionEnvelope(validEnvelope());
  const reparsed = parsePetitionEnvelopeBytes(first.canonicalBytes);

  assert.deepEqual(reparsed.envelope, first.envelope);
  assert.deepEqual(reparsed.canonicalBytes, first.canonicalBytes);
  assert.equal(reparsed.envelopeDigest, first.envelopeDigest);
  assert.deepEqual(first.envelope.authorityContext, institutionResolution.authorityContext.authorityContext);
});

test("canonical bytes and digest ignore input key insertion order", () => {
  const input = validEnvelope();
  const reordered = Object.fromEntries(Object.entries(input).reverse());
  const first = createPetitionEnvelope(input);
  const second = createPetitionEnvelope(reordered);
  assert.deepEqual(second.canonicalBytes, first.canonicalBytes);
  assert.equal(second.envelopeDigest, first.envelopeDigest);
});

function leafPaths(value: unknown, prefix: string[] = []): string[][] {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      leafPaths(child, [...prefix, key]),
    );
  }
  return [prefix];
}

test("every signed leaf participates in the envelope digest", () => {
  const representation = createPetitionEnvelope(validEnvelope());
  const original = representation.envelope as unknown as JsonValue;
  for (const path of leafPaths(original)) {
    const changed = structuredClone(original);
    const current = path.reduce<unknown>((value, key) => recordAt(value)[key], changed);
    const replacement =
      typeof current === "string" ? `${current}!` : typeof current === "number" ? current + 1 : false;
    setAt(changed, path, replacement);
    const bytes = Buffer.from(canonicalJson(changed), "utf8");
    const digest = createHash("sha256")
      .update(Buffer.concat([Buffer.from("ecosym.petition-envelope.v1"), Buffer.from([0])]))
      .update(bytes)
      .digest("hex");
    assert.notEqual(`sha256:${digest}`, representation.envelopeDigest, path.join("."));
  }
});

test("refuses unknown envelope and nested fields and delegated authority", () => {
  for (const path of [
    ["unexpected"],
    ["principal", "unexpected"],
    ["proofProfile", "unexpected"],
    ["audience", "unexpected"],
    ["authorityContext", "unexpected"],
  ]) {
    const envelope = validEnvelope();
    setAt(envelope, path, true);
    expectRefusal("closed_schema", () => createPetitionEnvelope(envelope));
  }
  const delegated = validEnvelope();
  setAt(delegated, ["authorityBasis", "type"], "delegated-petition");
  expectRefusal("authority_basis", () => createPetitionEnvelope(delegated));
});

test("proof profiles are checked structurally without selecting a profile", () => {
  const structurallyDifferent = validEnvelope();
  structurallyDifferent.proofProfile = {
    id: "another.synthetic.profile",
    revision: "unselected-revision",
    definitionDigest: `sha256:${"e".repeat(64)}`,
  };
  assert.doesNotThrow(() => createPetitionEnvelope(structurallyDifferent));

  const malformedDigest = validEnvelope();
  setAt(malformedDigest, ["proofProfile", "definitionDigest"], "sha256:NOT-LOWERCASE-HEX");
  expectRefusal("digest_format", () => createPetitionEnvelope(malformedDigest));
});

test("preserves request refusal rules, including unknown type distinctly", () => {
  const unknown = validEnvelope();
  setAt(unknown, ["request", "type", "id"], "synthetic.unknown");
  expectRefusal("unknown_request_type", () => createPetitionEnvelope(unknown), "request");

  const malformed = validEnvelope();
  setAt(malformed, ["request", "operation"], "git.delete-repository");
  expectRefusal("schema_value", () => createPetitionEnvelope(malformed), "request");
});

test("generates and validates canonical petition and withdrawal identifiers", () => {
  assert.match(validatePetitionId(generatePetitionId()), /^petition:[A-Za-z0-9_-]{43}$/);
  assert.match(validateWithdrawalId(generateWithdrawalId()), /^withdrawal:[A-Za-z0-9_-]{43}$/);
});

test("refuses every non-canonical identifier class", () => {
  expectRefusal("identifier_padding", () => validatePetitionId(`${PETITION_ID}=`));
  expectRefusal("identifier_length", () => validatePetitionId(PETITION_ID.slice(0, -1)));
  expectRefusal("identifier_alphabet", () => validatePetitionId(`${PETITION_ID.slice(0, -1)}+`));
  expectRefusal("identifier_prefix", () => validatePetitionId(PETITION_ID.slice("petition:".length)));
  expectRefusal("identifier_prefix", () => validatePetitionId(PETITION_ID.replace("petition:", "other:")));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const final = PETITION_ID.at(-1);
  assert.ok(final !== undefined);
  const alternate = alphabet[(alphabet.indexOf(final) + 1) % alphabet.length];
  assert.ok(alternate !== undefined);
  expectRefusal("identifier_noncanonical", () =>
    validatePetitionId(`${PETITION_ID.slice(0, -1)}${alternate}`),
  );
});

test("uses real NUL domain separators and distinct domains", () => {
  const envelope = createPetitionEnvelope(validEnvelope());
  const withdrawal = createPetitionWithdrawal(validWithdrawal(), validEnvelope());
  const proof = validateEnvelopeProofRecord(
    validProof(envelope.envelope, envelope.envelopeDigest),
    validEnvelope(),
  );
  function independent(prefix: string, bytes: Buffer): string {
    return `sha256:${createHash("sha256")
      .update(Buffer.concat([Buffer.from(prefix), Buffer.from([0])]))
      .update(bytes)
      .digest("hex")}`;
  }
  assert.equal(envelope.envelopeDigest, independent("ecosym.petition-envelope.v1", envelope.canonicalBytes));
  assert.equal(withdrawal.withdrawalDigest, independent("ecosym.petition-withdrawal.v1", withdrawal.canonicalBytes));
  assert.equal(proof.userProofDigest, independent("ecosym.user-proof-record.v1", proof.canonicalBytes));
  assert.notEqual(
    envelope.envelopeDigest,
    `sha256:${createHash("sha256").update("ecosym.petition-envelope.v1\\0").update(envelope.canonicalBytes).digest("hex")}`,
  );

  const identical = Buffer.from("{}", "utf8");
  const digests = [
    independent("ecosym.petition-envelope.v1", identical),
    independent("ecosym.user-proof-record.v1", identical),
    independent("ecosym.petition-withdrawal.v1", identical),
  ];
  assert.equal(new Set(digests).size, 3);
  expectRefusal("closed_schema", () => createPetitionEnvelope(proof.proofRecord));
});

test("validates an envelope proof only against its exact subject bindings", () => {
  const envelope = createPetitionEnvelope(validEnvelope());
  const proof = validProof(envelope.envelope, envelope.envelopeDigest);
  assert.equal(validateEnvelopeProofRecord(proof, validEnvelope()).proofRecord.proofBytes, proof.proofBytes);

  const wrongDigest = structuredClone(proof);
  wrongDigest.subjectDigest = `sha256:${"d".repeat(64)}`;
  expectRefusal("subject_digest_mismatch", () => validateEnvelopeProofRecord(wrongDigest, validEnvelope()));
  const wrongProfile = structuredClone(proof);
  setAt(wrongProfile, ["proofProfile", "revision"], "revision:other");
  expectRefusal("proof_profile_mismatch", () => validateEnvelopeProofRecord(wrongProfile, validEnvelope()));
  const wrongCredential = structuredClone(proof);
  wrongCredential.credentialId = "synthetic-other-credential";
  expectRefusal("credential_id_mismatch", () => validateEnvelopeProofRecord(wrongCredential, validEnvelope()));
  const padded = structuredClone(proof);
  padded.proofBytes += "=";
  expectRefusal("proof_bytes", () => validateEnvelopeProofRecord(padded, validEnvelope()));
});

test("accepts a rotated withdrawal credential and validates proof against the withdrawal", () => {
  const envelope = validEnvelope();
  const withdrawal = createPetitionWithdrawal(validWithdrawal(envelope), envelope);
  assert.notEqual(withdrawal.withdrawal.credentialId, createPetitionEnvelope(envelope).envelope.credentialId);
  const proof = validProof(withdrawal.withdrawal, withdrawal.withdrawalDigest);
  const validatedProof = validateWithdrawalProofRecord(proof, withdrawal.withdrawal, envelope);
  assert.equal(
    validatedProof.proofRecord.credentialId,
    withdrawal.withdrawal.credentialId,
  );
  assert.notEqual(
    validatedProof.withdrawalProofDigest,
    validateEnvelopeProofRecord(
      validProof(createPetitionEnvelope(envelope).envelope, createPetitionEnvelope(envelope).envelopeDigest),
      envelope,
    ).userProofDigest,
  );
  proof.subjectDigest = createPetitionEnvelope(envelope).envelopeDigest;
  expectRefusal("subject_digest_mismatch", () =>
    validateWithdrawalProofRecord(proof, withdrawal.withdrawal, envelope),
  );
});

test("distinguishes withdrawal petition and envelope digest mismatches", () => {
  const envelope = validEnvelope();
  const wrongPetition = validWithdrawal(envelope);
  wrongPetition.petitionId = OTHER_PETITION_ID;
  expectRefusal("petition_id_mismatch", () => createPetitionWithdrawal(wrongPetition, envelope));
  const wrongDigest = validWithdrawal(envelope);
  wrongDigest.envelopeDigest = `sha256:${"d".repeat(64)}`;
  expectRefusal("envelope_digest_mismatch", () => createPetitionWithdrawal(wrongDigest, envelope));
});

test("withdrawal binds original principal and audience but not credential", () => {
  const envelope = validEnvelope();
  assert.doesNotThrow(() => createPetitionWithdrawal(validWithdrawal(envelope), envelope));
  const principal = validWithdrawal(envelope);
  setAt(principal, ["principal", "subject"], "other-user@example.test");
  expectRefusal("principal_mismatch", () => createPetitionWithdrawal(principal, envelope));
  const audience = validWithdrawal(envelope);
  setAt(audience, ["audience", "runtimeId"], "runtime://synthetic/other");
  expectRefusal("audience_mismatch", () => createPetitionWithdrawal(audience, envelope));
  for (const field of ["expiresAt", "effectiveAt"]) {
    const timed = validWithdrawal(envelope);
    timed[field] = "2026-09-05T12:30:00.000Z";
    expectRefusal("closed_schema", () => createPetitionWithdrawal(timed, envelope));
  }
});

test("checks inclusive start, exclusive expiry, and strict canonical instants without a clock", () => {
  const envelope = validEnvelope();
  assert.equal(isEnvelopeWithinInterval(envelope, "2026-09-05T12:00:00.000Z"), true);
  assert.equal(isEnvelopeWithinInterval(envelope, "2026-09-05T13:00:00.000Z"), false);
  const empty = validEnvelope();
  empty.expiresAt = empty.notBefore;
  expectRefusal("interval_empty", () => createPetitionEnvelope(empty));
  const reversed = validEnvelope();
  reversed.expiresAt = "2026-09-05T11:00:00.000Z";
  expectRefusal("interval_order", () => createPetitionEnvelope(reversed));
  for (const instant of [
    "2026-09-05T12:00:00Z",
    "2026-09-05T12:00:00+00:00",
    "2026-09-05T12:00:00.5Z",
  ]) {
    const nonCanonical = validEnvelope();
    nonCanonical.notBefore = instant;
    expectRefusal("utc_instant", () => createPetitionEnvelope(nonCanonical));
  }
});

test("refuses a self predecessor and never supplies validity bounds", () => {
  const self = validEnvelope();
  self.predecessorPetitionId = PETITION_ID;
  expectRefusal("predecessor_self", () => createPetitionEnvelope(self));
  for (const field of ["notBefore", "expiresAt"]) {
    const missing = validEnvelope();
    removeAt(missing, [field]);
    expectRefusal("schema_value", () => createPetitionEnvelope(missing));
    assert.equal(Object.hasOwn(missing, field), false);
  }
  const linked = validEnvelope();
  linked.predecessorPetitionId = OTHER_PETITION_ID;
  assert.equal(createPetitionEnvelope(linked).envelope.predecessorPetitionId, OTHER_PETITION_ID);
});

test("refuses sensitive content without reproducing it in errors", () => {
  const sentinel = "UNIQUE_SECRET_SENTINEL_024";
  const cases: Array<() => unknown> = [];
  const envelope = validEnvelope();
  envelope.credentialId = `${sentinel}\u0000`;
  cases.push(() => createPetitionEnvelope(envelope));
  const unknownField = validEnvelope();
  unknownField[sentinel] = undefined;
  cases.push(() => createPetitionEnvelope(unknownField));
  const withdrawal = validWithdrawal();
  withdrawal.credentialId = `${sentinel}\u0000`;
  cases.push(() => createPetitionWithdrawal(withdrawal, validEnvelope()));
  const valid = createPetitionEnvelope(validEnvelope());
  const proof = validProof(valid.envelope, valid.envelopeDigest);
  proof.proofBytes = `${sentinel}=`;
  proof.credentialId = `${sentinel}-credential`;
  cases.push(() => validateEnvelopeProofRecord(proof, validEnvelope()));
  for (const action of cases) {
    assert.throws(action, (error: unknown) => {
      assert.ok(error instanceof PetitionEnvelopeRefusal);
      for (const rendered of [error.message, String(error), JSON.stringify(error)]) {
        assert.ok(!rendered.includes(sentinel));
      }
      return true;
    });
  }
});

test("refuses canonicalizer divergences before canonicalization", () => {
  for (const [value, rule] of [
    [-0, "negative_zero"],
    [Number.NaN, "non_finite_number"],
    [Number.POSITIVE_INFINITY, "non_finite_number"],
    [undefined, "undefined_value"],
  ] as const) {
    const envelope = validEnvelope();
    envelope.unexpected = value;
    expectRefusal(rule, () => createPetitionEnvelope(envelope));
  }
});

test("canonicalJson is RFC 8785-equivalent for admitted value kinds", () => {
  const vector = {
    string: "€$\u000f\nA'B\"\\\\\"/𝄞",
    literals: [null, true, false],
  };
  assert.equal(
    canonicalJson(vector),
    "{\"literals\":[null,true,false],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/𝄞\"}",
  );
  const utf16Order = { "\r": "CR", "1": "one", "€": "euro", "😀": "grin", "ö": "o" };
  assert.equal(canonicalJson(utf16Order), "{\"1\":\"one\",\"\\r\":\"CR\",\"ö\":\"o\",\"€\":\"euro\",\"😀\":\"grin\"}");
});

test("admits non-BMP owner identifiers but refuses controls and lone surrogates", () => {
  const envelope = validEnvelope();
  setAt(envelope, ["principal", "issuer"], "synthetic-runtime-😀");
  setAt(envelope, ["principal", "subject"], "synthetic-user-𝄞");
  envelope.credentialId = "synthetic-credential-😀";
  setAt(envelope, ["audience", "runtimeId"], "synthetic-runtime-𝄞");
  setAt(envelope, ["audience", "controlPlaneId"], "synthetic-control-😀");
  assert.doesNotThrow(() => createPetitionEnvelope(envelope));
  for (const bad of ["bad\u0000identifier", "bad\ud800identifier", "x".repeat(2049)]) {
    const rejected = validEnvelope();
    rejected.credentialId = bad;
    expectRefusal(bad.includes("\ud800") ? "schema_value" : "owner_identifier", () =>
      createPetitionEnvelope(rejected),
    );
  }
});

test("rejects a value nested too deeply to canonicalize", () => {
  const deep: unknown = buildDeepValue(260);
  assert.throws(
    () => createPetitionEnvelope({ schemaVersion: 1, nested: deep }),
    (error: unknown) => {
      assert.ok(error instanceof PetitionEnvelopeRefusal);
      assert.equal((error as PetitionEnvelopeRefusal).rule, "schema_value");
      return true;
    },
  );
  assert.throws(
    () =>
      createPetitionWithdrawal(
        { schemaVersion: 1, withdrawalId: WITHDRAWAL_ID, nested: deep, action: "withdraw" },
        validEnvelope(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof PetitionEnvelopeRefusal);
      assert.equal((error as PetitionEnvelopeRefusal).rule, "schema_value");
      return true;
    },
  );
  assert.throws(
    () =>
      validateEnvelopeProofRecord(
        {
          schemaVersion: 1,
          proofProfile: { id: "x", revision: "1", definitionDigest: PROFILE_DIGEST },
          credentialId: "x",
          subjectDigest: `sha256:${"a".repeat(64)}`,
          proofBytes: "x",
          nested: deep,
        },
        validEnvelope(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof PetitionEnvelopeRefusal);
      assert.equal((error as PetitionEnvelopeRefusal).rule, "schema_value");
      return true;
    },
  );
});

function buildDeepValue(depth: number): unknown {
  let value: unknown = "leaf";
  for (let i = 0; i < depth; i++) {
    value = { child: value };
  }
  return value;
}

