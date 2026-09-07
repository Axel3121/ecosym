import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./web/", import.meta.url)),
  plugins: [react()],
  // No environment files or static copy directory enter the browser bundle.
  envDir: false,
  publicDir: false,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    fs: { strict: true, allow: [fileURLToPath(new URL("./web/", import.meta.url))] },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist/world/", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
});
