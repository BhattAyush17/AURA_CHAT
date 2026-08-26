import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().startsWith("http://127.0.0.1:5173")) ?? (await ctx.newPage());
await page.addInitScript("(() => { window.__dbg = { ok: 1, p: performance.now() }; window.__dbgSync = () => 42; })();");
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(4000);
console.log("result:", await page.evaluate(() => JSON.stringify(window.__dbg)));
await browser.close();
