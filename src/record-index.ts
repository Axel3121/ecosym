import { materializeFacts } from "./materialize.ts";
import {
  jsonlSourceMatchesRevision,
  readJsonlSourceWithRecordIndexModes,
} from "./readers.ts";
import {
  type ActiveConnection,
  type ContentionBudget,
  ObservationStore,
} from "./store.ts";

export async function resolveLegacyRecordIndexMode(
  store: ObservationStore,
  connection: ActiveConnection,
  contentionBudget?: ContentionBudget,
): Promise<ActiveConnection> {
  const persisted = store.getConnection(connection.config.id);
  store.assertConnectionActive(connection);
  if (persisted.jsonlRecordIndexMode !== "unknown") {
    return persisted;
  }

  const source = await readJsonlSourceWithRecordIndexModes(persisted.config);
  const physicalLineFacts = source.physicalLine.map((record) =>
    materializeFacts(persisted.config, record),
  );
  const recordOrdinalFacts = source.recordOrdinal.map((record) =>
    materializeFacts(persisted.config, record),
  );
  if (
    !(await store.resolveRecordIndexModeFromEquivalentFacts(
      persisted,
      physicalLineFacts,
      recordOrdinalFacts,
      () =>
        persisted.config.reader.type === "jsonl" &&
        jsonlSourceMatchesRevision(
          persisted.config.reader.path,
          source.revision,
        ),
      contentionBudget,
    ))
  ) {
    return persisted;
  }
  return store.getConnection(connection.config.id);
}
