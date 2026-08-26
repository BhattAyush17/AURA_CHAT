import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  window.__log = [];
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.continuous = false;
  r.interimResults = true;
  r.lang = "en-US";
  const t0 = performance.now();
  for (const ev of ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "result", "nomatch", "error", "end"]) {
    try {
      r["on" + ev] = (e) => {
        let extra = "";
        if (ev === "result") {
          const last = e.results[e.results.length - 1];
          extra = " text=" + JSON.stringify(last[0].transcript) + " final=" + last.isFinal;
        }
        if (ev === "error") extra = " err=" + e.error;
        window.__log.push(ev + " @" + Math.round(performance.now() - t0) + "ms" + extra);
      };
    } catch {}
  }
  r.start();
  window.__rec = r;
});
await page.waitForTimeout(15000);
const l = await page.evaluate(() => window.__log);
console.log("RAW BARE:", JSON.stringify(l, null, 1));
await page.close();
await browser.close();
