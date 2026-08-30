import { type ConnectionConfig } from "./config.ts";
import { canonicalJson, sha256 } from "./json.ts";
import { materializeFacts } from "./materialize.ts";
import { readSource } from "./readers.ts";
import {
  type ActiveConnection,
  ObservationStore,
  type VerificationFact,
} from "./store.ts";

export interface VerificationCounts {
  advanced: number;
  matched: number;
  missingAtSource: number;
  payloadMismatch: number;
  sourceFacts: number;
  sourceVersionConflict: number;
  storedFacts: number;
  superseded: number;
  uncollected: number;
}

export interface VerificationConnectionReport {
  connectionId: string;
  counts: VerificationCounts;
  outcome: "agreement" | "disagreement" | "unread";
  unreadReason: null | string;
}

export interface VerificationReport {
  schemaVersion: 1;
  outcome: "agreement" | "disagreement" | "mixed" | "unread";
  connections: VerificationConnectionReport[];
}

interface ComparableFact extends VerificationFact {}

export async function verifyAll(store: ObservationStore): Promise<VerificationReport> {
  const connections: VerificationConnectionReport[] = [];
  for (const connection of store.listConnections()) {
    connections.push(await verifyConnection(store, connection));
  }
  return {
    schemaVersion: 1,
    outcome: aggregateOutcome(connections),
    connections,
  };
}

export async function verifyConnection(
  store: ObservationStore,
  connection: ActiveConnection,
): Promise<VerificationConnectionReport> {
  const snapshot = store.factsForVerification(connection);
  const stored = deduplicate(snapshot.facts);
  if (!snapshot.currentnessKnown) {
    return {
      connectionId: connection.config.id,
      counts: emptyCounts(stored.length),
      outcome: "unread",
      unreadReason: "store_currentness_unknown",
    };
  }
  let source: ComparableFact[];
  try {
    const materialized: ComparableFact[] = [];
    for await (const sourceRecord of readSource(connection.config)) {
      for (const fact of materializeFacts(connection.config, sourceRecord)) {
        const payloadJson = canonicalJson(fact.payload);
        materialized.push({
          epistemicStatus: fact.epistemicStatus,
          factOwner: fact.factOwner,
          kind: fact.kind,
          payloadHash: sha256(payloadJson),
          sourceRecordedAt: fact.sourceRecordedAt,
          sourceRecordId: fact.sourceRecordId,
          subject: fact.subject,
        });
      }
    }
    source = deduplicate(materialized);
  } catch (error) {
    return {
      connectionId: connection.config.id,
      counts: emptyCounts(stored.length),
      outcome: "unread",
      unreadReason: safeFailureCode(error),
    };
  }

  const counts = compareFacts(connection.config, stored, source);
  return {
    connectionId: connection.config.id,
    counts,
    outcome:
      counts.missingAtSource > 0 ||
      counts.payloadMismatch > 0 ||
      counts.sourceVersionConflict > 0 ||
      counts.uncollected > 0
        ? "disagreement"
        : "agreement",
    unreadReason: null,
  };
}

export function exitCodeForVerification(report: VerificationReport): number {
  switch (report.outcome) {
    case "agreement":
      return 0;
    case "disagreement":
      return 1;
    case "unread":
      return 2;
    case "mixed":
      return 3;
  }
}

function compareFacts(
  config: ConnectionConfig,
  stored: ComparableFact[],
  source: ComparableFact[],
): VerificationCounts {
  const counts = emptyCounts(stored.length, source.length);
  const storedByVersion = groupBy(stored, sourceVersionKey);
  const sourceByVersion = groupBy(source, sourceVersionKey);
  const storedByIdentity = groupBy(stored, factIdentityKey);
  const sourceByIdentity = groupBy(source, factIdentityKey);

  for (const versions of sourceByVersion.values()) {
    if (new Set(versions.map((fact) => fact.payloadHash)).size > 1) {
      counts.sourceVersionConflict += 1;
    }
  }

  for (const sourceFact of source) {
    const sameVersion = storedByVersion.get(sourceVersionKey(sourceFact)) ?? [];
    if (sameVersion.some((storedFact) => storedFact.payloadHash === sourceFact.payloadHash)) {
      counts.matched += 1;
      counts.payloadMismatch += new Set(
        sameVersion
          .filter((storedFact) => storedFact.payloadHash !== sourceFact.payloadHash)
          .map((storedFact) => storedFact.payloadHash),
      ).size;
      continue;
    }
    if (sameVersion.length > 0) {
      counts.payloadMismatch += 1;
      continue;
    }
    const history = storedByIdentity.get(factIdentityKey(sourceFact)) ?? [];
    if (isStrictlyNewerThanHistory(sourceFact, history)) {
      counts.advanced += 1;
    } else {
      counts.uncollected += 1;
    }
  }

  for (const storedFact of stored) {
    if (sourceByVersion.has(sourceVersionKey(storedFact))) {
      continue;
    }
    const currentSource = sourceByIdentity.get(factIdentityKey(storedFact)) ?? [];
    if (
      config.sourceRecord.retention === "latest" &&
      currentSource.some((sourceFact) => isStrictlyNewer(sourceFact, storedFact))
    ) {
      counts.superseded += 1;
    } else {
      counts.missingAtSource += 1;
    }
  }

  return counts;
}

function deduplicate(facts: ComparableFact[]): ComparableFact[] {
  const unique = new Map<string, ComparableFact>();
  for (const fact of facts) {
    unique.set(`${sourceVersionKey(fact)}\u0000${fact.payloadHash}`, fact);
  }
  return [...unique.values()];
}

function groupBy(
  facts: ComparableFact[],
  keyOf: (fact: ComparableFact) => string,
): Map<string, ComparableFact[]> {
  const groups = new Map<string, ComparableFact[]>();
  for (const fact of facts) {
    const key = keyOf(fact);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [fact]);
    } else {
      group.push(fact);
    }
  }
  return groups;
}

function factIdentityKey(fact: ComparableFact): string {
  return canonicalJson([
    fact.epistemicStatus,
    fact.factOwner,
    fact.kind,
    fact.subject,
  ]);
}

function sourceVersionKey(fact: ComparableFact): string {
  return canonicalJson([
    fact.epistemicStatus,
    fact.factOwner,
    fact.kind,
    fact.subject,
    fact.sourceRecordId,
    fact.sourceRecordedAt,
  ]);
}

function isStrictlyNewerThanHistory(candidate: ComparableFact, history: ComparableFact[]): boolean {
  return history.length > 0 && history.every((fact) => isStrictlyNewer(candidate, fact));
}

function isStrictlyNewer(candidate: ComparableFact, prior: ComparableFact): boolean {
  return (
    candidate.sourceRecordedAt !== null &&
    prior.sourceRecordedAt !== null &&
    candidate.sourceRecordedAt > prior.sourceRecordedAt
  );
}

function emptyCounts(storedFacts: number, sourceFacts = 0): VerificationCounts {
  return {
    advanced: 0,
    matched: 0,
    missingAtSource: 0,
    payloadMismatch: 0,
    sourceFacts,
    sourceVersionConflict: 0,
    storedFacts,
    superseded: 0,
    uncollected: 0,
  };
}

function aggregateOutcome(
  connections: VerificationConnectionReport[],
): VerificationReport["outcome"] {
  const hasDisagreement = connections.some((connection) => connection.outcome === "disagreement");
  const hasUnread = connections.some((connection) => connection.outcome === "unread");
  if (hasDisagreement && hasUnread) {
    return "mixed";
  }
  if (hasDisagreement) {
    return "disagreement";
  }
  if (hasUnread) {
    return "unread";
  }
  return "agreement";
}

function safeFailureCode(error: unknown): string {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/.test(error.code)
  ) {
    return error.code;
  }
  return "internal_error";
}
