import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  window.__log = [];
  if (!SR) { window.__log.push("NO SR API"); return; }
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.lang = "en-US";
  const evs = ["audiostart","soundstart","speechstart","speechend","soundend","audioend","result","nomatch","error","end","start"];
  for (const ev of evs) r["on" + ev] = (e) => window.__log.push(`${ev}${e && e.error ? ":" + e.error : ""}${ev === "result" ? ":t=" + (e.results[0] && e.results[0][0].transcript || "?") : ""}`);
  r.start();
  window.__log.push("start() at " + Date.now());
  const vc = () => { window.__log.push("voices: " + window.speechSynthesis.getVoices().length); };
  vc(); window.speechSynthesis.onvoiceschanged = vc; setTimeout(vc, 5000);
});
await page.waitForTimeout(15000);
const l = await page.evaluate(() => window.__log);
console.log("SR+TTS:", JSON.stringify(l, null, 0));
await page.close();
await browser.close();
