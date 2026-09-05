import { materializeFacts } from "./materialize.ts";
import { readSource } from "./readers.ts";
import { resolveLegacyRecordIndexMode } from "./record-index.ts";
import {
  createCollectionContentionBudget,
  type CollectionResult,
  ObservationStore,
  StoredRecordIndexModeUnknownError,
} from "./store.ts";

export interface CollectionReport {
  connectionId: string;
  result: CollectionResult;
}

export async function collectConnection(
  store: ObservationStore,
  connectionId: string,
): Promise<CollectionReport> {
  const contentionBudget = createCollectionContentionBudget();
  let connection = store.getConnection(connectionId);
  if (connection.jsonlRecordIndexMode === "unknown") {
    connection = await resolveLegacyRecordIndexMode(
      store,
      connection,
      contentionBudget,
    );
  }
  const recordIndexMode = connection.jsonlRecordIndexMode;
  if (recordIndexMode === "unknown") {
    throw new StoredRecordIndexModeUnknownError(connectionId);
  }
  const result = await store.collect(
    connection,
    async (sink) => {
      for await (const sourceRecord of readSource(
        connection.config,
        recordIndexMode,
      )) {
        sink.recordSourceRecord(() =>
          materializeFacts(connection.config, sourceRecord),
        );
      }
    },
    undefined,
    contentionBudget,
  );
  return { connectionId, result };
}
