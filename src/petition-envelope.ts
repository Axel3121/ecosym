import { createHash, randomBytes } from "node:crypto";

import { canonicalJson, type JsonValue } from "./json.ts";
import {
  type DeleteGitBranchRequest,
  DELETE_GIT_BRANCH_REQUEST_ID,
  parseAuthorityContext,
  PetitionRequestRefusal,
  type PetitionRequestRefusalRule,
  validatePetitionRequest,
} from "./petition-request.ts";
import { isCanonicalUtcInstant } from "./time.ts";

const ENVELOPE_DOMAIN = Buffer.concat([
  Buffer.from("ecosym.petition-envelope.v1", "utf8"),
  Buffer.from([0]),
]);
const PROOF_DOMAIN = Buffer.concat([
  Buffer.from("ecosym.user-proof-record.v1", "utf8"),
  Buffer.from([0]),
]);
const WITHDRAWAL_DOMAIN = Buffer.concat([
  Buffer.from("ecosym.petition-withdrawal.v1", "utf8"),
  Buffer.from([0]),
]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const OWNER_IDENTIFIER_MAX_LENGTH = 2048;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Nothing produced here is a petition. An unsigned envelope has not been asked,
 * admitted, or authorized. Successful validation means only structurally
 * well-formed against an unselected proof profile; this module neither selects
 * nor verifies a profile.
 *
 * Owner-namespace identifiers admit any non-empty, well-formed UTF-16 string of
 * at most 2,048 code units without C0/C1 controls. Tighter syntax belongs to the
 * unselected credential or runtime owner. Consequence evidence is carried and
 * checked for request consistency, but its truth and currentness are not
 * established here.
 *
 * The empty validity interval is refused because it can never authorize and
 * ambiguous or expired authority fails closed under SECURITY.md lines 90-91.
 * This chooses no duration: callers must provide both absolute bounds, and all
 * interval checks take their instant as an argument rather than reading a clock.
 */

export type PetitionEnvelopeRefusalRule =
  | PetitionRequestRefusalRule
  | "authority_basis"
  | "audience_mismatch"
  | "closed_schema"
  | "credential_id_mismatch"
  | "digest_format"
  | "envelope_digest_mismatch"
  | "identifier_alphabet"
  | "identifier_length"
  | "identifier_noncanonical"
  | "identifier_padding"
  | "identifier_prefix"
  | "interval_empty"
  | "interval_order"
  | "negative_zero"
  | "non_finite_number"
  | "owner_identifier"
  | "petition_id_mismatch"
  | "predecessor_self"
  | "principal_mismatch"
  | "proof_bytes"
  | "proof_profile_mismatch"
  | "schema_value"
  | "subject_digest_mismatch"
  | "undefined_value"
  | "utc_instant";

export class PetitionEnvelopeRefusal extends Error {
  readonly code = "petition_envelope_refused";
  readonly rule: PetitionEnvelopeRefusalRule;
  readonly fieldPath: string;

  constructor(rule: PetitionEnvelopeRefusalRule, fieldPath: string) {
    super(`petition envelope refused: ${rule} at ${fieldPath}`);
    this.name = "PetitionEnvelopeRefusal";
    this.rule = rule;
    this.fieldPath = fieldPath;
  }
}

export interface PetitionPrincipal {
  issuer: string;
  subject: string;
}

export interface PetitionProofProfile {
  id: string;
  revision: string;
  definitionDigest: string;
}

export interface PetitionAudience {
  runtimeId: string;
  controlPlaneId: string;
}

export interface PetitionEnvelope {
  schemaVersion: 1;
  petitionId: string;
  principal: PetitionPrincipal;
  credentialId: string;
  proofProfile: PetitionProofProfile;
  audience: PetitionAudience;
  civilizationId: string;
  authorityContext: {
    mandateId: string;
    mandateRevision: string;
    mandateDigest: string;
  };
  authorityBasis: { type: "direct-user-petition" };
  request: DeleteGitBranchRequest;
  notBefore: string;
  expiresAt: string;
  predecessorPetitionId: string | null;
}

export interface PetitionEnvelopeRepresentation {
  envelope: PetitionEnvelope;
  canonicalBytes: Buffer;
  envelopeDigest: string;
}

export interface PetitionWithdrawal {
  schemaVersion: 1;
  withdrawalId: string;
  petitionId: string;
  envelopeDigest: string;
  principal: PetitionPrincipal;
  credentialId: string;
  proofProfile: PetitionProofProfile;
  audience: PetitionAudience;
  action: "withdraw";
}

export interface PetitionWithdrawalRepresentation {
  withdrawal: PetitionWithdrawal;
  canonicalBytes: Buffer;
  withdrawalDigest: string;
}

export interface PetitionProofRecord {
  schemaVersion: 1;
  proofProfile: PetitionProofProfile;
  credentialId: string;
  subjectDigest: string;
  proofBytes: string;
}

interface PetitionProofRepresentation {
  proofRecord: PetitionProofRecord;
  canonicalBytes: Buffer;
  proofDigest: string;
}

export interface EnvelopeProofRepresentation {
  proofRecord: PetitionProofRecord;
  canonicalBytes: Buffer;
  userProofDigest: string;
}

export interface WithdrawalProofRepresentation {
  proofRecord: PetitionProofRecord;
  canonicalBytes: Buffer;
  withdrawalProofDigest: string;
}

export function generatePetitionId(): string {
  return `petition:${randomBytes(32).toString("base64url")}`;
}

export function generateWithdrawalId(): string {
  return `withdrawal:${randomBytes(32).toString("base64url")}`;
}

export function validatePetitionId(value: unknown): string {
  return canonicalIdentifier(value, "petition", "petitionId");
}

export function validateWithdrawalId(value: unknown): string {
  return canonicalIdentifier(value, "withdrawal", "withdrawalId");
}

export function createPetitionEnvelope(input: unknown): PetitionEnvelopeRepresentation {
  rejectNonCanonicalJsonValues(input, "envelope");
  const value = objectAt(input, "envelope");
  exactKeys(value, [
    "schemaVersion",
    "petitionId",
    "principal",
    "credentialId",
    "proofProfile",
    "audience",
    "civilizationId",
    "authorityContext",
    "authorityBasis",
    "request",
    "notBefore",
    "expiresAt",
    "predecessorPetitionId",
  ], "envelope");
  assertRule(value.schemaVersion === 1, "schema_value", "schemaVersion");

  const petitionId = validatePetitionId(value.petitionId);
  const principal = parsePrincipal(value.principal, "principal");
  const credentialId = ownerIdentifierAt(value.credentialId, "credentialId");
  const proofProfile = parseProofProfile(value.proofProfile, "proofProfile");
  const audience = parseAudience(value.audience, "audience");
  const authority = parseAuthority(value);
  const authorityBasis = objectAt(value.authorityBasis, "authorityBasis");
  exactKeys(authorityBasis, ["type"], "authorityBasis");
  assertRule(
    authorityBasis.type === "direct-user-petition",
    "authority_basis",
    "authorityBasis.type",
  );

  let request: DeleteGitBranchRequest;
  try {
    request = validatePetitionRequest(value.request).request;
  } catch (error) {
    if (error instanceof PetitionRequestRefusal) {
      throw new PetitionEnvelopeRefusal(error.rule, "request");
    }
    throw error;
  }
  assertRule(request.type.id === DELETE_GIT_BRANCH_REQUEST_ID, "unknown_request_type", "request.type.id");

  const notBefore = canonicalInstantAt(value.notBefore, "notBefore");
  const expiresAt = canonicalInstantAt(value.expiresAt, "expiresAt");
  if (notBefore === expiresAt) {
    throw new PetitionEnvelopeRefusal("interval_empty", "expiresAt");
  }
  assertRule(notBefore < expiresAt, "interval_order", "expiresAt");

  const predecessorPetitionId =
    value.predecessorPetitionId === null
      ? null
      : canonicalIdentifier(value.predecessorPetitionId, "petition", "predecessorPetitionId");
  assertRule(predecessorPetitionId !== petitionId, "predecessor_self", "predecessorPetitionId");

  const envelope: PetitionEnvelope = {
    schemaVersion: 1,
    petitionId,
    principal,
    credentialId,
    proofProfile,
    audience,
    civilizationId: authority.civilizationId,
    authorityContext: authority.authorityContext,
    authorityBasis: { type: "direct-user-petition" },
    request,
    notBefore,
    expiresAt,
    predecessorPetitionId,
  };
  const represented = represent(envelope, ENVELOPE_DOMAIN);
  return {
    envelope,
    canonicalBytes: represented.canonicalBytes,
    envelopeDigest: represented.digest,
  };
}

export function parsePetitionEnvelopeBytes(bytes: Uint8Array): PetitionEnvelopeRepresentation {
  let input: unknown;
  try {
    input = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new PetitionEnvelopeRefusal("schema_value", "envelope");
  }
  const representation = createPetitionEnvelope(input);
  assertRule(
    Buffer.from(bytes).equals(representation.canonicalBytes),
    "schema_value",
    "envelope",
  );
  return representation;
}

export function isEnvelopeWithinInterval(
  input: unknown,
  instantInput: unknown,
): boolean {
  const { envelope } = createPetitionEnvelope(input);
  const instant = canonicalInstantAt(instantInput, "instant");
  return envelope.notBefore <= instant && instant < envelope.expiresAt;
}

export function createPetitionWithdrawal(
  input: unknown,
  envelopeInput: unknown,
): PetitionWithdrawalRepresentation {
  const envelope = createPetitionEnvelope(envelopeInput);
  const withdrawal = parseWithdrawal(input);
  assertRule(withdrawal.petitionId === envelope.envelope.petitionId, "petition_id_mismatch", "petitionId");
  assertRule(
    withdrawal.envelopeDigest === envelope.envelopeDigest,
    "envelope_digest_mismatch",
    "envelopeDigest",
  );
  assertRule(equalPrincipal(withdrawal.principal, envelope.envelope.principal), "principal_mismatch", "principal");
  assertRule(equalAudience(withdrawal.audience, envelope.envelope.audience), "audience_mismatch", "audience");
  const represented = represent(withdrawal, WITHDRAWAL_DOMAIN);
  return {
    withdrawal,
    canonicalBytes: represented.canonicalBytes,
    withdrawalDigest: represented.digest,
  };
}

export function validateEnvelopeProofRecord(
  input: unknown,
  envelopeInput: unknown,
): EnvelopeProofRepresentation {
  const subject = createPetitionEnvelope(envelopeInput);
  const proof = validateProofRecord(
    input,
    subject.envelopeDigest,
    subject.envelope.proofProfile,
    subject.envelope.credentialId,
  );
  return {
    proofRecord: proof.proofRecord,
    canonicalBytes: proof.canonicalBytes,
    userProofDigest: proof.proofDigest,
  };
}

export function validateWithdrawalProofRecord(
  input: unknown,
  withdrawalInput: unknown,
  envelopeInput: unknown,
): WithdrawalProofRepresentation {
  const subject = createPetitionWithdrawal(withdrawalInput, envelopeInput);
  const proof = validateProofRecord(
    input,
    subject.withdrawalDigest,
    subject.withdrawal.proofProfile,
    subject.withdrawal.credentialId,
  );
  return {
    proofRecord: proof.proofRecord,
    canonicalBytes: proof.canonicalBytes,
    withdrawalProofDigest: proof.proofDigest,
  };
}

function parseWithdrawal(input: unknown): PetitionWithdrawal {
  rejectNonCanonicalJsonValues(input, "withdrawal");
  const value = objectAt(input, "withdrawal");
  exactKeys(value, [
    "schemaVersion",
    "withdrawalId",
    "petitionId",
    "envelopeDigest",
    "principal",
    "credentialId",
    "proofProfile",
    "audience",
    "action",
  ], "withdrawal");
  assertRule(value.schemaVersion === 1, "schema_value", "schemaVersion");
  assertRule(value.action === "withdraw", "schema_value", "action");
  return {
    schemaVersion: 1,
    withdrawalId: validateWithdrawalId(value.withdrawalId),
    petitionId: validatePetitionId(value.petitionId),
    envelopeDigest: digestAt(value.envelopeDigest, "envelopeDigest"),
    principal: parsePrincipal(value.principal, "principal"),
    credentialId: ownerIdentifierAt(value.credentialId, "credentialId"),
    proofProfile: parseProofProfile(value.proofProfile, "proofProfile"),
    audience: parseAudience(value.audience, "audience"),
    action: "withdraw",
  };
}

function validateProofRecord(
  input: unknown,
  subjectDigest: string,
  subjectProfile: PetitionProofProfile,
  subjectCredentialId: string,
): PetitionProofRepresentation {
  rejectNonCanonicalJsonValues(input, "proofRecord");
  const value = objectAt(input, "proofRecord");
  exactKeys(
    value,
    ["schemaVersion", "proofProfile", "credentialId", "subjectDigest", "proofBytes"],
    "proofRecord",
  );
  assertRule(value.schemaVersion === 1, "schema_value", "schemaVersion");
  const proofProfile = parseProofProfile(value.proofProfile, "proofProfile");
  const credentialId = ownerIdentifierAt(value.credentialId, "credentialId");
  const suppliedSubjectDigest = digestAt(value.subjectDigest, "subjectDigest");
  const proofBytes = canonicalBase64urlAt(value.proofBytes, "proofBytes");
  assertRule(suppliedSubjectDigest === subjectDigest, "subject_digest_mismatch", "subjectDigest");
  assertRule(equalProofProfile(proofProfile, subjectProfile), "proof_profile_mismatch", "proofProfile");
  assertRule(credentialId === subjectCredentialId, "credential_id_mismatch", "credentialId");
  const proofRecord: PetitionProofRecord = {
    schemaVersion: 1,
    proofProfile,
    credentialId,
    subjectDigest: suppliedSubjectDigest,
    proofBytes,
  };
  const represented = represent(proofRecord, PROOF_DOMAIN);
  return {
    proofRecord,
    canonicalBytes: represented.canonicalBytes,
    proofDigest: represented.digest,
  };
}

function parseAuthority(value: Record<string, unknown>): {
  civilizationId: string;
  authorityContext: PetitionEnvelope["authorityContext"];
} {
  try {
    return parseAuthorityContext(
      { civilizationId: value.civilizationId, authorityContext: value.authorityContext },
      "envelope",
    );
  } catch (error) {
    if (error instanceof PetitionRequestRefusal) {
      throw new PetitionEnvelopeRefusal(error.rule, "authorityContext");
    }
    throw error;
  }
}

function parsePrincipal(input: unknown, path: string): PetitionPrincipal {
  const value = objectAt(input, path);
  exactKeys(value, ["issuer", "subject"], path);
  return {
    issuer: ownerIdentifierAt(value.issuer, `${path}.issuer`),
    subject: ownerIdentifierAt(value.subject, `${path}.subject`),
  };
}

function parseProofProfile(input: unknown, path: string): PetitionProofProfile {
  const value = objectAt(input, path);
  exactKeys(value, ["id", "revision", "definitionDigest"], path);
  return {
    id: structuralStringAt(value.id, `${path}.id`),
    revision: structuralStringAt(value.revision, `${path}.revision`),
    definitionDigest: digestAt(value.definitionDigest, `${path}.definitionDigest`),
  };
}

function parseAudience(input: unknown, path: string): PetitionAudience {
  const value = objectAt(input, path);
  exactKeys(value, ["runtimeId", "controlPlaneId"], path);
  return {
    runtimeId: ownerIdentifierAt(value.runtimeId, `${path}.runtimeId`),
    controlPlaneId: ownerIdentifierAt(value.controlPlaneId, `${path}.controlPlaneId`),
  };
}

function canonicalIdentifier(value: unknown, prefix: string, path: string): string {
  assertRule(typeof value === "string", "identifier_prefix", path);
  const identifier = value as string;
  assertRule(!identifier.includes("="), "identifier_padding", path);
  assertRule(identifier.startsWith(`${prefix}:`), "identifier_prefix", path);
  const encoded = identifier.slice(prefix.length + 1);
  assertRule(encoded.length === 43, "identifier_length", path);
  assertRule(BASE64URL_PATTERN.test(encoded), "identifier_alphabet", path);
  assertRule(
    Buffer.from(encoded, "base64url").toString("base64url") === encoded,
    "identifier_noncanonical",
    path,
  );
  return identifier;
}

function canonicalBase64urlAt(value: unknown, path: string): string {
  assertRule(typeof value === "string", "proof_bytes", path);
  const encoded = value as string;
  assertRule(encoded !== "" && !encoded.includes("=") && BASE64URL_PATTERN.test(encoded), "proof_bytes", path);
  assertRule(Buffer.from(encoded, "base64url").toString("base64url") === encoded, "proof_bytes", path);
  return encoded;
}

function ownerIdentifierAt(value: unknown, path: string): string {
  assertRule(typeof value === "string", "owner_identifier", path);
  const identifier = value as string;
  assertRule(
    identifier !== "" &&
      identifier.length <= OWNER_IDENTIFIER_MAX_LENGTH &&
      identifier.isWellFormed() &&
      !CONTROL_CHARACTER_PATTERN.test(identifier),
    "owner_identifier",
    path,
  );
  return identifier;
}

function structuralStringAt(value: unknown, path: string): string {
  assertRule(typeof value === "string", "schema_value", path);
  const string = value as string;
  assertRule(
    string !== "" && string.length <= OWNER_IDENTIFIER_MAX_LENGTH && string.isWellFormed() && !CONTROL_CHARACTER_PATTERN.test(string),
    "schema_value",
    path,
  );
  return string;
}

function digestAt(value: unknown, path: string): string {
  assertRule(typeof value === "string" && SHA256_PATTERN.test(value), "digest_format", path);
  return value as string;
}

function canonicalInstantAt(value: unknown, path: string): string {
  assertRule(isCanonicalUtcInstant(value), "utc_instant", path);
  return value;
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  assertRule(value !== null && typeof value === "object" && !Array.isArray(value), "schema_value", path);
  const object = value as Record<string, unknown>;
  const prototype = Object.getPrototypeOf(object);
  assertRule(prototype === Object.prototype || prototype === null, "schema_value", path);
  return object;
}

function exactKeys(value: Record<string, unknown>, keys: string[], path: string): void {
  const allowed = new Set(keys);
  assertRule(Object.keys(value).every((key) => allowed.has(key)), "closed_schema", path);
  for (const key of keys) {
    assertRule(Object.hasOwn(value, key), "schema_value", `${path}.${key}`);
  }
}

function rejectNonCanonicalJsonValues(
  value: unknown,
  path: string,
  ancestors = new Set<object>(),
  depth = 0,
): void {
  if (depth > 256) {
    throw new PetitionEnvelopeRefusal("schema_value", `${path} (depth exceeded)`);
  }
  if (value === undefined) {
    throw new PetitionEnvelopeRefusal("undefined_value", path);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PetitionEnvelopeRefusal("non_finite_number", path);
    }
    if (Object.is(value, -0)) {
      throw new PetitionEnvelopeRefusal("negative_zero", path);
    }
    return;
  }
  if (typeof value === "string") {
    assertRule(value.isWellFormed(), "schema_value", path);
    return;
  }
  if (value === null || typeof value === "boolean") {
    return;
  }
  assertRule(typeof value === "object", "schema_value", path);
  const object = value as object;
  assertRule(!ancestors.has(object), "schema_value", path);
  ancestors.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    assertRule(
      typeof key === "string" &&
        descriptor !== undefined &&
        descriptor.enumerable === true &&
        "value" in descriptor,
      "closed_schema",
      path,
    );
    rejectNonCanonicalJsonValues(
      (descriptor as PropertyDescriptor & { value: unknown }).value,
      path,
      ancestors,
      depth + 1,
    );
  }
  ancestors.delete(object);
}

function equalPrincipal(left: PetitionPrincipal, right: PetitionPrincipal): boolean {
  return left.issuer === right.issuer && left.subject === right.subject;
}

function equalAudience(left: PetitionAudience, right: PetitionAudience): boolean {
  return left.runtimeId === right.runtimeId && left.controlPlaneId === right.controlPlaneId;
}

function equalProofProfile(left: PetitionProofProfile, right: PetitionProofProfile): boolean {
  return left.id === right.id && left.revision === right.revision && left.definitionDigest === right.definitionDigest;
}

function digest(domain: Buffer, canonicalBytes: Buffer): string {
  return `sha256:${createHash("sha256").update(domain).update(canonicalBytes).digest("hex")}`;
}

function represent(
  value: object,
  domain: Buffer,
): { canonicalBytes: Buffer; digest: string } {
  const canonicalBytes = Buffer.from(canonicalJson(value as JsonValue), "utf8");
  return { canonicalBytes, digest: digest(domain, canonicalBytes) };
}

function assertRule(
  condition: boolean,
  rule: PetitionEnvelopeRefusalRule,
  fieldPath: string,
): asserts condition {
  if (!condition) {
    throw new PetitionEnvelopeRefusal(rule, fieldPath);
  }
}
