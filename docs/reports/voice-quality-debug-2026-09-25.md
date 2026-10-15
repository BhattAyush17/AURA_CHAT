# Voice quality debugging — 2026-09-25

## Findings and trace reconstruction

Used the workspace's `skills/debugger.md` and Verify-tier codebase-memory discovery. The `aura-chat` graph generation was `2026-09-08T10:05:49Z`; coverage reported changed metadata for the provider/backend files. Current source and executable reproductions were used to verify findings. Graph call edges were incomplete/inaccurate in this scope, so imports and call sites were checked in source. This is a bounded review, not a claim that every voice path is correct.

No live failing TurnEnvelope or recorded audio was supplied. The traces below are deterministic local reproductions, without live providers or a microphone; they have no production trace ID, nonce, or failure timestamp. Stage names map the debugger skill onto the current voice runtime.

| Finding                                          | Reconstructed trace and root cause                                                                                                                                                                           | Change                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Gemini can remain stuck speaking                 | S7 generation complete → S9 buffered audio → playback callback rejected because the generation-complete event incremented its nonce → turn completion and microphone release never run.                      | Keep callbacks valid through playback drain; invalidate them on interruption, reconnect, and stop.                                                                             |
| Current utterance missing from LLM history       | S5 builds `newMessages` with the latest user turn → queues a React state update → S7 serializes the old `messagesRef`. Hidden prompts never enter that state at all.                                         | Send the explicit per-turn `newMessages` snapshot in both providers.                                                                                                           |
| Older analysis starts a newer physical request   | Turn A waits for behavior analysis → turn B begins → A finishes and overwrites the shared fetch controller, despite A's nonce being stale.                                                                   | Check the nonce after behavior analysis and cognitive assembly, before proceeding.                                                                                             |
| Stream failures masquerade as completion         | S7 parser silently ignores provider error frames and `finish_reason=length`; frontend then throws an error event inside a catch that swallows it as a JSON parse failure. Backend emits `done` after errors. | Surface provider/malformed/truncated/incomplete streams as errors, record structured reasons, propagate frontend non-parse errors, and end the endpoint after its error event. |
| Sarvam can repeat a partial response on fallback | S7 emits text → S9 may begin playback → stream fails → a fresh direct generation can start the answer again.                                                                                                 | Stop playback and preserve a marked partial response in history; return control to the user instead of regenerating it.                                                        |

## Degraded lanes

- Failure before response text still reaches the existing direct-provider fallback.
- OpenRouter already had partial-response recovery, but swallowed SSE errors bypassed it. Those errors now reach that recovery.
- Sarvam partial-response failures now terminate the pending speech queue, mark the response interrupted, and return to listening/idle.
- Length-limited or disconnected backend streams are observable through `llm_stream_incomplete`; invalid JSON and upstream errors have separate events. These logs include the model and finish reason where available, without logging speech content.
- Gemini interruption/reconnect/stop callbacks cannot decrement a replacement turn's audio count.

## Remaining flaws and recommended verification

These remain open; their existence in source is verified, but their audible severity has not been measured here.

1. **Inconsistent response limits:** backend streaming uses 150 output tokens; the OpenRouter direct fallback uses 80; Sarvam direct fallback uses 250. Hard token limits can end a sentence prematurely. The backend now reports truncation, but this does not prevent it. Measure truncation frequency and choose a common budget policy compatible with executive response-length decisions.
2. **Different repetition controls:** backend requests use frequency/presence penalties of 0.1/0.1; direct frontend requests use frequency penalty 0.5 and omit presence penalty. The same conversation can change behavior after fallback. Treating “regularisation” as repetition control, no penalty tuning was attempted without English/Hinglish conversational evaluation.
3. **Sarvam start delay:** the backend speech path waits for two sentences or stream completion. A one-sentence reply therefore waits for the entire generation. Measure time to first audible playback before changing this buffering tradeoff.
4. **Punctuation/prosody:** browser speech helpers replace commas with semicolons and remove final punctuation. This changes the engine's prosody cues. Verify questions, lists, abbreviations, and Hinglish with the actual selected voices before adjusting it.
5. **Generated versus heard context:** provider history generally records generated text, not an exact playback-aligned transcript. The partial-response marker identifies failure but does not tell the model precisely which words were audible.

The disconnected `generate_response` helper also retains an old-answer fallback. Source search found no production call site in this review; it was not treated as the cause of the active streaming issue.

## Files and risks

Production changes: `GeminiVoiceEngine.ts`, OpenRouter `useProvider.ts`, Sarvam `useSarvam.ts`, `backend/core/intelligence/llm_pipeline.py`, and the streaming endpoint in `backend/api/main.py`. Existing local interruption-related edits were retained.

The main behavioral change is that an incomplete stream now ends visibly in the degraded path instead of appearing successful. Some providers that omit a terminal finish reason will now be classified as incomplete. Partial generated text can still differ from what the user actually heard. No generation penalties, token budgets, architectural contracts, or behavior-injection thresholds were changed in this pass.

## Verification

- `node scripts/test-voice-quality-regressions.cjs`: 9 scenarios covering actual production callbacks with mocked transport/audio boundaries: buffered playback, interrupted/stopped playback, current and hidden utterances on both providers, midstream failures without regeneration, and superseded analysis.
- `venv/bin/python -m unittest backend.tests.test_stream_quality_regressions`: 5 tests covering clean completion/usage frames, upstream errors, length truncation, abrupt stream closure, and malformed JSON. This test file is local under the repository's ignored `backend/tests/` directory.
- The initial reproductions failed for playback, all four current/hidden-history cases, both superseded-analysis cases, and backend error/truncation handling before the corresponding fixes.
- `tsc --noEmit`: passed. Targeted ESLint on the three changed frontend provider files: zero errors, 87 warnings. `git diff --check`: passed.
- Live voice fluency, latency, repetition rate, and subjective response quality still require microphone/provider evaluation.

Recommended live sequence: an English question, a Hinglish follow-up requiring prior context, an interruption halfway through playback, a correction while analysis is pending, a long answer that approaches the token cap, and a forced provider failure. Check playback releases, latest-turn relevance, absence of answer replay, and degraded-path telemetry.

## Live browser observation — 2026-09-26

A live Gemini session was started in the in-app browser with the environment-configured credential. The user reported that AURA audibly repeated itself during the first turn.

Observed sequence:

1. Gemini connected successfully and the UI entered `LISTENING`.
2. Local VAD reported speech/barge-in events, but the diagnostic transcript remained `Listening…` rather than displaying a complete user turn.
3. AURA executed one `playYouTubeMusic` action for `Counting Stars by OneRepublic`. The music service selected and started the track successfully.
4. Immediately after playback started, local VAD fired again and `NATIVE BARGE-IN DETECTED` flushed the speech coordinator. The UI briefly exposed the incomplete transcript `you play`.
5. The local conversation archive remained empty, so the exact generated/repeated words were not retained for textual comparison.
6. After the music was paused for a clean follow-up question, Gemini entered repeated close/reconnect cycles. `VoiceHealthWatchdog` reported `RESPONSE_STALL: No server messages or audio for > 25000ms`, and the UI ended at `CONNECTION FAILED AFTER MULTIPLE RECOVERY ATTEMPTS` before a second answer could be collected.

Assessment:

- **Audible repetition: confirmed by the user.** The event trace is consistent with output/playback leaking into the input path, triggering barge-in and replay/recovery behavior. The trace does not prove that the model generated duplicate text because output transcription was not persisted.
- **Single-question handling: failed.** One music request produced an action, playback, repeated local voice detections, an interrupted response, and recovery churn instead of one stable response cycle.
- **Context-flow evaluation: blocked after turn one.** The second clean question never reached a completed response because the voice session failed recovery.
- **Telemetry gap:** Gemini output text and the audible cutoff position were not retained after interruption. The archive reported no conversations despite the action and partial transcript, preventing exact duplicate-string analysis.

Recommended next fixes are to gate microphone VAD against both AURA speech and music playback, prevent recovery from replaying an interrupted turn, persist interrupted input/output transcription with turn and nonce identifiers, and reset the watchdog's stall baseline on each successful reconnect.

### Trace window beginning 2026-09-26T05:17:48.828Z

This window was requested explicitly to trace every vocal turn from that point onward.

| Time (UTC)                    | Speaker/event              | Captured content                                                        | Result                                                                                                                                                               |
| ----------------------------- | -------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 05:18:03.625–05:18:03.934     | Local VAD                  | Two speech confirmations                                                | Duplicate local detections occurred before the visible transcript completed.                                                                                         |
| 05:18:08.967                  | User transcript            | `आज का मौसम कैसा है?`                                                   | One clear Hindi weather question.                                                                                                                                    |
| 05:18:14.839–05:18:15.096     | Runtime/cognition activity | Cognition and expression telemetry followed by repeated music telemetry | A turn was processed, but the generated output transcript was not exposed or archived.                                                                               |
| user-observed after the turn  | AURA audio                 | Same weather answer delivered in Hindi and English                      | **Bilingual semantic duplicate confirmed by the user.** One question produced two language versions instead of one answer matching the input language.               |
| 05:18:34.837 and 05:18:46.668 | Local VAD                  | Additional speech confirmations                                         | Input continued to trigger local VAD without a durable turn transcript.                                                                                              |
| 05:18:46.804                  | Watchdog                   | `RESPONSE_STALL: No server messages or audio for > 25000ms`             | Session teardown and recovery began.                                                                                                                                 |
| 05:18:48.076                  | Gemini session             | `CONNECTED`                                                             | Recovery initially succeeded.                                                                                                                                        |
| 05:18:49.077                  | Watchdog                   | Immediate second `RESPONSE_STALL`                                       | The recovered connection was torn down about one second after connecting, showing that the stall baseline survived reconnect. The UI returned to `TAP MIC TO BEGIN`. |

Language-path finding: the base prompt says to match the user's language, but `GeminiVoiceLanguageAdapter.applyResponseLanguage()` is intentionally a no-op and defers entirely to Gemini's native audio adaptation. The richer language state can describe a dominant and secondary language, but Gemini Live receives no provider-level single-language enforcement. For a pure Hindi question, that leaves room for the model to answer in Hindi and then translate/restate in English.

Classification for this turn:

- Repetition: **FAIL — confirmed bilingual semantic duplicate.**
- Single-sentence/question discipline: **FAIL — one question produced two equivalent language versions.**
- Context continuity: **not measurable beyond this turn** because recovery failed.
- Transcript observability: **FAIL — AURA output audio was not persisted, so exact Hindi/English wording cannot be automatically compared.**

#### Continued vocal trace, 05:20:28–05:24:18 UTC

| Turn | Captured user transcript                                                                                 | Runtime behavior                                                                                                                                                                                    | Assessment                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 2    | `Hey. Dekha.`                                                                                            | Language mapped to `hi-IN`; active Gemini session disconnected; orchestrator logged `Seamless handoff: voice changed while active`; a new session and proactive greeting sequence started.          | Mid-turn language/config handoff creates a direct replay path.                                                      |
| 3    | `Aur bhai kaisa hai?`                                                                                    | Language mapped to Hindi. AURA then executed `playYouTubeMusic` for `hiking music` and started a meditation track.                                                                                  | **Intent drift:** a casual greeting produced an unrelated music action.                                             |
| 4    | `plan ka agar tum weather ka details bata sakte ho to batao.`                                            | Two local VAD events fired while playback/output was active.                                                                                                                                        | **Repeat confirmed by user.** Weather intent remained recognizable despite an apparent STT error in the first word. |
| 5    | `It is something like calming plus adventurous. I need to go somewhere. Because the mosam is very good.` | Four local barge-in events fired, then AURA executed `hiking music` and restarted the meditation track without an explicit play request.                                                            | **Over-inference:** descriptive context was promoted to a music command.                                            |
| 6    | `It's near the mountains. In the Uttarakhand. Valley.`                                                   | Subsequent output generated repeated local VAD events with no new durable user transcript.                                                                                                          | **Repeat confirmed by user** for the Uttarakhand Valley response.                                                   |
| 7    | `Could you play something track related to it?`                                                          | Legitimate music request; search query was `calm hiking music`. The selector returned the exact same track despite reporting `Recent repeat penalty`. Language mapped the English input to `hi-IN`. | Music selection repetition and one-turn language-state lag.                                                         |
| 8    | `It's good.`                                                                                             | One VAD event preceded the transcript; no immediate tool action or session handoff. Four later VAD events occurred while the UI showed only `Listening…`.                                           | No duplicate confirmed for this acknowledgement, but output-to-input feedback remained active.                      |

User-confirmed repeated-response count in this trace window: **3** — bilingual weather answer, weather-details answer, and Uttarakhand Valley answer.

The live evidence now separates three overlapping causes:

1. **Bilingual semantic duplication:** pure Hindi input receives equivalent Hindi and English answers because Gemini's provider adapter does not enforce one response language.
2. **Session replay:** language/voice state changes restart an active Gemini session and launch the proactive greeting sequence again.
3. **Acoustic feedback:** AURA speech or music causes local VAD/barge-in events when no new durable user transcript exists, feeding output back into the turn loop.

There is also an independent intent-routing flaw: non-command conversation about mood, travel, weather, or mountains is repeatedly promoted to a `playYouTubeMusic` action.

From 05:24:25 through 05:24:55 UTC, eight further `Barge-in/speech confirmed via local VAD` events occurred while the UI remained at `Listening…` and exposed no new user transcript. These are not counted as user turns. They show the feedback loop continuing independently of durable speech recognition and explain why repeated or fragmented responses can persist after the user stops speaking.

## Root-cause trace — repetition during speech (2026-09-26, resolved in working tree)

User-reported loop per turn: `Flushing stale streams...` → `NATIVE BARGE-IN DETECTED: Engine truncated output.` → `Barge-in/speech confirmed via local VAD.` → `Enforcing single-language response (turnNonce: N)` → AURA delivers the same answer again.

Mechanisms confirmed in source:

1. **Echo-tail regeneration (primary):** at turn end, `GeminiVoiceEngine.checkTurnEnded()` re-opened the mic-to-server PCM path immediately (`GeminiAudioInput` gates only on `isAuraSpeaking`). AURA's own output ringing in the room streamed back to Gemini; server-side VAD read it as a new user turn and regenerated the same answer. The existing 600ms guard covered only the _local barge-in callback_, not PCM streaming. **Fix:** `echoTailUntil` window in `GeminiVoiceEngine.start()` blocks PCM sends to the server for 600ms after each completed turn.
2. **Mid-speech nonce churn (secondary):** during active AURA speech, the worklet's raised-threshold barge-in still fired on echo → `onUserSpeechDetected` → `setTurnNonce` → language-enforcement directive re-sent mid-turn → model re-answered. Mic PCM is server-gated during speech, so a local barge-in there was never actionable anyway. **Fix:** the engine's local VAD handler now returns early while `isAuraSpeaking`.
3. **Dropped output transcription (observability):** the session configured `outputAudioTranscription: {}` (GeminiSession.ts:62) but never handled `serverContent.outputTranscription` — with `responseModalities: [AUDIO]`, AURA's words exist only there; `modelText` stayed empty, so interrupted turns archived nothing. **Fix:** `onOutputTranscription` now flows Session → Engine → Adapter and accumulates into `currentModelTextRef`; interrupted turns persist the actual audible words via `addInterruptedTurn`.

This complements the earlier same-day fixes (playback-drain nonce, recovery turn-state clearing, watchdog baseline reset, VAD gating vs speech+music) and the language/music policy fixes passed to `GeminiVoiceLanguageAdapter` and `gemini-prompt.ts`.

### Live re-check guidance

Watch the console for turn-boundary behavior: after AURA finishes an answer, no `NATIVE BARGE-IN DETECTED` should appear within ~1s; `Enforcing single-language response` should appear only at real user-turn starts; the transcript archive (`localStorage.aura_transcript_backup`) should now contain AURA's output text marked `[INTERRUPTED]` on truncated turns. Compare consecutive AURA utterances for near-duplicate content after a forced echo (clap near the speaker) to confirm the echo-tail gate holds.

Verification: `tsc --noEmit` pass; eslint on changed provider files 0 errors; `node scripts/test-voice-quality-regressions.cjs` 9/9; backend `test_stream_quality_regressions` 5/5.
