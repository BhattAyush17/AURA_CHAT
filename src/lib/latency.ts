export interface LatencyMetrics {
  geminiConnect: number | null;
  firstToken: number | null;
  roundTrip: number | null;
  audioChunkInterval: number | null;
  backendAnalysis: number | null;
  memoryLayer: "live" | "seed" | "deep";
  geminiSetup: number | null;
  geminiGenStart: number | null;
  tokenThroughput: number | null;
  turnTokens: number | null;
  interruptionStopMs: number | null;
}

export function emitLatency(
  type: keyof LatencyMetrics | Partial<LatencyMetrics>,
  value?: number | string,
) {
  window.dispatchEvent(new CustomEvent("aura:latency", { detail: { type, value } }));
}
