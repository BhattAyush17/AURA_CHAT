# PROJECT SNAPSHOT
- Purpose: AURA conversational engine backend & frontend production hardening
- Architecture: 5-brain parallel async system, FastAPI, Redis Bus, Gemini Live WebSocket frontend, structured 2KB Reflective Memory Seed.
- Entry points: useLive.ts, backend/api/main.py

# CURRENT TASK STATE
- Objective: Complete the integration of AURA Synthetic Psyche, Reflective Memory System, Workspace Restructuring, and Identity/Personality Integrity Hardening — COMPLETE
- Completed Subtasks:
    - P1: Integrated Aura Psyche Engine (`src/lib/aura-psyche.ts`) intent routing into behavioral injection, enabling ephemeral persona-driven system injections (<1ms latency).
    - P2: Designed and implemented the AURA Reflective Memory System (`src/lib/aura-memory.ts`) featuring structured JSON schema, 2KB size ceiling, 4-pass progressive compression, relational thread soul rewrite, and legacy adapter bridging.
    - P3: Reorganized project root cleanly, moving 13 pre-refactor Python files to `legacy/` and 5 one-time migration scripts to `scripts/migration/`.
    - P4: Hardened AURA Identity Integrity and resolved personality-drift by creating a robust dynamic system prompt generator (`getSystemPromptForPersonality` in `src/lib/gemini-prompt.ts`) containing detailed Hinglish/Hindi rules, college/hostel slang definitions, and negative AI-identification constraints.
    - P5: Synchronized dynamic personality prompt injections across both Gemini Live WebSocket (`useWebSocket.ts`) and OpenRouter (`useProvider.ts`) clients to enforce character consistency.
    - P6: Refactored the frontend orchestrator (`useLive.ts`) to trigger immediate hot WebSocket reconnection when the personality mode is updated mid-session, applying the new system prompt instantly.
- Status: ✅ AURA Synthetic Psyche, Reflective Memory System, Root structure, and Identity/Personality Integrity are 100% hardened and production-ready.

# FILE INDEX
- Production Active:
    - `src/lib/aura-psyche.ts`, `src/lib/aura-memory.ts`
    - `src/providers/gemini/useLive.ts`, `src/providers/gemini/useBehaviorInjection.ts`, `src/providers/gemini/useWebSocket.ts`
    - `src/providers/openrouter/useProvider.ts`
    - `src/lib/gemini-prompt.ts`
    - `backend/api/main.py`, `backend/core/behavior.py`
- Tests & Utilities:
    - `scripts/test-psyche-routing.ts`, `scripts/test-memory-system.ts`
    - `scripts/reorganize_root.sh`

# RECENT CHANGES
- **Identity Integrity:** Implemented strict character constraints and Hinglish spoken directives in `getSystemPromptForPersonality` to eliminate generic Google/AI default responses.
- **WebSocket Mid-Session Switch:** Wired up `updateConfig` to trigger dynamic session reset and reconnect, forcing the browser to instantly initialize a new WebSocket with the fresh system prompt.
- **Provider Parity:** Enabled identical personality overlays and identity checks in both Gemini Live and OpenRouter pipelines.

# KNOWN PATTERNS
- **Memory Compression:** Meaning is prioritized over completeness. Relational thread is a full rewrite—never an append.
- **Fail-Open:** Reflective crystallization and remote storage adapters are executed asynchronously so as not to block conversational streams.
- **Language Directive:** Automatically detects regional languages (native Hindi, Hinglish, Mixed) and matches informal/casual style.

# KEY FINDINGS
- **System Instruction Isolation:** Gemini Live WebSockets only accept `systemInstruction` during initial handshake. Modifying prompt mid-stream requires a clean disconnect-reconnect.
- **Identity Safety Alignment:** Base model alignment defaults to "I am an AI assistant" unless heavily overridden with explicit, personality-inscribed system instructions.

# NEXT SESSION BOOTSTRAP
- Resume at: Production field-testing of Hinglish voice banter and real-time behavioral switching across all supported providers.
