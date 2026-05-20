import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Settings, X, Check, Eye, EyeOff, ChevronDown, RotateCcw } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import { useVoiceOrchestrator } from "@/core/useVoiceOrchestrator";
import { PersonalityMode, PersonalitySelector } from "@/components/PersonalitySelector";
import { getGeminiKey, getOpenRouterKey } from "@/lib/api";
import { StorageSettings } from "@/components/StorageSettings";
import { hasRequiredCredentials } from "@/lib/credentials";
import { MemoryWarningBanner } from "@/components/MemoryWarningBanner";
import { hasLocalSeedOnly, isMemoryWarningDismissed } from "@/lib/sync-meta";
import { getCurrentUserId } from "@/lib/user-identity";
import { LatencyMeter } from "@/components/LatencyMeter";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return <AuraExperience />;
}

function AuraExperience() {
  const [personality, setPersonality] = useState<PersonalityMode>("adaptive");
  const [selectedVoice, setSelectedVoice] = useState("Puck");
  const [showVoiceMenu, setShowVoiceMenu] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [showStorageModal, setShowStorageModal] = useState(false);
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);

  // Settings modal indicator state
  const [dbConnected, setDbConnected] = useState(false);
  const [showKeyHint, setShowKeyHint] = useState(false);

  const [activeBrain, setActiveBrain] = useState<"gemini" | "openrouter" | "sarvam">("gemini");
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false);

  // Compute needsSettings dynamically based on the active brain
  // R07 FIX: Sarvam requires BOTH OpenRouter key (LLM) and Sarvam key (STT/TTS)
  const getSarvamKey = () =>
    sessionStorage.getItem("aura_sarvam_api_key") || import.meta.env.VITE_SARVAM_API_KEY || "";
  const needsSettings =
    activeBrain === "gemini"
      ? !getGeminiKey()
      : activeBrain === "sarvam"
        ? !getOpenRouterKey() || !getSarvamKey()
        : !getOpenRouterKey();

  const hasActiveBrainCredentials = useCallback(() => {
    if (activeBrain === "gemini") return !!getGeminiKey();
    if (activeBrain === "sarvam") return !!getOpenRouterKey() && !!getSarvamKey();
    return !!getOpenRouterKey();
  }, [activeBrain]);

  useEffect(() => {
    setDbConnected(localStorage.getItem("aura_cloud_sync_enabled") === "true");

    // Load default brain
    const savedBrain = localStorage.getItem("aura_active_brain") as
      | "gemini"
      | "openrouter"
      | "sarvam";
    if (savedBrain === "gemini" || savedBrain === "openrouter" || savedBrain === "sarvam") {
      setActiveBrain(savedBrain);
    }
    setHasOpenRouterKey(!!getOpenRouterKey());
  }, []);

  // Check for local-only memory warning
  useEffect(() => {
    const userId = getCurrentUserId();
    if (!userId) return;
    if (isMemoryWarningDismissed(userId)) return;

    if (hasLocalSeedOnly(userId)) {
      setMemoryWarning(
        "AURA's memory is saved on this device only. " +
          "If you clear browser data, memory is lost permanently. " +
          "Add Supabase in Settings to back it up.",
      );
    }
  }, []);

  const VOICE_OPTIONS =
    activeBrain === "sarvam"
      ? [
          { id: "Puck", label: "Puck (Anushka)", desc: "Warm & clear female" },
          { id: "Fenrir", label: "Fenrir (Arvind)", desc: "Bold & confident male" },
          { id: "Kore", label: "Kore (Namrata)", desc: "Calm & steady female" },
          { id: "Charon", label: "Charon (Darshan)", desc: "Smooth & deep male" },
          { id: "Aoede", label: "Aoede (Kavya)", desc: "Soft & gentle female" },
        ]
      : [
          { id: "Puck", label: "Puck", desc: "Warm & clear" },
          { id: "Fenrir", label: "Fenrir", desc: "Bold & confident" },
          { id: "Kore", label: "Kore", desc: "Calm & steady" },
          { id: "Charon", label: "Charon", desc: "Smooth & deep" },
          { id: "Aoede", label: "Aoede", desc: "Soft & gentle" },
        ];

  const pipeline = useVoiceOrchestrator(activeBrain, personality, selectedVoice);

  const {
    status,
    isSpeaking,
    isThinking,
    lastError,
    words,
    startSession,
    endSession,
    getInputFrequencyData,
    getOutputFrequencyData,
    auraState,
    activeModel,
    isActiveVoice,
    updateConfig,
  } = pipeline;

  const tone =
    activeBrain === "gemini" ? auraState?.tone : isThinking ? "Analyzing..." : "Multilingual";
  const intent =
    activeBrain === "gemini" ? auraState?.intent : isThinking ? "Mapping..." : "Steady";
  const brainModel = activeBrain === "gemini" ? "Gemini Live 🎙️" : activeModel || "Unknown";

  const handleMicClick = useCallback(async () => {
    if (!hasActiveBrainCredentials()) {
      setShowKeyHint(true);
      setTimeout(() => setShowKeyHint(false), 3500);
      return;
    }

    if (status === "idle" || status === "error") {
      console.log("[AURA] 🖱️ Starting session...");
      setErrorMsg(null);
      try {
        await startSession();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          message ||
            `Failed to start ${activeBrain === "gemini" ? "Gemini" : activeBrain === "sarvam" ? "Sarvam" : "OpenRouter"} session. Check console.`,
        );
      }
    } else {
      console.log("[AURA] 🖱️ Ending session...");
      endSession();
    }
  }, [status, startSession, endSession, hasActiveBrainCredentials, activeBrain]);

  const handleAudioReset = useCallback(async () => {
    console.log("[AURA] 🔄 Manually resetting audio pipeline and reconnecting...");
    setErrorMsg(null);
    endSession();
    setTimeout(async () => {
      try {
        await startSession();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setErrorMsg(
          message ||
            `Failed to restart ${activeBrain === "gemini" ? "Gemini" : activeBrain === "sarvam" ? "Sarvam" : "OpenRouter"} session.`,
        );
      }
    }, 300);
  }, [endSession, startSession, activeBrain]);

  const errText = errorMsg || lastError;
  const isBillingError = !!(
    errText &&
    (errText.toLowerCase().includes("billing") ||
      errText.toLowerCase().includes("prepaid") ||
      errText.toLowerCase().includes("credits") ||
      errText.includes("1008"))
  );

  // Reset errorDismissed when a new error occurs
  useEffect(() => {
    if (errText) {
      setErrorDismissed(false);
    }
  }, [errText]);

  return (
    <main className="relative min-h-screen bg-background text-foreground overflow-x-hidden font-body">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-10 selection:bg-foreground selection:text-background">
        {/* Header */}
        <header className="flex w-full items-center justify-between py-6">
          <div className="flex items-center">
            <select
              value={activeBrain}
              onChange={(e) => {
                const target = e.target.value as "gemini" | "openrouter" | "sarvam";
                setActiveBrain(target);
                localStorage.setItem("aura_active_brain", target);
                // End active session of the other brain
                if (status !== "idle") {
                  endSession();
                }
              }}
              className="bg-transparent border border-border/30 text-[9px] uppercase tracking-[0.2em] font-black text-muted-foreground hover:text-foreground hover:border-foreground/50 rounded px-2 py-1 outline-none transition-all duration-200 cursor-pointer"
            >
              <option value="gemini" className="bg-background text-foreground">
                Gemini Live 🎙️
              </option>
              <option value="openrouter" className="bg-background text-foreground">
                OpenRouter 🚀
              </option>
              <option value="sarvam" className="bg-background text-foreground">
                Sarvam AI 🇮🇳
              </option>
            </select>
          </div>
          <h1 className="text-2xl font-black uppercase tracking-[0.25em] text-foreground">
            AURA CHAT
          </h1>
          <div className="flex items-center gap-3">
            {(status === "listening" ||
              status === "speaking" ||
              status === "thinking" ||
              status === "error") && (
              <button
                onClick={handleAudioReset}
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-all duration-200"
                title="Reset Mic & Connection"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
            <div
              className={`h-2 w-2 rounded-full transition-all duration-300 ${!needsSettings ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]" : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]"}`}
              title={!needsSettings ? "Ready to Chat" : "API Key Required"}
            />
            <button
              onClick={() => setShowStorageModal(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-full border border-border text-muted-foreground hover:border-foreground hover:text-foreground transition-all duration-200"
              title="Settings"
            >
              <Settings className="h-4 w-4" strokeWidth={1.5} />
              {needsSettings && (
                <span className="absolute top-[10px] right-[10px] h-1.5 w-1.5 rounded-full bg-foreground" />
              )}
            </button>
          </div>
        </header>

        {/* Storage Settings Modal */}
        {showStorageModal && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto"
            onClick={() => {
              setShowStorageModal(false);
              setDbConnected(localStorage.getItem("aura_cloud_sync_enabled") === "true");
              setHasOpenRouterKey(!!getOpenRouterKey());
            }}
          >
            <div
              className="w-full max-w-2xl animate-in fade-in zoom-in duration-200 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {hasActiveBrainCredentials() && (
                <button
                  onClick={() => setShowStorageModal(false)}
                  className="absolute -top-12 right-0 text-white/50 hover:text-white transition-colors flex items-center gap-2 text-xs uppercase tracking-widest"
                >
                  Close <X className="w-4 h-4" />
                </button>
              )}
              <StorageSettings
                onClose={() => {
                  setShowStorageModal(false);
                  setDbConnected(localStorage.getItem("aura_cloud_sync_enabled") === "true");
                  setHasOpenRouterKey(!!getOpenRouterKey());
                }}
              />
            </div>
          </div>
        )}

        {/* Memory Warning Banner */}
        {memoryWarning && (
          <MemoryWarningBanner
            userId={getCurrentUserId()}
            message={memoryWarning}
            onDismiss={() => setMemoryWarning(null)}
          />
        )}

        {/* Center Canvas */}
        <section className="mt-20 flex flex-1 flex-col items-center w-full relative">
          <AnimatePresence>
            {showKeyHint && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -top-14 z-10 flex items-center justify-center rounded border border-border bg-muted/80 px-4 py-2 text-xs text-foreground backdrop-blur shadow-sm"
              >
                Please add{" "}
                {activeBrain === "gemini"
                  ? "a Gemini"
                  : activeBrain === "sarvam"
                    ? "OpenRouter + Sarvam"
                    : "an OpenRouter"}{" "}
                key via the gear icon
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={handleMicClick}
            disabled={status === "connecting"}
            className={`flex h-28 w-28 items-center justify-center rounded-full border-2 transition-all duration-300 ${
              status === "listening" || status === "speaking" || status === "thinking"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-transparent text-foreground hover:border-foreground"
            } disabled:opacity-50`}
          >
            {status === "listening" || status === "speaking" || status === "thinking" ? (
              <Square className="h-10 w-10" fill="currentColor" />
            ) : status === "connecting" ? (
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            ) : (
              <Mic className="h-10 w-10" strokeWidth={1.5} />
            )}
          </button>

          <div className="mt-6 flex h-6 items-center justify-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {status === "idle" && "tap mic to begin"}
            {status === "connecting" && "connecting…"}
            {(status === "listening" || status === "speaking" || status === "thinking") &&
              (isSpeaking ? "aura is speaking" : isThinking ? "aura is thinking…" : "listening")}
          </div>

          {(status === "listening" || status === "speaking" || status === "thinking") && (
            <div className="mt-8 w-full max-w-md">
              <div className="h-20 w-full mb-8">
                <Waveform
                  active
                  getFrequencyData={isSpeaking ? getOutputFrequencyData : getInputFrequencyData}
                  color={isSpeaking ? "#ffffff" : "#666666"}
                  isVADActive={
                    !isSpeaking &&
                    (activeBrain === "gemini" ? isActiveVoice : status === "listening")
                  }
                />
              </div>
            </div>
          )}
        </section>

        {/* Personality Toggle Container */}
        <section className="mt-8 w-full max-w-lg">
          <p className="mb-4 text-center text-[9px] uppercase tracking-[0.4em] text-muted-foreground">
            personality
          </p>
          <PersonalitySelector
            value={personality}
            onChange={(p) => {
              setPersonality(p);
              if (status === "listening" && activeBrain === "gemini" && updateConfig) {
                updateConfig(undefined, p);
              }
            }}
            disabled={status === "connecting"}
          />
        </section>

        {/* Voice Selector (For Gemini and Sarvam) */}
        {(activeBrain === "gemini" || activeBrain === "sarvam") && (
          <section className="mt-6 w-full max-w-lg">
            <p className="mb-4 text-center text-[9px] uppercase tracking-[0.4em] text-muted-foreground">
              voice
            </p>
            <div className="relative">
              <button
                onClick={() => setShowVoiceMenu((v) => !v)}
                disabled={status === "connecting"}
                className="flex w-full items-center justify-between rounded-2xl border border-border bg-muted/10 px-5 py-3 text-sm text-foreground backdrop-blur-sm transition-all hover:border-foreground/30 disabled:opacity-50"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">{selectedVoice}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {VOICE_OPTIONS.find((v) => v.id === selectedVoice)?.desc}
                  </span>
                </div>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showVoiceMenu ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {showVoiceMenu && (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
                    animate={{ opacity: 1, y: 0, scaleY: 1 }}
                    exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-10 mt-2 w-full origin-top overflow-y-auto max-h-[140px] custom-scrollbar overscroll-contain rounded-2xl border border-border bg-background/95 backdrop-blur-md shadow-lg"
                  >
                    {VOICE_OPTIONS.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => {
                          setSelectedVoice(v.id);
                          setShowVoiceMenu(false);
                          if (updateConfig) updateConfig(v.id, undefined);
                        }}
                        className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition-colors ${
                          selectedVoice === v.id
                            ? "bg-foreground/10 text-foreground"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                        }`}
                      >
                        <span className="font-medium">{v.label}</span>
                        <span className="text-[10px] text-muted-foreground/60">{v.desc}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        )}

        {/* Integrated Internal Analysis (Thinking Box) */}
        <AnimatePresence mode="wait">
          {(isThinking || words) && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="mt-8 w-full max-w-lg"
            >
              <div className="flex flex-col gap-4 rounded-[1.5rem] border border-border/50 p-6 text-left bg-muted/5 backdrop-blur-sm relative overflow-hidden">
                {isThinking && !isSpeaking && (
                  <motion.div
                    className="absolute inset-0 bg-foreground/[0.02]"
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                  />
                )}

                <div className="flex flex-col gap-1">
                  <span className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/40">
                    {isThinking && !isSpeaking ? "AURA IS PERCEIVING..." : "USER TRANSCRIPT"}
                  </span>
                  <span className="text-sm italic text-foreground leading-relaxed min-h-[1.25rem]">
                    {words ? `"${words}"` : isThinking ? "Processing input..." : "..."}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-4 border-t border-border/20 pt-4 mt-2">
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/40">
                      DETECTED TONE
                    </span>
                    <span className="text-xs text-foreground/80 font-medium">{tone}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/40">
                      INTENT
                    </span>
                    <span className="text-xs text-foreground/70 line-clamp-1">{intent}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[8px] uppercase tracking-[0.3em] text-muted-foreground/40">
                      ACTIVE BRAIN
                    </span>
                    <span
                      className="text-xs text-foreground/70 font-semibold truncate"
                      title={brainModel}
                    >
                      {activeBrain === "gemini"
                        ? "Gemini Live 🎙️"
                        : activeBrain === "sarvam"
                          ? "Sarvam Native 🇮🇳"
                          : brainModel === "openrouter/free"
                            ? "Auto Free 🚀"
                            : brainModel.replace(":free", "").split("/").pop()}
                    </span>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Error */}
        <AnimatePresence>
          {errText &&
            !errorDismissed &&
            (isBillingError ? (
              <motion.div
                initial={{ opacity: 0, y: 12, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.95 }}
                className="mt-8 w-full max-w-lg rounded-[2rem] border border-red-500/20 bg-red-950/20 p-6 text-left backdrop-blur-xl relative overflow-hidden shadow-[0_8px_32px_0_rgba(239,68,68,0.1)] z-10"
              >
                {/* Dynamic decorative light spot in the background */}
                <div className="absolute -top-24 -right-24 h-48 w-48 rounded-full bg-red-500/10 blur-[60px]" />

                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
                    <Settings className="h-5 w-5 animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-red-400">
                      Live API Activation Required
                    </h3>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                      Google AI Studio • Paid Tier (Tier 1)
                    </p>
                  </div>
                </div>

                <p className="text-sm text-foreground/90 leading-relaxed mb-5">
                  The real-time Multimodal Live API (WebSocket) requires your Google AI Studio
                  project to be on the <strong>Paid Tier (Tier 1)</strong> with billing enabled and
                  a positive prepay credit balance of at least <strong>$10</strong>.
                </p>

                <div className="space-y-3 mb-6">
                  <div className="flex gap-3 items-start">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-bold text-foreground">
                      1
                    </span>
                    <p className="text-xs text-foreground/80 pt-0.5">
                      Go to{" "}
                      <a
                        href="https://aistudio.google.com/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:text-foreground font-semibold"
                      >
                        Google AI Studio
                      </a>
                      .
                    </p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-bold text-foreground">
                      2
                    </span>
                    <p className="text-xs text-foreground/80 pt-0.5">
                      Click <strong>"Set up billing"</strong> under your active project.
                    </p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-bold text-foreground">
                      3
                    </span>
                    <p className="text-xs text-foreground/80 pt-0.5">
                      Link a billing account and make a prepay deposit (min. <strong>$10</strong>).
                    </p>
                  </div>
                  <div className="flex gap-3 items-start">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground/10 text-[10px] font-bold text-foreground">
                      4
                    </span>
                    <p className="text-xs text-foreground/80 pt-0.5">
                      Set a <strong>Project Spend Cap</strong> (e.g. $10) so you never spend a cent
                      more.
                    </p>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <a
                    href="https://aistudio.google.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 flex h-11 items-center justify-center rounded-2xl bg-foreground text-background font-medium text-xs hover:opacity-90 transition-opacity uppercase tracking-wider text-center"
                  >
                    Configure AI Studio Billing
                  </a>
                  <button
                    onClick={() => {
                      setErrorDismissed(true);
                    }}
                    className="flex h-11 px-5 items-center justify-center rounded-2xl border border-border hover:border-foreground/30 text-muted-foreground hover:text-foreground text-xs transition-colors uppercase tracking-wider"
                  >
                    Dismiss
                  </button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-6 max-w-md rounded-2xl border border-foreground bg-foreground px-5 py-3 text-center text-sm text-background relative flex items-center justify-between gap-4"
              >
                <div className="text-left font-medium">{errText}</div>
                <button
                  onClick={() => {
                    setErrorDismissed(true);
                  }}
                  className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  <X className="w-4 h-4 bg-background text-foreground rounded-full p-0.5" />
                </button>
              </motion.div>
            ))}
        </AnimatePresence>

        <footer className="mt-12 pb-8 text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
          built for soothing and mindful conversations
        </footer>
      </div>

      <LatencyMeter
        visible={status === "listening" || status === "speaking" || status === "thinking"}
        activeBrain={activeBrain}
      />
    </main>
  );
}
