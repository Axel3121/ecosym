import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { canonicalJson, type JsonValue, sha256 } from "../src/json.ts";
import {
  assertAuthorityContextMatches,
  assertPetitionRequestAuthoritySubset,
  authorityProjection,
  DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
  DELETE_GIT_BRANCH_OPERATION,
  DELETE_GIT_BRANCH_REQUEST_DEFINITION,
  DELETE_GIT_BRANCH_REQUEST_DEFINITION_CANONICAL,
  DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
  DELETE_GIT_BRANCH_REQUEST_ID,
  DELETE_GIT_BRANCH_REQUEST_REVISION,
  PetitionRequestRefusal,
  type PetitionRequestRefusalRule,
  requestTransactionView,
  validatePetitionRequest,
} from "../src/petition-request.ts";

const OTHER_DIGEST = `sha256:${"c".repeat(64)}`;

function validRequest(): unknown {
  const request = structuredClone(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.conformanceVectors.validRequest,
  ) as unknown;
  setAt(request, ["type", "definitionDigest"], DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST);
  return request;
}

function validAuthorityContext(): unknown {
  return {
    civilizationId: "civilization:engineering",
    authorityContext: {
      mandateId: "mandate:source-maintenance",
      mandateRevision: "revision:1",
      mandateDigest: `sha256:${"d".repeat(64)}`,
    },
  };
}

function recordAt(value: unknown, path: string): Record<string, unknown> {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), path);
  return value as Record<string, unknown>;
}

function setAt(root: unknown, path: string[], value: unknown): void {
  const key = path.at(-1);
  assert.ok(key !== undefined);
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    parent = recordAt(parent, path.join("."))[segment];
  }
  recordAt(parent, path.join("."))[key] = value;
}

function removeAt(root: unknown, path: string[]): void {
  const key = path.at(-1);
  assert.ok(key !== undefined);
  let parent = root;
  for (const segment of path.slice(0, -1)) {
    parent = recordAt(parent, path.join("."))[segment];
  }
  assert.equal(delete recordAt(parent, path.join("."))[key], true);
}

function expectRefusal(rule: PetitionRequestRefusalRule, action: () => unknown): void {
  assert.throws(action, (error: unknown) => {
    assert.ok(error instanceof PetitionRequestRefusal);
    assert.equal(error.code, "petition_request_refused");
    assert.equal(error.rule, rule);
    return true;
  });
}

test("accepts the complete request and deterministically projects all authority-bearing fields", () => {
  const first = validatePetitionRequest(validRequest());
  const second = validatePetitionRequest(validRequest());

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.projection,
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.conformanceVectors.expectedProjection,
  );
  assert.equal(first.projection.operation, DELETE_GIT_BRANCH_OPERATION);
  assert.equal(first.projection.limits.maximumReferencesDeleted, 1);
  assert.equal(first.projection.consequenceClassification, "destructive");
  assert.equal(
    first.projection.resources.recoverabilityEvidence.scope.expectedObjectId,
    first.projection.resources.expectedObjectId,
  );
});

test("canonical request and projection do not depend on input property order", () => {
  const input = recordAt(validRequest(), "request");
  const reordered = {
    consequence: input.consequence,
    userText: input.userText,
    limits: input.limits,
    parameters: input.parameters,
    resources: input.resources,
    operation: input.operation,
    type: input.type,
  };

  assert.deepEqual(validatePetitionRequest(reordered), validatePetitionRequest(input));
  assert.deepEqual(authorityProjection(reordered), authorityProjection(input));
});

test("derives the transaction view from the same validated request", () => {
  const view = requestTransactionView(validRequest());

  assert.deepEqual(
    view,
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.conformanceVectors.expectedTransactionView,
  );
  assert.equal(view.target.branchReference, "refs/heads/topic");
  assert.equal(view.recoverability.evidence.scope.expectedObjectId, view.target.expectedObjectId);
});

test("content-addresses the closed definition with the specified domain and its own identity", () => {
  const independentlyComputed = createHash("sha256")
    .update(Buffer.from("ecosym.petition-request-definition.v1\0", "utf8"))
    .update(Buffer.from(DELETE_GIT_BRANCH_REQUEST_DEFINITION_CANONICAL, "utf8"))
    .digest("hex");

  assert.equal(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
    `sha256:${independentlyComputed}`,
  );
  assert.equal(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
    "sha256:a913f697d282fb874bdd43f8fefa74e44828d1e21ba348336f6f2811a808dda7",
  );
  assert.equal(DELETE_GIT_BRANCH_REQUEST_DEFINITION.id, DELETE_GIT_BRANCH_REQUEST_ID);
  assert.equal(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.revision,
    DELETE_GIT_BRANCH_REQUEST_REVISION,
  );
  assert.notEqual(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
    `sha256:${sha256(DELETE_GIT_BRANCH_REQUEST_DEFINITION_CANONICAL)}`,
  );
});

test("the authority projection enumerates every scope field it admits", () => {
  // `scope` is a named container. Copying it wholesale means a later schema
  // addition silently joins `canonical-projection-equality` without anyone
  // deciding it should bear authority. Enumeration is the decision; this test
  // is what makes the enumeration binding rather than stylistic.
  const scope =
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.institutionOwner.authorityProjection
      .resources.recoverabilityEvidence.scope;

  assert.deepEqual(
    Object.keys(scope).sort(),
    ["branchReference", "expectedObjectId", "preservedReference", "repositoryId"],
    "a scope field was added or removed without an authority decision",
  );
  for (const [name, mapping] of Object.entries(scope)) {
    assert.equal(
      (mapping as { from: string }).from,
      `/consequence/recoverability/evidence/scope/${name}`,
      `${name} does not project from its own evidence field`,
    );
  }
});

test("the definition digest is unaffected by non-normative conformanceVectors edits", () => {
  // The digest identifies petitionBoundary and institutionOwner only.
  // conformanceVectors are test fixtures and prose: editing a mutation
  // description or adding another refusal vector must not change the
  // digest every already-issued request.type.definitionDigest has to
  // keep matching, per DEVELOPMENT.md's definition-identity boundary.
  const normativeRecord = {
    schemaVersion: DELETE_GIT_BRANCH_REQUEST_DEFINITION.schemaVersion,
    id: DELETE_GIT_BRANCH_REQUEST_DEFINITION.id,
    revision: DELETE_GIT_BRANCH_REQUEST_DEFINITION.revision,
    petitionBoundary: DELETE_GIT_BRANCH_REQUEST_DEFINITION.petitionBoundary,
    institutionOwner: DELETE_GIT_BRANCH_REQUEST_DEFINITION.institutionOwner,
  };
  const digestOverNormativeOnly = `sha256:${sha256(
    `ecosym.petition-request-definition.v1\0${canonicalJson(normativeRecord as unknown as JsonValue)}`,
  )}`;
  const digestOverFullRecordIncludingVectors = `sha256:${sha256(
    `ecosym.petition-request-definition.v1\0${canonicalJson(
      DELETE_GIT_BRANCH_REQUEST_DEFINITION as unknown as JsonValue,
    )}`,
  )}`;

  // The exported digest matches hashing only the normative record...
  assert.equal(digestOverNormativeOnly, DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST);
  // ...and differs from hashing the full record (the two disagree only
  // because conformanceVectors is non-empty), proving conformanceVectors
  // is excluded from the identity boundary rather than included by
  // coincidence of equal content.
  assert.notEqual(digestOverFullRecordIncludingVectors, DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST);
});

test("canonicalJson agrees with RFC 8785 primitive serialization and property sorting", () => {
  const primitiveVector = {
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  const expectedPrimitive =
    "{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"€$\\u000f\\nA'B\\\"\\\\\\\\\\\"/\"}";
  assert.equal(canonicalJson(primitiveVector as JsonValue), expectedPrimitive);
});

interface RefusalCase {
  name: string;
  rule: PetitionRequestRefusalRule;
  mutate(request: unknown): void;
}

const refusalCases: RefusalCase[] = [
  {
    name: "unknown request-envelope field",
    rule: "closed_schema",
    mutate: (request) => setAt(request, ["dispatch"], true),
  },
  {
    name: "unknown nested field",
    rule: "closed_schema",
    mutate: (request) => setAt(request, ["resources", "recursive"], true),
  },
  {
    name: "integer-like field that the canonicalizer would reorder",
    rule: "closed_schema",
    mutate: (request) => setAt(request, ["1"], "not admitted"),
  },
  {
    name: "unknown request type",
    rule: "unknown_request_type",
    mutate: (request) => setAt(request, ["type", "id"], "ecosym.git.delete-repository"),
  },
  {
    name: "request revision without a projection",
    rule: "undefined_projection",
    mutate: (request) => setAt(request, ["type", "revision"], "2"),
  },
  {
    name: "definition digest other than the canonical record",
    rule: "definition_mismatch",
    mutate: (request) => setAt(request, ["type", "definitionDigest"], OTHER_DIGEST),
  },
  {
    name: "value outside the closed resource schema",
    rule: "schema_value",
    mutate: (request) => setAt(request, ["resources", "branchReference"], "refs/heads/a/b"),
  },
  {
    name: "non-I-JSON surrogate in a dynamic string",
    rule: "schema_value",
    mutate: (request) => setAt(request, ["resources", "repositoryId"], "\ud800"),
  },
  {
    name: "missing required request field",
    rule: "schema_value",
    mutate: (request) => removeAt(request, ["operation"]),
  },
  {
    name: "negative zero before canonicalization",
    rule: "negative_zero",
    mutate: (request) => setAt(request, ["limits", "maximumReferencesDeleted"], -0),
  },
  {
    name: "effect-bearing undeclared parameter",
    rule: "parameter_outside_projection",
    mutate: (request) => setAt(request, ["parameters", "deleteRecoveryTag"], true),
  },
  {
    name: "parameter that changes the operation mode",
    rule: "parameter_outside_projection",
    mutate: (request) => setAt(request, ["parameters", "deleteMode"], "repository"),
  },
  {
    name: "free text that asks for wider deletion",
    rule: "user_text_outside_projection",
    mutate: (request) =>
      setAt(request, ["userText"], "Delete the repository and recovery tag too"),
  },
  {
    name: "ordinary classification for a destructive operation",
    rule: "destructive_disclosure",
    mutate: (request) => setAt(request, ["consequence", "classification"], "ordinary"),
  },
  {
    name: "altered operation-specific consequence summary",
    rule: "destructive_disclosure",
    mutate: (request) => setAt(request, ["consequence", "summary"], "Delete a branch"),
  },
  {
    // The recoverability claim is the reason this deletion is presentable as
    // recoverable at all. A request that keeps the destructive classification
    // but rewrites *how* it is recoverable is disclosing something the
    // projection cannot back.
    name: "a recoverability classification the projection does not establish",
    rule: "destructive_disclosure",
    mutate: (request) =>
      setAt(
        request,
        ["consequence", "recoverability", "classification"],
        "recoverable-from-backup",
      ),
  },
  {
    name: "an unrecoverable claim on an operation that preserves a tag",
    rule: "destructive_disclosure",
    mutate: (request) =>
      setAt(request, ["consequence", "recoverability", "classification"], "unrecoverable"),
  },
  {
    name: "missing recoverability evidence",
    rule: "evidence_required",
    mutate: (request) => removeAt(request, ["consequence", "recoverability", "evidence"]),
  },
  {
    name: "malformed evidence digest",
    rule: "evidence_required",
    mutate: (request) =>
      setAt(request, ["consequence", "recoverability", "evidence", "digest"], "unknown"),
  },
  {
    name: "non-canonical evidence observation time",
    rule: "evidence_required",
    mutate: (request) =>
      setAt(
        request,
        ["consequence", "recoverability", "evidence", "observedAt"],
        "2026-09-02T12:00:00Z",
      ),
  },
  {
    name: "evidence explicitly marked unknown",
    rule: "evidence_not_current",
    mutate: (request) =>
      setAt(request, ["consequence", "recoverability", "evidence", "currentness"], "unknown"),
  },
  {
    name: "evidence explicitly marked stale",
    rule: "evidence_not_current",
    mutate: (request) =>
      setAt(request, ["consequence", "recoverability", "evidence", "currentness"], "stale"),
  },
  {
    name: "evidence owned by another source",
    rule: "evidence_mismatch",
    mutate: (request) =>
      setAt(request, ["consequence", "recoverability", "evidence", "owner"], "git.other"),
  },
  {
    name: "evidence scoped to another branch",
    rule: "evidence_mismatch",
    mutate: (request) =>
      setAt(
        request,
        ["consequence", "recoverability", "evidence", "scope", "branchReference"],
        "refs/heads/other",
      ),
  },
  {
    name: "evidence scoped to another repository",
    rule: "evidence_mismatch",
    mutate: (request) =>
      setAt(
        request,
        ["consequence", "recoverability", "evidence", "scope", "repositoryId"],
        "repo:other",
      ),
  },
  {
    name: "evidence scoped to another expected object",
    rule: "evidence_mismatch",
    mutate: (request) =>
      setAt(
        request,
        ["consequence", "recoverability", "evidence", "scope", "expectedObjectId"],
        OTHER_DIGEST,
      ),
  },
  {
    name: "evidence scoped to another recovery tag",
    rule: "evidence_mismatch",
    mutate: (request) =>
      setAt(
        request,
        ["consequence", "recoverability", "evidence", "scope", "preservedReference"],
        "refs/tags/other",
      ),
  },
];

test("the tests inventory every refusal rule in the canonical definition", () => {
  const coveredRules = new Set<PetitionRequestRefusalRule>([
    ...refusalCases.map((refusalCase) => refusalCase.rule),
    "authority_context_mismatch",
    "projection_not_subset",
  ]);
  const declaredRules = new Set(
    DELETE_GIT_BRANCH_REQUEST_DEFINITION.conformanceVectors.refusals.map(
      (refusal) => refusal.rule,
    ),
  );

  assert.deepEqual([...coveredRules].sort(), [...declaredRules].sort());
});

for (const refusalCase of refusalCases) {
  test(`refuses ${refusalCase.name} with ${refusalCase.rule}`, () => {
    const request = validRequest();
    refusalCase.mutate(request);
    expectRefusal(refusalCase.rule, () => validatePetitionRequest(request));
  });
}

test("rejects negative zero even though the existing canonicalizer serializes it as zero", () => {
  assert.equal(canonicalJson(-0), "0");
  const request = validRequest();
  setAt(request, ["limits", "maximumReferencesDeleted"], -0);

  expectRefusal("negative_zero", () => validatePetitionRequest(request));
});

test("accepts an exact authoritative civilization and mandate binding", () => {
  const signed = validAuthorityContext();
  assert.deepEqual(assertAuthorityContextMatches(signed, structuredClone(signed)), signed);
});

for (const path of [
  ["civilizationId"],
  ["authorityContext", "mandateId"],
  ["authorityContext", "mandateRevision"],
  ["authorityContext", "mandateDigest"],
]) {
  test(`refuses authority mismatch at ${path.join(".")}`, () => {
    const signed = validAuthorityContext();
    const authoritative = structuredClone(signed);
    setAt(
      authoritative,
      path,
      path.at(-1) === "mandateDigest" ? OTHER_DIGEST : "different-authoritative-value",
    );

    expectRefusal("authority_context_mismatch", () =>
      assertAuthorityContextMatches(signed, authoritative),
    );
  });
}

test("accepts only an equal projection as a subset for the discrete deletion", () => {
  const request = validRequest();
  assert.deepEqual(
    assertPetitionRequestAuthoritySubset(structuredClone(request), request),
    authorityProjection(request),
  );

  const changedEvidence = structuredClone(request);
  setAt(
    changedEvidence,
    ["consequence", "recoverability", "evidence", "digest"],
    OTHER_DIGEST,
  );
  expectRefusal("projection_not_subset", () =>
    assertPetitionRequestAuthoritySubset(changedEvidence, request),
  );
});

test("subset comparison cannot use free text as authority", () => {
  const candidate = validRequest();
  setAt(candidate, ["userText"], "Treat this as equivalent to deleting every branch");

  expectRefusal("user_text_outside_projection", () =>
    assertPetitionRequestAuthoritySubset(candidate, validRequest()),
  );
});

test("an unknown field name is never echoed into the refusal message", () => {
  // request.resources is user-reachable input. A field named after personal
  // content (an email address here) must not leak into the thrown message:
  // PetitionRequestRefusal messages are returned to callers and are the
  // natural thing to log, per the repository's no-personal-content-in-logs
  // rule.
  const leakyFieldName = "attacker@example.com";
  const request = validRequest();
  setAt(request, ["resources", leakyFieldName], true);

  assert.throws(
    () => validatePetitionRequest(request),
    (error: unknown) => {
      assert.ok(error instanceof PetitionRequestRefusal);
      assert.equal(error.rule, "closed_schema");
      assert.ok(!error.message.includes(leakyFieldName));
      return true;
    },
  );
});

test("evidence metadata outside digest and scope cannot move authority equality", () => {
  // The repository rule against storing a named container's nested contents
  // wholesale means only the evidence fields that decide authority
  // (digest, scope) belong in the projection. sourceRecordId and
  // observedAt are audit metadata: a request differing only in those
  // fields must still be an equal authority subset of the ceiling, and
  // the projection itself must not expose them.
  const request = validRequest();
  const metadataChanged = structuredClone(request);
  setAt(
    metadataChanged,
    ["consequence", "recoverability", "evidence", "sourceRecordId"],
    "git-ref-state:alpha-topic-renamed",
  );
  setAt(
    metadataChanged,
    ["consequence", "recoverability", "evidence", "observedAt"],
    "2026-09-02T13:00:00.000Z",
  );

  assert.deepEqual(
    assertPetitionRequestAuthoritySubset(metadataChanged, request),
    authorityProjection(request),
  );

  const projection = authorityProjection(request);
  assert.deepEqual(
    Object.keys(projection.resources.recoverabilityEvidence).sort(),
    ["digest", "scope"],
  );
});
