/**
 * StorageSettings Component - Two-Tier Progressive Disclosure
 *
 * Tier 1: Pipeline Selection — Gemini (one key) OR OpenRouter+Sarvam (two keys)
 * Tier 2: Optional Power-Ups — Cohere, Pinecone, Supabase, Redis (expandable after Tier 1 saved)
 */

import { useState, useEffect } from "react";
import { getGeminiKey, getOpenRouterKey, getSarvamKey, isValidKey } from "@/lib/api";
import {
  Cloud, Key, CheckCircle, Zap, ChevronDown, Eye, EyeOff,
  Trash2, MessageSquare, Clock, Sparkles,
} from "lucide-react";
import { setCredential, getCredential, hasRequiredCredentials } from "@/lib/credentials";
import { loadSyncMeta, SyncMeta } from "@/lib/sync-meta";
import { SupabaseConnect } from "@/components/SupabaseConnect";
import { getStorageManager } from "@/lib/storage/manager";
import { SessionData } from "@/lib/storage/types";
import { RedisManager } from "@/components/RedisManager";

// ─── Reusable Key Input Row ─────────────────────────────────────────
function KeyInput({
  label,
  badge,
  description,
  placeholder,
  credentialKey,
  icon,
  onSaved,
}: {
  label: string;
  badge: string;
  description: string;
  placeholder: string;
  credentialKey: string;
  icon: string;
  onSaved?: () => void;
}) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState(false);
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getEnvValue = () => {
    let envVal: string | null = null;
    if (credentialKey === "aura_gemini_api_key") envVal = import.meta.env.VITE_GEMINI_API_KEY;
    else if (credentialKey === "openrouter_api_key") envVal = import.meta.env.VITE_OPENROUTER_API_KEY;
    else if (credentialKey === "sarvam_api_key") envVal = import.meta.env.VITE_SARVAM_API_KEY;
    else if (credentialKey === "cohere_api_key") envVal = import.meta.env.VITE_COHERE_API_KEY;
    else if (credentialKey === "redis_url") envVal = import.meta.env.VITE_REDIS_URL;
    return isValidKey(envVal, credentialKey) ? envVal : null;
  };

  useEffect(() => {
    const existing = getCredential(credentialKey as any);
    if (existing) {
      setValue(existing);
      setSaved(true);
    } else {
      const envVal = getEnvValue();
      if (envVal) {
        setValue("••••••••••••••••");
        setSaved(true);
      } else {
        setValue("");
        setSaved(false);
      }
    }
    setError(null);
  }, [credentialKey]);

  const handleSave = () => {
    const trimmed = value.trim();
    setError(null);
    if (!trimmed || trimmed === "••••••••••••••••") {
      setCredential(credentialKey as any, "");
      const envVal = getEnvValue();
      if (envVal) {
        setValue("••••••••••••••••");
        setSaved(true);
      } else {
        setValue("");
        setSaved(false);
      }
      onSaved?.();
      return;
    }

    if (!isValidKey(trimmed, credentialKey)) {
      if (credentialKey === "aura_gemini_api_key") {
        setError("Invalid Gemini API key. Must start with 'AIzaSy' and be 39 characters long.");
      } else if (credentialKey === "openrouter_api_key") {
        setError("Invalid OpenRouter API key. Must start with 'sk-or-v1-'.");
      } else if (credentialKey === "sarvam_api_key") {
        setError("Invalid Sarvam API key. Must start with 'sk_'.");
      } else {
        setError(`Invalid ${label} key format.`);
      }
      return;
    }

    setCredential(credentialKey as any, trimmed);
    setSaved(true);
    onSaved?.();
  };

  const isSystemProvided = saved && !getCredential(credentialKey as any) && !!getEnvValue();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <span>{icon}</span>
          <span>{label}</span>
          <span className="text-muted-foreground text-xs font-normal">({badge})</span>
        </label>
        {saved && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium transition-all duration-200 ${
            isSystemProvided 
              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" 
              : "bg-green-500/10 text-green-400 border border-green-500/20"
          }`}>
            <CheckCircle className="w-3 h-3" />
            {isSystemProvided ? "System Active" : "User Saved"}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          disabled={saved}
          className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-500 font-semibold mt-1">{error}</p>
      )}
      {!saved ? (
        <button onClick={handleSave} className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full cursor-pointer">
          ✓ Save {label.split(" ").slice(-2).join(" ")}
        </button>
      ) : (
        <button 
          onClick={() => { 
            setSaved(false); 
            const existing = getCredential(credentialKey as any);
            setValue(existing || "");
            setError(null);
          }} 
          className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full cursor-pointer"
        >
          Edit
        </button>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────
export function StorageSettings({ onClose }: { onClose?: () => void }) {
  const [selectedPipeline, setSelectedPipeline] = useState<"gemini" | "sarvam" | null>(null);
  const [showPowerUps, setShowPowerUps] = useState(false);
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [showCloudSyncSection, setShowCloudSyncSection] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<SessionData[]>([]);
  const [usageStats, setUsageStats] = useState({ conversations: 0, messagesTotal: 0, lastUpdated: Date.now() });
  const [showRedisManager, setShowRedisManager] = useState(false);

  // Detect which pipeline is already configured
  const geminiSaved = !!getGeminiKey();
  const orSaved = !!getOpenRouterKey();
  const sarvamSaved = !!getSarvamKey();
  const hasPrimaryKeys = geminiSaved || (orSaved && sarvamSaved);

  useEffect(() => {
    if (geminiSaved) setSelectedPipeline("gemini");
    else if (orSaved) setSelectedPipeline("sarvam");

    setCloudSyncEnabled(localStorage.getItem("aura_cloud_sync_enabled") === "true");
    setSyncMeta(loadSyncMeta("local-user"));

    const key = "aura_usage_local-user";
    const stored = localStorage.getItem(key);
    if (stored) setUsageStats(JSON.parse(stored));
  }, []);

  const handleSupabaseConnected = () => {
    setCloudSyncEnabled(true);
  };

  const handleToggleSessions = async () => {
    if (!showSessions) {
      const manager = getStorageManager("local-user");
      const allSessions = await manager.list();
      allSessions.sort((a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime());
      setSessions(allSessions);
    }
    setShowSessions(!showSessions);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (confirm("Are you sure you want to delete this conversation?")) {
      const manager = getStorageManager("local-user");
      await manager.delete(sessionId);
      const allSessions = await manager.list();
      allSessions.sort((a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime());
      setSessions(allSessions);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-background rounded-lg border border-border shadow-sm space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar overscroll-contain">

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HEADER                                                        */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Key className="w-6 h-6 text-foreground" />
          AURA Setup
        </h2>
        <p className="text-sm text-muted-foreground mt-2">
          Choose your voice pipeline. AURA is fully functional with just one option.
        </p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TIER 1: PIPELINE SELECTION                                     */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* Pipeline selector tabs */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setSelectedPipeline("gemini")}
          className={`p-4 rounded-lg border-2 text-left transition-all duration-200 ${
            selectedPipeline === "gemini"
              ? "border-foreground bg-foreground/5"
              : "border-border hover:border-foreground/30"
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🎙️</span>
            <span className="text-sm font-bold text-foreground">Gemini Live</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            One key does everything — voice, intelligence, and audio output through a single WebSocket.
          </p>
          {geminiSaved && (
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-foreground font-medium">
              <CheckCircle className="w-3 h-3" /> Active
            </span>
          )}
        </button>

        <button
          onClick={() => setSelectedPipeline("sarvam")}
          className={`p-4 rounded-lg border-2 text-left transition-all duration-200 ${
            selectedPipeline === "sarvam"
              ? "border-foreground bg-foreground/5"
              : "border-border hover:border-foreground/30"
          }`}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">🇮🇳</span>
            <span className="text-sm font-bold text-foreground">OpenRouter + Sarvam</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Best for Hinglish. HD Indian voices via Sarvam + open LLMs via OpenRouter. Two keys needed.
          </p>
          {orSaved && sarvamSaved && (
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-foreground font-medium">
              <CheckCircle className="w-3 h-3" /> Active
            </span>
          )}
        </button>
      </div>

      {/* Pipeline-specific key inputs */}
      {selectedPipeline === "gemini" && (
        <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-3 animate-in fade-in slide-in-from-top-2 duration-300">
          {syncMeta?.hasCloudCopy && !cloudSyncEnabled && (
            <div className="mb-4 p-3 bg-muted/20 border border-border rounded-lg flex gap-3">
              <Cloud className="w-5 h-5 text-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">Cloud Memory Detected</p>
                <p className="text-xs text-muted-foreground mt-1">
                  You have a cloud memory copy from {new Date(syncMeta.updatedAt).toLocaleDateString()}.
                  Add Supabase credentials in Power-Ups below to load it.
                </p>
              </div>
            </div>
          )}

          <KeyInput
            label="Google Gemini API Key"
            badge="REQUIRED"
            description="Powers voice input, LLM reasoning, and audio output — all natively. Get a free key at aistudio.google.com."
            placeholder="Enter your Gemini API key..."
            credentialKey="aura_gemini_api_key"
            icon="🔑"
            onSaved={() => { if (onClose) setTimeout(onClose, 800); }}
          />

          {/* Voice Language */}
          <div className="border-t border-border/40 pt-4 space-y-2">
            <label className="text-sm font-semibold text-foreground block">🗣️ Voice Language</label>
            <p className="text-xs text-muted-foreground">Gemini Live voice locale.</p>
            <select
              defaultValue={localStorage.getItem("aura_voice_language") || "en-US"}
              onChange={(e) => localStorage.setItem("aura_voice_language", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:border-foreground"
            >
              <option value="en-US">English (US)</option>
              <option value="hi-IN">Hindi (भारत)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
              <option value="ja-JP">Japanese</option>
            </select>
          </div>
        </div>
      )}

      {selectedPipeline === "sarvam" && (
        <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
          <KeyInput
            label="OpenRouter API Key"
            badge="REQUIRED"
            description="Routes to open LLMs (Llama 3, Gemma, DeepSeek). Handles all text intelligence."
            placeholder="Enter your OpenRouter API key..."
            credentialKey="openrouter_api_key"
            icon="🚀"
          />
          <div className="border-t border-border/30" />
          <KeyInput
            label="Sarvam AI API Key"
            badge="REQUIRED FOR HD VOICE"
            description="HD Hinglish voices (bulbul:v3 TTS + saaras:v3 STT). Falls back to browser speech if absent."
            placeholder="Enter your Sarvam API key..."
            credentialKey="sarvam_api_key"
            icon="🇮🇳"
          />

          {/* Voice Language */}
          <div className="border-t border-border/40 pt-4 space-y-2">
            <label className="text-sm font-semibold text-foreground block">🗣️ Speech Locale</label>
            <p className="text-xs text-muted-foreground">Sets listening (STT) and speaking (TTS) language.</p>
            <select
              defaultValue={localStorage.getItem("aura_voice_language") || "hi-IN"}
              onChange={(e) => localStorage.setItem("aura_voice_language", e.target.value)}
              className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:border-foreground"
            >
              <option value="hi-IN">Hindi (भारत)</option>
              <option value="en-US">English (US)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="de-DE">German</option>
            </select>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* TIER 2: OPTIONAL POWER-UPS (shown after primary keys saved)    */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {selectedPipeline && (
        <button
          onClick={() => setShowPowerUps(!showPowerUps)}
          className="w-full text-left p-4 bg-muted/20 hover:bg-muted/30 transition-colors rounded-lg border border-border cursor-pointer group flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <div>
              <span className="text-sm font-semibold text-foreground">Optional Power-Ups</span>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Enhance memory, sync, and speed. None required — AURA works fully without these.
              </p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-muted-foreground group-hover:text-foreground transition-all duration-200 ${showPowerUps ? "rotate-180" : ""}`} />
        </button>
      )}

      {showPowerUps && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">

          {/* Cohere */}
          <div className="p-4 bg-muted/10 rounded-lg border border-border">
            <KeyInput
              label="Cohere API Key"
              badge="MEMORY"
              description="Multilingual semantic search (embed-multilingual-v3.0). Makes AURA recall past conversations in mixed Hindi/English with high precision."
              placeholder="Enter your Cohere API key..."
              credentialKey="cohere_api_key"
              icon="🌀"
            />
          </div>

          {/* Pinecone */}
          <div className="p-4 bg-muted/10 rounded-lg border border-border">
            <KeyInput
              label="Pinecone API Key"
              badge="MEMORY"
              description="Scales memory search to thousands of sessions. Replaces local ChromaDB with cloud vector database."
              placeholder="Enter your Pinecone API key..."
              credentialKey="pinecone_api_key"
              icon="🌲"
            />
          </div>

          {/* Redis */}
          <div className="p-4 bg-muted/10 rounded-lg border border-border">
            <KeyInput
              label="Redis / Valkey URL"
              badge="SPEED"
              description="Parallel async processing for sub-200ms response times. Runs behavior + memory retrieval simultaneously."
              placeholder="redis://localhost:6379/0"
              credentialKey="redis_url"
              icon="⚡"
            />
            {getCredential("redis_url") || import.meta.env.VITE_REDIS_URL ? (
              <div className="mt-4 pt-4 border-t border-border/50">
                <button
                  onClick={() => setShowRedisManager(!showRedisManager)}
                  className="w-full py-2 px-4 bg-foreground/10 hover:bg-foreground/20 text-foreground border border-border rounded text-xs font-medium transition flex items-center justify-center gap-2"
                >
                  <Zap className="w-4 h-4" />
                  {showRedisManager ? "Hide Redis Manager" : "Manage Redis Storage & Stats"}
                </button>
                {showRedisManager && (
                  <div className="mt-4">
                    <RedisManager />
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Cloud Sync (Supabase) */}
          <div className={`p-4 rounded-lg border transition-all ${cloudSyncEnabled ? "bg-muted/20 border-foreground/30" : "bg-muted/10 border-border"}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <Cloud className="w-5 h-5 text-foreground" />
                <div>
                  <label className="text-sm font-semibold text-foreground block">
                    ☁️ Cloud Sync
                    <span className="ml-2 text-muted-foreground text-xs font-normal">PERSISTENCE</span>
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Sync conversations across devices with your own Supabase database. Enables relationship memory that survives browser clears.
                  </p>
                </div>
              </div>
              {cloudSyncEnabled && (
                <span className="text-xs text-foreground flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> Active
                </span>
              )}
            </div>
            <SupabaseConnect onConnected={handleSupabaseConnected} />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* BROWSER STORAGE STATUS                                         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/30 rounded-lg border border-border space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-foreground" />
          <label className="text-sm font-semibold text-foreground">
            Browser Storage (Always Active)
          </label>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          ✅ Conversations auto-saved to browser local storage.
          <br />
          🔒 100% private — never leaves your device.
          <br />
          📊 <strong>Usage:</strong> {usageStats.conversations} conversations stored.
        </p>

        <button
          onClick={handleToggleSessions}
          className="w-full mt-2 py-2 px-4 bg-muted hover:bg-muted/80 text-foreground border border-border rounded text-xs font-medium transition flex items-center justify-center gap-2"
        >
          <MessageSquare className="w-4 h-4" />
          {showSessions ? "Hide Saved Chats" : "View Saved Chats"}
        </button>

        {showSessions && (
          <div className="mt-4 space-y-2 max-h-60 overflow-y-auto custom-scrollbar border border-border rounded-md p-2 bg-background/50">
            {sessions.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No saved conversations found.</p>
            ) : (
              sessions.map(session => {
                const userTurn = session.transcript?.find(t => t.user_initiated && t.text);
                const title = userTurn?.text || "Empty Conversation";
                return (
                  <div key={session.session_id} className="flex flex-col p-3 border border-border/50 rounded bg-background">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="text-xs font-medium text-foreground truncate">{title}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(session.last_active).toLocaleString()}
                          </span>
                          <span>{session.transcript?.length || 0} turns</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeleteSession(session.session_id)}
                        className="p-1.5 text-red-500/70 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors shrink-0"
                        title="Delete Conversation"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* FOOTER                                                         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-3 bg-muted/10 rounded border border-border text-xs text-muted-foreground space-y-1">
        <p>🔒 <strong>Privacy First:</strong> Keys stored in browser session only. Wiped on tab close.</p>
        <p>💾 <strong>Local Storage:</strong> All conversations saved locally by default.</p>
        <p>☁️ <strong>Cloud Sync:</strong> Optional — enable via Power-Ups with your own Supabase.</p>
      </div>
    </div>
  );
}
