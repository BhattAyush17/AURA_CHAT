import { chromium } from "playwright";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__rc2 = { stt: [], srConstructed: 0, srStarted: 0 };
  const now = () => performance.now();
  const OrigSR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (OrigSR && !window.__rc2WrappedSR) {
    window.__rc2WrappedSR = true;
    const lastText = (e) => { try { const r = e.results && e.results[e.results.length - 1]; return r && r[0] ? { text: r[0].transcript, final: !!r.isFinal } : undefined; } catch { return undefined; } };
    const wrapInstance = (inst) => {
      window.__rc2.srConstructed++;
      let attached = false;
      const origStart = inst.start.bind(inst);
      inst.start = () => {
        window.__rc2.srStarted++;
        if (!attached) {
          attached = true;
          for (const ev of ["start", "audiostart", "speechstart", "result", "error", "end"]) {
            try { inst.addEventListener(ev, (e) => window.__rc2.stt.push({ ev, t: now(), text: ev === "result" ? lastText(e) : undefined, err: ev === "error" ? String(e && e.error) : undefined })); } catch {}
          }
        }
        return origStart();
      };
    };
    const Wrapped = new Proxy(OrigSR, { construct(target, args, newTarget) { const inst = Reflect.construct(target, args, newTarget); wrapInstance(inst); return inst; } });
    if (window.SpeechRecognition) window.SpeechRecognition = Wrapped;
    if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = Wrapped;
  }
});
await page.goto("http://127.0.0.1:5173/", { waitUntil: "load" });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  window.__log = [];
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.lang = "en-US";
  for (const ev of ["onstart", "onresult", "onerror", "onend"]) r[ev] = (e) => window.__log.push(ev + (ev === "result" ? ":t=" + (e.results[0] && e.results[0][0].transcript || "?") : ""));
  r.start();
});
await page.waitForTimeout(10000);
const l = await page.evaluate(() => ({ log: window.__log, stt: window.__rc2.stt.map((x) => x.ev), constructed: window.__rc2.srConstructed, started: window.__rc2.srStarted }));
console.log("WRAPPED v2:", JSON.stringify(l));
await page.close();
await browser.close();
