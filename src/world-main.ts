import { fileURLToPath } from "node:url";

import { ObservationStore } from "./store.ts";
import { createWorldServer } from "./world-server.ts";

const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--port"
  || !/^\d+$/u.test(args[1]!) || Number(args[1]) > 65535)) {
  console.error("Bruk: world-main.ts [--port 0-65535]");
  process.exitCode = 1;
} else {
  const store = new ObservationStore();
  const server = createWorldServer(store, fileURLToPath(new URL("../dist/world/", import.meta.url)));
  let closed = false;
  const closeStore = () => {
    if (!closed) { closed = true; store.close(); }
  };
  const shutdown = () => { server.close(); server.closeAllConnections(); };
  server.once("close", () => {
    closeStore();
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  });
  server.once("error", () => {
    console.error("Verdensserveren kunne ikke startes");
    closeStore();
    process.exitCode = 1;
    shutdown();
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  server.listen(args.length === 0 ? 0 : Number(args[1]), "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string") console.log(`http://127.0.0.1:${address.port}`);
  });
}
