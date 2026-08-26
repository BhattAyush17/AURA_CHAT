# Phase 14 — Production Readiness Audit (working log)

**Status:** IN PROGRESS · Date: 2026-08-07

## 1. Build Health — PASS
- `vite build`: ✅ 12.5–22.9s, 2440 modules, target es2022, minify esbuild, `sourcemap: "hidden"`.
- Bundle: JS ~1.80MB raw / ~410KB gzip · CSS 113.8KB / 18.9KB gzip.
- Largest chunk: `index-*.js` 538KB (gzip 170KB). WASM: silero+onnx 26.8MB (gzip 6.3MB) — biggest asset by far; preloaded at runtime, not render-blocking.
- Code-split warnings (3): `SpeechCoordinator`, `RuntimeManager`, `MusicService` are both statically + dynamically imported — dynamic chunks never split. Documented; optional optimization only.
- Dead files removed (16): 12 zero-byte root `.py` stubs (real modules live in `backend/core/intelligence/`), `full_arch_description.md` (0B), `test_parser.js`, `update_env.py`, `wrangler.jsonc` (Cloudflare, unused).

## 2. Dependency Audit — Score: 100 (after cleanup)
- Security: **20 vulns (1 critical) → 0 vulnerabilities**. Critical `seroval` fixed via `npm audit fix`; remaining 4 (wrangler/miniflare/undici via `@cloudflare/vite-plugin`) eliminated by removing that **dead dependency** (referenced nowhere, not in vite.config).
- Unused dependencies removed (22): `@lovable.dev/vite-tanstack-config` (explicitly bypassed in vite.config), `@tanstack/react-query`, `zod`, `@hookform/resolvers`, `cmdk`, `date-fns`, `embla-carousel-react`, `react-day-picker`, `recharts`, `tw-animate-css`(reinstalled — used in styles.css), `vaul`, 14× `@radix-ui/*` — none imported anywhere in src/ (leftover shadcn scaffolding).
- node_modules: 748MB → 422MB. 0 deprecated packages flagged; 58 packages behind latest (patch/minor only).
- Missing peer deps: none reported by npm.

## 3. Runtime Stability — STATIC INVENTORY DONE, browser soak PENDING
- 20 files manage listeners/intervals/timeouts/streams; cleanup pattern presence verified (removeEventListener/clearInterval/close/disconnect/getTracks/terminate all present).
- Hot spots to verify live: `useSarvam.ts` (34 sites), `useProvider.ts` (21), `useLive.ts` (20), `useWebSocket.ts` (13), `MicrophoneCoordinator` (9).
- Pending: 30–60 min browser soak (idle/conversation/resume/tab-switch/background), memory + listener leak check.

## 4. Voice System Health — STATIC, live audio soak PENDING
- Full chain exists: Microphone → VAD (silero) → STT → Perception → Executive → Prompt → LLM → TTS → Playback → resume.
- Pending live: deadlock/race/duplicate-listener/zombie-stream checks via browser session.

## 5. Executive Integrity — 98% (no dead decisions)
- Every decision field has a runtime consumer: prompt builder consumes strategy/initiative/budget/language/register/relationship/clarification/confidence/tone/speechBehavior/memoryPolicy/memoryContent/rationale; useSarvam consumes clarification/confidence/executiveTimeMs/informationBudget/language/memoryPolicy/register/relationship/strategy/thinkingBehavior; ReflectionEngine consumes strategy/budget/clarification/confidence/understanding.
- `plan.socialUnderstanding`: no runtime consumer — documented "evidence only" (intentional traceability).
- 0 disconnected policies; 0 duplicate routing; memory policy now has a content channel (Phase 13 fix).

## 10. Environment Variables — PASS (with warts)
- `src/integrations/supabase/client.ts` degrades to a no-op client when vars are missing — **no crash**; AURA uses runtime credentials instead.
- Wart: `.env` declares `VITE_SUPABASE_ANON_KEY`, the client reads `VITE_SUPABASE_PUBLISHABLE_KEY` — name mismatch (dead var). Documented; not churned.
- `auth-middleware.ts` throws if vars missing, but is SSR-only; app is a static SPA — unaffected.

## 11. Production Logging — ACCEPTABLE (documented)
- 246 console calls: 112 log / 90 warn / 39 error / 1 debug. **No secrets logged**; **no per-audio-chunk hot-path logging**; mostly low-frequency status lines (`[Storage] …`, `[Cloud Sync] …`).
- Recommended (not done — 31 files of churn): gate behind `import.meta.env.DEV`.

## 13. Memory Safety — PASS
- Session start calls `executive.resetLanguage()` + `executive.resetRegister()` + ref resets (useSarvam.ts:2220-2231) — no stale language/register across sessions.
- Reflection weights persist across sessions within page lifetime (±0.05 ratchet, clamped ±1, no reset API) — acceptable single-user behavior; flag for multi-user.
- Transcript + speculative behavior reset on session end (useSarvam.ts:2798, 2839). Telemetry `clearConversationTrace()` exists.

## 14. Security Audit — PARTIAL
- Backend: CORS allowlist (localhost + vercel) ✓, slowapi rate limiting + Redis RateLimiter ✓, OPTIONS exempt ✓.
- Missing: security headers on backend API responses (no X-Content-Type-Options/CSP middleware) — documented (API-tier, lower risk).
- Frontend: no prompt-injection surface (LLM output is display text; telemetry only to window var).

## 18. Vercel Deployment — FIXED × 2, validated build
- **FIXED:** removed orphaned `/api/cron` block (no function exists; backend is a separate Python service on Render).
- **FIXED:** added security headers (nosniff, DENY frames, Referrer-Policy, Permissions-Policy mic=self) + immutable caching for /assets/*.
- `vercel.json` now: framework vite, output dist, SPA rewrite ✓.
- `vercel build`/`preview`/`deploy` pending (needs vercel CLI/auth).

## 7 + 12. Network Resilience & Error Recovery — PASS (static)
- Mature 3-phase resilience layer: `phase1` (AudioWatchdog, STTWatchdog, NetworkMonitor), `phase2` (DeviceProfiler, ExperienceHealthEngine), `phase3` (ConversationPreservation, PredictiveFailureEngine, ProviderMesh, QueueProtection, SilenceProtection).
- Offline/online/retry/degradation handlers all present (8 offline, 8 online, 4 retry, 5 degrad references).
- Live fault-injection (offline toggle, 429/500/504, STT/TTS failure) pending browser session.

## 16. UX Audit — PASS (static)
- Main route has loading, `isThinking`, `isSpeaking`, `listening`, live-transcript, and empty states (routes/index.tsx:177-199, 469, 568).
- `LatencyMeter.tsx.patch` leftover file found → **deleted**.

## 17. Accessibility — PARTIAL (2 documented gaps)
- aria-live/aria-label in MiniPlayer, SupabaseConnect; status text for SR in main route; 16 aria/role attributes in ui/.
- Gap: **no `prefers-reduced-motion` handling anywhere** (documented).
- Gap: keyboard-focus audit not run (needs browser).

## Code Quality (for certification)
- TODO/FIXME/HACK count: **0** in src/.
- Dead file cleaned: `src/components/LatencyMeter.tsx.patch`.
- 0 vulnerabilities, tsc baseline-only, eslint clean on touched files.

## LIVE RESULTS (Playwright, Chromium 151) — 2026-08-07
- Harness: `scripts/phase14/audit.mjs` (run: `AURA_TEST_OPENROUTER_KEY=<key> env -u LD_LIBRARY_PATH node scripts/phase14/audit.mjs` — preview server must be running).
- Results JSON: `runs/phase14-audit.json`. Full certification report: `docs/reports/phase-14.md`.
- Load ×3: TTFB 4ms, DCL 140ms, heap 22–25MB. Soak 180s: heap flat 25MB, 0 errors. Offline: 0 unhandled, clean reconnect.
- Voice boot (fake mic + seeded `openrouter_api_key` sessionStorage + brain=openrouter): getUserMedia ✓, session start ✓, backend /health ✓, OpenRouter auth/key ✓, STTWatchdog ✓, 0 page errors.
- A11y: 17 focusable, 4 icon buttons no aria-label, no aria-live. Mobile 390px: no h-scroll.
- Env quirk: flatpak Zed LD_LIBRARY_PATH breaks Chromium launch → unset; status text CSS-uppercases (innerText checks must be case-insensitive).

## 6–9, 15. — covered by live runs above (see phase-14.md).

## Executed changes (working tree, uncommitted)
- Removed 16 dead files + 22 unused deps + `@cloudflare/vite-plugin` (0 vulns now).
- `vercel.json` rewritten (headers + no orphan cron).
- `package.json` name → `aura-chat`.
- Phase 13 production fixes already merged: memoryContent channel, initiative prompt directives, [OUTPUT RULES].

## Known follow-ups
- TTS spoken-line sanitizer in `useSarvam.ts` (Phase 13 finding: model meta-commentary leakage).
- `package.json` name "tanstack_start_ts" + version missing → fix to `aura-chat`.

## 14.2 — Executive-Aware Model Routing (COMPLETE)
- **New:** `src/executive/ModelProfile.ts` — immutable capability registry (llama/qwen/deepseek/gemini/gemma; strengths/weaknesses/safety/creativity/reasoning/latency) + single pinned OpenRouter ID map + `buildModelQueue()`.
- **New:** `src/executive/ModelRouter.ts` — `routeConversationModel()` pure deterministic router over 5 Conversation Profiles (A playful-friends, B comfort-support, C technical, D teaching-research, E general-chat) with additive typed-signal scoring. No keywords/regex/text inspection — only Executive outputs. `signalsFromPlan()` is the single plan→signals conversion.
- **Integration:** `useSarvam.ts` processTurn builds the failover queue from the routed ranking (`buildModelQueue(routing.ranking)`); failover loop, 800ms backoff, 15s timeout, AbortError handling all untouched. `activeModel` initial = llama ID. Static `FALLBACK_MODELS` array removed from the hook (was a duplicate chain). Explicit mode (deepseek-only) preserved.
- **Telemetry:** new `MODEL_ROUTING` trace after the failover loop — profile, selectedModel, ranking, reason, signals (strategy/register/relationship/language/humor/warmth/move/expected/implicit/budget), fallbackCount, latencyMs, retry.
- **Tests:** `scripts/test-model-routing.ts` — 34 checks: 15 mission scenarios (roasting, dark humor, sarcasm, adult banter, support, grief, coding, debugging, teaching, research, interview, negotiation, Hinglish, family, office) + determinism (1000 runs), no-keyword (raw text swap), neverPrimary/Gemma-last invariants, queue integrity ×5, latency mean 0.0024ms, full-path integration with real Executive + real texts (roast→A, grief→B, coding→C, support→B, casual→E).
- **Design note (documented):** teaching "learning asks" in casual/Hinglish registers route to E (Llama) and formal/academic ones to C (Qwen); only speakerGoal=teach (user teaches AURA) cleanly reaches D (DeepSeek). Full C/D topic separation would require keyword routing — forbidden.
- **Regression:** tsc clean (baseline only), eslint clean after --fix, `vite build` 23.6s (bundle +5.3KB for router), all executive/provider/memory suites pass. `tsx` restored as devDependency (was pruned in 14.1).
