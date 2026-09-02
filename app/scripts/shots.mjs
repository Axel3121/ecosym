// Screenshot the three camera states for visual review. Run: node scripts/shots.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = process.env.URL ?? "http://127.0.0.1:5179/";
mkdirSync("shots", { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base);
await page.waitForFunction(() => document.fonts.status === "loaded");
await page.waitForTimeout(1500);
await page.screenshot({ path: "shots/1-chart.png" });

await page.evaluate(() => window.__ecosym.select({ kind: "capital", label: "Capital" }));
await page.waitForTimeout(1000);
await page.screenshot({ path: "shots/2-capital.png" });

await page.evaluate(() => window.__ecosym.select({ kind: "settlement", settlementId: "roma", label: "Roma" }));
await page.waitForTimeout(1200);
await page.screenshot({ path: "shots/3-roma.png" });

await page.evaluate(() => window.__ecosym.select({ kind: "seat", settlementId: "roma", label: "Curia" }));
await page.waitForTimeout(300);
await page.screenshot({ path: "shots/4-curia.png" });

await page.evaluate(() => { window.__ecosym.select(null); window.__ecosym.flyTo(280, 850, 1.6); });
await page.waitForTimeout(1200);
await page.screenshot({ path: "shots/5-thule-unobserved.png" });

console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
