import { readFileSync, writeFileSync } from "node:fs";

const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((t) => t.type === "page" && t.url.includes("3000"));
if (!page) throw new Error("no AURA page target");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  setTimeout(() => rej(new Error("ws open timeout")), 5000);
});

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
    setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        rej(new Error(`timeout: ${method}`));
      }
    }, 15000);
  });
const evalv = async (expr) => {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const snap = async (label) => {
  const s = JSON.parse(
    (await evalv(`JSON.stringify(window.__audioProbe?.snapshot?.() ?? null)`)) ?? "null",
  );
  if (!s) {
    console.log(`[${label}] null snapshot`);
    return null;
  }
  console.log(
    `[${label}] ctx=${s.ctxCount} created=${s.createdNodes} active=${s.activeNodes} future=${s.futureNodes}${s.futureNodes ? `(+${s.futureHorizonMs}ms)` : ""} synth=${s.speechSynthesisSpeaks}`,
  );
  return s;
};

const phase = process.argv[2] ?? "verify";
const OUT = process.env.OUT;

if (phase === "reload") {
  await send("Page.reload");
  await sleep(9000);
  const probe = readFileSync(new URL("./audio-probe-inject.js", import.meta.url), "utf8");
  await evalv(probe);
  await sleep(500);
  await snap("after-reload");
  ws.close();
} else if (phase === "verify") {
  const probe = readFileSync(new URL("./audio-probe-inject.js", import.meta.url), "utf8");
  const exc = await evalv(probe);
  await sleep(500);
  const s = await snap("fresh");
  const hdr = await evalv(
    `JSON.stringify({ title: document.title, ready: document.readyState, root: !!document.getElementById("root"), url: location.href })`,
  );
  const hws = await send("Network.enable");
  let wsUrls = [];
  const wsHandler = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Network.webSocketCreated") wsUrls.push(m.params.url);
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  const orig = ws.onmessage;
  const combined = (e) => {
    wsHandler(e);
    orig(e);
  };
  ws.onmessage = combined;
  await sleep(3000);
  const result = { ...JSON.parse(hdr), snapshot: s, webSockets: wsUrls };
  console.log("VERIFY:", JSON.stringify(result, null, 1));
  if (OUT) require("node:fs").writeFileSync(OUT, JSON.stringify(result, null, 1));
  ws.close();
} else if (phase === "start") {
  const key = process.env.GEMINI_KEY || "";
  await evalv(`sessionStorage.setItem("aura_gemini_api_key", ${JSON.stringify(key)}); true`);
  await evalv(
    `(() => { const b = [...document.querySelectorAll("button")].find(x => x.className.includes("rounded-full")); if (b) { b.click(); return "clicked"; } return "no-button"; })()`,
  );
  console.log("mic clicked");
  for (let i = 0; i < 6; i++) {
    await sleep(10000);
    await snap(`t+${(i + 1) * 10}`);
    const st = await evalv(`document.body.innerText.slice(0, 120)`);
    console.log("  status:", JSON.stringify(st.split("\n")[0]));
  }
  ws.close();
} else if (phase === "latency") {
  await send("Runtime.enable");
  await send("Network.enable");
  const consoleLines = [];
  let wsFrames = 0;
  let wsLastFrameAt = 0;
  const onEvent = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.consoleAPICalled") {
      const args = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ");
      consoleLines.push({ t: Math.round(performance.now()), text: args.slice(0, 200) });
    }
    if (m.method === "Network.webSocketFrameReceived") {
      wsFrames++;
      wsLastFrameAt = Date.now();
    }
  };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method === "Runtime.consoleAPICalled" || m.method === "Network.webSocketFrameReceived")
      onEvent(e);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  await evalv(
    `window.__latencyEvents = []; window.addEventListener("aura:latency", (e) => window.__latencyEvents.push({ t: Math.round(performance.now()), detail: e.detail })); true`,
  );
  const key = process.env.GEMINI_KEY || "";
  await evalv(`sessionStorage.setItem("aura_gemini_api_key", ${JSON.stringify(key)}); true`);
  const already = await evalv(`document.body.innerText.slice(0, 40)`);
  if (!already.includes("GEMINI LIVE")) {
    await evalv(
      `(() => { const b = [...document.querySelectorAll("button")].find(x => x.className.includes("rounded-full")); if (b) { b.click(); return "clicked"; } return "no-button"; })()`,
    );
    console.log("latency run: mic clicked");
  } else {
    console.log("latency run: session already connected");
  }
  const totalMs = Number(process.env.DURATION ?? 90000);
  const startAt = Date.now();
  while (Date.now() - startAt < totalMs) {
    await sleep(5000);
    const st = await evalv(`document.body.innerText.slice(0, 40)`);
    await snap(`L+${Math.round((Date.now() - startAt) / 1000)}`);
    console.log("  status:", JSON.stringify(st.split("\n")[0]), "wsFrames:", wsFrames);
  }
  const evts = JSON.parse(await evalv(`JSON.stringify(window.__latencyEvents)`));
  const result = {
    durationMs: totalMs,
    wsFrames,
    wsLastFrameAt,
    latencyEvents: evts,
    console: consoleLines,
  };
  if (OUT) writeFileSync(OUT, JSON.stringify(result, null, 1));
  console.log(
    `WROTE ${OUT} events=${evts.length} consoleLines=${consoleLines.length} wsFrames=${wsFrames}`,
  );
  ws.close();
}
