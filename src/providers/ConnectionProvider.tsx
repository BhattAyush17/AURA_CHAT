import React, { createContext, useContext, useEffect, useState } from 'react';
import { connectionState, ConnectionState } from '../config/connectionState';
import { getCredential } from '@/lib/credentials';
import { ENDPOINTS } from '@/config/api';
import { getGeminiKey, getOpenRouterKey, getSarvamKey } from '@/lib/api';

const ConnectionContext = createContext<ConnectionState>(connectionState.getState());

export const ConnectionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<ConnectionState>(connectionState.getState());

  useEffect(() => {
    const unsubscribe = connectionState.subscribe((newState) => {
      setState(newState);
    });

    const initializeConnection = async () => {
      const results = await Promise.allSettled([
        // ping Supabase → handled by MemoryProvider initialization normally, but we do a quick check here
        fetch(ENDPOINTS.health, { signal: AbortSignal.timeout(3000) }).then(res => res.json()),
        // ping Render /health
        fetch(ENDPOINTS.health, { signal: AbortSignal.timeout(3000) }),
        // check env for GEMINI_API_KEY
        Promise.resolve(!!getGeminiKey()),
        // check env for OPENROUTER_API_KEY
        Promise.resolve(!!getOpenRouterKey()),
        // ping Sarvam
        Promise.resolve(!!getSarvamKey()) // Simplified sarvam ping
      ]);

      const [healthData, renderRes, geminiKey, openrouterKey, sarvamKey] = results;

      const supabase_connected = healthData.status === 'fulfilled' && (healthData.value?.checks?.supabase?.ok || healthData.value?.supabase_connected);
      const render_reachable = renderRes.status === 'fulfilled' && renderRes.value.ok;
      const gemini_key_exists = geminiKey.status === 'fulfilled' && geminiKey.value;
      const openrouter_key_exists = openrouterKey.status === 'fulfilled' && openrouterKey.value;
      const sarvam_available = sarvamKey.status === 'fulfilled' && sarvamKey.value;

      connectionState.updateState({
        supabase_connected,
        render_reachable,
        gemini_key_exists,
        openrouter_key_exists,
        sarvam_available
      });

      pipelineSelector();
      connectionState.updateState({ init_complete: true });
      window.dispatchEvent(new Event('aura_ready'));
    };

    const pipelineSelector = () => {
      const state = connectionState.getState();
      
      // MEMORY
      let active_memory_mode = state.active_memory_mode;
      let active_embed_mode = state.active_embed_mode;

      if (state.supabase_connected && state.gemini_key_exists) {
        active_memory_mode = "supabase";
        active_embed_mode = "gemini";
      } else if (state.supabase_connected && state.render_reachable) {
        active_memory_mode = "supabase";
        active_embed_mode = "fastembed";
      } else if (state.supabase_connected) {
        active_memory_mode = "supabase";
        active_embed_mode = "fts";
      } else {
        active_memory_mode = "local";
        active_embed_mode = "tagmatch";
      }

      // LLM
      let active_llm = state.active_llm;
      if (state.openrouter_key_exists) {
        active_llm = "openrouter_haiku";
      } else if (state.gemini_key_exists) {
        active_llm = "gemini_direct";
      } else {
        active_llm = "degraded";
      }

      // VOICE IN
      let active_voice_in = state.active_voice_in;
      if (state.sarvam_available) {
        active_voice_in = "sarvam";
      } else if (typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) {
        active_voice_in = "webspeech";
      } else {
        active_voice_in = "textinput";
      }

      // VOICE OUT
      let active_voice_out = state.active_voice_out;
      if (state.sarvam_available) {
        active_voice_out = "sarvam";
      } else if (typeof window !== 'undefined' && window.speechSynthesis) {
        active_voice_out = "webspeech";
      } else {
        active_voice_out = "textonly";
      }

      // Calculate Scores
      const memory_quality = active_embed_mode === "gemini" ? 1.0 : (active_embed_mode === "fastembed" ? 0.85 : (active_embed_mode === "fts" ? 0.65 : 0.50));
      const llm_quality = active_llm === "openrouter_haiku" ? 1.0 : (active_llm === "openrouter_mini" ? 0.85 : (active_llm === "openrouter_llama" ? 0.70 : (active_llm === "gemini_direct" ? 0.60 : 0.10)));
      const voice_quality = (active_voice_in === "sarvam" && active_voice_out === "sarvam") ? 1.0 : ((active_voice_out === "sarvam" && active_voice_in === "webspeech") ? 0.85 : ((active_voice_in === "webspeech" && active_voice_out === "webspeech") ? 0.70 : ((active_voice_in === "textinput" && active_voice_out === "sarvam") ? 0.60 : 0.00)));
      const overall_score = 0.40 * memory_quality + 0.35 * llm_quality + 0.25 * voice_quality;

      connectionState.updateState({
        active_memory_mode,
        active_embed_mode,
        active_llm,
        active_voice_in,
        active_voice_out
      });

      connectionState.updateScores({
        memory_quality,
        llm_quality,
        voice_quality,
        overall_score
      });
    };

    initializeConnection();

    // Keep-alive ping every 10 minutes to prevent Render cold starts
    const keepAlive = setInterval(() => {
      fetch(ENDPOINTS.health).catch((err) => console.error("Keep-alive failed:", err));
    }, 10 * 60 * 1000);

    return () => {
      unsubscribe();
      clearInterval(keepAlive);
    };
  }, []);

  return (
    <ConnectionContext.Provider value={state}>
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = () => useContext(ConnectionContext);
