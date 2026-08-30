import { existsSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

import { parseConnectionConfig } from "../../src/config.ts";
import { ConnectionConflictError, ObservationStore } from "../../src/store.ts";

const [stateDirectory, gatePath, encodedConfig] = process.argv.slice(2);
if (stateDirectory === undefined || gatePath === undefined || encodedConfig === undefined) {
  throw new Error("register-worker requires a state directory, gate, and configuration");
}

while (!existsSync(gatePath)) {
  await delay(2);
}

const store = new ObservationStore(stateDirectory);
try {
  const parsed = parseConnectionConfig(JSON.parse(encodedConfig) as unknown);
  try {
    const outcome = store.register(parsed);
    process.stdout.write(JSON.stringify({ outcome, hash: parsed.hash }));
  } catch (error) {
    if (error instanceof ConnectionConflictError) {
      process.stdout.write(JSON.stringify({ outcome: "conflict", hash: parsed.hash }));
    } else {
      throw error;
    }
  }
} finally {
  store.close();
}
