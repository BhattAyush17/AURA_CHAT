# AURA Fallback & Degradation Pipelines

This document details the multi-tier failover chains integrated into the AURA architecture. The system strictly adheres to a "fail-open" reliability engineering model, ensuring that the critical conversational voice loop remains functional even as peripheral dependencies degrade.

---

## 1. LLM Orchestration Pipeline (`llm_pipeline.py`)
The core intelligence engine uses a cascading provider approach to ensure high availability for text and reasoning generation.

### P1: OpenRouter Cascade (Primary)
The system iterates through the `FALLBACK_MODELS` list. If a model returns an error or empty response, the next model is tried automatically.

**Intended priority order:**
1. `deepseek/deepseek-chat` — Highest quality reasoning, best personality adherence.
2. `meta-llama/llama-3.3-70b-instruct:free` — Strong free-tier fallback with broad capabilities.
3. `google/gemini-2.0-flash-lite-001` — Fast, lightweight Google model.
4. `google/gemma-3-27b-it` — Open-weight Google alternative.
5. `openrouter/free` — Auto-routed to any available free model.

> [!WARNING]
> **Current Code Gap:** `llm_pipeline.py` line 9–14 does NOT include DeepSeek in `FALLBACK_MODELS`. The list currently starts at Llama. DeepSeek must be added as the first entry.

### P2: Gemini Direct API (Secondary)
If all OpenRouter models fail (or the API key is missing), the system falls back to calling the Gemini REST API directly using `gemini-1.5-flash`.

### P3: Stale / Heuristic Response (Critical Failure)
If both P1 and P2 fail completely, the system returns the last cached assistant message from the conversation history, or a static localized "I'm having trouble connecting" message.

---

## 2. Voice I/O Pipeline (STT / TTS)
The frontend manages audio processing through graceful degradation, prioritizing fidelity first, then native speed.

- **Tier 1 (Primary):** **Sarvam APIs**
  - Sarvam STT (Speech-to-Text) and TTS (Text-to-Speech) provide the highest quality, multilingual, emotionally resonant audio synthesis and transcription.
- **Tier 2 (Failover):** **Browser WebSpeech API**
  - If Sarvam API requests time out or the network is degraded, the frontend automatically falls back to native `window.speechSynthesis` and `SpeechRecognition`. This guarantees offline-capable audio I/O, albeit with lower robotic fidelity.
- **Tier 3 (Degraded):** **Text-Only Mode**
  - If hardware permissions fail (no microphone/speakers) or WebSpeech is unsupported by the browser, AURA degrades into a traditional text-chat interface.

---

## 3. Memory & Embedding Pipeline
Vector embeddings and memory retrieval are protected by strict timeouts and a hardware-agnostic fallback chain.

- **Tier 1 (Primary):** **Gemini Embedding API (`embedding-001`)**
  - 768-dimensional native embeddings.
- **Tier 2 (Failover):** **Cohere API (`embed-multilingual-v3.0`)**
  - 1024-dimensional embeddings, cleverly truncated via Matryoshka Representation Learning (MRL) to 768 dimensions to seamlessly fit the existing `pgvector` schema.
- **Tier 3 (Local Fallback):** **FastEmbed (`BGE-base-en-v1.5`)**
  - If external APIs are blocked, the backend generates 768-dimensional embeddings locally on the host CPU using FastEmbed.
- **Tier 4 (Degraded):** **Postgres FTS (Full-Text Search)**
  - If embedding generation completely fails, semantic search is bypassed entirely in favor of a standard keyword text match against the memory database.
- **Tier 5 (Critical Failure):** **Present-Moment Context**
  - If the Supabase/Chroma DB query takes longer than `0.8s` (`asyncio.wait_for`), the entire memory retrieval is aborted. The LLM is instead injected with a lightweight "present-moment" context frame.

---

## 4. Emotional Core & Infrastructure (Circuit Breakers)
The `DegradationManager` monitors core infrastructure components (Redis, Supabase, Workers) and dynamically adjusts the complexity of the analytical pipeline.

- **Level 0 (Full Operations):** 
  - `consumer.py` calculates complex `StateVectors` and `EmotionVectors` asynchronously via Redis streams, injecting rich behavioral context into the LLM.
- **Level 1 (NO_MEMORY):** *Supabase Circuit OPEN*
  - Persistent episodic memory is bypassed. AURA relies solely on the active session's short-term history and the initialized memory `seed`.
- **Level 2 (NO_SENSING):** *Redis / Worker Circuit OPEN*
  - Async stream processing is aborted. The backend falls back to calculating emotional vectors synchronously within the fast `/api/analyze` FastAPI path.
- **Level 3 (VOICE_ONLY):** *Total Infrastructure Collapse*
  - All behavioral and emotional routing is bypassed. AURA falls back to acting as a standard, un-steered LLM with only the base static system prompt, ensuring the user can always converse.
