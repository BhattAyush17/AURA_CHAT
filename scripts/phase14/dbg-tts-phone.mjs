import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
const r = await page.evaluate(async () => {
  const nv = await new Promise((res) => {
    if (speechSynthesis.getVoices().length) return res(speechSynthesis.getVoices().length);
    speechSynthesis.onvoiceschanged = () => res(speechSynthesis.getVoices().length);
    setTimeout(() => res(-1), 4000);
  });
  const u = new SpeechSynthesisUtterance("Hello from Aura. This is a voice test.");
  u.lang = "en-US";
  u.volume = 1;
  const t0 = performance.now();
  const events = [];
  const done = new Promise((res) => {
    const t = setTimeout(() => res("timeout"), 15000);
    u.onstart = () => { events.push("start@" + Math.round(performance.now() - t0)); };
    u.onend = () => { events.push("end@" + Math.round(performance.now() - t0)); clearTimeout(t); res("complete"); };
    u.onerror = (e) => { events.push("error=" + e.error + "@" + Math.round(performance.now() - t0)); clearTimeout(t); res("error"); };
  });
  speechSynthesis.speak(u);
  const outcome = await done;
  return { voices: nv, outcome, events, paused: speechSynthesis.paused, pending: speechSynthesis.pending, speaking: speechSynthesis.speaking };
});
console.log(JSON.stringify(r, null, 1));
await page.close();
await browser.close();
