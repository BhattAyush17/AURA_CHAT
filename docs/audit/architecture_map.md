# AURA System — Architecture Map
*Phase A — High-Level Project Mapping*

## System Overview
AURA is a highly resilient, multi-tier AI voice companion built on a React frontend and a FastAPI Python backend. The system is designed to maintain personality consistency and operational capability even under severe network or dependency degradation. It utilizes a layered approach for memory, intelligence, behavior processing, and voice I/O.

## Component Boundaries

### 1. Frontend Client (Browser / PWA)
- **Framework:** React + Vite + TanStack Router
- **Styling/UI:** Tailwind CSS, Radix UI Primitives, Framer Motion
- **Core Responsibilities:**
  - Audio capture and playback (Browser MediaRecorder / AudioContext)
  - Connection state and pipeline orchestration (`ConnectionProvider.tsx`)
  - Voice Pipeline modes (Sarvam STT/TTS vs. WebSpeech API vs. Text)
  - Client-side memory abstraction (`memory-gateway.ts` handling L3 local vs. Supabase modes)
- **Key Modules:** `src/providers/`, `src/lib/`, `src/hooks/`, `src/config/connectionState.ts`

### 2. Core Backend API
- **Framework:** FastAPI (`backend/api/main.py`)
- **Core Responsibilities:**
  - Request ingestion and fail-open rate limiting.
  - Routing user input through the intelligence and behavior pipelines.
  - Coordinating async tasks (Redis pub/sub, Supabase persistence).
- **Deployment:** Render (`render.yaml` - web service)

### 3. Intelligence & Context Layer (Middleware)
- **Location:** `backend/core/intelligence/`
- **Core Responsibilities:**
  - Injects real-world grounding into the LLM prompt.
  - Includes engines for: Time, Geo, Environment, Device, Network, and Live Knowledge Fallback.
  - Context Composer aggregates these signals before LLM invocation.

### 4. Behavior & Emotional Engine
- **Location:** `backend/core/` (sensing.py, emotion.py, vocab.py, relationship.py)
- **Core Responsibilities:**
  - Analyzes sentiment, frustration, withdrawal, and trust (Sensing L1).
  - Maintains a StateVector representing the user's emotional arc.
  - Generates behavioral instructions for the LLM (Behavior L2).
  - Tracks vocabulary usage and relationship progression.

### 5. Memory & Retrieval System
- **Location:** `backend/memory/` and Postgres (pgvector)
- **Core Responsibilities:**
  - Persistent, multi-tier embedding retrieval (Chroma / Supabase).
  - Uses `embedding_provider.py` to route embedding generation (Gemini → Cohere → FastEmbed → FTS).
  - Consolidates memory offline via daily cron jobs (`consolidator.py`).
  - Fallback to browser `localStorage` if backend/cloud is unreachable.

### 6. Event Bus & Asynchronous Processing
- **Location:** `backend/bus/` (Redis)
- **Core Responsibilities:**
  - Offloads heavy behavioral processing to a background consumer (`consumer.py`).
  - Caches turn-by-turn analysis to reduce latency.
- **Deployment:** Render (`render.yaml` - worker service)

## Dependency Graph (Execution Path)

1. **User Speaks** → Frontend Audio Capture (`useSarvam.ts` or `useLive.ts`).
2. **STT Processing** → Sarvam STT API (fallback: WebSpeech).
3. **Behavior/Intelligence Analysis** → FastAPI `/api/analyze` (or `/chat`).
   - *Async Path (Brain 3):* Publish to Redis → Read from Redis Cache.
   - *Sync Path (Fallback):* L1 Sensing Engine → StateVector update.
   - Context Composer injects time/geo variables.
   - Memory Retrieval (L3) queries Supabase via pgvector (or local cache).
4. **LLM Generation (L4)** → `llm_pipeline.py`.
   - Priority: OpenRouter → Gemini Direct → Stale Cache.
5. **TTS Processing** → Sarvam TTS (fallback: WebSpeech).
6. **Audio Playback** → Frontend AudioContext.
7. **Post-Session** → Sync StateVector, generate seeds, update vocab.

## Critical Resilience / Fallback Systems (Degradation Matrix)
The backend implements a `DegradationManager` (`backend/infrastructure/degradation.py`) using the Circuit Breaker pattern.
- **Level 0 (Full):** All systems (Redis, Supabase, LLM, Worker) healthy.
- **Level 1 (No Memory):** Supabase down. System relies on short-term session context.
- **Level 2 (No Sensing):** Redis/Worker down. System bypasses complex behavioral routing and relies on raw LLM prompts.
- **Level 3 (Voice Only):** Extreme degradation. Basic LLM + system prompt, minimal external calls.
- **Level 4 (Offline):** Fallback responses.

### Multiple Fallback Pipelines (Current Implementation)
A key architectural principle of AURA is the multi-tier failover chains across core functionalities:
1. **Memory Retrieval Pipeline (`embedding_provider.py` & `sync.py`)**: 
   - Gemini API (768d) → Cohere API (Truncated via MRL to 768d) → Local FastEmbed (BGE-base 768d) → Postgres FTS (Text keyword match).
   - *Timeouts*: Strict 0.8s `asyncio.wait_for` wrappers degrade smoothly to a "present-moment" prompt if DB retrieval hangs.
2. **LLM Orchestration Pipeline (`llm_pipeline.py`)**:
   - Primary (e.g. Gemini/DeepSeek) → OpenRouter Fallback → Secondary Provider → Basic cached heuristic response.
3. **Voice I/O Pipeline (`useSarvam.ts` / `useLive.ts`)**:
   - Sarvam STT/TTS (High fidelity) → Browser Native WebSpeech API (STT/TTS) → Text-Only Fallback Mode.
4. **Emotional Intelligence Pipeline (`consumer.py` & `server.py`)**:
   - Async Redis Worker (Full `StateVector` + multi-dimensional `EmotionVector`) → Sync inline calculation (FastAPI path) → Static fallback prompt injection.

## Known Unknowns & Audit Backlog
- ~~What is the exact payload structure of the new "Joyful Passion" model?~~ (Resolved: DeepSeek/OpenRouter configs audited)
- ~~How deeply integrated is the Client-Side Memory Gateway?~~ (Resolved: Fallback mechanism validated, but frontend suffers from 1-turn async cache lag)
- ~~Is the async Redis consumer handling high load gracefully?~~ (Resolved: Identified critical OOM leaks in `_sensing_engines` and cross-session bleed in `RuntimeEngine`)
- ~~Are the pgvector HNSW indices correctly mapped to the fallback embedding outputs?~~ (Resolved: MRL truncation aligns dimensions to 768, but `embedding_cache.py` has a critical vector-space collapse bug during failovers).
- **PENDING:** Subsystem 5 (Fallback + Degradation Logic validation)
- **PENDING:** Subsystem 6 (Frontend UX Flow and WebSocket ordering).

---
*Next Audit Target: Subsystem 5 (Fallback + Degradation Logic)*
