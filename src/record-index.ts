import { materializeFacts } from "./materialize.ts";
import { readSource, type JsonlRecordIndexMode } from "./readers.ts";
import {
  type ActiveConnection,
  type FactInput,
  ObservationStore,
} from "./store.ts";

export async function resolveLegacyRecordIndexMode(
  store: ObservationStore,
  connection: ActiveConnection,
): Promise<ActiveConnection> {
  const persisted = store.getConnection(connection.config.id);
  store.assertConnectionActive(connection);
  if (persisted.jsonlRecordIndexMode !== "unknown") {
    return persisted;
  }

  const physicalLineFacts = await factsUnderMode(persisted, "physical-line");
  const recordOrdinalFacts = await factsUnderMode(persisted, "record-ordinal");
  if (
    !store.resolveRecordIndexModeFromEquivalentFacts(
      persisted,
      physicalLineFacts,
      recordOrdinalFacts,
    )
  ) {
    return persisted;
  }
  return store.getConnection(connection.config.id);
}

async function factsUnderMode(
  connection: ActiveConnection,
  mode: JsonlRecordIndexMode,
): Promise<FactInput[]> {
  const facts: FactInput[] = [];
  for await (const sourceRecord of readSource(connection.config, mode)) {
    facts.push(...materializeFacts(connection.config, sourceRecord));
  }
  return facts;
}
