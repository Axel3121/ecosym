import type { ConnectionStatus } from "./observation-snapshot.ts";
import { WORLD_FACT_SEMANTICS_CAVEAT, type WorldSnapshot, type WorldSourcePicture } from "./world-snapshot.ts";

export interface WorldForm {
  snapshot: WorldSnapshot;
  /** No semantic terrain is supported by the contract. Neutral scene topology is a surface concern. */
  terrain: null;
  places: { declaration: WorldSnapshot["civilizations"][number]; sourcePicture: WorldSourcePicture }[];
}

/** Retain validated contract objects; a founding is a place, never evidence of activity. */
export function worldForm(snapshot: WorldSnapshot): WorldForm {
  const pictures = new Map(snapshot.sourcePictures.map((picture) => [picture.civilizationId, picture]));
  return {
    snapshot, terrain: null,
    places: snapshot.civilizations.map((declaration) => ({ declaration, sourcePicture: pictures.get(declaration.civilizationId)! })),
  };
}

const collectionMeaning = {
  collected: "Successfully saw new or changed stored facts; not operational success.",
  "nothing-new": "Successfully read with no new or changed facts: quiet only in the collection picture.",
  "never-run": "Unread: no collection attempt in this active configuration/activation lifetime. Retained facts may belong to a prior activation.",
  incomplete: "Unread: the latest attempt has no recorded completion. An in-progress record does not prove a collector is still alive.",
  failed: "Unread: the latest collection attempt failed. Retained facts do not establish a fresh read or source absence.",
  retired: "Unread: the latest collection attempt was explicitly retired, not completed as a successful read.",
  skipped: "Unread: the latest collection attempt was skipped, not a successful read.",
  "record-index-unknown": "Unread: the stored JSONL record-index interpretation is unknown; record identity cannot be reliably interpreted until resolved.",
} satisfies Record<ConnectionStatus["reason"], string>;

/** Pure form projection of validated evidence; none changes population, activity or terrain. */
export function inspectSourceFields(picture: WorldSourcePicture, snapshot: WorldSnapshot): { label: string; values: string[] }[] {
  const civilization = snapshot.civilizations.find((entry) => entry.civilizationId === picture.civilizationId)!;
  const fields = [
    { label: "Source semantics", values: [WORLD_FACT_SEMANTICS_CAVEAT] },
    { label: "Stored picture limits", values: [
      `observationsTruncated: ${snapshot.observationsTruncated}; claimsTruncated: ${snapshot.claimsTruncated}`,
      snapshot.observationsTruncated ? "Observations are truncated across active connections; per-source emptiness is unknown."
        : "Observations are not truncated across active connections.",
      snapshot.claimsTruncated ? "Claims are truncated across active connections; per-source emptiness is unknown."
        : "Claims are not truncated across active connections.",
      "Limits apply across active connections, not just this civilization. Reload after collecting to see a new picture.",
    ] },
  ];
  if (!civilization.bodyReadable) {
    fields.push({ label: "Sources unknown", values: ["The declaration could not be read; no source links can be established."] });
  } else if (picture.sources.length === 0) {
    fields.push({ label: "No declared sources", values: ["Founded, with no declared observation source. This does not establish inactivity."] });
  }
  for (const source of picture.sources) {
    const collection = source.collection;
    fields.push({ label: `Collection picture: ${source.connectionId}`, values: [
      "Collection metadata is owned by Ecosym's observation store, not an external observation.",
      collection === null ? "Missing registered source: no active connection with this exact ID."
        : collectionMeaning[collection.reason],
      JSON.stringify(collection),
      `attemptsInProgress: ${JSON.stringify(source.attemptsInProgress)}`,
    ] });
    for (const [label, facts, truncated] of [["Recorded source fields", source.observations, snapshot.observationsTruncated],
      ["Claims", source.claims, snapshot.claimsTruncated]] as const) {
      fields.push({ label: `${label}: ${source.connectionId}`, values: facts.length === 0
        ? [truncated ? "No entries returned; owner-wide truncation leaves this source's emptiness unknown."
          : "No collected entries in this returned picture; not evidence of no activity."]
        : facts.map((fact) => `${fact.epistemicStatus}: ${fact.factOwner} recorded ${fact.kind} for ${fact.subject}. Source recorded time: ${fact.sourceRecordedAt ?? "unavailable"}. Temporal status: ${fact.temporalStatus}. ${JSON.stringify(fact)}${fact.sourceRecordedAt === null ? " Temporal status is not inferred from collection time." : ""}`) });
    }
  }
  return fields;
}
