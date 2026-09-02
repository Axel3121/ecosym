// Drive the focus-mode conversation and screenshot it. Run: URL=... node scripts/talk.mjs
import { chromium } from "@playwright/test";
const base = process.env.URL ?? "http://127.0.0.1:5179/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(base); await page.waitForTimeout(1500);

// open Roma sheet, click "Snakk med Curia"
await page.evaluate(() => window.__ecosym.select({ kind: "settlement", settlementId: "roma", label: "Roma" }));
await page.waitForTimeout(400);
await page.click("[data-talk-civ=roma]");
await page.waitForTimeout(1200);
const ask = async (t) => { await page.fill("#focus-input", t); await page.press("#focus-input", "Enter"); await page.waitForTimeout(600); };
await ask("hva driver dere med?");
await ask("legg PS5-kontrollere på watchlisten");
await ask("kontakt selgeren av den billigste");
await page.screenshot({ path: "shots/6-talk-curia.png" });
const lines = await page.$$eval("#focus-thread .msg", (els) => els.map((e) => e.className.replace("msg ", "") + ": " + e.textContent));
console.log(lines.join("\n"));

await page.click("#focus-back"); await page.waitForTimeout(300);
await page.evaluate(() => window.__ecosym.focus({ kind: "council" }));
await page.waitForTimeout(1200);
await ask("hva vil roma?");
await page.screenshot({ path: "shots/7-talk-council.png" });
console.log(JSON.stringify({ errors }));
await browser.close();
