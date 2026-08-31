import { type ConnectionConfig } from "./config.ts";
import { canonicalJson, sha256 } from "./json.ts";
import { materializeFacts } from "./materialize.ts";
import { readSource } from "./readers.ts";
import {
  type ActiveConnection,
  ObservationStore,
  type VerificationFact,
  type VerificationSnapshot,
} from "./store.ts";
import { utcInstantOrderingKey } from "./time.ts";

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

interface VerificationConnectionReportBase {
  connectionId: string;
  counts: VerificationCounts;
}

export type VerificationConnectionReport = VerificationConnectionReportBase &
  (
    | {
        outcome: "agreement" | "disagreement";
        unreadReason: null;
        unverifiedReason: null;
      }
    | { outcome: "unread"; unreadReason: string; unverifiedReason: null }
    | { outcome: "unverified"; unreadReason: null; unverifiedReason: "no_facts" }
  );

interface VerificationReportBase {
  schemaVersion: 1;
  connections: VerificationConnectionReport[];
}

export type VerificationReport = VerificationReportBase &
  (
    | {
        outcome: "agreement" | "disagreement" | "unread";
        unverifiedReason: null;
      }
    | {
        outcome: "mixed";
        unverifiedReason: null | "connections_unverified";
      }
    | {
        outcome: "unverified";
        unverifiedReason: "connections_unverified" | "no_connections";
      }
  );

interface ComparableFact extends VerificationFact {}

export async function verifyAll(store: ObservationStore): Promise<VerificationReport> {
  const connections: VerificationConnectionReport[] = [];
  for (const connection of store.listConnections()) {
    connections.push(await verifyConnection(store, connection));
  }
  const outcome = aggregateOutcome(connections);
  if (outcome === "unverified") {
    return {
      schemaVersion: 1,
      outcome,
      unverifiedReason: connections.length === 0 ? "no_connections" : "connections_unverified",
      connections,
    };
  }
  if (outcome === "mixed") {
    return {
      schemaVersion: 1,
      outcome,
      unverifiedReason: connections.some((connection) => connection.outcome === "unverified")
        ? "connections_unverified"
        : null,
      connections,
    };
  }
  return {
    schemaVersion: 1,
    outcome,
    unverifiedReason: null,
    connections,
  };
}

export async function verifyConnection(
  store: ObservationStore,
  connection: ActiveConnection,
): Promise<VerificationConnectionReport> {
  let snapshot: VerificationSnapshot;
  try {
    snapshot = store.factsForVerification(connection);
  } catch (error) {
    return unreadReport(connection.config.id, 0, safeFailureCode(error));
  }
  const stored = deduplicate(snapshot.facts);
  const unreadReason = snapshotUnreadReason(snapshot);
  if (unreadReason !== null) {
    return unreadReport(connection.config.id, stored.length, unreadReason);
  }
  const recordIndexMode = snapshot.jsonlRecordIndexMode;
  if (recordIndexMode === "unknown") {
    return unreadReport(
      connection.config.id,
      stored.length,
      "store_record_index_mode_unknown",
    );
  }
  let source: ComparableFact[];
  try {
    const materialized: ComparableFact[] = [];
    for await (const sourceRecord of readSource(
      connection.config,
      recordIndexMode,
    )) {
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
    return unreadReport(connection.config.id, stored.length, safeFailureCode(error));
  }
  try {
    store.assertConnectionActive(connection);
  } catch (error) {
    return unreadReport(connection.config.id, stored.length, safeFailureCode(error));
  }

  const counts = compareFacts(connection.config, stored, source);
  if (counts.storedFacts === 0 && counts.sourceFacts === 0) {
    return {
      connectionId: connection.config.id,
      counts,
      outcome: "unverified",
      unreadReason: null,
      unverifiedReason: "no_facts",
    };
  }
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
    unverifiedReason: null,
  };
}

function snapshotUnreadReason(snapshot: VerificationSnapshot): null | string {
  if (!snapshot.sourceTimeKeysValid) {
    return "store_source_time_invalid";
  }
  if (!snapshot.payloadHashesValid) {
    return "store_payload_invalid";
  }
  return snapshot.currentnessKnown ? null : "store_currentness_unknown";
}

function unreadReport(
  connectionId: string,
  storedFacts: number,
  unreadReason: string,
): VerificationConnectionReport {
  return {
    connectionId,
    counts: emptyCounts(storedFacts),
    outcome: "unread",
    unreadReason,
    unverifiedReason: null,
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
    case "unverified":
      return 4;
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
      continue;
    }
    if (sameVersion.length > 0) {
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
    const sameVersion = sourceByVersion.get(sourceVersionKey(storedFact));
    if (sameVersion !== undefined) {
      if (!sameVersion.some((sourceFact) => sourceFact.payloadHash === storedFact.payloadHash)) {
        counts.payloadMismatch += 1;
      }
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
    sourceTimeKey(fact),
  ]);
}

function isStrictlyNewerThanHistory(candidate: ComparableFact, history: ComparableFact[]): boolean {
  return history.length > 0 && history.every((fact) => isStrictlyNewer(candidate, fact));
}

function isStrictlyNewer(candidate: ComparableFact, prior: ComparableFact): boolean {
  const candidateTime = sourceTimeKey(candidate);
  const priorTime = sourceTimeKey(prior);
  return candidateTime !== null && priorTime !== null && candidateTime > priorTime;
}

function sourceTimeKey(fact: ComparableFact): null | string {
  return fact.sourceRecordedAt === null
    ? null
    : utcInstantOrderingKey(fact.sourceRecordedAt);
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
  const first = connections[0];
  if (first === undefined) {
    return "unverified";
  }
  return connections.some((connection) => connection.outcome !== first.outcome)
    ? "mixed"
    : first.outcome;
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
