export type MemoryMode = "supabase" | "local";
export type EmbedMode = "gemini" | "fastembed" | "fts" | "tagmatch";
export type LlmMode = "openrouter" | "gemini_direct";
export type VoiceMode = "sarvam" | "webspeech" | "textonly";

export interface ConnectionState {
  supabase_connected: boolean;
  render_reachable: boolean;
  sarvam_available: boolean;
  gemini_key_exists: boolean;
  openrouter_key_exists: boolean;
  init_complete: boolean;
  active_memory_mode: MemoryMode;
  active_embed_mode: EmbedMode;
  active_llm: string;
  active_voice_in: string;
  active_voice_out: string;
  active_voice: VoiceMode;
  scores: {
    memory_quality: number;
    llm_quality: number;
    voice_quality: number;
    overall_score: number;
  };
  latencies: {
    l1_sensing_ms?: number;
    l2_behavior_ms?: number;
    l3_memory_ms?: number;
    l4_llm_ms?: number;
    tts_ms?: number;
    total_ms?: number;
  };
}

const defaultState: ConnectionState = {
  supabase_connected: false,
  render_reachable: false,
  sarvam_available: false,
  gemini_key_exists: false,
  openrouter_key_exists: false,
  init_complete: false,
  active_memory_mode: "local",
  active_embed_mode: "fts",
  active_llm: "openrouter",
  active_voice_in: "textinput",
  active_voice_out: "textonly",
  active_voice: "textonly",
  scores: {
    memory_quality: 0.5,
    llm_quality: 0.1,
    voice_quality: 0.0,
    overall_score: 0.25,
  },
  latencies: {},
};

type Listener = (state: ConnectionState) => void;

class ConnectionStateManager {
  private state: ConnectionState = { ...defaultState };
  private listeners: Set<Listener> = new Set();

  getState(): ConnectionState {
    return { ...this.state };
  }

  updateState(partial: Partial<ConnectionState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  updateLatency(latency: Partial<ConnectionState["latencies"]>) {
    this.state.latencies = { ...this.state.latencies, ...latency };
    this.notify();
  }

  updateScores(scores: Partial<ConnectionState["scores"]>) {
    this.state.scores = { ...this.state.scores, ...scores };
    this.notify();
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}

export const connectionState = new ConnectionStateManager();
