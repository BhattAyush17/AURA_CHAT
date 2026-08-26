import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(async () => {
  window.__log = [];
  const log = (s) => window.__log.push(s);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let peak = 0;
  const meter = setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms > peak) peak = rms;
    log("rms=" + rms.toFixed(4));
  }, 500);
  log("MIC_STREAM_ACQUIRED");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = "en-US";
  const t0 = performance.now();
  for (const ev of ["start", "audiostart", "soundstart", "speechstart", "result", "nomatch", "error", "end"]) {
    try {
      r["on" + ev] = (e) => {
        let extra = "";
        if (ev === "result") {
          const last = e.results[e.results.length - 1];
          extra = " text=" + JSON.stringify(last[0].transcript) + " final=" + last.isFinal;
        }
        if (ev === "error") extra = " err=" + e.error;
        log(ev + " @" + Math.round(performance.now() - t0) + "ms" + extra);
      };
    } catch {}
  }
  log("SR_STARTING");
  r.start();
  window.__stop = () => { clearInterval(meter); stream.getTracks().forEach((t) => t.stop()); };
});
await page.waitForTimeout(15000);
const l = await page.evaluate(() => { window.__stop(); return window.__log; });
const rms = l.filter((x) => x.startsWith("rms="));
const nonRms = l.filter((x) => !x.startsWith("rms="));
const peaks = rms.map((x) => parseFloat(x.slice(4))).sort((a, b) => b - a);
console.log("PEAK RMS top5:", peaks.slice(0, 5).join(" "));
console.log("EVENTS:", JSON.stringify(nonRms, null, 1));
await page.close();
await browser.close();
