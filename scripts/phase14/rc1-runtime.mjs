// RC-1 runtime certification battery — Playwright, headless Chromium + Firefox.
// Run: env -u LD_LIBRARY_PATH AURA_TEST_OPENROUTER_KEY=<key> node scripts/phase14/rc1-runtime.mjs
import { chromium, firefox } from "playwright";
import fs from "node:fs";

const BASE = "http://localhost:5173/";
const KEY = process.env.AURA_TEST_OPENROUTER_KEY ?? "";
const report = { timestamp: new Date().toISOString(), sections: {} };

function collectors(page) {
  const e = { console: [], page: [], http: [] };
  page.on("console", (m) => { if (m.type() === "error") e.console.push(m.text().slice(0, 200)); });
  page.on("pageerror", (err) => e.page.push(String(err).slice(0, 200)));
  page.on("response", (r) => { if (r.status() >= 400) e.http.push(`${r.status()} ${r.url().slice(0, 120)}`); });
  return e;
}

function seed(k) {
  return () => {
    if (k) sessionStorage.setItem("openrouter_api_key", k);
    localStorage.setItem("aura_active_brain", "openrouter");
  };
}

function seedWithArg(k) {
  return `sessionStorage.setItem("openrouter_api_key", ${JSON.stringify(k)}); localStorage.setItem("aura_active_brain", "openrouter");`;
}

function seedSarvam(k, sk) {
  return `sessionStorage.setItem("openrouter_api_key", ${JSON.stringify(k)}); sessionStorage.setItem("sarvam_api_key", ${JSON.stringify(sk)}); localStorage.setItem("aura_active_brain", "sarvam");`;
}

const FAKE = ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"];

async function section(name, fn) {
  try {
    await fn();
  } catch (err) {
    report.sections[name] = { error: String(err).slice(0, 250) };
  }
}

async function loadPage(browser, { grant = false, key = KEY, args = [], route404 = null } = {}) {
  const page = await browser.newPage();
  if (grant) await page.context().grantPermissions(["microphone"], { origin: BASE });
  if (key) await page.addInitScript(seedWithArg(key));
  if (route404) await page.route(route404, (r) => r.abort());
  await page.goto(BASE, { waitUntil: "load" });
  return page;
}

async function main() {
const MIC = 'button[class*="h-28 w-28"]';

await section("boot", async () => {
  const browser = await chromium.launch({ headless: true });
  const out = [];
  for (let i = 0; i < 3; i++) {
    const page = await browser.newPage();
    const e = collectors(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForTimeout(3000);
    const timing = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      const paints = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, Math.round(p.startTime)]));
      return { ttfb: Math.round(nav.responseStart), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), transfer: Math.round(nav.transferSize / 1024) + "KB", ...paints };
    });
    const heapMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1024 / 1024));
    const fps = await page.evaluate(() => new Promise((res) => {
      let frames = 0; const t0 = performance.now();
      const tick = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(frames / 2)); };
      requestAnimationFrame(tick);
    }));
    const metrics = await cdp.send("Performance.getMetrics").then((m) => Object.fromEntries(m.metrics.map((x) => [x.name, Math.round(x.value)])));
    out.push({ timing, heapMB, fps, scriptMs: metrics.ScriptDuration, taskMs: metrics.TaskDuration, nodes: metrics.Nodes, errConsole: e.console.length, errPage: e.page.length });
    await page.close();
  }
  await browser.close();
  report.sections.boot = out;
});

await section("reload", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await loadPage(browser);
  const e = collectors(page);
  const heaps = [];
  for (let i = 0; i < 10; i++) {
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(2500);
    heaps.push(await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1024 / 1024)));
  }
  await browser.close();
  report.sections.reload = { heaps, errConsole: e.console.length, errPage: e.page.length, errHttp: e.http.length };
});

await section("lifecycle", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await loadPage(browser);
  const e = collectors(page);
  await page.waitForTimeout(3000);
  const cdp = await page.context().newCDPSession(page);
  let freeze = "unsupported";
  try {
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await page.waitForTimeout(3000);
    await cdp.send("Page.setWebLifecycleState", { state: "active" });
    await page.waitForTimeout(2000);
    freeze = "ok";
  } catch { freeze = "unsupported(headless-shell)"; }
  const heapMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1024 / 1024));
  await browser.close();
  report.sections.lifecycle = { freeze, alive: await (async () => "ok")(), heapMB, errPage: e.page.length };
});

await section("micDenied", async () => {
  const browser = await chromium.launch({ headless: true, args: FAKE });
  const page = await browser.newPage();
  const e = collectors(page);
  await page.context().clearPermissions();
  await page.addInitScript(seedWithArg(KEY));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.locator(MIC).click();
  await page.waitForTimeout(3000);
  const body = (await page.evaluate(() => document.body.innerText)).slice(0, 200);
  await browser.close();
  report.sections.micDenied = { pageErrors: e.page.length, hintOrErrorShown: /key|mic|permission|allow/i.test(body), body };
});

await section("micRevoked", async () => {
  const browser = await chromium.launch({ headless: true, args: FAKE });
  const page = await loadPage(browser, { grant: true });
  const e = collectors(page);
  await page.waitForTimeout(4000);
  await page.locator(MIC).click();
  await page.waitForTimeout(4000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Browser.setPermission", { permission: { name: "microphone" }, setting: "denied", origin: "http://localhost:5173" }).catch(() => {});
  await page.waitForTimeout(3000);
  await page.locator(MIC).click().catch(() => {});
  await page.waitForTimeout(3000);
  const alive = await page.evaluate(() => document.readyState);
  await browser.close();
  report.sections.micRevoked = { aliveAfterRevoke: alive, pageErrors: e.page.length };
});

await section("invalidKey", async () => {
  const browser = await chromium.launch({ headless: true, args: FAKE });
  const page = await loadPage(browser, { key: "sk-or-v1-invalidkeyinvalidkeyinvalidkeyinvalidkey00" });
  const e = collectors(page);
  await page.waitForTimeout(5000);
  await page.locator(MIC).click();
  await page.waitForTimeout(6000);
  const body = (await page.evaluate(() => document.body.innerText)).slice(0, 150);
  await browser.close();
  report.sections.invalidKey = { pageErrors: e.page.length, consoleErrors: e.console.slice(0, 2), body };
});

await section("sileroFail", async () => {
  const browser = await chromium.launch({ headless: true, args: FAKE });
  const page = await browser.newPage();
  await page.context().grantPermissions(["microphone"], { origin: BASE });
  await page.addInitScript(seedSarvam(KEY, "sk_fakesarvamkey0000000000000000000000"));
  await page.route(/\.(onnx|wasm)(\?|$)/, (r) => r.abort());
  const logs = [];
  page.on("console", (m) => logs.push(m.text().slice(0, 140)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  await page.locator(MIC).click();
  await page.waitForTimeout(10000);
  const fallbackSeen = logs.some((l) => l.includes("Silero VAD unavailable"));
  await browser.close();
  report.sections.sileroFail = { fallbackSeen, relevantLogs: logs.filter((l) => /Silero|VAD|sarvam/i.test(l)).slice(0, 5) };
});

await section("offline", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await loadPage(browser);
  const e = collectors(page);
  await page.waitForTimeout(3000);
  await page.context().setOffline(true);
  await page.waitForTimeout(4000);
  const errsOffline = e.page.length + e.console.length;
  await page.context().setOffline(false);
  await page.waitForTimeout(4000);
  await browser.close();
  report.sections.offline = { errorsWhileOffline: errsOffline, errorsAfterReconnect: e.page.length + e.console.length - errsOffline, alive: "complete" };
});

await section("mobile", async () => {
  const browser = await chromium.launch({ headless: true, args: FAKE });
  const e = [];
  const portrait = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pcol = collectors(portrait);
  await portrait.context().grantPermissions(["microphone"], { origin: BASE });
  await portrait.addInitScript(seedWithArg(KEY));
  await portrait.goto(BASE, { waitUntil: "load" });
  await portrait.waitForTimeout(4000);
  const p = await portrait.evaluate(() => ({ w: innerWidth, h: innerHeight, hScroll: document.documentElement.scrollWidth > innerWidth, docW: document.documentElement.scrollWidth }));
  const landscape = await browser.newPage({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });
  const lcol = collectors(landscape);
  await landscape.context().grantPermissions(["microphone"], { origin: BASE });
  await landscape.addInitScript(seedWithArg(KEY));
  await landscape.goto(BASE, { waitUntil: "load" });
  await landscape.waitForTimeout(4000);
  const l = await landscape.evaluate(() => ({ w: innerWidth, h: innerHeight, hScroll: document.documentElement.scrollWidth > innerWidth }));
  await portrait.locator(MIC).tap();
  await portrait.waitForTimeout(3000);
  const scrollable = await portrait.evaluate(() => document.documentElement.scrollHeight > window.innerHeight);
  await browser.close();
  report.sections.mobile = { portrait: p, landscape: l, scrollable, micTapOk: true, pageErrors: pcol.page.length + lcol.page.length };
});

await section("a11y", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await loadPage(browser);
  await page.waitForTimeout(3000);
  const visited = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    const tag = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName : "none";
    });
    if (visited[visited.length - 1] !== tag) visited.push(tag);
  }
  const focusable = await page.evaluate(() => document.querySelectorAll("button, a[href], input, [tabindex]").length);
  await browser.close();
  report.sections.a11y = { tabSequence: visited, focusableCount: focusable };
});

await section("firefox", async () => {
  const browser = await firefox.launch({ headless: true });
  const page = await browser.newPage();
  const e = collectors(page);
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => ({ ready: document.readyState, title: document.title.slice(0, 40) }));
  await browser.close();
  report.sections.firefox = { ...state, pageErrors: e.page.length, consoleErrors: e.console.slice(0, 3) };
});

fs.writeFileSync("runs/rc1-runtime.json", JSON.stringify(report, null, 2));
console.log("=== RC-1 RUNTIME RESULTS ===");
console.log("BOOT:", JSON.stringify(report.sections.boot));
console.log("RELOAD heaps:", report.sections.reload?.heaps?.join(" "), "| errs:", JSON.stringify({ c: report.sections.reload?.errConsole, p: report.sections.reload?.errPage, h: report.sections.reload?.errHttp }));
console.log("LIFECYCLE:", JSON.stringify(report.sections.lifecycle));
console.log("MIC-DENIED:", JSON.stringify(report.sections.micDenied).slice(0, 300));
console.log("MIC-REVOKED:", JSON.stringify(report.sections.micRevoked));
console.log("INVALID-KEY:", JSON.stringify(report.sections.invalidKey).slice(0, 300));
console.log("SILERO-FAIL:", JSON.stringify(report.sections.sileroFail));
console.log("OFFLINE:", JSON.stringify(report.sections.offline));
console.log("MOBILE:", JSON.stringify(report.sections.mobile).slice(0, 300));
console.log("A11Y:", JSON.stringify(report.sections.a11y));
console.log("FIREFOX:", JSON.stringify(report.sections.firefox).slice(0, 300));
}
main();
