import { materializeFacts } from "./materialize.ts";
import { readSource } from "./readers.ts";
import { type CollectionResult, ObservationStore } from "./store.ts";

export interface CollectionReport {
  connectionId: string;
  result: CollectionResult;
}

export async function collectConnection(
  store: ObservationStore,
  connectionId: string,
): Promise<CollectionReport> {
  const connection = store.getConnection(connectionId);
  const result = await store.collect(connection, async (sink) => {
    for await (const sourceRecord of readSource(
      connection.config,
      connection.jsonlRecordIndexMode,
    )) {
      sink.recordSourceRecord(() => materializeFacts(connection.config, sourceRecord));
    }
  });
  return { connectionId, result };
}
