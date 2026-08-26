// RC-2 — Mobile Voice Latency Benchmark harness.
// Drives REAL Chrome on Android via CDP (adb forward), speaks through the REAL phone mic.
// No app code is modified. Instrumentation is injected via addInitScript (measurement only).
//
// Run: env -u LD_LIBRARY_PATH AURA_TEST_OPENROUTER_KEY=<key> node scripts/phase14/rc2-mobile-bench.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import { execSync } from "node:child_process";

const APP_URL = "http://127.0.0.1:5173/"; // adb reverse maps to host:5173
const DESKTOP_URL = "http://localhost:5173/";
const CDP_URL = "http://127.0.0.1:9222";
let KEY = process.env.AURA_TEST_OPENROUTER_KEY ?? "";
let SARVAM_KEY = process.env.AURA_TEST_SARVAM_KEY ?? "";
if (!KEY || !SARVAM_KEY) {
  // Fallback: read keys straight from .env.local (shell grep -P is unreliable).
  try {
    const env = fs.readFileSync(".env.local", "utf8");
    for (const line of env.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (!m) continue;
      const [_, name, val] = m;
      const v = val.replace(/^["']|["']$/g, "");
      if (name === "OPENROUTER_API_KEY" && !KEY) KEY = v;
      if (name === "SARVAM_API_KEY" && !SARVAM_KEY) SARVAM_KEY = v;
    }
  } catch {}
}
const BRAIN = process.env.AURA_TEST_BRAIN ?? "openrouter";
const DESKTOP = process.env.RC2_DEVICE === "desktop";
const DESKTOP_UA = "Mozilla/5.0 (Linux; Android 14; RMX3371) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";

const SCENARIOS = [
  { id: "greeting", cue: "Hey Aura.", timeoutMs: 30000 },
  { id: "question", cue: "What's the weather like?", timeoutMs: 30000 },
  { id: "long_sentence", cue: "Tell a 15-second story — keep talking the whole time.", timeoutMs: 60000 },
  { id: "emotional", cue: "I'm really exhausted today.", timeoutMs: 30000 },
  { id: "interruption", cue: "Speak NOW, then interrupt Aura while it replies.", timeoutMs: 60000, waitForSpeech: true },
  { id: "fast_followup", cue: "Ask a question; then ask another question within 1 second of Aura finishing.", timeoutMs: 60000, followup: true },
  { id: "silence", cue: "Say one sentence with a deliberate 4-second pause in the middle.", timeoutMs: 45000 },
  { id: "hinglish", cue: "Aaj office bahut hectic tha yaar.", timeoutMs: 30000 },
  { id: "noise", cue: "Speak while a fan or music plays in the background.", timeoutMs: 30000 },
  { id: "whisper", cue: "Whisper softly: 'Hey Aura, are you there?'", timeoutMs: 30000 },
];

function INJECT(cfg) {
  const k = cfg?.k, brain = cfg?.brain, sk = cfg?.sk;
  if (k) sessionStorage.setItem("openrouter_api_key", k);
  if (brain === "sarvam") {
    localStorage.setItem("aura_active_brain", "sarvam");
    if (sk) sessionStorage.setItem("sarvam_api_key", sk);
  } else {
    localStorage.setItem("aura_active_brain", "openrouter");
  }
  window.__rc2 = { boot: performance.now(), stt: [], tts: [], phase: "idle", srConstructed: 0, srStarted: 0 };
  const now = () => performance.now();
  // --- SpeechRecognition wrapper (T1,T2,T4,T5) ---
  // NOTE: must NOT subclass SpeechRecognition (breaks Chrome's WebIDL engine).
  // Proxy on construct: wrap the REAL instance's handlers.
  const OrigSR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (OrigSR && !window.__rc2WrappedSR) {
    window.__rc2WrappedSR = true;
    const lastText = (e) => {
      try {
        const r = e.results && e.results[e.results.length - 1];
        return r && r[0] ? { text: r[0].transcript, final: !!r.isFinal } : undefined;
      } catch { return undefined; }
    };
    const wrapInstance = (inst) => {
      window.__rc2.srConstructed++;
      let attached = false;
      const origStart = inst.start.bind(inst);
      inst.start = () => {
        window.__rc2.srStarted++;
        if (!attached) {
          attached = true;
          for (const ev of ["start", "audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "result", "nomatch", "error", "end"]) {
            try {
              inst.addEventListener(ev, (e) => window.__rc2.stt.push({
                ev, t: now(), text: ev === "result" ? lastText(e) : undefined, err: ev === "error" ? String(e && e.error) : undefined,
              }));
            } catch {}
          }
        }
        return origStart();
      };
    };
    const Wrapped = new Proxy(OrigSR, {
      construct(target, args, newTarget) {
        const inst = Reflect.construct(target, args, newTarget);
        wrapInstance(inst);
        return inst;
      },
    });
    if (window.SpeechRecognition) window.SpeechRecognition = Wrapped;
    if (window.webkitSpeechRecognition) window.webkitSpeechRecognition = Wrapped;
  }
  // --- speechSynthesis wrapper (T13,T15,T16) ---
  try {
    const ss = window.speechSynthesis;
    if (ss && !ss.__rc2wrapped) {
      ss.__rc2wrapped = true;
      const orig = ss.speak.bind(ss);
      ss.speak = function (u) {
        window.__rc2.tts.push({ ev: "request", t: now(), text: (u && u.text || "").slice(0, 80) });
        const on = (ev, getErr) => { try { u.addEventListener(ev, (e) => window.__rc2.tts.push({ ev, t: now(), err: getErr ? String(e?.error) : undefined })); } catch {} };
        on("start"); on("end"); on("error", true);
        return orig(u);
      };
    }
  } catch {}
  // clock sync marker
  window.__rc2Sync = () => ({ d: Date.now(), p: performance.now() });
}

function sh(cmd) { return execSync(cmd, { encoding: "utf8", stderr: "ignore" }).trim(); }

function curlJson(url) {
  const out = execSync(`curl -s --max-time 5 ${url}`, { encoding: "utf8", stderr: "ignore" }).trim();
  return JSON.parse(out);
}

function log(...a) { console.log(new Date().toISOString().slice(11, 23), ...a); }

const report = { timestamp: new Date().toISOString(), device: {}, browser: {}, scenarios: {} };
const SMOKE = process.env.RC2_SMOKE === "1";
const DEBUG = process.env.RC2_DEBUG === "1";
for (const s of SCENARIOS) s.timeoutMs = Math.max(60000, s.timeoutMs);
const SCEN = SMOKE ? SCENARIOS.slice(0, 1) : SCENARIOS;
const RUNS_PER = SMOKE ? 1 : 5;

// ---- 1. Prepare adb plumbing + Chrome ----
function setupDevice() {
  const dev = sh("adb devices | awk 'NR>1 && $2==\"device\" {print $1}' | head -1");
  if (!dev) throw new Error("No authorized Android device. Accept the RSA prompt on the phone.");
  report.device.serial = dev;
  sh("adb reverse tcp:5173 tcp:5173");
  sh("adb reverse tcp:9222 tcp:9222");
  report.device.reverse = "tcp:5173 + tcp:9222 forwarded";
  // Brave / Samsung Internet also expose chrome_devtools_remote — kill them so
  // the forward lands on real Chrome, not an ad-blocking fork.
  for (const pkg of ["com.android.chrome", "com.brave.browser", "com.sec.android.app.sbrowser"]) {
    sh(`adb shell am force-stop ${pkg}`);
  }
  sh(`adb shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d "${APP_URL}"`);
  sh("adb forward --remove tcp:9222 2>/dev/null; adb forward tcp:9222 localabstract:chrome_devtools_remote");
  let ver = null;
  for (let i = 0; i < 20 && !ver; i++) {
    try {
      ver = curlJson("http://127.0.0.1:9222/json/version");
      if (ver && ver["Android-Package"] !== "com.android.chrome") ver = null;
    } catch { execSync("sleep 1", { encoding: "utf8", stderr: "ignore" }); }
  }
  if (!ver) throw new Error("Chrome CDP socket never appeared on the phone.");
  report.browser = { name: ver.Browser, protocol: ver["Protocol-Version"], package: ver["Android-Package"] };
  log("Browser:", ver.Browser, "| pkg:", ver["Android-Package"]);
  return dev;
}

function epochAt(page, tPage) {
  return tPage + offset;
}
let offset = 0;

async function attach() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const ctxs = browser.contexts();
  const ctx = ctxs[0] ?? (await browser.newContext());
  // Prefer a VISIBLE app tab (Chrome's foreground tab from `am start`).
  // A fresh CDP-created tab stays backgrounded on Android → page hidden →
  // the app parks its mic/STT pipeline ("Tab hidden" console, srConstructed=0).
  let page = null;
  for (const p of ctx.pages()) {
    if (!p.url().startsWith("http://127.0.0.1:5173")) continue;
    try { if ((await p.evaluate(() => document.visibilityState)) === "visible") { page = p; break; } } catch {}
  }
  if (!page) {
    for (const p of ctx.pages()) if (p.url().startsWith("http://127.0.0.1:5173")) { try { await p.close(); } catch {} }
    page = await ctx.newPage();
  }
  // Force the chosen tab to the foreground — a backgrounded Android tab
  // parks the app's mic/STT pipeline ("Tab hidden" console, srConstructed=0).
  try {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Page.bringToFront");
  } catch {}
  let vis = "unknown";
  try { vis = await page.evaluate(() => document.visibilityState); } catch {}
  log("Tab visibility:", vis);
  return { browser, page };
}

async function main() {
  let browser, page;
  if (DESKTOP) {
    browser = await chromium.launch({ channel: "chrome", headless: false });
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true,
      userAgent: DESKTOP_UA,
    });
    await ctx.grantPermissions(["microphone"]);
    page = await ctx.newPage();
    report.device.serial = "DESKTOP-EMULATED-MOBILE (laptop ALC257 mic)";
    report.browser = { name: "Google Chrome (mobile-emulated)" };
  } else {
    const dev = setupDevice();
    const a = await attach();
    browser = a.browser;
    page = a.page;
  }
  await page.addInitScript(INJECT, { k: KEY, brain: BRAIN, sk: SARVAM_KEY });
  await page.goto(DESKTOP ? DESKTOP_URL : APP_URL, { waitUntil: "load", timeout: 60000 });
  // Slow tablets take a long time to mount React (20s+). Poll until the app
  // is actually interactive AND freshly booted (window.__rc2.boot is a fresh
  // document's boot marker set by the init script, not a restored session).
  const MIC = 'button[class*="h-28 w-28"]';
  let booted = false;
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(1000);
    try {
      const s = await page.evaluate(() => ({ boot: window.__rc2 ? window.__rc2.boot : null, hasMic: !!document.querySelector('button[class*="h-28 w-28"]') }));
      if (s.boot !== null && s.hasMic) { booted = true; break; }
    } catch {}
  }
  log("App mounted:", booted, "| waiting 4s for the app's own init…");
  await page.waitForTimeout(4000);
  log("Brain:", BRAIN, "| Device:", report.device.serial);
  // clock sync
  const s = await page.evaluate(() => window.__rc2Sync());
  offset = s.d - s.p;
  // grant mic
  await page.context().grantPermissions(["microphone"], { origin: DESKTOP ? DESKTOP_URL : APP_URL }).catch(() => {});
  const net = [];
  page.on("request", (r) => {
    if (/openrouter|sarvam|generativelanguage|v1\/chat/i.test(r.url())) net.push({ ev: "req", t: Date.now(), u: r.url().slice(0, 90), m: r.method() });
  });
  page.on("response", (r) => {
    if (/openrouter|sarvam|generativelanguage|v1\/chat/i.test(r.url())) net.push({ ev: "res", t: Date.now(), u: r.url().slice(0, 90), s: r.status() });
  });
  const consoleLog = [];
  page.on("console", (m) => {
    const t = Date.now();
    consoleLog.push({ t, txt: m.text().slice(0, 160) });
    if (DEBUG) log("  [console]", m.text().slice(0, 120));
  });

  const res = await page.evaluate(() => document.body.innerText.slice(0, 60));
  log("App state:", res.replace(/\n/g, " "));
  // Start the voice session: tap the mic button. On first tap the phone may
  // show a mic permission prompt — accept it on the phone.
  log(">> Tapping MIC button to start session…");
  try {
    await page.locator(MIC).click();
      log(">> If a mic permission prompt appeared on the phone — tap ALLOW.");
  } catch (e) { log(">> Mic tap failed:", String(e).slice(0, 80)); }
  await page.waitForTimeout(6000);
  const after = await page.evaluate(() => document.body.innerText.slice(0, 200));
  const probe = await page.evaluate(() => ({
    srConstructed: window.__rc2.srConstructed,
    srStarted: window.__rc2.srStarted,
    sttEvents: window.__rc2.stt.map((e) => `${e.ev}${e.text ? ":t=" + e.text.text : ""}${e.err ? ":err=" + e.err : ""}`),
  }));
  log("After mic tap:", after.replace(/\n/g, " ").slice(0, 120));
  log("SR probe:", JSON.stringify(probe));
  log(">> Settling 8s (let initial detection/recognition cycle finish)…");
  await page.waitForTimeout(8000);
  log(`Phone ready. ${SCEN.length} scenarios x ${RUNS_PER} runs. Speak into the phone when cued.`);
  await page.waitForTimeout(2000);

  const runs = [];
  let runNo = 0;
  for (const sc of SCEN) {
    for (let i = 0; i < RUNS_PER; i++) {
      runNo++;
      const run = { scenario: sc.id, run: i + 1, events: {}, timings: {}, transcript: null, errors: [] };
      // FRESH SESSION PER RUN: re-arm the session WITHOUT a full reload —
      // reloads take 20s+ on this slow tablet. Bring the tab to front (so the
      // app's mic pipeline stays live). Only tap mic if the session ended
      // (TAP MIC TO BEGIN) — mid-session taps toggle listening OFF.
      if (!DESKTOP) {
        try { await page.context().newCDPSession(page).then((c) => c.send("Page.bringToFront")); } catch {}
      }
      await page.waitForTimeout(250);
      const pre = await page.evaluate(() => document.body.innerText.slice(0, 200));
      if (/TAP MIC TO BEGIN/i.test(pre)) {
        await page.locator(MIC).click().catch((e) => log("  mic tap failed:", String(e).slice(0, 60)));
        await page.waitForTimeout(800);
      }
      await page.evaluate(() => { window.__rc2.stt.length = 0; window.__rc2.tts.length = 0; });
      log(`--- Run ${runNo}/${SCEN.length * RUNS_PER} [${sc.id} #${i + 1}] ---`);
      log(`>>> SPEAK NOW: ${sc.cue}`);
      const t0node = Date.now();
      const deadline = t0node + sc.timeoutMs;
      let ttsEnds = 0, secondCued = false, interrupCued = false;
      let finished = false, timedOut = false, t0Probe = null;
      while (Date.now() < deadline) {
        await page.waitForTimeout(250);
        const st = await page.evaluate(() => ({
          tts: window.__rc2.tts.length,
          ttsEnds: window.__rc2.tts.filter((e) => e.ev === "end").length,
          sttEnds: window.__rc2.stt.filter((e) => e.ev === "end").length,
          sttStarts: window.__rc2.stt.filter((e) => e.ev === "start").length,
          ttsStarts: window.__rc2.tts.filter((e) => e.ev === "start").length,
          ttsErrors: window.__rc2.tts.filter((e) => e.ev === "error").length,
          vad: document.body.innerText.includes("ACTIVE VOICE DETECTED"),
        }));
        if (t0Probe === null && st.vad) t0Probe = Date.now();
        if (DEBUG && t0Probe !== null && run.timingsT0 === undefined) { run.timingsT0 = t0Probe - t0node; }
        if (DEBUG) {
          const all = await page.evaluate(() => ({ stt: window.__rc2.stt.map((e) => `${e.ev}:${e.text ? e.text.text : ""}`), tts: window.__rc2.tts.map((e) => e.ev) }));
          if (all.stt.length || all.tts.length) log("  [rc2]", JSON.stringify({ s: all.stt, t: all.tts }).slice(0, 200));
        }
        ttsEnds = st.ttsEnds;
        if (sc.waitForSpeech && !interrupCued) {
          if (st.ttsStarts > 0) {
            interrupCued = true;
            log(">>> AURA IS SPEAKING — INTERRUPT NOW");
          } else if (st.sttEnds > 0 && ttsEnds === 0 && Date.now() - t0node > 12000) {
            interrupCued = true;
            log(">>> TTS unavailable (text-only) — LLM streaming; INTERRUPT NOW with your second utterance");
          }
        }
        if (sc.followup && !secondCued) {
          if (ttsEnds > 0) {
            secondCued = true;
            await page.waitForTimeout(900);
            log(">>> SECOND QUESTION — SPEAK NOW (within 1s)");
          } else if (st.sttEnds > 0 && st.ttsEnds === 0 && st.ttsErrors > 0) {
            secondCued = true;
            await page.waitForTimeout(900);
            log(">>> SECOND QUESTION (text-only turn done) — SPEAK NOW");
          }
        }
        if (!sc.waitForSpeech && !sc.followup) {
          if (ttsEnds > 0 || (st.sttEnds > 0 && st.ttsEnds === 0 && st.ttsErrors > 0)) { finished = true; break; }
        } else if (sc.followup) {
          if (secondCued && ttsEnds >= 2) { finished = true; break; }
          if (secondCued && st.sttEnds > 0 && st.ttsEnds === 0 && st.ttsErrors > 0) { finished = true; break; }
        } else if (sc.waitForSpeech) {
          if (interrupCued && st.sttEnds >= 2) { finished = true; break; }
          if (interrupCued && ttsEnds >= 2) { finished = true; break; }
        }
      }
      if (!finished) timedOut = true;
      const endedAt = Date.now();
      const snap = await page.evaluate(() => ({ stt: window.__rc2.stt, tts: window.__rc2.tts, body: document.body.innerText.slice(0, 260) }));
      run.events.stt = snap.stt.map((e) => ({ ...e, t: epochAt(page, e.t) }));
      run.events.tts = snap.tts.map((e) => ({ ...e, t: epochAt(page, e.t) }));
      run.events.net = net.splice(0, net.length);
      run.consoleAll = consoleLog.splice(0, consoleLog.length);
      run.consoleLog = run.consoleAll.filter((c) => /MODEL_ROUTING|ListeningIntelligence|Turn cancelled|LISTENING|Starting session|Speech|STT/i.test(c.txt));
      run.t0Probe = t0Probe;
      run.timings = computeTimings(run, t0node, endedAt);
      run.bottleneck = classifyBottleneck(run);
      run.totalMs = endedAt - t0node;
      run.timedOut = timedOut;
      runs.push(run);
      log(`  → ${timedOut ? "TIMEOUT" : "turn end"}. metrics:`, JSON.stringify(run.timings));
      await page.waitForTimeout(2000);
    }
  }

      report.scenarios = aggregate(runs);
  report.global = summarize(runs);
  report.rawRuns = runs.map((r) => ({
    scenario: r.scenario, run: r.run, timedOut: r.timedOut,
    stt: r.events.stt.map((e) => [e.ev, Math.round(e.t - (r.timings.T.t0 ?? r.events.stt[0]?.t ?? 0)), e.text ?? e.err ?? ""]),
    tts: r.events.tts.map((e) => [e.ev, Math.round(e.t - (r.timings.T.t0 ?? r.events.stt[0]?.t ?? 0)), (e.text ?? "").slice(0, 40)]),
    net: r.events.net.map((e) => [e.ev, Math.round(e.t - (r.timings.T.t0 ?? r.events.stt[0]?.t ?? 0)), `${e.m ?? ""} ${e.s ?? ""}`.trim(), e.u]),
    console: r.consoleLog.map((c) => [Math.round(c.t - (r.timings.T.t0 ?? r.events.stt[0]?.t ?? 0)), c.txt]),
  }));
  fs.writeFileSync("runs/rc2-mobile-latency.json", JSON.stringify(report, null, 2));
  await browser.close();
  printSummary(report);
}

function computeTimings(run, tStart, tEnd) {
  const stt = run.events.stt;
  const tts = run.events.tts;
  const t = (ev, source) => { const f = source.find((x) => x.ev === ev); return f ? f.t : null; };
  const T = {};
  if (BRAIN === "sarvam") {
    // No platform SR results on this device: anchor on VAD + app console logs.
    const cl = run.consoleAll ?? [];
    const findLog = (re) => { const f = cl.find((c) => re.test(c.txt)); return f ? f.t : null; };
    T.t0 = run.t0Probe;                          // first "ACTIVE VOICE DETECTED" (VAD onset proxy)
    T.t2 = run.t0Probe;
    T.t5 = findLog(/Chosen Final Text/);         // STT final chosen
    T.t4 = findLog(/Sarvam Transcribed/) ?? T.t5;
    T.t10 = (() => { const r = run.events.net.find((x) => x.ev === "req" && /openrouter/i.test(x.u)); return r ? r.t : null; })();
    T.t12 = (() => { const r = run.events.net.find((x) => x.ev === "res" && /openrouter/i.test(x.u)); return r ? r.t : null; })();
    T.t13 = t("request", tts);
    T.t15 = t("start", tts);
    T.t16 = t("end", tts);
  } else {
    T.t1 = t("start", stt);            // mic + STT engine started (proxy for first sample)
    T.t2 = t("speechstart", stt);      // VAD speech onset
    T.t4 = (() => { const p = stt.find((x) => x.ev === "result" && x.text && !x.text.final); return p ? p.t : null; })();
    T.t5 = (() => { const f = stt.find((x) => x.ev === "result" && x.text && x.text.final); return f ? f.t : null; })();
    T.t10 = (() => { const r = run.events.net.find((x) => x.ev === "req" && /openrouter/i.test(x.u)); return r ? r.t : null; })();
    T.t12 = (() => { const r = run.events.net.find((x) => x.ev === "res" && /openrouter/i.test(x.u)); return r ? r.t : null; })();
    T.t13 = t("request", tts);
    T.t15 = t("start", tts);
    T.t16 = t("end", tts);
    T.t0 = T.t2; // best external proxy for user speech onset
  }
  const D = {};
  D.speechDetection = sub(T.t2, T.t0); // 0 by construction; real VAD onset in t2 abs
  D.sttPartial = sub(T.t4, T.t0);
  D.sttFinal = sub(T.t5, T.t0);
  D.executive = sub(T.t10, T.t5);      // understanding+plan+prompt+queue (incl. UI glue)
  D.networkRtt = sub(T.t12, T.t10);
  D.ttsStartup = sub(T.t15, T.t13);
  D.totalVoice = sub(T.t15, T.t0);
  D.completeTurn = sub(T.t16, T.t0);
  D.sttFirstAudio = sub(T.t2, T.t1);
  return { T, D };
}

function sub(a, b) { return a != null && b != null ? Math.round(a - b) : null; }

function classifyBottleneck(run) {
  const d = run.timings.D;
  const parts = [
    { k: "sttFinal", v: d.sttFinal, who: "STT" },
    { k: "executive", v: d.executive, who: "Executive+prompt" },
    { k: "networkRtt", v: d.networkRtt, who: "OpenRouter" },
    { k: "ttsStartup", v: d.ttsStartup, who: "TTS" },
    { k: "totalVoice", v: d.totalVoice, who: "Playback start" },
  ].filter((x) => x.v != null);
  const max = parts.reduce((a, b) => (b.v > a.v ? b : a), { v: -1 });
  return max.k === "totalVoice" ? "End-to-end assembly" : max.who;
}

function aggregate(runs) {
  const bySc = {};
  for (const r of runs) {
    (bySc[r.scenario] ??= []).push(r);
  }
  const out = {};
  for (const [k, rs] of Object.entries(bySc)) {
    const metric = (sel) => {
      const vals = rs.map(sel).filter((v) => v != null);
      if (!vals.length) return null;
      vals.sort((a, b) => a - b);
      return {
        mean: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
        median: vals[Math.floor(vals.length / 2)],
        p95: vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))],
        min: vals[0],
        max: vals[vals.length - 1],
        n: vals.length,
      };
    };
    out[k] = {
      total: metric((r) => r.timings.D.totalVoice),
      completeTurn: metric((r) => r.timings.D.completeTurn),
      sttPartial: metric((r) => r.timings.D.sttPartial),
      sttFinal: metric((r) => r.timings.D.sttFinal),
      executive: metric((r) => r.timings.D.executive),
      networkRtt: metric((r) => r.timings.D.networkRtt),
      ttsStartup: metric((r) => r.timings.D.ttsStartup),
      bottlenecks: (() => { const m = {}; for (const r of rs) m[r.bottleneck] = (m[r.bottleneck] ?? 0) + 1; return m; })(),
      turns: rs.map((r) => r.timings.D.totalVoice),
    };
  }
  return out;
}

function starRating(ms) {
  if (ms == null) return "N/A";
  if (ms < 900) return "5★ Human";
  if (ms < 1400) return "4★ Very Good";
  if (ms < 2000) return "3★ Acceptable";
  if (ms < 3000) return "2★ Needs Work";
  return "1★ Poor";
}

function summarize(runs) {
  const totals = runs.map((r) => r.timings.D.totalVoice).filter((v) => v != null).sort((a, b) => a - b);
  const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  const target = (ms, pass, warn) => (ms == null ? "N/A" : ms <= pass ? "PASS" : ms <= warn ? "WARNING" : "FAIL");
  const s = {
    runs: runs.length,
    totalVoice: { mean: avg(totals), median: totals[Math.floor(totals.length / 2)], p95: totals[Math.min(totals.length - 1, Math.floor(totals.length * 0.95))], fastest: totals[0], slowest: totals[totals.length - 1] },
    sttPartial: target(avg(runs.map((r) => r.timings.D.sttPartial).filter((v) => v != null)), 300, 600),
    sttFinal: null,
    executive: target(avg(runs.map((r) => r.timings.D.executive).filter((v) => v != null)), 5, 20),
    networkRtt: null,
    ttsStartup: target(avg(runs.map((r) => r.timings.D.ttsStartup).filter((v) => v != null)), 250, 500),
    stars: starRating(avg(totals)),
  };
  const f1 = runs.map((r) => r.timings.D.sttFinal).filter((v) => v != null);
  s.sttFinal = f1.length ? target(avg(f1), 300, 600) : "N/A";
  const rtt = runs.map((r) => r.timings.D.networkRtt).filter((v) => v != null);
  s.networkRtt = rtt.length ? { mean: avg(rtt), median: rtt.sort((a, b) => a - b)[Math.floor(rtt.length / 2)] } : null;
  return s;
}

function printSummary(report) {
  console.log("\n===== RC-2 MOBILE VOICE LATENCY SUMMARY =====");
  console.log("Device:", report.device.serial, "| Browser:", report.browser.name, "| Brain:", BRAIN);
  const g = report.global;
  console.log("Total Voice Response (T15-T0): mean", g.totalVoice.mean + "ms", "| median", g.totalVoice.median + "ms", "| p95", g.totalVoice.p95 + "ms", "| fastest", g.totalVoice.fastest + "ms", "| slowest", g.totalVoice.slowest + "ms", "→", g.stars);
  console.log("STT First Partial:", g.sttPartial, "| STT Final:", g.sttFinal, "| Executive+pre: ", g.executive, "| TTS Startup:", g.ttsStartup, "| Network RTT:", JSON.stringify(g.networkRtt));
  console.log("\nPer scenario (mean total voice, ms):");
  for (const [k, v] of Object.entries(report.scenarios)) {
    console.log(`  ${k.padEnd(14)} ${String(v.total?.mean).padStart(5)}ms  ${v.total ? starRating(v.total.mean) : "N/A"}  bottleneck: ${JSON.stringify(v.bottlenecks)}`);
  }
  console.log("Full data: runs/rc2-mobile-latency.json");
}

await main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
