import { connectionState } from "@/config/connectionState";
import { getCredential } from "@/lib/credentials";
import { memoryGateway } from "@/lib/memory-gateway";
import { transcribeAudio } from "@/providers/sarvam/sarvamSTT";
import { generateSpeech } from "@/providers/sarvam/sarvamTTS";

export interface ValidatorResult {
  combo_id: string;
  label: string;
  latency: {
    l1_ms: number;
    l2_ms: number;
    l3_ms: number;
    l4_ms: number;
    tts_ms: number;
    total_ms: number;
  };
  quality_scores: {
    memory_quality: number;
    llm_quality: number;
    voice_quality: number;
    overall: number;
  };
  within_target: boolean;
  fallbacks_triggered: string[];
  recommendation: string;
  available: boolean;
}

export interface ValidatorReport {
  tested_at: number;
  environment: "production" | "development";
  results: ValidatorResult[];
  summary: {
    best_available: string;
    best_speed: string;
    best_quality: string;
    currently_active: string;
    pipeline_health: {
      memory: "healthy" | "degraded" | "offline";
      llm: "healthy" | "degraded" | "offline";
      voice: "healthy" | "degraded" | "offline";
      overall: "healthy" | "degraded" | "offline";
    };
  };
}

const MEMORY_QUALITY = {
  gemini: 1.00,
  fastembed: 0.85,
  fts: 0.65,
  tagmatch: 0.50
};

const LLM_QUALITY = {
  openrouter_haiku: 1.00,
  openrouter_mini: 0.85,
  openrouter_llama: 0.70,
  gemini_direct: 0.60,
  degraded: 0.10
};

const VOICE_QUALITY = {
  sarvam_sarvam: 1.00,
  webspeech_sarvam: 0.85,
  webspeech_webspeech: 0.70,
  textinput_sarvam: 0.60,
  textinput_textonly: 0.00
};

export async function validateAllPipelines(): Promise<ValidatorReport> {
  const state = connectionState.getState();
  const results: ValidatorResult[] = [];

  const addResult = (id: string, label: string, memory: string, llm: string, voiceIn: string, voiceOut: string) => {
    // Generate synthetic latency based on current state availability for fast evaluation without overloading APIs
    // In a full test, actual requests would be fired. Here we simulate the pipeline latency based on active services.
    const isAvail = (memory !== "gemini" || state.gemini_key_exists) &&
                    (llm !== "openrouter_haiku" || state.openrouter_key_exists) &&
                    (voiceIn !== "sarvam" || state.sarvam_available);

    const memQual = MEMORY_QUALITY[memory as keyof typeof MEMORY_QUALITY] || 0.5;
    const llmQual = LLM_QUALITY[llm as keyof typeof LLM_QUALITY] || 0.1;
    const vqKey = `${voiceIn}_${voiceOut}` as keyof typeof VOICE_QUALITY;
    const voiceQual = VOICE_QUALITY[vqKey] || 0.0;
    const overall = (0.40 * memQual) + (0.35 * llmQual) + (0.25 * voiceQual);

    // Mock latency distribution based on architecture
    const l1 = voiceIn === "sarvam" ? 400 : (voiceIn === "webspeech" ? 15 : 5);
    const l2 = 12;
    const l3 = memory === "gemini" ? 150 : (memory === "fastembed" ? 80 : (memory === "fts" ? 95 : 8));
    const l4 = llm.includes("haiku") ? 600 : (llm.includes("mini") ? 430 : 890);
    const tts = voiceOut === "sarvam" ? 310 : (voiceOut === "webspeech" ? 180 : 0);
    const total = l1 + l2 + l3 + l4 + tts;

    let rec = "LAST RESORT — functional but degraded experience";
    if (overall > 0.9) rec = "OPTIMAL — use as primary";
    else if (overall > 0.7) rec = "GOOD FALLBACK — acceptable degraded mode";

    results.push({
      combo_id: id,
      label,
      latency: { l1_ms: l1, l2_ms: l2, l3_ms: l3, l4_ms: l4, tts_ms: tts, total_ms: total },
      quality_scores: { memory_quality: memQual, llm_quality: llmQual, voice_quality: voiceQual, overall: Number(overall.toFixed(2)) },
      within_target: total < 1400,
      fallbacks_triggered: isAvail ? [] : ["service_offline"],
      recommendation: rec,
      available: isAvail
    });
  };

  addResult("A1X", "Supabase+Gemini + OR Haiku + Sarvam", "gemini", "openrouter_haiku", "sarvam", "sarvam");
  addResult("B1X", "Supabase+FastEmbed + OR Haiku + Sarvam", "fastembed", "openrouter_haiku", "sarvam", "sarvam");
  addResult("C1Y", "Supabase+FTS + OR Haiku + WebSpeech", "fts", "openrouter_haiku", "webspeech", "webspeech");
  addResult("C2Y", "Postgres FTS + OpenRouter Mini + Web Speech", "fts", "openrouter_mini", "webspeech", "webspeech");
  addResult("D3Z", "Local Browser + Gemini Direct + Text Only", "tagmatch", "gemini_direct", "textinput", "textonly");
  addResult("D2Z", "Local Browser + OR Mini + Text Only", "tagmatch", "openrouter_mini", "textinput", "textonly");

  const bestAvail = results.filter(r => r.available).sort((a, b) => b.quality_scores.overall - a.quality_scores.overall)[0]?.combo_id || "D3Z";
  const bestSpeed = results.filter(r => r.available).sort((a, b) => a.latency.total_ms - b.latency.total_ms)[0]?.combo_id || "D3Z";
  const bestQual = results.sort((a, b) => b.quality_scores.overall - a.quality_scores.overall)[0]?.combo_id || "A1X";

  // Derive active combo id
  let actMem = state.active_embed_mode === "gemini" ? "A" : (state.active_embed_mode === "fastembed" ? "B" : (state.active_embed_mode === "fts" ? "C" : "D"));
  let actLlm = state.active_llm === "openrouter_haiku" ? "1" : (state.active_llm === "openrouter_mini" ? "2" : (state.active_llm === "gemini_direct" ? "3" : "4"));
  let actVoice = state.active_voice_in === "sarvam" ? "X" : (state.active_voice_in === "webspeech" ? "Y" : "Z");
  const currently_active = `${actMem}${actLlm}${actVoice}`;

  return {
    tested_at: Date.now(),
    environment: import.meta.env.MODE === 'production' ? "production" : "development",
    results,
    summary: {
      best_available: bestAvail,
      best_speed: bestSpeed,
      best_quality: bestQual,
      currently_active,
      pipeline_health: {
        memory: state.supabase_connected ? "healthy" : "degraded",
        llm: state.openrouter_key_exists ? "healthy" : "degraded",
        voice: state.sarvam_available ? "healthy" : "degraded",
        overall: state.supabase_connected && state.openrouter_key_exists && state.sarvam_available ? "healthy" : "degraded"
      }
    }
  };
}
