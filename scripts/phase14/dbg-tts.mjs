import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome", headless: false });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; RMX3371) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36" });
const page = await ctx.newPage();
await page.goto("http://localhost:5173/", { waitUntil: "load" });
await page.waitForTimeout(2000);
await page.evaluate(async () => {
  window.__l = [];
  const log = (s) => window.__l.push(s);
  const waitVoices = async () => {
    if (speechSynthesis.getVoices().length) return speechSynthesis.getVoices().length;
    return await new Promise((res) => {
      speechSynthesis.onvoiceschanged = () => res(speechSynthesis.getVoices().length);
      setTimeout(() => res(-1), 4000);
    });
  };
  log("voices0=" + speechSynthesis.getVoices().length);
  const nv = await waitVoices();
  log("voicesAfterWait=" + nv);
  const u = new SpeechSynthesisUtterance("Hello there, testing one two three");
  u.lang = "en-US";
  for (const ev of ["start", "end", "error"]) try { u.addEventListener(ev, (e) => log("tts:" + ev)); } catch {}
  try {
    speechSynthesis.speak(u);
    log("speak() called ok");
  } catch (e) {
    log("speak() THREW: " + String(e));
  }
});
await page.waitForTimeout(8000);
const l = await page.evaluate(() => window.__l);
console.log(JSON.stringify(l, null, 1));
await browser.close();
