import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:5173/";
const OUT = "runs/phase14-audit.json";
const report = { timestamp: new Date().toISOString(), sections: {} };

function attachCollectors(page) {
  const errs = { console: [], page: [], http4xx5xx: [], cors: [] };
  page.on("console", (m) => {
    if (m.type() === "error") errs.console.push(m.text().slice(0, 300));
    if (m.type() === "warning" && /CORS|cross-origin/i.test(m.text())) errs.cors.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => errs.page.push(String(e).slice(0, 300)));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 400) errs.http4xx5xx.push(`${s} ${r.url().slice(0, 150)}`);
  });
  return errs;
}

async function loadTiming(page) {
  const timing = await page.evaluate(() => {
    const t = performance.getEntriesByType("navigation")[0];
    return {
      ttfb: Math.round(t.responseStart),
      dcl: Math.round(t.domContentLoadedEventEnd),
      load: Math.round(t.loadEventEnd),
      transfer: Math.round(t.transferSize / 1024) + "KB",
    };
  });
  const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1024 / 1024));
  return { ...timing, heapMB: heap };
}

async function perfSection() {
  const browser = await chromium.launch({ headless: true });
  const out = [];
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage();
    const errs = attachCollectors(page);
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(6000);
    out.push(await loadTiming(page));
    out[i].consoleErrors = errs.console.length;
    out[i].httpErrors = errs.http4xx5xx.length;
    await page.close();
  }
  await browser.close();
  report.sections.performance = out;
}

async function soakSection() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = attachCollectors(page);
  await page.goto(BASE, { waitUntil: "load" });
  const heartbeats = [];
  for (let i = 1; i <= 6; i++) {
    await page.waitForTimeout(30000);
    heartbeats.push({ t: `${i * 30}s`, heapMB: await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)), alive: true });
  }
  await browser.close();
  report.sections.soak = { duration: "180s", heartbeats, errors: errs };
}

async function networkSection() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = attachCollectors(page);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.context().setOffline(true);
  await page.waitForTimeout(3000);
  const duringOffline = errs.console.length + errs.page.length;
  await page.context().setOffline(false);
  await page.waitForTimeout(5000);
  report.sections.network = {
    errorsWhileOffline: duringOffline,
    errorsAfterReconnect: errs.console.length + errs.page.length - duringOffline,
    pageAliveAfterReconnect: await page.evaluate(() => document.readyState),
    sampleErrors: errs.console.slice(0, 5),
  };
  await browser.close();
}

async function mobileSection() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errs = attachCollectors(page);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const layout = await page.evaluate(() => ({
    hScroll: document.documentElement.scrollWidth > window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  const mic = page.locator("button").filter({ has: page.locator("svg") }).first();
  await mic.click().catch(() => {});
  await page.waitForTimeout(3000);
  const statusText = await page.locator("div.mt-6").first().textContent().catch(() => "(none)");
  report.sections.mobile = { layout, consoleErrors: errs.console.length, statusText: statusText?.trim() };
  await browser.close();
}

async function voiceSection() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const page = await browser.newPage();
  await page.context().grantPermissions(["microphone"], { origin: "http://localhost:5173" });
  const apiKey = process.env.AURA_TEST_OPENROUTER_KEY;
  if (apiKey) {
    await page.addInitScript((k) => {
      sessionStorage.setItem("openrouter_api_key", k);
      localStorage.setItem("aura_active_brain", "openrouter");
    }, apiKey);
  }
  const errs = attachCollectors(page);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(6000);
  const mic = page.locator('button[class*="h-28 w-28"]');
  const sessionLog = [];
  page.on("console", (m) => {
    if (/Starting session|Ending session|Watchdog|\[AURA\]/.test(m.text())) sessionLog.push(m.text().slice(0, 100));
  });
  await mic.click();
  const transitions = [];
  const toks = ["tap mic to begin", "connecting", "listening", "thinking", "aura is speaking"];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(1500);
    const body = await page.evaluate(() => document.body.innerText);
    const present = toks.filter((t) => body.toLowerCase().includes(t));
    const t = present[present.length - 1] || "(none)";
    if (transitions[transitions.length - 1] !== t) transitions.push(t);
  }
  report.sections.voice = { statusTransitions: transitions, sessionLog: sessionLog.slice(0, 8), errors: { console: errs.console, page: errs.page } };
  await browser.close();
}

async function a11ySection() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  const a11y = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    return {
      buttonsWithoutAriaOrText: buttons.filter((b) => !(b.getAttribute("aria-label") || b.textContent.trim())).length,
      focusableCount: [...document.querySelectorAll("button, a[href], input, [tabindex]")].length,
      hasLiveRegion: [...document.querySelectorAll('[aria-live]')].length > 0,
    };
  });
  report.sections.a11y = a11y;
  await browser.close();
}

await perfSection();
await soakSection();
await networkSection();
await mobileSection();
await voiceSection();
await a11ySection();

fs.mkdirSync("runs", { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log("=== PHASE 14 AUDIT SUMMARY ===");
console.log("PERF:", JSON.stringify(report.sections.performance.map((p) => ({ ttfb: p.ttfb, dcl: p.dcl, load: p.load, heap: p.heapMB + "MB", errs: p.consoleErrors })), null, 1));
console.log("SOAK heap:", report.sections.soak.heartbeats.map((h) => h.heapMB + "MB").join(" -> "), "| console errs:", report.sections.soak.errors.console.length, "| http errs:", report.sections.soak.errors.http4xx5xx.length);
console.log("NETWORK:", JSON.stringify(report.sections.network));
console.log("MOBILE:", JSON.stringify(report.sections.mobile));
console.log("VOICE:", JSON.stringify(report.sections.voice.statusTransitions), "| errs:", report.sections.voice.errors.console.length);
console.log("A11Y:", JSON.stringify(report.sections.a11y));
