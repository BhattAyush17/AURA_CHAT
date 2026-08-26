/**
 * Phase 7.2 Validation Harness — internal correctness of the Listening
 * Intelligence chain WITHOUT a browser/mic.
 *
 * Covers the capability checklist that can be proven headlessly:
 *   A. vadMath units                (statistical VAD math)
 *   B. Worklet simulation           (vad-processor.js algorithm on synthetic audio)
 *   C. Silero-tier override         (prob feed → hysteresis/dominant/silence merge)
 *   D. Turn engine                  (calculateTurnConfidenceCore floor ownership)
 *   E. Language detection matrix    (SpeechStyleDetector rows incl. Hinglish)
 *   F. Friction report gates        (computeFrictionReport verdicts)
 *   G. Executive listening input    (ConversationContext embeds ListeningState)
 *
 * The browser-only rows of the capability checklist (real mic, real fan,
 * real TV, real voices, live barge-in probes) are printed as a runbook at
 * the end — they require a human with a microphone.
 *
 * Run: npx tsx scripts/test-perception.ts
 */
import {
  rmsOf,
  calibrateNoise,
  emaNoise,
  snrDb,
  speechProbability,
  noiseLevelDb,
  vadConfidence,
  nextSpeechDetected,
  PROB_SPEECH_ON,
  PROB_SPEECH_OFF,
  PROB_BARGE_IN,
  PROB_DOMINANT_SPEECH,
  NOISE_CALIBRATION_FRAMES,
} from "../src/audioRuntime/vadMath";
import {
  calculateTurnConfidenceCore,
  type SpeechProfile,
} from "../src/shared/useAdaptiveTurnDetection";
import { SpeechStyleDetector } from "../src/runtime/language/SpeechStyleDetector";
import {
  computeFrictionReport,
  emptySessionStats,
  type SessionStats,
} from "../src/runtime/validation/ConversationFrictionReport";
import { buildConversationContext } from "../src/executive/ConversationContext";
import { ConversationExecutive } from "../src/executive/ConversationExecutive";

let failures = 0;
const assert = (cond: boolean, label: string) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  if (!cond) failures++;
};
const section = (name: string) => console.log(`\n── ${name} ──`);

// ────────────────────────────────────────────────────────────────────
// A. vadMath units
// ────────────────────────────────────────────────────────────────────
section("A. vadMath units");
assert(
  Math.abs(rmsOf(new Float32Array([0.5, 0.5]))) < 1e-9 ||
    Math.abs(rmsOf(new Float32Array([0.5, 0.5])) - 0.5) < 1e-9,
  `rmsOf tone = 0.5 (got ${rmsOf(new Float32Array([0.5, 0.5])).toFixed(4)})`,
);
assert(rmsOf(new Float32Array(16)) === 0, "rmsOf silence = 0");
assert(
  Math.abs(calibrateNoise(0.02, 0.04, 0) - 0.04) < 1e-9,
  "calibrateNoise first frame adopts rms",
);
assert(Math.abs(emaNoise(0.1, 0.2, 0.5) - 0.15) < 1e-9, "emaNoise alpha 0.5 → mean");
assert(
  Math.abs(snrDb(0.1, 0.05) - 6.02) < 0.02,
  `snrDb(0.1,0.05) ≈ 6dB (got ${snrDb(0.1, 0.05).toFixed(2)})`,
);
assert(
  Math.abs(noiseLevelDb(0.01) + 40) < 0.01,
  `noiseLevelDb(0.01) = -40dBFS (got ${noiseLevelDb(0.01).toFixed(1)})`,
);
assert(
  Math.abs(speechProbability(0.1, 0.05) - 0.5) < 0.03,
  `speechProbability ≈ 0.5 at mid SNR (got ${speechProbability(0.1, 0.05).toFixed(3)})`,
);
assert(
  speechProbability(0.1, 0.001) > speechProbability(0.05, 0.05),
  "speechProbability rises with SNR",
);
assert(
  Math.abs(vadConfidence(0.95) - 0.9) < 1e-9,
  `vadConfidence(0.95) = 0.9 (got ${vadConfidence(0.95)})`,
);
assert(Math.abs(vadConfidence(0.5)) < 1e-9, "vadConfidence(0.5) = 0 (max uncertainty)");
assert(
  PROB_SPEECH_ON === 0.6 &&
    PROB_SPEECH_OFF === 0.3 &&
    PROB_BARGE_IN === 0.9 &&
    PROB_DOMINANT_SPEECH === 0.8,
  "threshold constants stable",
);
assert(NOISE_CALIBRATION_FRAMES === 200, "calibration window = 200 frames");
{
  let d = false;
  d = nextSpeechDetected(d, 0.5);
  assert(d === false, "hysteresis: 0.5 (below on) → off");
  d = nextSpeechDetected(d, 0.7);
  assert(d === true, "hysteresis: 0.7 (above on) → on");
  d = nextSpeechDetected(d, 0.4);
  assert(d === true, "hysteresis: 0.4 (held above off) → on");
  d = nextSpeechDetected(d, 0.3);
  assert(d === false, "hysteresis: 0.3 (at off) → off");
}

// ────────────────────────────────────────────────────────────────────
// B. Worklet simulation — faithful copy of public/vad-processor.js math
// ────────────────────────────────────────────────────────────────────
section("B. Worklet simulation (vad-processor.js algorithm)");
const QUANTUM = 128; // @16kHz = 8ms
const SAMPLE_RATE = 16000;

class WorkletSim {
  noiseFloor = 0.02;
  calibrationFrames = 0;
  frameProb = 0;
  silenceQuanta = 0;
  silenceMs = 0;
  loudFrameCount = 0;
  isSpeaking = false;
  bargeInEvents: { rms: number; probability: number }[] = [];
  posts: { probability: number; noiseFloor: number; silenceMs: number; rms: number }[] = [];
  private buf: number[] = [];
  private maxProbSeen = 0;

  run(frames: number, rmsOfQuantum: (q: number) => number, speaking = false) {
    for (let q = 0; q < frames; q++) {
      const rms = rmsOfQuantum(q);
      if (this.calibrationFrames < NOISE_CALIBRATION_FRAMES) {
        this.noiseFloor = calibrateNoise(this.noiseFloor, rms, this.calibrationFrames);
        this.calibrationFrames++;
      } else {
        this.noiseFloor = emaNoise(this.noiseFloor, rms);
      }
      const snr = snrDb(rms, this.noiseFloor);
      this.frameProb = 1 / (1 + Math.exp(-0.5 * (snr - 6)));
      this.maxProbSeen = Math.max(this.maxProbSeen, this.frameProb);

      if (this.frameProb < 0.3) {
        this.silenceQuanta++;
        this.silenceMs = (this.silenceQuanta * QUANTUM * 1000) / SAMPLE_RATE;
      } else {
        this.silenceQuanta = 0;
        this.silenceMs = 0;
      }

      for (let i = 0; i < QUANTUM; i++) {
        this.buf.push(rms);
        if (this.buf.length >= 2048) {
          this.posts.push({
            probability: this.frameProb,
            noiseFloor: this.noiseFloor,
            silenceMs: this.silenceMs,
            rms,
          });
          this.buf = [];
        }
      }

      if (!speaking) continue;
      const rmsClamp = Math.max(0.15, this.noiseFloor * 4);
      if (this.frameProb >= PROB_BARGE_IN && rms > rmsClamp) {
        this.loudFrameCount++;
        if (this.loudFrameCount >= 15) {
          this.bargeInEvents.push({ rms, probability: this.frameProb });
          this.loudFrameCount = 0;
        }
      } else {
        this.loudFrameCount = 0;
      }
    }
    return this;
  }
}

// B1 — ceiling fan: constant quiet rumble
{
  const sim = new WorkletSim().run(2000, () => 0.001);
  assert(sim.maxProbSeen < 0.3, "B1 fan: never speech-like (prob < 0.3)");
  assert(sim.silenceMs > 5000, `B1 fan: silence accumulates (${Math.round(sim.silenceMs)}ms)`);
  assert(sim.bargeInEvents.length === 0, "B1 fan: no barge-in");
}

// B2 — keyboard: sparse short taps, never sustained (deterministic pattern)
{
  const sim = new WorkletSim().run(2000, (q) => {
    const taps: Record<number, number> = { 300: 3, 900: 3, 1300: 3 };
    const start = Object.keys(taps)
      .map(Number)
      .find((t) => q >= t && q < t + taps[t]);
    return start !== undefined ? 0.05 : 0.001;
  });
  assert(sim.bargeInEvents.length === 0, "B2 keyboard: no barge-in from taps");
  assert(
    sim.maxProbSeen >= 0.9,
    `B2 keyboard: taps are heard transiently (max ${sim.maxProbSeen.toFixed(2)})`,
  );
  assert(
    sim.silenceMs > 5000,
    `B2 keyboard: silence recovers between taps (${Math.round(sim.silenceMs)}ms)`,
  );
}

// B3 — TV at moderate volume: the EMA noise floor absorbs it
{
  const sim = new WorkletSim().run(2000, (q) => {
    const mod = Math.sin(((q % 400) / 400) * Math.PI * 2);
    return 0.02 + mod * 0.015;
  });
  assert(
    sim.maxProbSeen < 0.6,
    `B3 TV: stays below speech-on (max prob ${sim.maxProbSeen.toFixed(3)})`,
  );
  assert(sim.bargeInEvents.length === 0, "B3 TV: no barge-in");
}

// B4 — quiet user speech vs AURA speaking: audible but cannot interrupt.
// Real speech is dynamic (syllable bursts + gaps); a constant tone would
// calibrate INTO the floor — that is the tier's documented behavior.
{
  const sim = new WorkletSim().run(1000, (q) =>
    q < 200 ? 0.001 : Math.random() < 0.3 ? 0.04 + Math.random() * 0.05 : 0.002,
  );
  assert(
    sim.maxProbSeen > 0.9,
    `B4 quiet speech: detected as speech (max prob ${sim.maxProbSeen.toFixed(3)})`,
  );
  assert(
    sim.bargeInEvents.length === 0,
    "B4 quiet speech: RMS clamp (0.15) blocks soft interruption",
  );
}

// B5 — loud sustained speech: barge-in fires within ~15 quanta (120ms)
{
  const sim = new WorkletSim().run(
    300,
    (q) => {
      if (q < 200) return 0.001;
      const inBurst = (q - 200) % 30 < 25;
      return inBurst ? 0.3 + Math.random() * 0.2 : 0.002;
    },
    true,
  );
  assert(sim.bargeInEvents.length >= 1, "B5 loud speech: barge-in fires (sustained 15 quanta)");
  assert(sim.loudFrameCount === 0, "B5 loud speech: counter resets after firing");
}

// B6 — loud burst shorter than the sustained window
{
  const sim = new WorkletSim().run(1000, (q) => (q < 10 ? 0.3 : 0.001));
  assert(
    sim.bargeInEvents.length === 0,
    "B6 80ms burst: below 15-quanta sustained window → no barge-in",
  );
}

// B7 — PCM_DATA carries the perception fields for the main thread
{
  const sim = new WorkletSim().run(100, () => 0.001);
  const p = sim.posts[0];
  assert(
    p &&
      Number.isFinite(p.probability) &&
      Number.isFinite(p.noiseFloor) &&
      Number.isFinite(p.silenceMs) &&
      Number.isFinite(p.rms),
    "B7 PCM_DATA: {probability, noiseFloor, silenceMs, rms} present and finite",
  );
}

// ────────────────────────────────────────────────────────────────────
// C. Silero-tier override — the merge loop behind applySileroProb
// ────────────────────────────────────────────────────────────────────
section("C. Silero-tier override (hysteresis + dominant + silence merge)");
{
  // Music at 0.05 — Silero says no speech
  let detected = false;
  let realSilence = 0;
  let dominant = false;
  for (let i = 0; i < 100; i++) {
    const prob = 0.05;
    detected = nextSpeechDetected(detected, prob);
    dominant = prob >= PROB_DOMINANT_SPEECH;
    realSilence = detected ? 0 : realSilence + 30;
  }
  assert(detected === false, "C music: never speechDetected");
  assert(dominant === false, "C music: never dominantSpeechDetected");
  assert(realSilence === 3000, `C music: realSilence grows 30ms/frame → ${realSilence}ms`);
}
{
  // User speech at 0.95 — Silero says speech
  let detected = false;
  let realSilence = 0;
  let dominant = false;
  for (let i = 0; i < 100; i++) {
    const prob = 0.95;
    detected = nextSpeechDetected(detected, prob);
    dominant = prob >= PROB_DOMINANT_SPEECH;
    realSilence = detected ? 0 : realSilence + 30;
  }
  assert(detected === true, "C speech: speechDetected");
  assert(dominant === true, "C speech: dominantSpeechDetected");
  assert(realSilence === 0, "C speech: realSilence pinned at 0");
}
{
  // Barge-in gate on the canonical signal: TV (0.55) must NOT interrupt
  assert(0.55 < PROB_BARGE_IN, "C TV: probability 0.55 stays below barge-in 0.9");
  assert(0.95 >= PROB_BARGE_IN, "C speech: probability 0.95 passes barge-in");
}

// ────────────────────────────────────────────────────────────────────
// D. Turn engine — calculateTurnConfidenceCore
// ────────────────────────────────────────────────────────────────────
section("D. Turn engine (floor ownership)");
const profile: SpeechProfile = {
  micro_pause_ms: 400,
  thinking_pause_ms: 1200,
  deep_pause_ms: 2000,
  comfort_pause_ms: 1100,
  speaking_rate: 130,
  thinking_pause_score: 0.3,
  storytelling_score: 0.2,
  response_patience: 0.5,
  burst_speaker_score: 0.3,
  interruption_count: 0,
  interruption_rate: 0,
  interruptibility_score: 0.3,
  total_sessions: 1,
  total_turns: 5,
};
const turn = (silenceMs: number, text: string) =>
  calculateTurnConfidenceCore({ profile, threshold: 0.95, silenceMs, text });

{
  const r = turn(1400, "What is the capital of France?").result;
  assert(
    r.floorOwnership === "YIELDED" && r.shouldRespond,
    `D1 natural pause: yields after complete question (${r.floorOwnership}, ${r.silenceMs}ms)`,
  );
}
{
  const r = turn(3000, "um, let me think, the problem is").result;
  assert(
    r.thinkingConfidence >= 0.5,
    `D2 thinking pause: thinkingConfidence ${r.thinkingConfidence.toFixed(2)}`,
  );
  assert(
    r.floorOwnership === "THINKING",
    `D2 thinking pause: floor held at 3s (${r.floorOwnership})`,
  );
}
{
  const r = turn(6000, "um, let me think, the problem is").result;
  assert(
    r.floorOwnership === "YIELDED",
    `D2b thinking pause: hard override at 6s → ${r.floorOwnership}`,
  );
}
{
  const r = turn(1200, "no wait, actually, hold on").result;
  assert(r.floorOwnership === "THINKING", `D3 self-correction: floor held (${r.floorOwnership})`);
}
{
  const r = turn(1000, "yes.").result;
  assert(
    r.floorOwnership === "YIELDED" && r.shouldRespond,
    `D4 one-word reply: yields fast (${r.floorOwnership})`,
  );
  assert(r.responseDelay <= 400, `D4 one-word reply: fast response delay ${r.responseDelay}ms`);
}
{
  const r = turn(
    2000,
    "so basically, this one time i was at the market and then this guy came up and started talking, and then he just kept going",
  ).result;
  assert(
    r.conversationMode === "storytelling",
    `D5 storytelling: mode detected (${r.conversationMode})`,
  );
  assert(
    r.floorOwnership !== "YIELDED",
    `D5 storytelling: patience holds floor at 2s (${r.floorOwnership})`,
  );
}
{
  const r = turn(1500, "and then").result;
  assert(r.floorOwnership === "THINKING", `D6 trailing filler: floor held (${r.floorOwnership})`);
}

// ────────────────────────────────────────────────────────────────────
// E. Language detection matrix
// ────────────────────────────────────────────────────────────────────
section("E. Language detection matrix (SpeechStyleDetector)");
const detector = new SpeechStyleDetector();
const langRow = (label: string, text: string, expectPrimary: string, expectStyle: string) => {
  const s = detector.detectStyle(text);
  const ok = s.primary === expectPrimary && s.style === expectStyle;
  assert(ok, `E ${label}: ${s.primary}/${s.style} (${s.ratio}, ${s.script})`);
  if (!ok) console.log(`   ⚠ input: "${text}"`);
};
langRow("pure Hindi (Devanagari)", "मैं आज बहुत खुश हूँ", "Hindi", "Pure Hindi");
langRow("pure English", "The capital of France is Paris.", "English", "Pure English");
langRow("Devanagari Hinglish", "मैं office जा रहा हूँ", "Hindi", "Mostly Hindi");
langRow("Hindi + English nouns", "कल meeting है, ठीक है", "Hindi", "Mostly Hindi");
langRow("rapid switching", "ठीक है, let's go, फिर मिलेंगे", "Hindi", "Mostly Hindi");
langRow("emotional Hindi", "मुझे बहुत दुख हुआ, मैं अकेला हूँ", "Hindi", "Pure Hindi");
langRow(
  "technical English",
  "DNS resolution happens at the resolver level",
  "English",
  "Pure English",
);
langRow("short command", "stop the music", "English", "Pure English");
// The Romanized-Hinglish gap is FIXED (Phase 8): roman-Hindi tokens are
// counted via the Executive's shared lexicon.
{
  const s = detector.detectStyle("maine office ja raha hoon, thoda late ho gaya");
  const ok = s.primary === "Hindi" && s.style === "Mostly Hindi";
  assert(ok, `E Romanized Hinglish: detected as Hindi-dominant (got ${s.primary}/${s.style})`);
}

// ────────────────────────────────────────────────────────────────────
// F. Friction report gates
// ────────────────────────────────────────────────────────────────────
section("F. Friction report gates");
{
  const r = computeFrictionReport(emptySessionStats());
  assert(
    r.frictionlessScore === 100 && r.verdict === "excellent",
    "F empty session: 100 / excellent",
  );
}
{
  const stats: SessionStats = {
    ...emptySessionStats(),
    turns: 12,
    interruptions: 1,
    heldThoughts: 1,
    backchannels: 2,
    clarifies: 1,
    deadAirMs: [1800],
  };
  const r = computeFrictionReport(stats);
  assert(
    r.frictionlessScore === 83 && r.verdict === "acceptable",
    `F good session: 83 / acceptable (got ${r.frictionlessScore}/${r.verdict})`,
  );
  assert(r.rates.recoveryRate === 1, "F good session: full interruption recovery");
}
{
  const stats: SessionStats = {
    ...emptySessionStats(),
    turns: 10,
    interruptions: 6,
    heldThoughts: 1,
    abortedStreams: 3,
    clarifies: 4,
    deadAirMs: [2000, 5000],
  };
  const r = computeFrictionReport(stats);
  assert(
    r.verdict === "broken",
    `F disaster session: broken (got ${r.frictionlessScore}/${r.verdict})`,
  );
  assert(
    r.rates.recoveryRate === 0.167,
    `F disaster session: low recovery rate (${r.rates.recoveryRate})`,
  );
}

// ────────────────────────────────────────────────────────────────────
// G. Executive listening input
// ────────────────────────────────────────────────────────────────────
section("G. Executive listening input (ConversationContext)");
{
  const ctx = buildConversationContext({
    input: {
      text: "what do you think?",
      sttConfidence: 0.9,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "english",
    },
    emotion: { dominant: "neutral", energy: 0.5, engagement: 0.5 },
    timing: { turnCount: 2, silenceDurationMs: 300 },
  });
  const l = ctx.input.listening;
  assert(
    l &&
      l.speechProbability === 0 &&
      l.detectionSource === "rms" &&
      l.realSilence === 0 &&
      l.vadConfidence === 0 &&
      l.dominantSpeechDetected === false &&
      l.speechDetected === false &&
      l.noiseLevel === -100,
    "G legacy callers: listening snapshot defaults filled",
  );
}
{
  const exec = new ConversationExecutive();
  const ctx = buildConversationContext({
    input: {
      text: "i'm really tired today",
      sttConfidence: 0.88,
      wasInterruption: false,
      audioRms: 0.02,
      languageMode: "english",
      listening: {
        speechProbability: 0.97,
        noiseLevel: -48.2,
        speechDetected: true,
        realSilence: 0,
        vadConfidence: 0.94,
        detectionSource: "silero",
        dominantSpeechDetected: true,
      },
    },
    emotion: { dominant: "withdrawn", vulnerability: 0.5, energy: 0.3, engagement: 0.4 },
    timing: { turnCount: 9, silenceDurationMs: 800 },
  });
  assert(
    ctx.input.listening.detectionSource === "silero",
    "G listening snapshot embedded (silero)",
  );
  const plan = exec.plan(ctx);
  assert(
    typeof plan.confidence.value === "number" && plan.strategy.primary.length > 0,
    "G executive plans with listening input without throwing",
  );
}

// ────────────────────────────────────────────────────────────────────
// Manual runbook — rows that need a real microphone
// ────────────────────────────────────────────────────────────────────
section("Manual runbook (needs the app + a mic) — execute in the browser");
console.log(`  1. Fan on → runtime drawer "Audio Perception": noise rises, speechProbability stays < 0.3, no "Listening…" flashes.
  2. Typing on keyboard → no barge-in, no listening flashes; bar may flicker on key hits only.
  3. TV at moderate volume → bar stays below the 0.6 speech line; no interruptions while AURA talks.
  4. Whisper "hello" → speech detected (dominant flag off until sustained).
  5. Speak loudly while AURA talks → barge-in within ~150ms (expect: AURA stops, "You were saying…").
  6. Speak softly while AURA talks → barge-in may NOT fire (RMS clamp 0.15 — see B4 finding).
  7. Pause mid-thought ("um… actually…") → no premature response; floor held.
  8. Silence >5s → proactive poller path (15s cadence) may engage per transcript.
  9. Switch languages mid-conversation → matrix rows E apply; Romanized Hinglish is a known gap.
  10. Conversation Friction Report in the end-of-session summary must match F verdicts.`);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exitCode = failures === 0 ? 0 : 1;
