import { parentPort, workerData } from "node:worker_threads";
import { ObservationStore } from "../src/store.ts";

const { directory, text, gate } = workerData as { directory: string; text: string; gate: SharedArrayBuffer };
const store = new ObservationStore(directory);
parentPort!.postMessage("ready");
Atomics.wait(new Int32Array(gate), 0, 0);
try {
  parentPort!.postMessage(await store.admitArenaBundle("arena", text));
} catch (error) {
  parentPort!.postMessage({ code: (error as { code: string }).code });
} finally {
  store.close();
}
