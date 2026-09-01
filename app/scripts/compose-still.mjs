// Compose one still of the world level from real art + the scene's truth layer.
// Run: node scripts/compose-still.mjs  → shots/still-world.png
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileSync } from "node:fs";

const W = 1536, H = 1024;
const c = createCanvas(W, H); const g = c.getContext("2d");
g.imageSmoothingEnabled = false;
const world = await loadImage("public/art/world.png");
const fog = await loadImage("public/art/fog.png");
const smoke = await loadImage("public/art/smoke.png");
const walkers = await loadImage("public/art/walkers.png");
g.drawImage(world, 0, 0);

// anchors measured on world.png
const places = {
  capital: { x: 760, y: 460, r: 230 },
  roma:    { x: 230, y: 220, r: 170, live: true },   // harbor
  midgard: { x: 1180, y: 155, r: 200, live: true },  // hill
  edo:     { x: 1240, y: 545, r: 230, live: false }, // orchard, quiet
  thule:   { x: 260, y: 730, r: 150, unobserved: true }, // lake, fog
};

// smoke only where something runs (frame 0 of the sheet, ~100px wide cells)
function puff(x, y, s = 0.35) { g.drawImage(smoke, 18, 10, 100, 270, x - 50 * s, y - 270 * s, 100 * s, 270 * s); }
puff(200, 190); puff(255, 215); puff(1170, 130); puff(1205, 170);

// walkers only where something runs (row 3 = side view, cell 1)
function walker(x, y, row = 2, col = 0, s = 0.22) {
  const cx = [100, 400, 660, 960][col], cy = [60, 360, 660, 940][row];
  g.drawImage(walkers, cx, cy, 200, 240, x - 100 * s, y - 240 * s, 200 * s, 240 * s);
}
walker(215, 255, 2, 0); walker(260, 240, 3, 1); walker(1165, 190, 2, 2); walker(1200, 175, 0, 1);

// fog over the unobserved place
const t = places.thule;
g.globalAlpha = 0.92;
g.drawImage(fog, t.x - t.r * 1.6, t.y - t.r * 1.1, t.r * 3.2, t.r * 2.2);
g.globalAlpha = 0.6;
g.drawImage(fog, t.x - t.r * 1.2, t.y - t.r * 0.6, t.r * 2.4, t.r * 1.6);
g.globalAlpha = 1;

// seal red marks only for council matters (roma:2, edo:1) — small pennant above the hall
function pennant(x, y, n) {
  g.fillStyle = "#9c3524";
  for (let i = 0; i < n; i++) { g.fillRect(x + i * 10, y, 3, 14); g.beginPath(); g.moveTo(x + i * 10 + 3, y); g.lineTo(x + i * 10 + 12, y + 4); g.lineTo(x + i * 10 + 3, y + 8); g.fill(); }
}
pennant(228, 100, 2); pennant(1225, 440, 1);

writeFileSync("shots/still-world.png", c.toBuffer("image/png"));
console.log("wrote shots/still-world.png");
