import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Square, Settings, X, Check, Eye, EyeOff, ChevronDown } from "lucide-react";
import { Waveform } from "@/components/Waveform";
import { useGeminiLive } from "@/hooks/useGeminiLive";
import { PersonalityMode, PersonalitySelector } from "@/components/PersonalitySelector";
import { getGeminiKey } from "@/lib/api";
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
  const [showStorageModal, setShowStorageModal] = useState(false);
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);

  // Settings modal indicator state
  const [needsSettings, setNeedsSettings] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);
  const [showKeyHint, setShowKeyHint] = useState(false);

  useEffect(() => {
    setNeedsSettings(!hasRequiredCredentials());
    setDbConnected(localStorage.getItem("aura_cloud_sync_enabled") === "true");
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

  const VOICE_OPTIONS = [
    { id: "Puck", label: "Puck", desc: "Warm & clear" },
    { id: "Fenrir", label: "Fenrir", desc: "Bold & confident" },
    { id: "Kore", label: "Kore", desc: "Calm & steady" },
    { id: "Charon", label: "Charon", desc: "Smooth & deep" },
    { id: "Aoede", label: "Aoede", desc: "Soft & gentle" },
  ] as const;

  const {
    status,
    isSpeaking,
    isThinking,
    volume,
    isActiveVoice,
    auraState,
    memories,
    lastError,
    getInputFrequencyData,
    getOutputFrequencyData,
    startSession,
    endSession,
    updateConfig,
  } = useGeminiLive(personality, selectedVoice);

  const handleStartSession = useCallback(async () => {
    setErrorMsg(null);
    try {
      await startSession();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorMsg(message || "Failed to start Gemini session. Check console.");
    }
  }, [startSession]);

  const handleMicClick = () => {
    if (!hasRequiredCredentials()) {
      setShowKeyHint(true);
      setTimeout(() => setShowKeyHint(false), 3500);
      setNeedsSettings(true);
      return;
    }

    if (status === "idle") void handleStartSession();
    else if (status === "listening") endSession();
  };

  return (
    <main className="relative min-h-screen bg-background text-foreground overflow-x-hidden font-body">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center px-6 py-10 selection:bg-foreground selection:text-background">
        {/* Header */}
        <header className="flex w-full items-center justify-between py-6">
          <div className="w-10" /> {/* Spacer */}
          <h1 className="text-2xl font-black uppercase tracking-[0.25em] text-foreground">
            AURA CHAT
          </h1>
          {/* Storage Settings toggle button */}
          <div className="flex items-center gap-3">
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
              setNeedsSettings(!hasRequiredCredentials());
              setDbConnected(localStorage.getItem("aura_cloud_sync_enabled") === "true");
            }}
          >
            <div
              className="w-full max-w-2xl animate-in fade-in zoom-in duration-200 relative"
              onClick={(e) => e.stopPropagation()}
            >
              {hasRequiredCredentials() && (
                <button
                  onClick={() => setShowStorageModal(false)}
                  className="absolute -top-12 right-0 text-white/50 hover:text-white transition-colors flex items-center gap-2 text-xs uppercase tracking-widest"
                >
                  Close <X className="w-4 h-4" />
                </button>
              )}
              <StorageSettings onClose={() => {
                setShowStorageModal(false);
                setNeedsSettings(!hasRequiredCredentials());
                setDbConnected(localStorage.getItem("aura_cloud_sync_enabled") === "true");
              }} />
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
          {/* Key Hint Tooltip */}
          <AnimatePresence>
            {showKeyHint && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -top-14 z-10 flex items-center justify-center rounded border border-border bg-muted/80 px-4 py-2 text-xs text-foreground backdrop-blur shadow-sm"
              >
                Please add a Gemini key via the gear icon
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={handleMicClick}
            disabled={status === "connecting"}
            className={`flex h-28 w-28 items-center justify-center rounded-full border-2 transition-all duration-300 ${status === "listening"
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-transparent text-foreground hover:border-foreground"
              } disabled:opacity-50`}
          >
            {status === "listening" ? (
              <Square className="h-10 w-10" fill="currentColor" />
            ) : status === "connecting" ? (
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            ) : (
              <Mic className="h-10 w-10" strokeWidth={1.5} />
            )}
          </button>

          {/* Status */}
          <div className="mt-6 flex h-6 items-center justify-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            {status === "idle" && "tap mic to begin"}
            {status === "connecting" && "connecting…"}
            {status === "listening" &&
              (isSpeaking ? "aura is speaking" : isThinking ? "aura is thinking…" : "listening")}
          </div>

          {/* Live waveform */}
          {status === "listening" && (
            <div className="mt-8 w-full max-w-md h-20">
              <Waveform
                active
                getFrequencyData={isSpeaking ? getOutputFrequencyData : getInputFrequencyData}
                color={isSpeaking ? "#ffffff" : "#666666"}
                isVADActive={!isSpeaking && isActiveVoice}
              />
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
              if (status === "listening") {
                updateConfig(undefined, p);
              }
            }}
            disabled={status === "connecting"}
          />
        </section>

        {/* Voice Selector */}
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
                className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${showVoiceMenu ? "rotate-180" : ""
                  }`}
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
                        const changed = selectedVoice !== v.id;
                        setSelectedVoice(v.id);
                        setShowVoiceMenu(false);
                        if (changed && status === "listening") {
                          updateConfig(v.id, undefined);
                        }
                      }}
                      className={`flex w-full items-center justify-between px-5 py-3 text-left text-sm transition-colors ${selectedVoice === v.id
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

        {/* Realtime Internal Analysis */}
        {auraState && (
          <section className="mt-12 w-full max-w-lg">
            <p className="mb-4 text-center text-[9px] uppercase tracking-[0.4em] text-muted-foreground">
              aura's internal analysis
            </p>
            <div className="flex flex-col gap-5 rounded-[2rem] border border-border p-6 text-left bg-muted/10 backdrop-blur-sm">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
                  User Transcript
                </span>
                <span className="text-sm italic text-foreground leading-relaxed">
                  "{auraState.words}"
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
                  Detected Tone
                </span>
                <span className="text-sm text-foreground font-medium">{auraState.tone}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground/50">
                  Perceived Intent
                </span>
                <span className="text-sm text-foreground/80">{auraState.intent}</span>
              </div>
            </div>
          </section>
        )}

        {/* Error */}
        <AnimatePresence>
          {(errorMsg || lastError) && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-6 max-w-md rounded-2xl border border-foreground bg-foreground px-5 py-3 text-center text-sm text-background"
            >
              {errorMsg || lastError}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="mt-12 pb-8 text-center text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60">
          built for soothing and mindful conversations
        </footer>
      </div>

      <LatencyMeter visible={status === "listening"} />
    </main>
  );
}
