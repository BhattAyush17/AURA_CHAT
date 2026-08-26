import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages().find((p) => p.url().startsWith("http://127.0.0.1:5173"));
if (!page) { console.log("NO PAGE"); process.exit(0); }
const r = await page.evaluate(() => ({
  rc2: !!window.__rc2,
  wrappedSR: !!window.__rc2WrappedSR,
  ttsWrapped: !!(window.speechSynthesis && window.speechSynthesis.__rc2wrapped),
  sttEvents: window.__rc2 ? window.__rc2.stt.length : -1,
  ttsEvents: window.__rc2 ? window.__rc2.tts.length : -1,
  brain: localStorage.getItem("aura_active_brain"),
  body: document.body.innerText.slice(0, 120).replace(/\n/g, " | "),
}));
console.log(JSON.stringify(r, null, 1));
await browser.close();
