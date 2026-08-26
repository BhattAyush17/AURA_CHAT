/**
 * AURA Gemini Realtime Latency Benchmark Harness.
 *
 * Connects to headless Chrome (CDP 9223), navigates to the Vite app, injects
 * the Gemini key, clicks the mic, and collects GeminiTimingTrace events.
 *
 * Usage: env -i PATH=/usr/bin:/bin HOME=$HOME GEMINI_KEY=... node scripts/measure-gemini-realtime.mjs
 * Env: DURATION (ms, default 30000), OUT (default /tmp/opencode/gemini-realtime-events.json)
 */

import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const KEY = process.env.GEMINI_KEY || "";
const URL = process.env.URL || "http://127.0.0.1:3000/";
const DURATION = Number(process.env.DURATION || 30000);
const OUT = process.env.OUT || "gemini-realtime-events.json";

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
     if (window.__GEMINI_TRACE__) {
       window.__GEMINI_TRACE__.clear();
     }
     return true;
   })()`
);
await cdp.send("Page.reload");
await sleep(6000);

await evaluate(
  cdp,
  `(() => {
     if (window.__GEMINI_TRACE__) {
       window.__GEMINI_TRACE__.clear();
     }
     return true;
   })()`
);

const clicked = await evaluate(
  cdp,
  `(() => { const b = [...document.querySelectorAll("button")].find(x => x.className.includes("rounded-full")); if (b) { b.click(); return "clicked"; } return "no-button"; })()`
);
console.log("[DRIVER] mic click:", clicked);

console.log(`[DRIVER] Listening for ${DURATION}ms...`);
await sleep(DURATION);

const traceEventsStr = await evaluate(cdp, `window.__GEMINI_TRACE__ ? window.__GEMINI_TRACE__.dump() : "[]"`);
const errBanner = await evaluate(
  cdp,
  `document.body.innerText.split("\\n").filter(l => /error|failed|key required/i.test(l)).slice(-6)`
);
const statusText = await evaluate(
  cdp,
  `document.body.innerText.split("\\n").filter(l => /listening|speaking|thinking|connecting|failed|error/i.test(l)).slice(-5)`
);

const trace = JSON.parse(traceEventsStr || "[]");

const data = {
  capturedAt: new Date().toISOString(),
  durationMs: DURATION,
  trace,
  consoleLogs,
  statusText,
  errBanner,
};

writeFileSync(OUT, JSON.stringify(data, null, 2));
console.log("[DRIVER] saved", OUT);
console.log("[DRIVER] trace events:", trace.length, "| status:", statusText, "| errors:", errBanner.filter(Boolean).length);

// Generate benchmark summary
const turns = {};
for (const ev of trace) {
    if (!turns[ev.turnId]) turns[ev.turnId] = {};
    turns[ev.turnId][ev.event] = ev.timestamp;
}

const benchmarkReport = {
    metadata: {
        timestamp: new Date().toISOString(),
        total_turns_analyzed: Object.keys(turns).length
    },
    latency_breakdown: []
};

for (const turnId of Object.keys(turns)) {
    const t = turns[turnId];
    if (t['USER_TURN_START'] && t['PLAYBACK_STARTED'] || (t['FIRST_RESPONSE_AUDIO_BYTE'] || t['FIRST_RESPONSE_AUDIO_CHUNK'] || t['PLAYBACK_SCHEDULED'])) {
        const e2e = (t['PLAYBACK_STARTED'] || t['PLAYBACK_SCHEDULED'] || t['FIRST_RESPONSE_AUDIO_BYTE'] || t['FIRST_RESPONSE_AUDIO_CHUNK']) - t['USER_TURN_START'];
        const cognition = t['COGNITION_COMPLETE'] ? (t['COGNITION_COMPLETE'] - t['COGNITION_START']) : null;
        const decision = t['DECISION_COMPLETE'] ? (t['DECISION_COMPLETE'] - t['DECISION_START']) : null;
        const geminiTtfb = t['FIRST_RESPONSE_AUDIO_BYTE'] ? (t['FIRST_RESPONSE_AUDIO_BYTE'] - t['GEMINI_REQUEST_SENT']) : null;
        
        benchmarkReport.latency_breakdown.push({
            turn_id: turnId,
            e2e_latency_ms: e2e,
            cognition_ms: cognition,
            decision_ms: decision,
            gemini_ttfb_ms: geminiTtfb
        });
    }
}

writeFileSync("gemini-realtime-benchmark.json", JSON.stringify(benchmarkReport, null, 2));
console.log("[DRIVER] saved gemini-realtime-benchmark.json");

cdp.ws.close();
