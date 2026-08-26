import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
const devs = await page.evaluate(async () => {
  const ds = await navigator.mediaDevices.enumerateDevices();
  return ds.filter((d) => d.kind === "audioinput").map((d) => ({ label: d.label, id: d.deviceId }));
});
console.log("AUDIO INPUTS:", JSON.stringify(devs));
for (const d of devs) {
  const r = await page.evaluate(async ({ deviceId, label }) => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
    const ac = new AudioContext();
    const src = ac.createMediaStreamSource(stream);
    const an = ac.createAnalyser();
    an.fftSize = 1024;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let peak = 0, sum = 0, n = 0;
    await new Promise((res) => {
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let rms = 0;
        for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
        rms = Math.sqrt(rms / buf.length);
        if (rms > peak) peak = rms;
        sum += rms; n++;
        if (n >= 12) { clearInterval(iv); res(); }
      }, 500);
    });
    stream.getTracks().forEach((t) => t.stop());
    return { label, peak, mean: sum / n };
  }, d);
  console.log("DEVICE:", JSON.stringify({ label: r.label, peak: r.peak.toFixed(4), mean: r.mean.toFixed(4) }));
}
await page.close();
await browser.close();
