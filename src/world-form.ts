import type { ConnectionStatus } from "./observation-snapshot.ts";
import { validateWorldSnapshot, WORLD_FACT_SEMANTICS_CAVEAT, type WorldSnapshot, type WorldSourcePicture } from "./world-snapshot.ts";

export interface WorldPlaceForm {
  declaration: WorldSnapshot["civilizations"][number];
  sourcePicture: WorldSourcePicture;
  id: string;
  name: string;
  domain: string;
  institution: WorldSnapshot["civilizations"][number]["mandate"]["status"];
  marks: { axis: "institution" | "collection" | "epistemic" | "temporal" | "attempt" | "limits" | "report"; kind: string; label: string }[];
  inspection: { label: string; values: string[] }[];
}

export interface WorldForm {
  snapshot: WorldSnapshot;
  /** No semantic terrain is supported by the contract. Neutral scene topology is a surface concern. */
  terrain: null;
  places: WorldPlaceForm[];
}

/** Validate and detach at the form boundary; a founding is never evidence of activity. */
export function worldForm(value: unknown): WorldForm {
  const snapshot = validateWorldSnapshot(value);
  const pictures = new Map(snapshot.sourcePictures.map((picture) => [picture.civilizationId, picture]));
  return {
    snapshot, terrain: null,
    places: snapshot.civilizations.map((declaration): WorldPlaceForm => {
      const sourcePicture = pictures.get(declaration.civilizationId)!;
      const institution = declaration.mandate.status;
      const institutionLabel = `Institution: ${institution}; declared state, not evidence of activity.`;
      const marks: WorldPlaceForm["marks"] = [{ axis: "institution", kind: institution, label: institutionLabel }];
      if (!declaration.bodyReadable || sourcePicture.sources.length === 0) {
        marks.push({ axis: "collection", kind: "unknown", label: declaration.bodyReadable
          ? "Collection unknown: no declared sources; not evidence of inactivity."
          : "Collection unknown: declaration body unreadable." });
      }
      for (const source of sourcePicture.sources) {
        if (source.sourceReport) {
          const report = source.sourceReport;
          marks.push({ axis: "report", kind: report.observation.state,
            label: `${source.connectionId}: Source-reported ${report.observation.state}; activity ${report.observation.activity} only in selected scope: ${report.selectedScope}. Not Ecosym collection health or domain inactivity.` });
          marks.push({ axis: "report", kind: "verification", label: `Source-reported verification: ${report.verification.status}; not Ecosym confirmation.` },
            { axis: "report", kind: "freshness", label: `Source-reported freshness: ${report.freshness.status}; not live source truth.` },
            { axis: "report", kind: "uncertainty", label: `Source-reported uncertainty: ${report.uncertainty.classification}.` });
        }
        const kind = source.collection?.status ?? "missing";
        marks.push({ axis: "collection", kind, label: `${source.connectionId}: ${kind}. ${source.collection === null
          ? "No active registered connection with this exact ID." : collectionMeaning[source.collection.reason]}` });
        for (const [epistemic, facts] of [["observation", source.observations], ["claim", source.claims]] as const) {
          if (facts.length === 0) continue;
          marks.push({ axis: "epistemic", kind: epistemic, label: `${source.connectionId}: ${epistemic} recorded.` });
          for (const temporal of new Set(facts.map((fact) => fact.temporalStatus))) {
            marks.push({ axis: "temporal", kind: temporal, label: `${source.connectionId}: ${epistemic}, ${temporal}; stored evidence, not live source truth.` });
          }
        }
        for (const attempt of source.attemptsInProgress) {
          marks.push({ axis: "attempt", kind: "in-progress", label: `${source.connectionId}: recorded in-progress attempt ${attempt.attemptId}; not proof of a live collector.` });
        }
      }
      if (snapshot.observationsTruncated) marks.push({ axis: "limits", kind: "observations-truncated", label: "Owner-wide observations truncated; per-source emptiness is unknown." });
      if (snapshot.claimsTruncated) marks.push({ axis: "limits", kind: "claims-truncated", label: "Owner-wide claims truncated; per-source emptiness is unknown." });
      const inspection: WorldPlaceForm["inspection"] = [
        { label: "Institution", values: [institutionLabel] },
        { label: "Civilization ID", values: [declaration.civilizationId] },
        { label: "Name", values: [declaration.name] },
        { label: "Founded at", values: [declaration.foundedAt] },
        { label: "Declaration body readable", values: [String(declaration.bodyReadable)] },
        { label: "Mandate status", values: [institution] },
        { label: "Mandate ID", values: [declaration.mandate.status === "unreadable" ? "unknown" : declaration.mandate.mandateId] },
        { label: "Mandate revision", values: [declaration.mandate.status === "unreadable" ? "unknown" : declaration.mandate.revision] },
        { label: "Mandate recorded at", values: [declaration.mandate.status === "unreadable" ? "unknown" : declaration.mandate.recordedAt] },
        { label: "Domain", values: [declaration.bodyReadable ? declaration.domain : "unknown"] },
      ];
      for (const key of ["sources", "mayActAlone", "mustEscalate"] as const) {
        inspection.push({ label: key, values: !declaration.bodyReadable ? ["unknown"]
          : declaration[key].length === 0 ? ["[]"] : [...declaration[key]] });
      }
      inspection.push(...inspectSourceFields(sourcePicture, snapshot));
      return { declaration, sourcePicture, id: declaration.civilizationId, name: declaration.name,
        domain: declaration.bodyReadable ? declaration.domain : "unknown", institution, marks, inspection };
    }),
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
    if (source.sourceReport) {
      fields.push({ label: `Source-reported metadata: ${source.connectionId}`, values: [
        "Latest locally admitted report, not newest external truth. Source-reported status is distinct from Ecosym collection health.",
        `Bundle fact count: ${source.sourceReport.factCount}; normal claims may include history or be truncated.`,
        JSON.stringify(source.sourceReport),
      ] });
    }
    for (const [label, facts, truncated] of [["Recorded source fields", source.observations, snapshot.observationsTruncated],
      ["Claims", source.claims, snapshot.claimsTruncated]] as const) {
      fields.push({ label: `${label}: ${source.connectionId}`, values: facts.length === 0
        ? [truncated ? "No entries returned; owner-wide truncation leaves this source's emptiness unknown."
          : "No collected entries in this returned picture; not evidence of no activity."]
        : facts.map((fact) => `${fact.epistemicStatus}: ${fact.factOwner} recorded ${fact.kind} for ${fact.subject}. ${fact.sourceReport ? `Source-reported epistemic type: ${fact.sourceReport.epistemicType}; Ecosym status remains claim. ` : ""}Source recorded time: ${fact.sourceRecordedAt ?? "unavailable"}. Temporal status: ${fact.temporalStatus}. ${JSON.stringify(fact)}${fact.sourceRecordedAt === null ? " Temporal status is not inferred from collection time." : ""}`) });
    }
  }
  return fields;
}
