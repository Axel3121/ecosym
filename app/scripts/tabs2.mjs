// Threads + settings end to end. Run from app/: node scripts/tabs2.mjs
import { chromium } from "@playwright/test";
const base = process.env.URL ?? "http://127.0.0.1:5179/";
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(base); await p.waitForTimeout(1500);
const out = { errs };
// talk to Curia, say two things, leave
await p.keyboard.press("1"); await p.waitForTimeout(300);
await p.click("[data-talk-civ=roma]"); await p.waitForTimeout(500);
await p.fill("#focus-input", "hva driver dere med?"); await p.keyboard.press("Enter"); await p.waitForTimeout(600);
await p.fill("#focus-input", "legg PS5-kontrollere på watchlisten"); await p.keyboard.press("Enter"); await p.waitForTimeout(600);
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
// talk to council too
await p.keyboard.press("c"); await p.waitForTimeout(300);
await p.click("[data-talk-council]"); await p.waitForTimeout(400);
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
// Samtaler tab
await p.keyboard.press("s"); await p.waitForTimeout(300);
out.samtaler = await p.evaluate(() => ({ badge: document.querySelector('[data-tab="samtaler"] .count')?.textContent, rows: [...document.querySelectorAll(".thr")].map((r) => r.innerText.replace(/\n/g, " | ").slice(0, 140)) }));
await p.screenshot({ path: "shots/tab-samtaler.png" });
// resume the Curia thread: history replays, then a new line lands
await p.click('[data-resume="seat:roma"]'); await p.waitForTimeout(400);
out.resumedLines = await p.evaluate(() => document.querySelectorAll("#focus-thread .msg").length);
await p.fill("#focus-input", "hvorfor?"); await p.keyboard.press("Enter"); await p.waitForTimeout(600);
await p.keyboard.press("Escape"); await p.waitForTimeout(200);
out.afterMore = await p.evaluate(() => document.querySelectorAll(".thr")[0]?.innerText.includes("3 meldinger"));
// Innstillinger: labels off, width wide, persist across reload
await p.keyboard.press("i"); await p.waitForTimeout(300);
await p.screenshot({ path: "shots/tab-innstillinger.png" });
await p.click('[data-set="labels"] + .sw'); await p.waitForTimeout(100);
await p.click('[data-seg="deskWidth"][data-val="400"]'); await p.waitForTimeout(400);
out.settingsLive = await p.evaluate(() => ({ labels: window.__ecosym.chart.showLabels, deskW: document.getElementById("desk").getBoundingClientRect().width, cw: document.getElementById("chart").width, cssw: document.getElementById("chart").clientWidth }));
await p.reload(); await p.waitForTimeout(1200);
out.settingsPersist = await p.evaluate(() => ({ labels: window.__ecosym.chart.showLabels, deskW: document.getElementById("desk").getBoundingClientRect().width, stored: localStorage.getItem("ecosym.settings") }));
await p.screenshot({ path: "shots/tab-nolabels.png" });
// tabs bar fits at 300 wide?
await p.evaluate(() => { localStorage.setItem("ecosym.settings", JSON.stringify({ deskWidth: 300 })); }); await p.reload(); await p.waitForTimeout(1000);
out.narrow = await p.evaluate(() => { const t = document.getElementById("desk-tabs"); return { sw: t.scrollWidth, cw: t.clientWidth }; });
await p.evaluate(() => localStorage.removeItem("ecosym.settings"));
console.log(JSON.stringify(out, null, 1));
await b.close();
