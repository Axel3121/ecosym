import { copyFileSync, mkdirSync } from "node:fs";

const root = new URL("../dist/world/", import.meta.url);
mkdirSync(root, { recursive: true });
for (const file of ["index.html", "world.css"]) {
  copyFileSync(new URL(`../web/${file}`, import.meta.url), new URL(file, root));
}
