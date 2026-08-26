import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; RMX3371) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36" });
await ctx.grantPermissions(["microphone"], { origin: "http://localhost:5173" });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(async () => {
  window.__log = [];
  const log = (s) => window.__log.push(s);
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const an = ac.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  const meter = setInterval(() => {
    an.getFloatTimeDomainData(buf);
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
const peaks = rms.map((x) => parseFloat(x.slice(4))).sort((a, b) => b - a);
console.log("PEAK RMS top5:", peaks.slice(0, 5).join(" "));
console.log("EVENTS:", JSON.stringify(l.filter((x) => !x.startsWith("rms=")), null, 1));
await browser.close();
