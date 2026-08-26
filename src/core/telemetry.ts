export type AuraTraceEvent = {
  timestamp: string;
  event: string;
  details?: any;
};

export const pushConversationTrace = (event: string, details?: any) => {
  if (typeof window === "undefined") return;
  const traceKey = "auraConversationTrace";
  if (!(window as any)[traceKey]) (window as any)[traceKey] = [];
  const trace = (window as any)[traceKey] as AuraTraceEvent[];
  trace.push({ timestamp: new Date().toISOString(), event, details });
  if (trace.length > 100) trace.shift();
};

export const getConversationTrace = (): AuraTraceEvent[] => {
  if (typeof window === "undefined") return [];
  return (window as any).auraConversationTrace || [];
};

export const clearConversationTrace = () => {
  if (typeof window === "undefined") return;
  (window as any).auraConversationTrace = [];
};

export const getConversationLatencies = () => {
  const trace = getConversationTrace();
  let micStart = 0;
  let sttResult = 0;
  let llmFirstToken = 0;
  let ttsReady = 0;
  let playbackStart = 0;
  let playbackEnd = 0;

  // We find the *last* instance of each event in the trace for the current turn
  for (let i = trace.length - 1; i >= 0; i--) {
    const ev = trace[i];
    const time = new Date(ev.timestamp).getTime();
    if (ev.event === "PLAYBACK_END" && !playbackEnd) playbackEnd = time;
    if (ev.event === "PLAYBACK_START" && !playbackStart) playbackStart = time;
    if (ev.event === "TTS_READY" && !ttsReady) ttsReady = time;
    if (ev.event === "LLM_FIRST_TOKEN" && !llmFirstToken) llmFirstToken = time;
    if (ev.event === "TRANSCRIPT_READY" && !sttResult) sttResult = time;
    if (ev.event === "MIC_CLICK" && !micStart) micStart = time;
    
    // Stop looking backward if we see a new session start
    if (ev.event === "SESSION_STARTED" && micStart) break;
  }

  return {
    sttLatency: sttResult && micStart ? sttResult - micStart : null,
    llmLatency: llmFirstToken && sttResult ? llmFirstToken - sttResult : null,
    ttsLatency: ttsReady && llmFirstToken ? ttsReady - llmFirstToken : null,
    playbackLatency: playbackStart && ttsReady ? playbackStart - ttsReady : null,
    playbackDuration: playbackEnd && playbackStart ? playbackEnd - playbackStart : null,
    totalTurnLatency: playbackStart && sttResult ? playbackStart - sttResult : null,
  };
};

export const getConversationFingerprint = () => {
  const trace = getConversationTrace();
  if (trace.length === 0) return "No events";
  
  const lastEvent = trace[trace.length - 1];
  
  if (lastEvent.event === "SESSION_RECOVERED") return "Session Automatically Recovered";
  if (lastEvent.event.includes("STT_ERROR") || lastEvent.event === "STT_START_FAILED") return "Speech Recognition Failure";
  if (lastEvent.event.includes("LLM_ERROR")) return "Model Response Failure";
  if (lastEvent.event.includes("TTS_ERROR")) return "Speech Synthesis Failure";
  if (lastEvent.event.includes("PLAYBACK_ERROR")) return "Audio Playback Failure";
  
  return "Running / Unknown";
};
