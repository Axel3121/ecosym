import { canonicalJson, type JsonValue, sha256 } from "./json.ts";

const REQUEST_DEFINITION_DOMAIN = "ecosym.petition-request-definition.v1\0";
const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const BRANCH_REFERENCE_PATTERN = /^refs\/heads\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const TAG_REFERENCE_PATTERN = /^refs\/tags\/[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const UTC_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const DELETE_GIT_BRANCH_REQUEST_ID = "ecosym.git.delete-branch";
export const DELETE_GIT_BRANCH_REQUEST_REVISION = "1";
export const DELETE_GIT_BRANCH_OPERATION = "git.delete-branch-reference";
export const DELETE_GIT_BRANCH_MODE = "branch-reference-only";
export const DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY =
  "Deletes exactly one Git branch reference. The preserved recovery tag is not deleted and can recreate the branch while its Git object remains available.";

const VECTOR_OBJECT_ID = `sha256:${"a".repeat(64)}`;
const VECTOR_EVIDENCE_DIGEST = `sha256:${"b".repeat(64)}`;

export const DELETE_GIT_BRANCH_REQUEST_DEFINITION = deepFreeze({
  schemaVersion: 1,
  id: DELETE_GIT_BRANCH_REQUEST_ID,
  revision: DELETE_GIT_BRANCH_REQUEST_REVISION,
  petitionBoundary: {
    serialization: {
      algorithm: "RFC8785-JCS",
      admittedNumbers: [1],
      negativeZero: "refused-before-canonicalization",
      admittedStrings: "ASCII patterns or exact YYYY-MM-DDTHH:mm:ss.sssZ instants",
    },
    requestSchema: {
      closedObjectFields: {
        "/": [
          "type",
          "operation",
          "resources",
          "parameters",
          "limits",
          "userText",
          "consequence",
        ],
        "/type": ["id", "revision", "definitionDigest"],
        "/resources": ["sourceOwner", "repositoryId", "branchReference"],
        "/parameters": ["deleteMode", "expectedObjectId", "preservedReference"],
        "/limits": ["maximumReferencesDeleted"],
        "/consequence": ["classification", "summary", "recoverability"],
        "/consequence/recoverability": ["classification", "evidence"],
        "/consequence/recoverability/evidence": [
          "owner",
          "sourceRecordId",
          "digest",
          "observedAt",
          "currentness",
          "scope",
        ],
        "/consequence/recoverability/evidence/scope": [
          "repositoryId",
          "branchReference",
          "expectedObjectId",
          "preservedReference",
        ],
      },
      constants: {
        "/type/id": DELETE_GIT_BRANCH_REQUEST_ID,
        "/type/revision": DELETE_GIT_BRANCH_REQUEST_REVISION,
        "/type/definitionDigest": "$requestDefinitionDigest",
        "/operation": DELETE_GIT_BRANCH_OPERATION,
        "/parameters/deleteMode": DELETE_GIT_BRANCH_MODE,
        "/limits/maximumReferencesDeleted": 1,
        "/userText": null,
        "/consequence/classification": "destructive",
        "/consequence/summary": DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
        "/consequence/recoverability/classification": "recoverable-from-preserved-tag",
        "/consequence/recoverability/evidence/currentness": "current",
      },
      stringPatterns: {
        name: NAME_PATTERN.source,
        branchReference: BRANCH_REFERENCE_PATTERN.source,
        tagReference: TAG_REFERENCE_PATTERN.source,
        sha256: SHA256_PATTERN.source,
        utcInstant: UTC_INSTANT_PATTERN.source,
      },
      fieldFormats: {
        "/resources/sourceOwner": "name",
        "/resources/repositoryId": "name",
        "/resources/branchReference": "branchReference",
        "/parameters/expectedObjectId": "sha256",
        "/parameters/preservedReference": "tagReference",
        "/consequence/recoverability/evidence/owner": "name",
        "/consequence/recoverability/evidence/sourceRecordId": "name",
        "/consequence/recoverability/evidence/digest": "sha256",
        "/consequence/recoverability/evidence/observedAt": "utcInstant",
        "/consequence/recoverability/evidence/scope/repositoryId": "name",
        "/consequence/recoverability/evidence/scope/branchReference": "branchReference",
        "/consequence/recoverability/evidence/scope/expectedObjectId": "sha256",
        "/consequence/recoverability/evidence/scope/preservedReference": "tagReference",
      },
      requiredEqualities: [
        ["/resources/sourceOwner", "/consequence/recoverability/evidence/owner"],
        [
          "/resources/repositoryId",
          "/consequence/recoverability/evidence/scope/repositoryId",
        ],
        [
          "/resources/branchReference",
          "/consequence/recoverability/evidence/scope/branchReference",
        ],
        [
          "/parameters/expectedObjectId",
          "/consequence/recoverability/evidence/scope/expectedObjectId",
        ],
        [
          "/parameters/preservedReference",
          "/consequence/recoverability/evidence/scope/preservedReference",
        ],
      ],
      unknownFields: "refused",
      missingFields: "refused",
    },
  },
  institutionOwner: {
    operation: {
      id: DELETE_GIT_BRANCH_OPERATION,
      effect: "delete only the named branch reference",
      excludedEffects: [
        "delete repository",
        "delete Git objects",
        "delete or move the preserved recovery tag",
        "delete another reference",
      ],
    },
    resourceSemantics: {
      sourceOwner: "owner namespace of the repository and evidence record",
      repositoryId: "one repository in the source owner's namespace",
      branchReference: "one complete refs/heads reference",
      expectedObjectId: "required current branch object and effect precondition",
      preservedReference: "distinct refs/tags reference that must remain at expectedObjectId",
      recoverabilityEvidence:
        "source-owned record whose digest and scope must be rechecked before the effect",
    },
    units: {
      maximumReferencesDeleted: "Git reference count",
    },
    authorityProjection: {
      operation: { constant: DELETE_GIT_BRANCH_OPERATION },
      resources: {
        sourceOwner: { from: "/resources/sourceOwner" },
        repositoryId: { from: "/resources/repositoryId" },
        branchReference: { from: "/resources/branchReference" },
        expectedObjectId: { from: "/parameters/expectedObjectId" },
        preservedReference: { from: "/parameters/preservedReference" },
        recoverabilityEvidence: {
          digest: { from: "/consequence/recoverability/evidence/digest" },
          // `scope` is a named container. Copying it wholesale means a later
          // schema addition silently joins the authority projection without a
          // decision. Enumerate the four fields that actually bear authority.
          scope: {
            repositoryId: { from: "/consequence/recoverability/evidence/scope/repositoryId" },
            branchReference: { from: "/consequence/recoverability/evidence/scope/branchReference" },
            expectedObjectId: { from: "/consequence/recoverability/evidence/scope/expectedObjectId" },
            preservedReference: { from: "/consequence/recoverability/evidence/scope/preservedReference" },
          },
        },
      },
      limits: {
        maximumReferencesDeleted: { from: "/limits/maximumReferencesDeleted" },
      },
      consequenceClassification: { from: "/consequence/classification" },
    },
    subsetComparison: {
      algorithm: "canonical-projection-equality",
      rationale:
        "One discrete reference deletion has no non-empty narrower resource or count; alteration requires a replacement petition.",
    },
    consequence: {
      classification: "destructive",
      summary: DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
      recoverability: "recoverable-from-preserved-tag",
      requiredEvidence: {
        owner: "must equal resources.sourceOwner",
        sourceRecordId: "required source-owned identifier",
        digest: "required lowercase SHA-256 digest",
        observedAt: "required exact UTC instant",
        currentness: "must be current; unknown and stale are refused",
        scope: "must equal the projected repository, branch, object, and recovery tag",
        enforcement:
          "admission and final enforcement must obtain the source record and recheck its digest, scope, and currentness",
      },
    },
    authorityContextComparison: {
      resolution: "supplied by the authoritative institution owner; not resolved by this type",
      signedFields: [
        "civilizationId",
        "authorityContext.mandateId",
        "authorityContext.mandateRevision",
        "authorityContext.mandateDigest",
      ],
      algorithm: "exact-field-equality",
      mismatch: "refused",
    },
    trustedTransactionPresentation: {
      format: "ecosym.git.delete-branch.transaction-view.v1",
      orderedFields: [
        "operation",
        "target.sourceOwner",
        "target.repositoryId",
        "target.branchReference",
        "target.expectedObjectId",
        "limit.maximumReferencesDeleted",
        "consequence.classification",
        "consequence.summary",
        "recoverability.classification",
        "recoverability.preservedReference",
        "recoverability.evidence.owner",
        "recoverability.evidence.sourceRecordId",
        "recoverability.evidence.digest",
        "recoverability.evidence.observedAt",
        "recoverability.evidence.currentness",
        "recoverability.evidence.scope.repositoryId",
        "recoverability.evidence.scope.branchReference",
        "recoverability.evidence.scope.expectedObjectId",
        "recoverability.evidence.scope.preservedReference",
      ],
      userText: "not admitted",
    },
  },
  conformanceVectors: {
    substitutions: {
      $requestDefinitionDigest:
        "replace with the digest of this record after canonicalization and domain separation",
    },
    validRequest: {
      type: {
        id: DELETE_GIT_BRANCH_REQUEST_ID,
        revision: DELETE_GIT_BRANCH_REQUEST_REVISION,
        definitionDigest: "$requestDefinitionDigest",
      },
      operation: DELETE_GIT_BRANCH_OPERATION,
      resources: {
        sourceOwner: "git.example",
        repositoryId: "repo:alpha",
        branchReference: "refs/heads/topic",
      },
      parameters: {
        deleteMode: DELETE_GIT_BRANCH_MODE,
        expectedObjectId: VECTOR_OBJECT_ID,
        preservedReference: "refs/tags/topic_recovery",
      },
      limits: { maximumReferencesDeleted: 1 },
      userText: null,
      consequence: {
        classification: "destructive",
        summary: DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
        recoverability: {
          classification: "recoverable-from-preserved-tag",
          evidence: {
            owner: "git.example",
            sourceRecordId: "git-ref-state:alpha-topic",
            digest: VECTOR_EVIDENCE_DIGEST,
            observedAt: "2026-09-02T12:00:00.000Z",
            currentness: "current",
            scope: {
              repositoryId: "repo:alpha",
              branchReference: "refs/heads/topic",
              expectedObjectId: VECTOR_OBJECT_ID,
              preservedReference: "refs/tags/topic_recovery",
            },
          },
        },
      },
    },
    expectedProjection: {
      operation: DELETE_GIT_BRANCH_OPERATION,
      resources: {
        sourceOwner: "git.example",
        repositoryId: "repo:alpha",
        branchReference: "refs/heads/topic",
        expectedObjectId: VECTOR_OBJECT_ID,
        preservedReference: "refs/tags/topic_recovery",
        recoverabilityEvidence: {
          digest: VECTOR_EVIDENCE_DIGEST,
          scope: {
            repositoryId: "repo:alpha",
            branchReference: "refs/heads/topic",
            expectedObjectId: VECTOR_OBJECT_ID,
            preservedReference: "refs/tags/topic_recovery",
          },
        },
      },
      limits: { maximumReferencesDeleted: 1 },
      consequenceClassification: "destructive",
    },
    expectedTransactionView: {
      format: "ecosym.git.delete-branch.transaction-view.v1",
      operation: DELETE_GIT_BRANCH_OPERATION,
      target: {
        sourceOwner: "git.example",
        repositoryId: "repo:alpha",
        branchReference: "refs/heads/topic",
        expectedObjectId: VECTOR_OBJECT_ID,
      },
      limit: { maximumReferencesDeleted: 1 },
      consequence: {
        classification: "destructive",
        summary: DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
      },
      recoverability: {
        classification: "recoverable-from-preserved-tag",
        preservedReference: "refs/tags/topic_recovery",
        evidence: {
          owner: "git.example",
          sourceRecordId: "git-ref-state:alpha-topic",
          digest: VECTOR_EVIDENCE_DIGEST,
          observedAt: "2026-09-02T12:00:00.000Z",
          currentness: "current",
          scope: {
            repositoryId: "repo:alpha",
            branchReference: "refs/heads/topic",
            expectedObjectId: VECTOR_OBJECT_ID,
            preservedReference: "refs/tags/topic_recovery",
          },
        },
      },
    },
    refusals: [
      { mutation: "add an undeclared field", rule: "closed_schema" },
      { mutation: "change type.id", rule: "unknown_request_type" },
      { mutation: "change type.revision", rule: "undefined_projection" },
      { mutation: "change type.definitionDigest", rule: "definition_mismatch" },
      { mutation: "supply a value outside a declared format", rule: "schema_value" },
      { mutation: "set the numeric limit to IEEE-754 negative zero", rule: "negative_zero" },
      {
        mutation: "add an effect-bearing parameter or change deleteMode",
        rule: "parameter_outside_projection",
      },
      { mutation: "supply non-null userText", rule: "user_text_outside_projection" },
      { mutation: "change the consequence disclosure", rule: "destructive_disclosure" },
      { mutation: "remove or malform the evidence reference", rule: "evidence_required" },
      { mutation: "mark evidence stale or unknown", rule: "evidence_not_current" },
      { mutation: "make evidence owner or scope differ", rule: "evidence_mismatch" },
      {
        mutation: "change a signed civilization or mandate field",
        rule: "authority_context_mismatch",
      },
      { mutation: "compare unequal valid projections", rule: "projection_not_subset" },
    ],
  },
} as const);

// The digest identifies only the normative record (petitionBoundary and
// institutionOwner). conformanceVectors holds test fixtures and descriptive
// prose, not authority-bearing rules: correcting a typo in a mutation
// description, or adding another refusal vector, must not change the digest
// every already-issued request.type.definitionDigest has to keep matching.
export const DELETE_GIT_BRANCH_REQUEST_NORMATIVE_RECORD = {
  schemaVersion: DELETE_GIT_BRANCH_REQUEST_DEFINITION.schemaVersion,
  id: DELETE_GIT_BRANCH_REQUEST_DEFINITION.id,
  revision: DELETE_GIT_BRANCH_REQUEST_DEFINITION.revision,
  petitionBoundary: DELETE_GIT_BRANCH_REQUEST_DEFINITION.petitionBoundary,
  institutionOwner: DELETE_GIT_BRANCH_REQUEST_DEFINITION.institutionOwner,
};
export const DELETE_GIT_BRANCH_REQUEST_DEFINITION_CANONICAL = canonicalJson(
  DELETE_GIT_BRANCH_REQUEST_NORMATIVE_RECORD as unknown as JsonValue,
);
export const DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST =
  `sha256:${sha256(`${REQUEST_DEFINITION_DOMAIN}${DELETE_GIT_BRANCH_REQUEST_DEFINITION_CANONICAL}`)}`;

export type PetitionRequestRefusalRule =
  (typeof DELETE_GIT_BRANCH_REQUEST_DEFINITION.conformanceVectors.refusals)[number]["rule"];

export class PetitionRequestRefusal extends Error {
  readonly code = "petition_request_refused";
  readonly rule: PetitionRequestRefusalRule;

  constructor(rule: PetitionRequestRefusalRule, message: string) {
    super(message);
    this.name = "PetitionRequestRefusal";
    this.rule = rule;
  }
}

export interface DeleteGitBranchRecoverabilityEvidence {
  owner: string;
  sourceRecordId: string;
  digest: string;
  observedAt: string;
  // This is the signed source marker; admission and enforcement establish actual currentness.
  currentness: "current";
  scope: {
    repositoryId: string;
    branchReference: string;
    expectedObjectId: string;
    preservedReference: string;
  };
}

export interface DeleteGitBranchRequest {
  type: {
    id: typeof DELETE_GIT_BRANCH_REQUEST_ID;
    revision: typeof DELETE_GIT_BRANCH_REQUEST_REVISION;
    definitionDigest: string;
  };
  operation: typeof DELETE_GIT_BRANCH_OPERATION;
  resources: {
    sourceOwner: string;
    repositoryId: string;
    branchReference: string;
  };
  parameters: {
    deleteMode: typeof DELETE_GIT_BRANCH_MODE;
    expectedObjectId: string;
    preservedReference: string;
  };
  limits: {
    maximumReferencesDeleted: 1;
  };
  userText: null;
  consequence: {
    classification: "destructive";
    summary: typeof DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY;
    recoverability: {
      classification: "recoverable-from-preserved-tag";
      evidence: DeleteGitBranchRecoverabilityEvidence;
    };
  };
}

// Only the evidence fields that actually decide authority are projected:
// the digest that anchors the record and the scope it claims to describe.
// owner is already covered by resources.sourceOwner (evidence_mismatch
// enforces they match); sourceRecordId, observedAt, and currentness are
// audit metadata that must not be able to move authority equality.
export interface DeleteGitBranchAuthorityBearingEvidence {
  digest: string;
  scope: DeleteGitBranchRecoverabilityEvidence["scope"];
}

export interface DeleteGitBranchAuthorityProjection {
  operation: typeof DELETE_GIT_BRANCH_OPERATION;
  resources: {
    sourceOwner: string;
    repositoryId: string;
    branchReference: string;
    expectedObjectId: string;
    preservedReference: string;
    recoverabilityEvidence: DeleteGitBranchAuthorityBearingEvidence;
  };
  limits: {
    maximumReferencesDeleted: 1;
  };
  consequenceClassification: "destructive";
}

export interface ValidatedDeleteGitBranchRequest {
  request: DeleteGitBranchRequest;
  canonicalRequest: string;
  projection: DeleteGitBranchAuthorityProjection;
}

export interface PetitionAuthorityContext {
  civilizationId: string;
  authorityContext: {
    mandateId: string;
    mandateRevision: string;
    mandateDigest: string;
  };
}

export interface DeleteGitBranchTransactionView {
  format: "ecosym.git.delete-branch.transaction-view.v1";
  operation: typeof DELETE_GIT_BRANCH_OPERATION;
  target: {
    sourceOwner: string;
    repositoryId: string;
    branchReference: string;
    expectedObjectId: string;
  };
  limit: {
    maximumReferencesDeleted: 1;
  };
  consequence: {
    classification: "destructive";
    summary: typeof DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY;
  };
  recoverability: {
    classification: "recoverable-from-preserved-tag";
    preservedReference: string;
    evidence: DeleteGitBranchRecoverabilityEvidence;
  };
}

export function validatePetitionRequest(input: unknown): ValidatedDeleteGitBranchRequest {
  const request = parsePetitionRequest(input);
  return {
    request,
    canonicalRequest: canonicalJson(request as unknown as JsonValue),
    projection: project(request),
  };
}

export function authorityProjection(input: unknown): DeleteGitBranchAuthorityProjection {
  return project(parsePetitionRequest(input));
}

export function requestTransactionView(input: unknown): DeleteGitBranchTransactionView {
  const request = parsePetitionRequest(input);
  return {
    format: "ecosym.git.delete-branch.transaction-view.v1",
    operation: request.operation,
    target: {
      sourceOwner: request.resources.sourceOwner,
      repositoryId: request.resources.repositoryId,
      branchReference: request.resources.branchReference,
      expectedObjectId: request.parameters.expectedObjectId,
    },
    limit: { maximumReferencesDeleted: request.limits.maximumReferencesDeleted },
    consequence: {
      classification: request.consequence.classification,
      summary: request.consequence.summary,
    },
    recoverability: {
      classification: request.consequence.recoverability.classification,
      preservedReference: request.parameters.preservedReference,
      evidence: copyEvidence(request.consequence.recoverability.evidence),
    },
  };
}

export function assertPetitionRequestAuthoritySubset(
  candidateInput: unknown,
  ceilingInput: unknown,
): DeleteGitBranchAuthorityProjection {
  const candidate = authorityProjection(candidateInput);
  const ceiling = authorityProjection(ceilingInput);
  assertRule(
    canonicalJson(candidate as unknown as JsonValue) ===
      canonicalJson(ceiling as unknown as JsonValue),
    "projection_not_subset",
    "candidate authority projection is not a subset of the petition ceiling",
  );
  return candidate;
}

// This compares an already-resolved institution record. It does not establish
// that the second argument came from the authoritative institution owner.
export function assertAuthorityContextMatches(
  signedInput: unknown,
  authoritativeInput: unknown,
): PetitionAuthorityContext {
  const signed = parseAuthorityContext(signedInput, "signedAuthority");
  const authoritative = parseAuthorityContext(authoritativeInput, "authoritativeAuthority");
  assertRule(
    signed.civilizationId === authoritative.civilizationId &&
      signed.authorityContext.mandateId === authoritative.authorityContext.mandateId &&
      signed.authorityContext.mandateRevision ===
        authoritative.authorityContext.mandateRevision &&
      signed.authorityContext.mandateDigest === authoritative.authorityContext.mandateDigest,
    "authority_context_mismatch",
    "signed civilization and mandate must exactly match the authoritative resolution",
  );
  return signed;
}

function parsePetitionRequest(input: unknown): DeleteGitBranchRequest {
  const request = objectAt(input, "request");
  exactKeys(request, [
    "type",
    "operation",
    "resources",
    "parameters",
    "limits",
    "userText",
    "consequence",
  ], "request");

  const type = objectAt(request.type, "request.type");
  exactKeys(type, ["id", "revision", "definitionDigest"], "request.type");
  const requestTypeId = stringAt(type.id, "request.type.id");
  assertRule(
    requestTypeId === DELETE_GIT_BRANCH_REQUEST_ID,
    "unknown_request_type",
    "request.type.id is not a known consequential request type",
  );
  const requestTypeRevision = stringAt(type.revision, "request.type.revision");
  assertRule(
    requestTypeRevision === DELETE_GIT_BRANCH_REQUEST_REVISION,
    "undefined_projection",
    "request.type.revision has no defined authority projection",
  );
  const definitionDigest = stringAt(type.definitionDigest, "request.type.definitionDigest");
  assertRule(
    definitionDigest === DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
    "definition_mismatch",
    "request.type.definitionDigest does not identify the configured definition",
  );

  const operation = stringAt(request.operation, "request.operation");
  assertRule(
    operation === DELETE_GIT_BRANCH_OPERATION,
    "schema_value",
    "request.operation is outside the selected request schema",
  );

  const resourcesInput = objectAt(request.resources, "request.resources");
  exactKeys(
    resourcesInput,
    ["sourceOwner", "repositoryId", "branchReference"],
    "request.resources",
  );
  const resources = {
    sourceOwner: patternedStringAt(
      resourcesInput.sourceOwner,
      NAME_PATTERN,
      "request.resources.sourceOwner",
    ),
    repositoryId: patternedStringAt(
      resourcesInput.repositoryId,
      NAME_PATTERN,
      "request.resources.repositoryId",
    ),
    branchReference: patternedStringAt(
      resourcesInput.branchReference,
      BRANCH_REFERENCE_PATTERN,
      "request.resources.branchReference",
    ),
  };

  const parametersInput = objectAt(request.parameters, "request.parameters");
  exactKeys(
    parametersInput,
    ["deleteMode", "expectedObjectId", "preservedReference"],
    "request.parameters",
    "parameter_outside_projection",
  );
  const deleteMode = stringAt(parametersInput.deleteMode, "request.parameters.deleteMode");
  assertRule(
    deleteMode === DELETE_GIT_BRANCH_MODE,
    "parameter_outside_projection",
    "request.parameters.deleteMode would change the projected effect",
  );
  const parameters: DeleteGitBranchRequest["parameters"] = {
    deleteMode: DELETE_GIT_BRANCH_MODE,
    expectedObjectId: patternedStringAt(
      parametersInput.expectedObjectId,
      SHA256_PATTERN,
      "request.parameters.expectedObjectId",
    ),
    preservedReference: patternedStringAt(
      parametersInput.preservedReference,
      TAG_REFERENCE_PATTERN,
      "request.parameters.preservedReference",
    ),
  };

  const limitsInput = objectAt(request.limits, "request.limits");
  exactKeys(limitsInput, ["maximumReferencesDeleted"], "request.limits");
  assertRule(
    !Object.is(limitsInput.maximumReferencesDeleted, -0),
    "negative_zero",
    "request.limits.maximumReferencesDeleted must not be negative zero",
  );
  assertRule(
    limitsInput.maximumReferencesDeleted === 1,
    "schema_value",
    "request.limits.maximumReferencesDeleted must be 1",
  );

  assertRule(
    request.userText === null,
    "user_text_outside_projection",
    "this request type does not admit userText",
  );

  const consequenceInput = objectAt(request.consequence, "request.consequence");
  exactKeys(
    consequenceInput,
    ["classification", "summary", "recoverability"],
    "request.consequence",
  );
  assertRule(
    consequenceInput.classification === "destructive" &&
      consequenceInput.summary === DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
    "destructive_disclosure",
    "request.consequence must contain the exact destructive disclosure",
  );

  const recoverabilityInput = objectAt(
    consequenceInput.recoverability,
    "request.consequence.recoverability",
    "destructive_disclosure",
  );
  assertRule(
    Object.hasOwn(recoverabilityInput, "classification"),
    "destructive_disclosure",
    "request.consequence.recoverability.classification is required",
  );
  assertRule(
    Object.hasOwn(recoverabilityInput, "evidence"),
    "evidence_required",
    "request.consequence.recoverability.evidence is required",
  );
  exactKeys(
    recoverabilityInput,
    ["classification", "evidence"],
    "request.consequence.recoverability",
  );
  assertRule(
    recoverabilityInput.classification === "recoverable-from-preserved-tag",
    "destructive_disclosure",
    "request.consequence.recoverability.classification must describe the preserved tag",
  );
  const evidence = parseEvidence(recoverabilityInput.evidence, resources, parameters);

  return {
    type: {
      id: DELETE_GIT_BRANCH_REQUEST_ID,
      revision: DELETE_GIT_BRANCH_REQUEST_REVISION,
      definitionDigest: DELETE_GIT_BRANCH_REQUEST_DEFINITION_DIGEST,
    },
    operation: DELETE_GIT_BRANCH_OPERATION,
    resources,
    parameters,
    limits: { maximumReferencesDeleted: 1 },
    userText: null,
    consequence: {
      classification: "destructive",
      summary: DELETE_GIT_BRANCH_CONSEQUENCE_SUMMARY,
      recoverability: {
        classification: "recoverable-from-preserved-tag",
        evidence,
      },
    },
  };
}

function parseEvidence(
  input: unknown,
  resources: DeleteGitBranchRequest["resources"],
  parameters: DeleteGitBranchRequest["parameters"],
): DeleteGitBranchRecoverabilityEvidence {
  const evidence = objectAt(
    input,
    "request.consequence.recoverability.evidence",
    "evidence_required",
  );
  exactKeys(
    evidence,
    ["owner", "sourceRecordId", "digest", "observedAt", "currentness", "scope"],
    "request.consequence.recoverability.evidence",
    "closed_schema",
    "evidence_required",
  );
  const owner = patternedStringAt(
    evidence.owner,
    NAME_PATTERN,
    "request.consequence.recoverability.evidence.owner",
    "evidence_required",
  );
  const sourceRecordId = patternedStringAt(
    evidence.sourceRecordId,
    NAME_PATTERN,
    "request.consequence.recoverability.evidence.sourceRecordId",
    "evidence_required",
  );
  const digest = patternedStringAt(
    evidence.digest,
    SHA256_PATTERN,
    "request.consequence.recoverability.evidence.digest",
    "evidence_required",
  );
  const observedAt = utcInstantAt(
    evidence.observedAt,
    "request.consequence.recoverability.evidence.observedAt",
  );
  assertRule(
    evidence.currentness === "current",
    "evidence_not_current",
    "request consequence evidence must be explicitly current",
  );

  const scopeInput = objectAt(
    evidence.scope,
    "request.consequence.recoverability.evidence.scope",
    "evidence_required",
  );
  exactKeys(
    scopeInput,
    ["repositoryId", "branchReference", "expectedObjectId", "preservedReference"],
    "request.consequence.recoverability.evidence.scope",
    "closed_schema",
    "evidence_required",
  );
  const scope = {
    repositoryId: patternedStringAt(
      scopeInput.repositoryId,
      NAME_PATTERN,
      "request.consequence.recoverability.evidence.scope.repositoryId",
      "evidence_required",
    ),
    branchReference: patternedStringAt(
      scopeInput.branchReference,
      BRANCH_REFERENCE_PATTERN,
      "request.consequence.recoverability.evidence.scope.branchReference",
      "evidence_required",
    ),
    expectedObjectId: patternedStringAt(
      scopeInput.expectedObjectId,
      SHA256_PATTERN,
      "request.consequence.recoverability.evidence.scope.expectedObjectId",
      "evidence_required",
    ),
    preservedReference: patternedStringAt(
      scopeInput.preservedReference,
      TAG_REFERENCE_PATTERN,
      "request.consequence.recoverability.evidence.scope.preservedReference",
      "evidence_required",
    ),
  };
  assertRule(
    owner === resources.sourceOwner &&
      scope.repositoryId === resources.repositoryId &&
      scope.branchReference === resources.branchReference &&
      scope.expectedObjectId === parameters.expectedObjectId &&
      scope.preservedReference === parameters.preservedReference,
    "evidence_mismatch",
    "request consequence evidence does not match the projected resource",
  );

  return {
    owner,
    sourceRecordId,
    digest,
    observedAt,
    currentness: "current",
    scope,
  };
}

function project(request: DeleteGitBranchRequest): DeleteGitBranchAuthorityProjection {
  return {
    operation: DELETE_GIT_BRANCH_OPERATION,
    resources: {
      sourceOwner: request.resources.sourceOwner,
      repositoryId: request.resources.repositoryId,
      branchReference: request.resources.branchReference,
      expectedObjectId: request.parameters.expectedObjectId,
      preservedReference: request.parameters.preservedReference,
      recoverabilityEvidence: authorityBearingEvidence(request.consequence.recoverability.evidence),
    },
    limits: { maximumReferencesDeleted: request.limits.maximumReferencesDeleted },
    consequenceClassification: request.consequence.classification,
  };
}

function copyEvidence(
  evidence: DeleteGitBranchRecoverabilityEvidence,
): DeleteGitBranchRecoverabilityEvidence {
  return {
    owner: evidence.owner,
    sourceRecordId: evidence.sourceRecordId,
    digest: evidence.digest,
    observedAt: evidence.observedAt,
    currentness: "current",
    scope: { ...evidence.scope },
  };
}

function authorityBearingEvidence(
  evidence: DeleteGitBranchRecoverabilityEvidence,
): DeleteGitBranchAuthorityBearingEvidence {
  return {
    digest: evidence.digest,
    scope: { ...evidence.scope },
  };
}

function parseAuthorityContext(input: unknown, path: string): PetitionAuthorityContext {
  const binding = objectAt(input, path);
  exactKeys(binding, ["civilizationId", "authorityContext"], path);
  const authorityContext = objectAt(binding.authorityContext, `${path}.authorityContext`);
  exactKeys(
    authorityContext,
    ["mandateId", "mandateRevision", "mandateDigest"],
    `${path}.authorityContext`,
  );
  return {
    civilizationId: patternedStringAt(
      binding.civilizationId,
      NAME_PATTERN,
      `${path}.civilizationId`,
    ),
    authorityContext: {
      mandateId: patternedStringAt(
        authorityContext.mandateId,
        NAME_PATTERN,
        `${path}.authorityContext.mandateId`,
      ),
      mandateRevision: patternedStringAt(
        authorityContext.mandateRevision,
        NAME_PATTERN,
        `${path}.authorityContext.mandateRevision`,
      ),
      mandateDigest: patternedStringAt(
        authorityContext.mandateDigest,
        SHA256_PATTERN,
        `${path}.authorityContext.mandateDigest`,
      ),
    },
  };
}

function objectAt(
  value: unknown,
  path: string,
  rule: PetitionRequestRefusalRule = "schema_value",
): Record<string, unknown> {
  assertRule(
    value !== null && typeof value === "object" && !Array.isArray(value),
    rule,
    `${path} must be an object`,
  );
  const object = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(object);
  assertRule(
    prototype === Object.prototype || prototype === null,
    rule,
    `${path} must be a plain JSON object`,
  );
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    assertRule(
      typeof key === "string" &&
        descriptor !== undefined &&
        descriptor.enumerable === true &&
        "value" in descriptor,
      "closed_schema",
      `${path} must contain only enumerable JSON fields`,
    );
  }
  return object;
}

function exactKeys(
  object: Record<string, unknown>,
  allowed: string[],
  path: string,
  unknownRule: PetitionRequestRefusalRule = "closed_schema",
  missingRule: PetitionRequestRefusalRule = "schema_value",
): void {
  const allowedSet = new Set(allowed);
  const unknownCount = Object.keys(object).filter((key) => !allowedSet.has(key)).length;
  assertRule(
    unknownCount === 0,
    unknownRule,
    `${path} contains ${unknownCount} field(s) outside the closed schema`,
  );
  for (const key of allowed) {
    assertRule(Object.hasOwn(object, key), missingRule, `${path}.${key} is required`);
  }
}

function stringAt(
  value: unknown,
  path: string,
  rule: PetitionRequestRefusalRule = "schema_value",
): string {
  assertRule(typeof value === "string", rule, `${path} must be a string`);
  return value as string;
}

function patternedStringAt(
  value: unknown,
  pattern: RegExp,
  path: string,
  rule: PetitionRequestRefusalRule = "schema_value",
): string {
  const string = stringAt(value, path, rule);
  assertRule(pattern.test(string), rule, `${path} is outside the request schema`);
  return string;
}

function utcInstantAt(value: unknown, path: string): string {
  const instant = stringAt(value, path, "evidence_required");
  assertRule(
    UTC_INSTANT_PATTERN.test(instant) &&
      Number.isFinite(Date.parse(instant)) &&
      new Date(instant).toISOString() === instant,
    "evidence_required",
    `${path} must be an exact UTC instant`,
  );
  return instant;
}

function assertRule(
  condition: boolean,
  rule: PetitionRequestRefusalRule,
  message: string,
): asserts condition {
  if (!condition) {
    throw new PetitionRequestRefusal(rule, message);
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
