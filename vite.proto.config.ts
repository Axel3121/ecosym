import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Design prototype: fixture data only, never the world server. */
export default defineConfig({
  root: fileURLToPath(new URL("./proto/", import.meta.url)),
  plugins: [react()],
  envDir: false,
  publicDir: false,
  server: { host: "127.0.0.1", port: 5174, strictPort: true, cors: false },
  preview: { host: "127.0.0.1", port: 4175, strictPort: true },
  build: { outDir: fileURLToPath(new URL("./dist/proto/", import.meta.url)), emptyOutDir: true, sourcemap: false, assetsInlineLimit: 0 },
});
