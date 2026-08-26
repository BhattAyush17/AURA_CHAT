/**
 * AURA Gemini real-mic baseline harness.
 *
 * Connects to headless Chrome (CDP 9223), navigates to the Vite app, injects
 * the Gemini key, clicks the mic, and collects:
 *   - aura:trace events (TracePoint per stage + TraceSummary)
 *   - aura:latency events (roundTrip, interruptionStopMs, ...)
 *   - console logs (inputTranscription, TraceRuntime summaries, state logs)
 *
 * Usage: env -i PATH=/usr/bin:/bin HOME=$HOME GEMINI_KEY=... node scripts/gemini-baseline.mjs
 * Env: DURATION (ms, default 180000), OUT (default /tmp/opencode/gemini-baseline.json)
 */

import { writeFileSync } from "node:fs";

const KEY = process.env.GEMINI_KEY || "";
const URL = "http://127.0.0.1:5173/";
const DURATION = Number(process.env.DURATION || 180000);
const OUT = process.env.OUT || "/tmp/opencode/gemini-baseline.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageTarget() {
  const res = await fetch("http://127.0.0.1:9223/json/list");
  const list = await res.json();
  return list.find((t) => t.type === "page");
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { ws, send };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}

const page = await getPageTarget();
if (!page) {
  console.error("No page target found on 9223");
  process.exit(1);
}
const cdp = await connect(page);

await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Log.enable");

const consoleLogs = [];
const baseOnMessage = cdp.ws.onmessage;
cdp.ws.onmessage = (e) => {
  baseOnMessage(e);
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.consoleAPICalled") {
    const line = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
    consoleLogs.push({ t: Date.now(), line });
  }
};

await cdp.send("Page.navigate", { url: URL });
await sleep(5000);

await evaluate(
  cdp,
  `(() => {
     sessionStorage.setItem("aura_gemini_api_key", ${JSON.stringify(KEY)});
     window.__lat = [];
     window.__trace = [];
     window.addEventListener("aura:latency", (e) => window.__lat.push({ t: performance.now(), d: e.detail }));
     window.addEventListener("aura:trace", (e) => window.__trace.push({ t: performance.now(), d: e.detail }));
     return true;
   })()`,
);
await cdp.send("Page.reload");
await sleep(6000);

await evaluate(
  cdp,
  `(() => {
     window.__lat = [];
     window.__trace = [];
     window.addEventListener("aura:latency", (e) => window.__lat.push({ t: performance.now(), d: e.detail }));
     window.addEventListener("aura:trace", (e) => window.__trace.push({ t: performance.now(), d: e.detail }));
     return true;
   })()`,
);

const clicked = await evaluate(
  cdp,
  `(() => { const b = [...document.querySelectorAll("button")].find(x => x.className.includes("rounded-full")); if (b) { b.click(); return "clicked"; } return "no-button"; })()`,
);
console.log("[DRIVER] mic click:", clicked);

await sleep(DURATION);

const lat = await evaluate(cdp, `JSON.stringify(window.__lat)`);
const trace = await evaluate(cdp, `JSON.stringify(window.__trace)`);
const errBanner = await evaluate(
  cdp,
  `document.body.innerText.split("\\n").filter(l => /error|failed|key required/i.test(l)).slice(-6)`,
);
const statusText = await evaluate(
  cdp,
  `document.body.innerText.split("\\n").filter(l => /listening|speaking|thinking|connecting|failed|error/i.test(l)).slice(-5)`,
);

const data = {
  capturedAt: new Date().toISOString(),
  durationMs: DURATION,
  latency: JSON.parse(lat || "[]"),
  trace: JSON.parse(trace || "[]"),
  consoleLogs,
  statusText,
  errBanner,
};
writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log("[DRIVER] saved", OUT);
console.log("[DRIVER] latency events:", data.latency.length, "| trace events:", data.trace.length, "| status:", statusText, "| errors:", errBanner.filter(Boolean).length);
cdp.ws.close();
