export function arenaBundle() {
  const at = "2026-09-01T12:00:00Z";
  const digest = `sha256:${"a".repeat(64)}`;
  return {
    schemaVersion: 1, bundleId: "bundle-one",
    source: { sourceId: "source", owner: "Synthetic Owner", system: "Synthetic", endpoint: "https://example.invalid/feed", selectedScope: "selected synthetic records", license: "synthetic" },
    observation: { state: "observed", attemptedAt: at, completedAt: at, activity: "present", scopeComplete: true },
    provenance: { inputs: [{ inputId: "input", role: "feed", uri: "https://example.invalid/feed", retrievalStatus: "retrieved", retrievedAt: at, mediaType: "application/json", digest, failureCode: null }] },
    processing: {
      pipeline: { name: "synthetic", version: "1" },
      rules: [{ ruleId: "rule", name: "synthetic", version: "1", status: "completed" }],
      models: ["extraction", "critique"].map((role) => ({ modelRunId: role, role, provider: "synthetic", modelId: "synthetic", configurationVersion: "1", status: "completed", outputDigest: digest })),
    },
    verification: { status: "partially_verified", scope: "provenance_and_representation", checkedAt: at, methods: [{ methodId: "method", name: "synthetic", version: "1" }], notes: "private note" },
    freshness: { status: "current", basis: "source_timestamp", evaluatedAt: at, sourceAsOf: at, validUntil: "2026-09-02T12:00:00Z" },
    uncertainty: { classification: "unknown", dimensions: [{ kind: "coverage", level: "unknown", description: "private uncertainty" }] },
    facts: [{ factId: "fact", epistemicType: "observation", factOwner: "External Owner", kind: "alert", subject: "synthetic subject", sourceRecordedAt: at, validFrom: at, validUntil: null, inputRefs: ["input"], processingRefs: ["rule", "extraction"], payload: { private: "OWNER-PRIVATE-PAYLOAD" } }],
    producedAt: at,
  };
}
