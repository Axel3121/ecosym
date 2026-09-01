import { canonicalJson, sha256 } from "./json.ts";
import type { FactInput, VerificationFact } from "./store.ts";
import { utcInstantOrderingKey } from "./time.ts";

export function verificationFactFromInput(fact: FactInput): VerificationFact {
  return {
    epistemicStatus: fact.epistemicStatus,
    factOwner: fact.factOwner,
    kind: fact.kind,
    payloadHash: sha256(canonicalJson(fact.payload)),
    sourceRecordedAt: fact.sourceRecordedAt,
    sourceRecordId: fact.sourceRecordId,
    subject: fact.subject,
  };
}

export function sameVerificationFactSet(
  left: readonly VerificationFact[],
  right: readonly VerificationFact[],
): boolean {
  const leftKeys = new Set(left.map(verificationFactKey));
  const rightKeys = new Set(right.map(verificationFactKey));
  return leftKeys.size === rightKeys.size && [...leftKeys].every((key) => rightKeys.has(key));
}

export function verificationFactKey(fact: VerificationFact): string {
  const sourceTimeKey =
    fact.sourceRecordedAt === null
      ? null
      : utcInstantOrderingKey(fact.sourceRecordedAt);
  return canonicalJson([
    fact.epistemicStatus,
    fact.factOwner,
    fact.kind,
    fact.subject,
    fact.sourceRecordId,
    sourceTimeKey,
    fact.payloadHash,
  ]);
}
