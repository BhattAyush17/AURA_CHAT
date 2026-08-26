// src/audioRuntime/sileroVad.worker.ts
// Silero VAD (ONNX/WASM) — the preferred tier of the perception chain.
//
// - Runs entirely off the UI thread (dedicated worker).
// - Consumes 512-sample frames @16k (30ms), posted by the main thread from
//   the canonical processed-audio chain (filtered worklet output).
// - Maintains the model's LSTM state across frames — frame ORDER matters.
// - Serializes inference: concurrent session.run calls would corrupt state.
// - Never throws toward the main thread: any failure posts { type: "failed" }
//   and the listening pipeline falls back to the statistical worklet VAD.

import * as ort from "onnxruntime-web";

// Minimal structural typing — the DOM "WebWorker" lib isn't enabled globally.
type WorkerScope = {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

const ctx = self as unknown as WorkerScope;

const FRAME = 512;
const HIDDEN = 128;

let session: ort.InferenceSession | null = null;
let state: ort.Tensor | null = null;
let chain: Promise<void> = Promise.resolve();

const SR = new ort.Tensor("int64", [16000n], [1]);

function readOutput(
  results: ort.InferenceSession.OnnxValueMapType,
  key: string,
): Float32Array | null {
  const out = results[key];
  if (!out) return null;
  if (Array.isArray(out)) return out[0] ? (out[0].data as Float32Array) : null;
  return (out as ort.Tensor).data as Float32Array;
}

async function load(): Promise<void> {
  ort.env.wasm.wasmPaths = "/ort/";
  try {
    // Explicitly disable threading so we don't need COOP/COEP headers;
    // ort-wasm-simd-threaded.wasm still runs single-threaded here.
    ort.env.wasm.numThreads = 1;
  } catch {}
  session = await ort.InferenceSession.create("/silero_vad.onnx", {
    executionProviders: ["wasm"],
  });
  state = new ort.Tensor("float32", new Float32Array(2 * HIDDEN), [2, 1, HIDDEN]);
}

function runFrame(pcm: Float32Array): Promise<void> {
  if (!session || !state) return Promise.resolve();
  chain = chain.then(async () => {
    try {
      const input = new ort.Tensor("float32", pcm, [1, 1, FRAME]);
      const results = await session!.run({ input, state: state!, sr: SR });
      const prob = readOutput(results, "output")?.[0] ?? 0.5;
      const nextState = results.stateN as ort.Tensor;
      if (nextState?.data) {
        state = new ort.Tensor("float32", nextState.data.slice() as Float32Array, [2, 1, HIDDEN]);
      }
      ctx.postMessage({ type: "prob", prob: Math.min(1, Math.max(0, prob)) });
    } catch (err) {
      // Dropped frame — the statistical VAD tier covers this window.
      ctx.postMessage({ type: "prob", prob: null });
    }
  });
  return chain;
}

ctx.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "init") {
    load()
      .then(() => ctx.postMessage({ type: "ready" }))
      .catch((err) => ctx.postMessage({ type: "failed", error: String(err) }));
    return;
  }
  if (msg.type === "frame" && msg.pcm instanceof Float32Array) {
    void runFrame(msg.pcm);
  }
};
