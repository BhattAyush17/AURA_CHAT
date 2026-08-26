import { chromium } from "playwright";
import fs from "node:fs";
const src = fs.readFileSync("scripts/phase14/rc2-mobile-bench.mjs", "utf8");
const m = src.match(/const INJECT = \(k\) => `([\s\S]*?)`;/);
if (!m) { console.log("MATCH FAIL"); process.exit(1); }
const KEY = "sk-or-v1-test";
const inject = eval("(" + m[1].replace(/\$\{JSON\.stringify\(k\)\}/, JSON.stringify(KEY)) + ")")();
try { new Function(inject); console.log("syntax OK, length:", inject.length); }
catch (e) { console.log("SYNTAX ERROR:", e.message); }
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().startsWith("http://127.0.0.1:5173")) ?? (await ctx.newPage());
await page.addInitScript(inject);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(4000);
const r = await page.evaluate(() => ({ rc2: typeof window.__rc2, sync: typeof window.__rc2Sync, sr: typeof window.__rc2WrappedSR, tts: typeof window.speechSynthesis.__rc2wrapped, brain: localStorage.getItem("aura_active_brain"), key: (sessionStorage.getItem("openrouter_api_key")||"").slice(0,8) }));
console.log("injected:", JSON.stringify(r));
await browser.close();
