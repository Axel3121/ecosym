import { materializeFacts } from "./materialize.ts";
import { readSource } from "./readers.ts";
import {
  type CollectionResult,
  type ConnectionStatus,
  ObservationStore,
} from "./store.ts";

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
    for await (const sourceRecord of readSource(connection.config)) {
      sink.recordSourceRecord();
      for (const fact of materializeFacts(connection.config, sourceRecord)) {
        sink.writeFact(fact);
      }
    }
  });
  return { connectionId, result };
}

export async function collectAll(store: ObservationStore): Promise<CollectionReport[]> {
  const reports: CollectionReport[] = [];
  for (const connection of store.listConnections()) {
    reports.push(await collectConnection(store, connection.config.id));
  }
  return reports;
}

export function connectionStatuses(store: ObservationStore): ConnectionStatus[] {
  return store.statuses();
}
