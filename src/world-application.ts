import type { FoundedCivilizationSnapshot } from "./institution-snapshot.ts";
import type { NarrationSnapshot } from "./observation-snapshot.ts";
import { validateWorldSnapshot, WORLD_SNAPSHOT_SCHEMA_VERSION, type WorldSnapshot } from "./world-snapshot.ts";

export interface WorldSnapshotSource {
  listFoundedCivilizations(): FoundedCivilizationSnapshot[];
  narrate(limit?: number): NarrationSnapshot;
}

/** Compose owner snapshots only; never collect, query external sources, or infer name-based links. */
export function composeWorldSnapshot(source: WorldSnapshotSource, limit?: number): WorldSnapshot {
  const civilizations = source.listFoundedCivilizations();
  const narration = source.narrate(limit);
  const connections = new Map(narration.connections.map((entry) => [entry.connectionId, entry]));
  if (connections.size !== narration.connections.length) throw new Error("Duplicate narration connection ID");
  const reports = new Map((narration.sourceReports ?? []).map((entry) => [entry.connectionId, entry]));
  if (reports.size !== (narration.sourceReports ?? []).length) throw new Error("Duplicate narration source report");
  return validateWorldSnapshot({
    schemaVersion: WORLD_SNAPSHOT_SCHEMA_VERSION,
    civilizations,
    sourcePictures: civilizations.map((civilization) => ({
      civilizationId: civilization.civilizationId,
      sources: [...new Set(civilization.sources)].map((connectionId) => ({
        connectionId,
        collection: connections.get(connectionId) ?? null,
        attemptsInProgress: narration.attemptsInProgress.filter((entry) => entry.connectionId === connectionId),
        observations: narration.observations.filter((entry) => entry.connectionId === connectionId),
        claims: narration.claims.filter((entry) => entry.connectionId === connectionId),
        ...(reports.has(connectionId) ? { sourceReport: reports.get(connectionId) } : {}),
      })),
    })),
    observationsTruncated: narration.observationsTruncated,
    claimsTruncated: narration.claimsTruncated,
  });
}
