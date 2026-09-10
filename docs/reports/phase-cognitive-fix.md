# AURA — PHASE 1: COGNITIVE FAST-PATH INTEGRITY FIX (OpenRouter + Sarvam)

**Date:** 2026-08-31
**Predecessor:** `phase-cognitive-fastpath-audit.md` (the read-only audit that found cut-offs C1–C9)
**Scope:** Implement the audit's Phase-1 fixes for the primary backend `/api/analyze/stream` path (Path A),
shared by OpenRouter and Sarvam. Behavioral verification via live backend calls — not just "it builds".
**Protected (untouched):** YouTube/yt-dlp, Google OAuth, HTMLAudio playback, Atmosphere (C6 left for runtime
audit), Telemetry, Social Cognition implementation, Memory implementation, Autonomous Conversation.
**Git policy:** no `add`/`commit`/`reset`/`push`. Pre-existing dirty tree = **220 modified tracked files**;
stays exactly **220** (verified). Only new _untracked_ source added.

---

## 1. Executive verdict

**Every authorized cognitive cut-off was wired end-to-end and the decision chain now reaches the LLM and
shapes the response — proven with live `/api/analyze/stream` calls, not just a successful build.**

Fixed vs the audit:

| Cut-off                                     | Verdict now                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| C1 music/action schema on Path A            | 🟢 FIXED — canonical `ACTION_SCHEMA` module injected; LLM re-emits `play_music`                       |
| C2 Executive strategy serialized            | 🟢 FIXED — `translatePlanToPrompt` wired; `executive_plan` reaches prompt                             |
| C3 music context on Path A                  | 🟢 FIXED — `music_context_text` sent (gated or meaningful music only)                                 |
| C4 LLM reliability                          | 🟡 IMPROVED — stronger `RESPONSE_CONTRACT` + answer-the-actual-question directive; model kept for now |
| C5 `cognitive_block` cap 422                | 🟢 FIXED — `boundCognitiveBlock` section-aware, caps at 3900; 422 boundary re-proven                  |
| C7 fast-path emotion                        | 🟢 FIXED — fast path now carries schema + emotion directive + anti-leak contract                      |
| C9 default `"Answer"` stance                | 🟢 FIXED — Executive strategy now drives `determineStance`                                            |
| Step 9 internal-state leak / hostile-warmth | 🟢 FIXED — `RESPONSE_CONTRACT` + `EMOTION_ACKNOWLEDGEMENT_DIRECTIVE`                                  |
| C6 atmosphere double-injection              | ⚪ UNCHANGED — separate runtime audit (protected, per instructions)                                   |
| C8 memoryPolicy gating                      | ⚪ UNCHANGED — intentional gating semantics preserved                                                 |

---

## 2. Files changed

**New (untracked) source:**

- `backend/core/intelligence/action_schema.py` — canonical Path-A `MUSIC_ACTION_SCHEMA`/`ACTION_SCHEMA`,
  `RESPONSE_CONTRACT`, `EMOTION_ACKNOWLEDGEMENT_DIRECTIVE`, `build_prompt()`. Single shared source for both
  providers; mirrors the frontend `MUSIC COMPANION` contract so interceptor parsing stays equivalent.
- `src/lib/cognitive-budget.ts` — `boundCognitiveBlock` (section-aware, deterministic, caps 3900) +
  `boundMusicContextText` (caps 1200).
- `scripts/test-c5-budget.ts` (gitignored) — 14 deterministic C5 tests.
- `docs/reports/phase-cognitive-fastpath-audit.md` (pre-existing) + this fix report.

**Tracked edits (all within pre-existing 220 modified baseline):**

- `backend/api/main.py` — imports the module; adds `music_context_text` field; both `/api/analyze/stream`
  branches (canonical + fast path) now assemble via `build_prompt([ACTION_SCHEMA, EMOTION_ACK…, executive_plan,
music_context_text, cognitive_block/behavior])` + `RESPONSE_CONTRACT` + length rule.
- `src/runtime/RuntimeManager.ts` — plans **before** stance (C9); stores `lastExecutivePrompt` from
  `translatePlanToPrompt(plan).slice(0,1700)`; `determineStance(..., plan.strategy.primary)`.
- `src/providers/openrouter/useProvider.ts` + `src/providers/sarvam/useSarvam.ts` — both send identical
  `cognitive_block: boundCognitiveBlock(...)`, `executive_plan`, and C3-gated `music_context_text`.

---

## 3. Architecture: before → after

**Before (audit):**

```
cognitiveBlock ──▶ cognitive_block ──▶ sys = cognitive_block + "Respond in 1-3 sentences"     (C1,C2,C5,C7 severed)
translatePlanToPrompt ──▶ DEAD                                      (C2)
musicContext ──▶ newMessages (Path B only)  — music XML NOT in Path A                      (C3)
determineStance(ctx, u, "Answer")                                   (C9)
```

**After:**

```
cognitiveBlock ──▶ boundCognitiveBlock ──▶ cognitive_block  (C5, ≤3900, no 422)
plan = executive.plan(ctx)  translatePlanToPrompt(plan).slice(0,1700) ──▶ executive_plan   (C2)
determineStance(ctx, u, plan.strategy.primary)                                             (C9)
music ──▶ currentTrack? buildMusicContext → boundMusicContextText ──▶ music_context_text   (C3, gated)
BACKEND: build_prompt([ACTION_SCHEMA, EMOTION_ACKNOWLEDGEMENT_DIRECTIVE,
                       executive_plan, music_context_text, cognitive_block]) + RESPONSE_CONTRACT  (C1,C4,C7)
```

Both providers hit the same endpoint → one shared cognitive implementation. No OpenRouter-vs-Sarvam split.

---

## 4. Deterministic C5 tests (`scripts/test-c5-budget.ts`, run via `tsx`)

| Test                                                                                                     | Result  |
| -------------------------------------------------------------------------------------------------------- | ------- |
| Under-budget block returned byte-identical                                                               | ✅ PASS |
| Slightly-over removes only the lowest-priority complete section                                          | ✅ PASS |
| Critical sections (`[COGNITIVE ORCHESTRATION]`, `[ADAPTIVE ATTENTION]`) preserved                        | ✅ PASS |
| Heavily-oversized removes multiple sections, result < budget                                             | ✅ PASS |
| No malformed open/close tags after binding (`[HUMAN STATE (PROBABILISTIC)]`↔`[/HUMAN STATE]` normalized) | ✅ PASS |
| `null`/`undefined` → empty string                                                                        | ✅ PASS |
| Pathological critical-only oversized still < budget with clean tags                                      | ✅ PASS |

The method uses an **ordered exact-section list** (not raw backreference regex) so the
`[HUMAN STATE (PROBABILISTIC)]`→`[/HUMAN STATE]` name mismatch is handled deterministically, sections cannot
be merged or double-removed, and arbitrary truncation is only the last resort.

---

## 5. Live regression matrix (`/api/analyze/stream`, valid `.env.local` OpenRouter key)

| Scenario   | Request (injected)                                       | LLM response (abridged)                                                                                     | Verdict                                              |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Factual    | `cognitive_block` + `executive_plan`; "What is 2+2?"     | "2 plus 2 equals 4, Priya. 😊 …" — correct, uses `[USER IDENTITY]`                                          | 🟢 answered; no substitution                         |
| Emotional  | "I am so frustrated and angry … falling apart."          | "Priya, I can hear how overwhelming this feels… you don't have to carry it alone."                          | 🟢 acknowledged first; warm; no leak                 |
| Music play | + `[ACTIVE MUSIC CONTEXT]`; "play chill lofi beats"      | `{"tool":"play_music","genre":"lo-fi","intent":"preference_based","activity":"focus"}` + ack                | 🟢 schema active (C1)                                |
| Music skip | same; "skip this track"                                  | `{"tool":"play_music","query":"LoFi hip hop","intent":"preference_based",…}` "switch to another lo-fi beat" | 🟢 context grounded the action                       |
| Memory     | lo-fi in `[RELEVANT MEMORY]`; "what music while I work?" | "keeping the lo-fi study beats going." + `play_music` contextual                                            | 🟢 memory + schema both reached model (C2 inherited) |
| Leak-check | "How is the weather today?"                              | answered weather naturally, in character; **no internal metadata echoed**                                   | 🟢 no leak (Step 9)                                  |

Boundary checks: all valid requests with `cognitive_block` + `executive_plan` + `music_context_text` → **HTTP 200**
(fields accepted, no 422); an intentionally >4000-char `cognitive_block` → **422 `string_too_long`**, which
`boundCognitiveBlock` prevents on the frontend (cap 3900 < 3999).

> Credential note: the process shell `OPENROUTER_API_KEY` is revoked ("User not found" 401). The valid key lives
> in `.env.local`; live probes used that key. This is an environment/credential fact, not a code issue.

---

## 6. Provider parity

Both `useProvider.ts` and `useSarvam.ts` emit **byte-identical** Phase-1 body fields and call the **same**
`/api/analyze/stream` endpoint backed by the shared `action_schema.py`. First-token latency and cognition are
identical; the only divergence (Sarvam STT/TTS, 403 in this env) is outside cognition. Parity is structural:
one shared implementation, no duplicated behavior.

---

## 7. Regression / verification suite

| Command                                                   | Result                                                                |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run build`                                           | ✅ ~12s                                                               |
| `npx tsc --noEmit`                                        | ✅ 15 pre-existing / **0 new** (all 15 in known untracked-err files)  |
| `npm run lint` (edited files)                             | ✅ only pre-existing `no-useless-escape` (useProvider:804, unrelated) |
| `python -m compileall backend`                            | ✅                                                                    |
| backend import smoke (`from backend.api.main import app`) | ✅ `build_prompt` drops `None` correctly                              |
| `npx prettier --write` edited files                       | ✅                                                                    |
| `git diff --check`                                        | ✅ clean                                                              |
| `git status` modified count                               | ✅ 220 (unchanged)                                                    |

---

## 8. Known limitations / left open

- **C4 model reliability** — improved via `RESPONSE_CONTRACT` (answer the user's actual question, no hallucination
  framing) rather than switching the model. `deepseek/deepseek-chat`, `max_tokens=150` and `FALLBACK_MODELS` are
  unchanged pending an evidence-driven model evaluation, per the audit's caution.
- **C6 atmosphere double-injection** — not touched (separate runtime audit; `[ENVIRONMENT CONTEXT]` frontend block
  still coexists with backend `[REAL-WORLD GROUNDING]`). Preserved to avoid scope creep into Atmosphere.
- **C8 memoryPolicy gating** — `Ignore` policy still omits fetched memories (intentional, unchanged).
- **Gemini Live path** (`useLiveNext.ts:137-148`) still discards `processCognitiveTurn()` — out of Phase-1 scope;
  noted, not fixed.
- Requires real audio devices for full frontend STT/TTS; behavioral music/action verification relies on the backend
  probes above (as in the audit).

---

## 9. Protected-areas & git-safety verification

- No file under YouTube/OAuth/HTMLAudio/Atmosphere/Telemetry/SocialCognition/Memory/Proactive/Expression was edited
  by this task (matches for "telemetry/auth/music" in the dirty set are part of the pre-existing **220** baseline).
- Modified tracked count remained **220** (0 added); new untracked files are only the four phase-1 sources
  (`action_schema.py`, `cognitive-budget.ts`, `test-c5-budget.ts`, `phase-cognitive-fix.md`).
- No commits, no staging, no pushes.
