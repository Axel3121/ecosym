import { setTimeout as delay } from "node:timers/promises";

import { ObservationStore } from "../../src/store.ts";

const [stateDirectory, connectionId] = process.argv.slice(2);
if (stateDirectory === undefined || connectionId === undefined) {
  throw new Error("interrupted-collection-worker requires state directory and connection id");
}

const store = new ObservationStore(stateDirectory);
const connection = store.getConnection(connectionId);
await store.collect(connection, async (sink) => {
  sink.recordSourceRecord(() => [
    {
      epistemicStatus: "observation",
      factOwner: connection.config.factOwner,
      kind: "example.value",
      payload: { value: 1 },
      sourceRecordedAt: "2026-08-30T00:00:00.000Z",
      sourceRecordId: "interrupted-record",
      subject: "subject-a",
    },
  ]);
  process.stdout.write("ready\n");
  while (true) {
    await delay(60_000);
  }
});
