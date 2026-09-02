import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto("http://127.0.0.1:5179/"); await p.waitForTimeout(1200);
const out = { errs };
// P0: select while on Innstillinger -> talk button must exist
await p.keyboard.press("i"); await p.keyboard.press("1"); await p.waitForTimeout(300);
out.p0 = await p.evaluate(() => ({ tab: document.querySelector(".tab.on")?.dataset.tab, talk: !!document.querySelector("[data-talk-civ=roma]") }));
// full mode: labelled way back
await p.keyboard.press("Alt+f"); await p.waitForTimeout(300);
out.showMap = await p.evaluate(() => { const e = document.querySelector(".show-map"); return e && getComputedStyle(e).display !== "none" ? e.textContent : null; });
await p.click(".show-map"); await p.waitForTimeout(300);
out.afterShowMap = await p.evaluate(() => document.getElementById("app").className);
// collapsed: letter under glyph
await p.keyboard.press("Alt+b"); await p.waitForTimeout(300);
out.keys = await p.evaluate(() => [...document.querySelectorAll(".tab .key")].filter((k) => getComputedStyle(k).display !== "none").map((k) => k.textContent).join(""));
await p.screenshot({ path: "shots/v3-collapsed.png" });
await p.keyboard.press("Alt+b"); await p.waitForTimeout(300);
// contrast of --fg-faint
out.faint = await p.evaluate(() => { const L = (c) => { const [r, g, b] = c.match(/\d+/g).map((n) => { n /= 255; return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }; const fg = getComputedStyle(document.documentElement).getPropertyValue("--fg-faint").trim(); const d = document.createElement("div"); d.style.color = fg; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); const bg = getComputedStyle(document.getElementById("desk")).backgroundColor; return ((Math.max(L(c), L(bg)) + 0.05) / (Math.min(L(c), L(bg)) + 0.05)).toFixed(2); });
// tab overflow at widths
out.overflow = {};
for (const w of [300, 340, 400]) {
  await p.evaluate((w) => localStorage.setItem("ecosym.settings", JSON.stringify({ labels: true, smoke: true, logLimit: 30, deskWidth: w, language: "nb" })), w);
  await p.reload(); await p.waitForTimeout(800);
  out.overflow[w] = await p.evaluate(() => { const t = document.getElementById("desk-tabs"); return t.scrollWidth - t.clientWidth; });
}
await p.evaluate(() => localStorage.removeItem("ecosym.settings"));
await p.reload(); await p.waitForTimeout(800); await p.keyboard.press("Alt+f"); await p.keyboard.press("r"); await p.waitForTimeout(300);
await p.screenshot({ path: "shots/v3-full.png" });
console.log(JSON.stringify(out, null, 1)); await b.close();
