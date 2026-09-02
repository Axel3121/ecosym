// Exercise tabs + collapse and screenshot each. Run from app/: node scripts/tabs.mjs
import { chromium } from "@playwright/test";
const base = process.env.URL ?? "http://127.0.0.1:5179/";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(base); await p.waitForTimeout(1500);
const out = {};
for (const [k, key] of [["raadet", "r"], ["arbeid", "a"], ["petisjoner", "p"], ["oversikt", "o"]]) {
  await p.keyboard.press(key); await p.waitForTimeout(300);
  out[k] = await p.evaluate(() => ({ on: document.querySelector(".tab.on")?.textContent?.trim(), h: document.getElementById("desk-body").scrollHeight, text: document.getElementById("desk-body").innerText.slice(0, 120).replace(/\n/g, " | ") }));
  await p.screenshot({ path: `shots/tab-${k}.png` });
}
// decide on Rådet tab then check count badge
await p.keyboard.press("r"); await p.click('[data-decide="ja"][data-id="c1"]'); await p.waitForTimeout(200);
out.badge = await p.evaluate(() => document.querySelector('[data-tab="raadet"] .count')?.textContent);
// collapse
await p.keyboard.press("Alt+b"); await p.waitForTimeout(400);
out.collapsed = await p.evaluate(() => ({ cls: document.getElementById("app").className, deskW: document.getElementById("desk").getBoundingClientRect().width, canvasW: document.getElementById("chart").clientWidth, cw: document.getElementById("chart").width }));
await p.screenshot({ path: "shots/tab-collapsed.png" });
await p.click("#desk-toggle"); await p.waitForTimeout(400);
out.expanded = await p.evaluate(() => document.getElementById("desk").getBoundingClientRect().width);
console.log(JSON.stringify({ errs, ...out }, null, 1));
await b.close();
