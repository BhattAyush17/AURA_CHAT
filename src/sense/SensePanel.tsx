/**
 * AURA Sense — SensePanel
 *
 * Premium floating panel opened by the ⚡ nav button.
 * Implements the full UX specification:
 * - Capability Explanation Sheet before OAuth
 * - 2-second Activation Animation sequence after auth
 * - Disconnect Confirmation Dialog
 * - Human-centric success toasts & state display
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Zap, Check, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { useMusicPlayer } from "../music/useMusicPlayer";
import { SenseManager } from "@/sense/SenseManager/SenseManager";
import type { SenseRegistryEntry, SenseStatusCode } from "@/sense/SenseManager/types";

interface SensePanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function statusDot(code: SenseStatusCode): string {
  switch (code) {
    case "active":      return "bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]";
    case "connected":   return "bg-green-500/60";
    case "connecting":  return "bg-yellow-400 animate-pulse";
    case "error":       return "bg-red-400";
    default:            return "bg-foreground/10";
  }
}

// ─── Always-Active Memory Card ────────────────────────────────────────
function MemoryCard() {
  return (
    <div className="rounded-2xl border border-border/40 bg-foreground/[0.03] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="text-lg">🧠</span>
          <div>
            <p className="text-xs font-semibold text-foreground tracking-wide">Memory</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Long-term cognitive continuity</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.8)]" />
          <span className="text-[10px] uppercase tracking-[0.15em] text-green-400">Always Active</span>
        </div>
      </div>
    </div>
  );
}

// ─── Capability Explanation Sheet Modal ────────────────────────────────
interface ExplanationSheetProps {
  displayName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function CapabilityExplanationSheet({ displayName, onConfirm, onCancel }: ExplanationSheetProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-50 flex flex-col justify-between bg-[oklch(0.06_0_0)] p-6 backdrop-blur-3xl"
    >
      <div>
        <div className="flex items-center gap-2 text-foreground/80 mb-2">
          <Sparkles className="h-4 w-4 text-amber-400" />
          <h3 className="text-sm font-bold uppercase tracking-wider">{displayName}</h3>
        </div>

        <p className="text-xs text-foreground/90 font-medium leading-relaxed mb-4">
          Aura doesn't just play music. It understands how music fits into your conversations and emotional context.
        </p>

        <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-2 font-semibold">
          With your permission Aura can
        </p>

        <div className="space-y-2 mb-4">
          {[
            "Know what's currently playing",
            "Control playback through voice",
            "Understand listening patterns",
            "Learn your preferences",
            "Personalize conversations",
          ].map((item, idx) => (
            <div key={idx} className="flex items-center gap-2 text-xs text-foreground/80">
              <Check className="h-3.5 w-3.5 text-green-400 shrink-0" />
              <span>{item}</span>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground leading-relaxed italic border-t border-border/20 pt-3">
          Your music is never used to replace conversation. It simply becomes another way Aura understands you.
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-border/30">
        <button
          onClick={onConfirm}
          className="flex h-11 items-center justify-center rounded-2xl bg-foreground text-background font-semibold text-xs hover:opacity-90 transition-opacity uppercase tracking-wider"
        >
          Continue with Google
        </button>
        <button
          onClick={onCancel}
          className="flex h-9 items-center justify-center rounded-2xl border border-border/40 text-muted-foreground hover:text-foreground text-xs transition-colors uppercase tracking-wider"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ─── Disconnect Confirmation Sheet Modal ──────────────────────────────
interface DisconnectSheetProps {
  displayName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function DisconnectConfirmationSheet({ displayName, onConfirm, onCancel }: DisconnectSheetProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
      className="absolute inset-0 z-50 flex flex-col justify-between bg-[oklch(0.06_0_0)] p-6 backdrop-blur-3xl"
    >
      <div className="flex flex-col items-center text-center mt-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-red-400 mb-4">
          <AlertCircle className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">
          Disconnect {displayName}?
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-[220px]">
          Aura will no longer understand your music or adjust conversations based on what you listen to.
        </p>
      </div>

      <div className="flex flex-col gap-2 pt-4 border-t border-border/30">
        <button
          onClick={onConfirm}
          className="flex h-11 items-center justify-center rounded-2xl bg-red-500/20 border border-red-500/40 text-red-400 font-semibold text-xs hover:bg-red-500/30 transition-colors uppercase tracking-wider"
        >
          Disconnect
        </button>
        <button
          onClick={onCancel}
          className="flex h-9 items-center justify-center rounded-2xl border border-border/40 text-muted-foreground hover:text-foreground text-xs transition-colors uppercase tracking-wider"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}

// ─── Activation Animation Overlay ──────────────────────────────────────
function ActivationSequenceOverlay({ onComplete }: { onComplete: () => void }) {
  const steps = [
    "Initializing Music Sense...",
    "Authenticating...",
    "Connecting Playback...",
    "Preparing Observation...",
    "Music Sense Ready ✓",
  ];
  const [stepIdx, setStepIdx] = useState(0);

  useEffect(() => {
    if (stepIdx < steps.length - 1) {
      const timer = setTimeout(() => {
        setStepIdx((prev) => prev + 1);
      }, 400);
      return () => clearTimeout(timer);
    } else {
      const timer = setTimeout(() => {
        onComplete();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [stepIdx, steps.length, onComplete]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-[oklch(0.06_0_0)]/95 p-6 backdrop-blur-3xl text-center"
    >
      <div className="relative mb-6">
        <div className="h-12 w-12 rounded-full border-2 border-foreground/20 border-t-foreground animate-spin" />
        <Zap className="absolute inset-0 m-auto h-5 w-5 text-amber-400" />
      </div>
      <p className="text-xs font-mono tracking-widest text-foreground uppercase animate-pulse">
        {steps[stepIdx]}
      </p>
    </motion.div>
  );
}

function MusicProviderSwitcher() {
  const { availableProviders, state, switchProvider } = useMusicPlayer();
  if (!availableProviders || availableProviders.length === 0) return null;

  return (
    <select
      className="text-[10px] bg-background border border-border/40 text-muted-foreground rounded px-1.5 py-0.5 outline-none hover:text-foreground transition-colors cursor-pointer"
      value={state.providerId || ""}
      onChange={(e) => switchProvider(e.target.value)}
      onClick={(e) => e.stopPropagation()}
    >
      {availableProviders.map((p: any) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  );
}

// ─── Sense Card ────────────────────────────────────────────────────────
interface SenseCardProps {
  entry: SenseRegistryEntry;
  onOpenExplanation: (entry: SenseRegistryEntry) => void;
  onOpenDisconnect: (entry: SenseRegistryEntry) => void;
}

function SenseCard({ entry, onOpenExplanation, onOpenDisconnect }: SenseCardProps) {
  const [health, setHealth] = useState(() =>
    entry.sense?.health() ?? { status: "coming_soon" as SenseStatusCode, provider: null }
  );

  useEffect(() => {
    if (!entry.sense) return;
    const interval = setInterval(() => {
      setHealth(entry.sense!.health());
    }, 2000);
    return () => clearInterval(interval);
  }, [entry.sense]);

  const isComingSoon = !entry.available;
  const isConnected = health.status === "connected" || health.status === "active";

  return (
    <div
      className={`rounded-2xl border transition-all duration-300 p-4 ${
        isComingSoon
          ? "border-border/20 bg-foreground/[0.01] opacity-50"
          : "border-border/40 bg-foreground/[0.03] hover:border-border/60 hover:bg-foreground/[0.05]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left: icon + info */}
        <div className="flex items-center gap-3 min-w-0">
          <span className={`text-xl ${isComingSoon ? "grayscale opacity-40" : ""}`}>
            {entry.manifest.icon}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-foreground tracking-wide truncate">
                {entry.manifest.displayName}
              </p>
              {!isComingSoon && (
                <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(health.status)}`} />
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
              {isComingSoon ? "Coming Soon" : isConnected ? "Playback Ready" : entry.manifest.description}
            </p>
          </div>
        </div>

        {/* Right: action */}
        {!isComingSoon && (
          <div className="shrink-0">
            {isConnected ? (
              <button
                onClick={() => onOpenDisconnect(entry)}
                className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground transition-colors border border-border/40 hover:border-border rounded-lg px-2.5 py-1.5"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={() => onOpenExplanation(entry)}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-foreground bg-foreground/10 hover:bg-foreground/20 border border-border/40 rounded-lg px-3 py-1.5 transition-all"
              >
                <span>Continue</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Connected status & Empty State Detail */}
      {isConnected && (
        <div className="mt-3 pt-3 border-t border-border/20 flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Check className="h-3 w-3 text-green-400" strokeWidth={2.5} />
              <span className="text-[10px] text-green-400/80 font-medium">
                Connected {health.provider && entry.manifest.id !== 'music' ? `(${health.provider})` : ""}
              </span>
            </div>
            {entry.manifest.id === 'music' && <MusicProviderSwitcher />}
          </div>
          {health.status !== "active" && (
            <p className="text-[10px] text-muted-foreground italic pl-5">
              Nothing currently playing. Try saying "Play Interstellar."
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main SensePanel ───────────────────────────────────────────────────
export function SensePanel({ isOpen, onClose }: SensePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<SenseRegistryEntry[]>([]);
  const [explainingEntry, setExplainingEntry] = useState<SenseRegistryEntry | null>(null);
  const [disconnectingEntry, setDisconnectingEntry] = useState<SenseRegistryEntry | null>(null);
  const [isActivating, setIsActivating] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const manager = SenseManager.getInstance();

  useEffect(() => {
    if (isOpen) {
      setEntries(manager.getAllEntries());
    }
  }, [isOpen, manager]);

  // Close on outside click (unless modal sheets are open)
  useEffect(() => {
    if (!isOpen || explainingEntry || disconnectingEntry || isActivating) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen, explainingEntry, disconnectingEntry, isActivating, onClose]);

  const handleStartOAuth = useCallback(async () => {
    if (!explainingEntry) return;
    const targetId = explainingEntry.manifest.id;
    setExplainingEntry(null);
    try {
      await manager.connectSense(targetId);
      setIsActivating(true);
    } catch (err) {
      console.error("[SensePanel] Auth error:", err);
    }
  }, [explainingEntry, manager]);

  const handleConfirmDisconnect = useCallback(async () => {
    if (!disconnectingEntry) return;
    const targetId = disconnectingEntry.manifest.id;
    setDisconnectingEntry(null);
    await manager.disconnectSense(targetId);
    setEntries(manager.getAllEntries());
  }, [disconnectingEntry, manager]);

  const handleActivationComplete = useCallback(() => {
    setIsActivating(false);
    setEntries(manager.getAllEntries());
    setToastMsg("✓ Aura can now understand your music.");
    setTimeout(() => setToastMsg(null), 3500);
  }, [manager]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="absolute top-[70px] right-0 z-50 w-80 rounded-[1.75rem] border border-border/50 bg-[oklch(0.07_0_0)] backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.04)] overflow-hidden min-h-[380px]"
        >
          {/* Capability Explanation Sheet */}
          {explainingEntry && (
            <CapabilityExplanationSheet
              displayName={explainingEntry.manifest.displayName}
              onConfirm={handleStartOAuth}
              onCancel={() => setExplainingEntry(null)}
            />
          )}

          {/* Disconnect Confirmation Sheet */}
          {disconnectingEntry && (
            <DisconnectConfirmationSheet
              displayName={disconnectingEntry.manifest.displayName}
              onConfirm={handleConfirmDisconnect}
              onCancel={() => setDisconnectingEntry(null)}
            />
          )}

          {/* Activation Sequence Overlay */}
          {isActivating && (
            <ActivationSequenceOverlay onComplete={handleActivationComplete} />
          )}

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <Zap className="h-3.5 w-3.5 text-foreground/60" strokeWidth={2} />
                <h2 className="text-xs font-black uppercase tracking-[0.25em] text-foreground">
                  Aura Sense
                </h2>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 tracking-wide">
                Expand what Aura can perceive.
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>

          {/* Toast message */}
          {toastMsg && (
            <div className="mx-4 mb-2 rounded-xl bg-green-500/10 border border-green-500/30 px-3 py-2 text-center text-xs text-green-400 font-medium animate-in fade-in">
              {toastMsg}
            </div>
          )}

          {/* Divider */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-border/50 to-transparent" />

          {/* Cards */}
          <div className="flex flex-col gap-2 p-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
            {/* Memory is always first */}
            <MemoryCard />

            {/* Dynamic Senses */}
            {entries.map((entry) => (
              <SenseCard
                key={entry.manifest.id}
                entry={entry}
                onOpenExplanation={(e) => setExplainingEntry(e)}
                onOpenDisconnect={(e) => setDisconnectingEntry(e)}
              />
            ))}
          </div>

          {/* Footer glow */}
          <div className="h-px w-full bg-gradient-to-r from-transparent via-foreground/5 to-transparent" />
          <div className="px-5 py-3">
            <p className="text-[9px] text-muted-foreground/30 tracking-[0.15em] uppercase text-center">
              Perception · Not Cognition
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
