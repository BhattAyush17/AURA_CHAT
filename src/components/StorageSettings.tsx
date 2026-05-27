/**
 * StorageSettings Component - Progressive Disclosure Pattern
 *
 * Flow:
 * 1. Show Gemini key (required) - user can start chatting
 * 2. Show note: "Optional: Add cloud sync for cross-device"
 * 3. After 5 conversations: Highlight cloud sync option with notification
 * 4. User can optionally enable cloud sync
 */

import { useState, useEffect } from "react";
import { getGeminiKey, getOpenRouterKey } from "@/lib/api";
import { Cloud, Key, CheckCircle, Zap, ChevronDown, Eye, EyeOff, Trash2, MessageSquare, Clock } from "lucide-react";
import { setCredential, getCredential, hasRequiredCredentials } from "@/lib/credentials";
import { loadSyncMeta, SyncMeta } from "@/lib/sync-meta";
import { SupabaseConnect } from "@/components/SupabaseConnect";
import { getStorageManager } from "@/lib/storage/manager";
import { SessionData } from "@/lib/storage/types";

interface UsageStats {
  conversations: number;
  messagesTotal: number;
  lastUpdated: number;
}

export function StorageSettings({ onClose }: { onClose?: () => void }) {
  // ═══════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  const [geminiKey, setGeminiKeyLocal] = useState("");
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const [openRouterKey, setOpenRouterKeyLocal] = useState("");
  const [openRouterKeySaved, setOpenRouterKeySaved] = useState(false);
  const [showOpenRouterKey, setShowOpenRouterKey] = useState(false);

  const [sarvamKey, setSarvamKeyLocal] = useState("");
  const [sarvamKeySaved, setSarvamKeySaved] = useState(false);
  const [showSarvamKey, setShowSarvamKey] = useState(false);

  const [cohereKey, setCohereKeyLocal] = useState("");
  const [cohereKeySaved, setCohereKeySaved] = useState(false);
  const [showCohereKey, setShowCohereKey] = useState(false);

  const [pineconeKey, setPineconeKeyLocal] = useState("");
  const [pineconeKeySaved, setPineconeKeySaved] = useState(false);
  const [showPineconeKey, setShowPineconeKey] = useState(false);

  const [redisUrl, setRedisUrlLocal] = useState("");
  const [redisUrlSaved, setRedisUrlSaved] = useState(false);
  const [showRedisUrl, setShowRedisUrl] = useState(false);

  const [voiceLanguage, setVoiceLanguageLocal] = useState("en-US");

  // Cloud sync state
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);

  // Connection status (for Gemini key save feedback)
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");

  // Usage tracking
  const [usageStats, setUsageStats] = useState<UsageStats>({
    conversations: 0,
    messagesTotal: 0,
    lastUpdated: Date.now(),
  });

  // UI state
  const [showCloudPrompt, setShowCloudPrompt] = useState(false);
  const [showCloudSyncSection, setShowCloudSyncSection] = useState(false);
  const [syncMeta, setSyncMeta] = useState<SyncMeta | null>(null);

  // Sessions View state
  const [showSessions, setShowSessions] = useState(false);
  const [sessions, setSessions] = useState<SessionData[]>([]);

  // ═══════════════════════════════════════════════════════════════════
  // INITIALIZATION & EFFECTS
  // ═══════════════════════════════════════════════════════════════════

  useEffect(() => {
    // Load Gemini key
    const savedKey = getGeminiKey();
    if (savedKey) {
      setGeminiKeyLocal(savedKey);
      setGeminiKeySaved(true);
    }

    // Load OpenRouter key
    const savedORKey = getCredential("openrouter_api_key");
    if (savedORKey) {
      setOpenRouterKeyLocal(savedORKey);
      setOpenRouterKeySaved(true);
    }

    // Load voice language setting
    const savedLang = localStorage.getItem("aura_voice_language") || "en-US";
    setVoiceLanguageLocal(savedLang);

    // Load Sarvam key
    const savedSarvamKey = getCredential("sarvam_api_key");
    if (savedSarvamKey) {
      setSarvamKeyLocal(savedSarvamKey);
      setSarvamKeySaved(true);
    }

    // Load Cohere key
    const savedCohereKey = getCredential("cohere_api_key");
    if (savedCohereKey) {
      setCohereKeyLocal(savedCohereKey);
      setCohereKeySaved(true);
    }

    // Load Pinecone key
    const savedPineconeKey = getCredential("pinecone_api_key");
    if (savedPineconeKey) {
      setPineconeKeyLocal(savedPineconeKey);
      setPineconeKeySaved(true);
    }

    // Load Redis URL
    const savedRedisUrl = getCredential("redis_url");
    if (savedRedisUrl) {
      setRedisUrlLocal(savedRedisUrl);
      setRedisUrlSaved(true);
    }

    // Load cloud sync state
    const cloudEnabled = localStorage.getItem("aura_cloud_sync_enabled") === "true";
    setCloudSyncEnabled(cloudEnabled);

    loadUsageStats();

    // Load cloud hint meta
    const meta = loadSyncMeta("local-user");
    setSyncMeta(meta);
  }, []);

  // Monitor usage and show prompt at 5 conversations
  useEffect(() => {
    const interval = setInterval(() => {
      loadUsageStats();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // ═══════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  const loadUsageStats = () => {
    const userId = "local-user";
    const key = `aura_usage_${userId}`;
    const stored = localStorage.getItem(key);
    const stats = stored
      ? JSON.parse(stored)
      : { conversations: 0, messagesTotal: 0, lastUpdated: Date.now() };

    setUsageStats(stats);

    // Show cloud sync prompt when reaching 5 conversations
    if (stats.conversations >= 5 && !cloudSyncEnabled) {
      setShowCloudPrompt(true);
      setShowCloudSyncSection(true);
    }
  };

  const handleSaveGeminiKey = () => {
    if (!geminiKey.trim()) {
      alert(
        "A Gemini API key is REQUIRED to use AURA. You can get one for free at aistudio.google.com.",
      );
      return;
    }
    setCredential("aura_gemini_api_key", geminiKey.trim());
    setConnectionStatus("success");
    setTimeout(() => {
      setConnectionStatus("idle");
      if (onClose) onClose();
    }, 1500);
    setGeminiKeySaved(true);
  };

  const handleSaveOpenRouterKey = () => {
    if (!openRouterKey.trim()) {
      setCredential("openrouter_api_key", "");
      setOpenRouterKeySaved(false);
      return;
    }
    setCredential("openrouter_api_key", openRouterKey.trim());
    setOpenRouterKeySaved(true);
  };

  const handleSaveLanguage = (lang: string) => {
    setVoiceLanguageLocal(lang);
    localStorage.setItem("aura_voice_language", lang);
  };

  const handleSaveSarvamKey = () => {
    if (!sarvamKey.trim()) {
      setCredential("sarvam_api_key", "");
      setSarvamKeySaved(false);
      return;
    }
    setCredential("sarvam_api_key", sarvamKey.trim());
    setSarvamKeySaved(true);
  };

  const handleSaveCohereKey = () => {
    if (!cohereKey.trim()) {
      setCredential("cohere_api_key", "");
      setCohereKeySaved(false);
      return;
    }
    setCredential("cohere_api_key", cohereKey.trim());
    setCohereKeySaved(true);
  };

  const handleSavePineconeKey = () => {
    if (!pineconeKey.trim()) {
      setCredential("pinecone_api_key", "");
      setPineconeKeySaved(false);
      return;
    }
    setCredential("pinecone_api_key", pineconeKey.trim());
    setPineconeKeySaved(true);
  };

  const handleSaveRedisUrl = () => {
    if (!redisUrl.trim()) {
      setCredential("redis_url", "");
      setRedisUrlSaved(false);
      return;
    }
    setCredential("redis_url", redisUrl.trim());
    setRedisUrlSaved(true);
  };

  const handleSupabaseConnected = () => {
    setCloudSyncEnabled(true);
    setShowCloudPrompt(false);
  };

  const handleToggleSessions = async () => {
    if (!showSessions) {
      const manager = getStorageManager("local-user");
      // list combines browser and cloud
      const allSessions = await manager.list();
      // sort by newest
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
      loadUsageStats(); // Update the conversations count
    }
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-background rounded-lg border border-border shadow-sm space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar overscroll-contain">
      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* HEADER */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div>
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Key className="w-6 h-6 text-foreground" />
          Storage & Sync
        </h2>
        <p className="text-sm text-muted-foreground mt-2">Configure where your data is stored</p>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1: GEMINI API KEY (REQUIRED) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-3">
        {/* Cloud Hint */}
        {syncMeta?.hasCloudCopy && !cloudSyncEnabled && (
          <div className="mb-6 p-4 bg-muted/20 border border-border rounded-lg flex gap-3 animate-in fade-in slide-in-from-top-4 duration-500">
            <Cloud className="w-5 h-5 text-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Cloud Memory Detected</p>
              <p className="text-xs text-muted-foreground mt-1">
                You have a cloud memory copy from{" "}
                {new Date(syncMeta.updatedAt).toLocaleDateString()}. Enter your Supabase credentials
                below to load it.
              </p>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-foreground">
            🔑 Google Gemini API Key
            <span className="ml-2 text-foreground/80 text-xs">REQUIRED</span>
          </label>
          {geminiKeySaved && (
            <span className="text-xs text-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Your API key is stored locally in your browser only. Never sent anywhere except to
          Google's API.
        </p>

        <div className="relative">
          <input
            type={showKey ? "text" : "password"}
            placeholder="Enter your Gemini API key..."
            value={geminiKey}
            onChange={(e) => setGeminiKeyLocal(e.target.value)}
            disabled={geminiKeySaved}
            className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {!geminiKeySaved ? (
          <button
            onClick={handleSaveGeminiKey}
            className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full"
          >
            ✓ Save API Key
          </button>
        ) : (
          <button
            onClick={() => {
              setGeminiKeySaved(false);
              setGeminiKeyLocal(geminiKey);
            }}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full"
          >
            Edit Key
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1B: OPENROUTER API KEY & VOICE LANGUAGE (OPTIONAL) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-4">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-semibold text-foreground">
            🚀 OpenRouter API Key
            <span className="ml-2 text-muted-foreground text-xs font-normal">OPTIONAL</span>
          </label>
          {openRouterKeySaved && (
            <span className="text-xs text-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Allows you to test fully free, multilingual voice models (Llama 3, Gemma 2, Grok) with
          offline browser text-to-speech.
        </p>

        <div className="relative">
          <input
            type={showOpenRouterKey ? "text" : "password"}
            placeholder="Enter your OpenRouter API key..."
            value={openRouterKey}
            onChange={(e) => setOpenRouterKeyLocal(e.target.value)}
            disabled={openRouterKeySaved}
            className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
          />
          <button
            type="button"
            onClick={() => setShowOpenRouterKey(!showOpenRouterKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showOpenRouterKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {!openRouterKeySaved ? (
          <button
            onClick={handleSaveOpenRouterKey}
            className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full"
          >
            ✓ Save OpenRouter Key
          </button>
        ) : (
          <button
            onClick={() => {
              setOpenRouterKeySaved(false);
              setOpenRouterKeyLocal(openRouterKey);
            }}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full"
          >
            Edit Key
          </button>
        )}

        {/* Dynamic Multilingual Voice Selector */}
        <div className="border-t border-border/40 pt-4 space-y-2">
          <label className="text-sm font-semibold text-foreground block">
            🗣️ Speech Locale / Language
          </label>
          <p className="text-xs text-muted-foreground">
            Sets the listening (STT) and speaking (TTS) language for the OpenRouter Voice Node.
          </p>
          <select
            value={voiceLanguage}
            onChange={(e) => handleSaveLanguage(e.target.value)}
            className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:border-foreground"
          >
            <option value="en-US">English (United States)</option>
            <option value="hi-IN">Hindi (भारत / India)</option>
            <option value="es-ES">Spanish (España)</option>
            <option value="fr-FR">French (France)</option>
            <option value="de-DE">German (Deutschland)</option>
            <option value="ja-JP">Japanese (日本)</option>
            <option value="it-IT">Italian (Italia)</option>
            <option value="ru-RU">Russian (Россия)</option>
            <option value="zh-CN">Chinese (Simplified)</option>
          </select>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1C: SARVAM AI API KEY (FOR SARVAM PROVIDER) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-semibold text-foreground">
            🇮🇳 Sarvam AI API Key
            <span className="ml-2 text-muted-foreground text-xs font-normal">
              FOR SARVAM PROVIDER
            </span>
          </label>
          {sarvamKeySaved && (
            <span className="text-xs text-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Required when using the Sarvam provider for high-fidelity Indian-language STT/TTS. Get
          your key at{" "}
          <a
            href="https://www.sarvam.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline hover:text-foreground/80"
          >
            sarvam.ai
          </a>
          . Also requires an OpenRouter key above for LLM inference.
        </p>

        <div className="relative">
          <input
            type={showSarvamKey ? "text" : "password"}
            placeholder="Enter your Sarvam API key..."
            value={sarvamKey}
            onChange={(e) => setSarvamKeyLocal(e.target.value)}
            disabled={sarvamKeySaved}
            className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
          />
          <button
            type="button"
            onClick={() => setShowSarvamKey(!showSarvamKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showSarvamKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {!sarvamKeySaved ? (
          <button
            onClick={handleSaveSarvamKey}
            className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full"
          >
            ✓ Save Sarvam Key
          </button>
        ) : (
          <button
            onClick={() => {
              setSarvamKeySaved(false);
              setSarvamKeyLocal(sarvamKey);
            }}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full"
          >
            Edit Key
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1D: COHERE API KEY (OPTIONAL) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-semibold text-foreground">
            🌀 Cohere API Key
            <span className="ml-2 text-muted-foreground text-xs font-normal">OPTIONAL</span>
          </label>
          {cohereKeySaved && (
            <span className="text-xs text-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Enables Cohere's embed-multilingual-v3.0 as part of the multi-tier embedding retrieval chain.
        </p>

        <div className="relative">
          <input
            type={showCohereKey ? "text" : "password"}
            placeholder="Enter your Cohere API key..."
            value={cohereKey}
            onChange={(e) => setCohereKeyLocal(e.target.value)}
            disabled={cohereKeySaved}
            className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
          />
          <button
            type="button"
            onClick={() => setShowCohereKey(!showCohereKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showCohereKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {!cohereKeySaved ? (
          <button
            onClick={handleSaveCohereKey}
            className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full"
          >
            ✓ Save Cohere Key
          </button>
        ) : (
          <button
            onClick={() => {
              setCohereKeySaved(false);
              setCohereKeyLocal(cohereKey);
            }}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full"
          >
            Edit Key
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1E: PINECONE API KEY (OPTIONAL) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-semibold text-foreground">
            🌲 Pinecone API Key
            <span className="ml-2 text-muted-foreground text-xs font-normal">OPTIONAL</span>
          </label>
          {pineconeKeySaved && (
            <span className="text-xs text-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Enables Pinecone Vector Database context integration for highly scaled memory profiles.
        </p>

        <div className="relative">
          <input
            type={showPineconeKey ? "text" : "password"}
            placeholder="Enter your Pinecone API key..."
            value={pineconeKey}
            onChange={(e) => setPineconeKeyLocal(e.target.value)}
            disabled={pineconeKeySaved}
            className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
          />
          <button
            type="button"
            onClick={() => setShowPineconeKey(!showPineconeKey)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPineconeKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {!pineconeKeySaved ? (
          <button
            onClick={handleSavePineconeKey}
            className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full"
          >
            ✓ Save Pinecone Key
          </button>
        ) : (
          <button
            onClick={() => {
              setPineconeKeySaved(false);
              setPineconeKeyLocal(pineconeKey);
            }}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full"
          >
            Edit Key
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 1F: REDIS URL (OPTIONAL) */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/20 rounded-lg border border-border space-y-3">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-semibold text-foreground">
            ⚡ Redis / Valkey URL
            <span className="ml-2 text-muted-foreground text-xs font-normal">OPTIONAL</span>
          </label>
          {redisUrlSaved && (
            <span className="text-xs text-foreground flex items-center gap-1">
              <CheckCircle className="w-3 h-3" /> Saved
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          Points your AURA asynchronous worker (Brain 3) to a specific local or cloud Redis/Valkey instance. Default: <code>redis://localhost:6379/0</code>
        </p>

        <div className="relative">
          <input
            type={showRedisUrl ? "text" : "password"}
            placeholder="redis://localhost:6379/0"
            value={redisUrl}
            onChange={(e) => setRedisUrlLocal(e.target.value)}
            disabled={redisUrlSaved}
            className="w-full pl-4 pr-10 py-2 bg-transparent border border-border rounded text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground disabled:opacity-50 disabled:cursor-not-allowed [&::-ms-reveal]:hidden [&::-ms-clear]:hidden"
          />
          <button
            type="button"
            onClick={() => setShowRedisUrl(!showRedisUrl)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showRedisUrl ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {!redisUrlSaved ? (
          <button
            onClick={handleSaveRedisUrl}
            className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full"
          >
            ✓ Save Redis URL
          </button>
        ) : (
          <button
            onClick={() => {
              setRedisUrlSaved(false);
              setRedisUrlLocal(redisUrl);
            }}
            className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded text-sm font-medium transition w-full"
          >
            Edit URL
          </button>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* SECTION 2: BROWSER STORAGE STATUS */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/30 rounded-lg border border-border space-y-3">
        <div className="flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-foreground" />
          <label className="text-sm font-semibold text-foreground">
            Browser Storage (Always Active)
          </label>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          ✅ All your conversations are automatically saved to your browser's local storage.
          <br />
          🔒 100% private - never leaves your device
          <br />
          📊 <strong>Usage:</strong> {usageStats.conversations} conversations stored
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
                // Find the first user transcript line for the title
                const userTurn = session.transcript?.find(t => t.user_initiated && t.text);
                const title = userTurn?.text || "Empty Conversation";
                
                return (
                  <div key={session.session_id} className="flex flex-col p-3 border border-border/50 rounded bg-background">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 pr-2">
                        <p className="text-xs font-medium text-foreground truncate">
                          {title}
                        </p>
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
      {/* SECTION 3: CLOUD SYNC OPTION (OPTIONAL) */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      {/* Show hint if under cap */}
      {!showCloudSyncSection && !cloudSyncEnabled && (
        <button
          onClick={() => setShowCloudSyncSection(true)}
          className="w-full text-left p-4 bg-muted/30 hover:bg-muted/40 transition-colors rounded-lg border border-border cursor-pointer group flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <Cloud className="w-4 h-4 group-hover:text-foreground transition-colors" />
            <span className="text-xs text-foreground">
              <strong>Tip:</strong> For seamless connectivity across devices, click here to add your
              Supabase credentials.
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      )}

      {/* Cloud Sync Section - Show by default after 5 conversations, or if already enabled */}
      {(showCloudSyncSection || cloudSyncEnabled) && (
        <div
          className={`p-5 rounded-lg border transition-all space-y-4 ${
            showCloudPrompt
              ? "bg-muted/20 border-foreground shadow-sm"
              : "bg-muted/10 border-border"
          }`}
        >
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Cloud className="w-5 h-5 text-foreground" />
              <div>
                <label className="text-sm font-semibold text-foreground block">
                  ☁️ Cloud Sync (Optional)
                </label>
                <p className="text-xs text-muted-foreground mt-1">
                  Sync across multiple devices with your own Supabase database
                </p>
              </div>
            </div>
            {cloudSyncEnabled && (
              <span className="text-xs text-foreground flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Active
              </span>
            )}
          </div>

          {/* Prompt Badge */}
          {showCloudPrompt && (
            <div className="p-3 bg-muted/30 rounded border border-border flex items-start gap-2">
              <Zap className="w-4 h-4 text-foreground mt-0.5 flex-shrink-0" />
              <p className="text-xs text-foreground">
                <strong>You've reached 5 conversations!</strong> Enable cloud sync to back up your
                data across devices and never lose your conversations.
              </p>
            </div>
          )}

          {/* SupabaseConnect handles the full OAuth → SQL → keys → done flow */}
          <SupabaseConnect onConnected={handleSupabaseConnected} />
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* INFO FOOTER */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-3 bg-muted/10 rounded border border-border text-xs text-muted-foreground space-y-1">
        <p>
          🔒 <strong>Privacy First:</strong> Your Gemini API key never leaves your browser.
        </p>
        <p>
          💾 <strong>Local Storage:</strong> All conversations saved locally by default (unlimited).
        </p>
        <p>
          ☁️ <strong>Cloud Sync:</strong> Optional backup with your own Supabase (first 5
          conversations).
        </p>
      </div>
    </div>
  );
}
