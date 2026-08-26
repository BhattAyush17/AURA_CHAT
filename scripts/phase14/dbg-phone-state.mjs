import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctxs = browser.contexts();
const ctx = ctxs[0];
const page = (await ctx.pages()).find((p) => p.url().includes("5173")) ?? (await ctx.newPage());
const r = await page.evaluate(() => ({
  url: location.href,
  key: (sessionStorage.getItem("openrouter_api_key") || "").slice(0, 20),
  keyLen: (sessionStorage.getItem("openrouter_api_key") || "").length,
  sk: (sessionStorage.getItem("sarvam_api_key") || "").slice(0, 10),
  brain: localStorage.getItem("aura_active_brain"),
  rc2: window.__rc2 ? { boot: window.__rc2.boot, srC: window.__rc2.srConstructed, srS: window.__rc2.srStarted, stt: window.__rc2.stt.length, tts: window.__rc2.tts.length } : null,
  body: document.body.innerText.slice(0, 150).replace(/\n/g, " | "),
  vis: document.visibilityState,
  micBtn: !!document.querySelector('button[class*="h-28 w-28"]'),
}));
console.log(JSON.stringify(r, null, 1));
await browser.close();
