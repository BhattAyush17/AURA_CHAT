/**
 * StorageSettings Component - Two-Tier Progressive Disclosure
 *
 * Tier 1: Pipeline Selection — Gemini (one key) OR OpenRouter+Sarvam (two keys)
 * Tier 2: Optional Power-Ups — Cohere, Pinecone, Supabase, Redis (expandable after Tier 1 saved)
 */

import { useState, useEffect } from "react";
import { getGeminiKey, getOpenRouterKey, getSarvamKey, isValidKey } from "@/lib/api";
import {
  Cloud,
  Key,
  CheckCircle,
  Zap,
  ChevronDown,
  Eye,
  EyeOff,
  Trash2,
  MessageSquare,
  Clock,
  Sparkles,
  Search,
  Download,
  Upload,
  FileText,
  FolderArchive,
  X,
  ChevronRight,
  FolderOpen,
} from "lucide-react";
import {
  setCredential,
  getCredential,
  hasRequiredCredentials,
  hasUserKey,
} from "@/lib/credentials";
import { loadSyncMeta, SyncMeta } from "@/lib/sync-meta";
import { SupabaseConnect } from "@/components/SupabaseConnect";
import { getStorageManager } from "@/lib/storage/manager";
import { SessionData } from "@/lib/storage/types";
import { RedisManager } from "@/components/RedisManager";
import {
  getConversationArchive,
  ConversationArchive,
  ArchivedMessage,
  ArchiveSearchResult,
  formatConversationAsJson,
  formatConversationAsMarkdown,
  formatConversationAsText,
  formatAllConversationsAsJson,
  formatAllConversationsAsMarkdown,
  validateExport,
  ArchiveExport,
} from "@/lib/storage/ConversationArchive";

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

  // Check if this key has a valid env-provided value (for runtime use only, NOT for UI display)
  const hasEnvFallback = () => {
    let envVal: string | null = null;
    if (import.meta.env.DEV) {
      if (credentialKey === "aura_gemini_api_key") envVal = import.meta.env.VITE_GEMINI_API_KEY;
      else if (credentialKey === "openrouter_api_key")
        envVal = import.meta.env.VITE_OPENROUTER_API_KEY;
      else if (credentialKey === "sarvam_api_key") envVal = import.meta.env.VITE_SARVAM_API_KEY;
      else if (credentialKey === "cohere_api_key") envVal = import.meta.env.VITE_COHERE_API_KEY;
      else if (credentialKey === "redis_url") envVal = import.meta.env.VITE_REDIS_URL;
    }
    return isValidKey(envVal, credentialKey);
  };

  useEffect(() => {
    const existing = getCredential(credentialKey as any);
    if (existing) {
      // Re-validate: purge stale/garbage values that were saved before strict validation
      if (isValidKey(existing, credentialKey)) {
        setValue(existing);
        setSaved(true);
      } else {
        // Garbage value in sessionStorage — nuke it
        setCredential(credentialKey as any, "");
        setValue("");
        setSaved(false);
      }
    } else {
      // No sessionStorage value — input stays empty regardless of env vars.
      // Env vars work silently at the API layer; UI only reflects user-provided keys.
      setValue("");
      setSaved(false);
    }
    setError(null);
  }, [credentialKey]);

  const handleSave = () => {
    const trimmed = value.trim();
    setError(null);
    if (!trimmed) {
      setCredential(credentialKey as any, "");
      setValue("");
      setSaved(false);
      onSaved?.();
      return;
    }

    if (!isValidKey(trimmed, credentialKey)) {
      if (credentialKey === "aura_gemini_api_key") {
        setError(
          "Invalid Gemini API key.\n\nSupported formats:\n• AQ... (current)\n• AIza... (legacy)\n\nVerify the key was copied correctly from Google AI Studio.",
        );
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <span>{icon}</span>
          <span>{label}</span>
          <span className="text-muted-foreground text-xs font-normal">({badge})</span>
        </label>
        {saved && (
          <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium transition-all duration-200 bg-green-500/10 text-green-400 border border-green-500/20">
            <CheckCircle className="w-3 h-3" />
            Saved
          </span>
        )}
        {!saved && hasEnvFallback() && (
          <span className="text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 font-medium transition-all duration-200 bg-blue-500/10 text-blue-400 border border-blue-500/20">
            <CheckCircle className="w-3 h-3" />
            Env Configured
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
          autoComplete="new-password"
          data-1p-ignore="true"
          data-lpignore="true"
          data-form-type="other"
          spellCheck="false"
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
        <p className="text-xs text-red-500 font-semibold mt-1 whitespace-pre-line">{error}</p>
      )}
      {!saved ? (
        <button
          onClick={handleSave}
          className="px-4 py-2 bg-foreground hover:bg-foreground/90 text-background rounded text-sm font-medium transition w-full cursor-pointer"
        >
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
  const [usageStats, setUsageStats] = useState({
    conversations: 0,
    messagesTotal: 0,
    lastUpdated: Date.now(),
  });
  const [showRedisManager, setShowRedisManager] = useState(false);

  // Conversation Archive state
  const [showArchive, setShowArchive] = useState(false);
  const [archiveConversations, setArchiveConversations] = useState<ConversationArchive[]>([]);
  const [archiveSearch, setArchiveSearch] = useState("");
  const [searchResults, setSearchResults] = useState<ArchiveSearchResult[]>([]);
  const [viewingConversation, setViewingConversation] = useState<ConversationArchive | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState<ArchiveExport | null>(null);

  // Detect which pipeline is already configured — UI only checks user-provided keys
  const geminiSaved = hasUserKey("aura_gemini_api_key");
  const orSaved = hasUserKey("openrouter_api_key");
  const sarvamSaved = hasUserKey("sarvam_api_key");
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

  // Auto-set voice language when pipeline is selected (dropdown defaultValue doesn't write to localStorage)
  useEffect(() => {
    if (!selectedPipeline) return;
    const currentLang = localStorage.getItem("aura_voice_language");
    if (!currentLang) {
      const defaultLang = selectedPipeline === "sarvam" ? "hi-IN" : "en-US";
      localStorage.setItem("aura_voice_language", defaultLang);
    }
  }, [selectedPipeline]);

  const handleSupabaseConnected = () => {
    setCloudSyncEnabled(true);
  };

  const handleToggleSessions = async () => {
    if (!showSessions) {
      const manager = getStorageManager("local-user");
      const allSessions = await manager.list();
      allSessions.sort(
        (a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime(),
      );
      setSessions(allSessions);
    }
    setShowSessions(!showSessions);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (confirm("Are you sure you want to delete this conversation?")) {
      const manager = getStorageManager("local-user");
      await manager.delete(sessionId);
      const allSessions = await manager.list();
      allSessions.sort(
        (a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime(),
      );
      setSessions(allSessions);
    }
  };

  // ─── Conversation Archive Handlers ───────────────────────────────────

  const loadArchive = async () => {
    const archive = getConversationArchive();
    const all = await archive.getAll();
    setArchiveConversations(all);
  };

  const handleToggleArchive = () => {
    if (!showArchive) {
      loadArchive();
      setShowArchive(true);
    } else {
      setShowArchive(false);
    }
    setViewingConversation(null);
    setSearchResults([]);
    setArchiveSearch("");
  };

  const handleArchiveSearch = async (query: string) => {
    setArchiveSearch(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const archive = getConversationArchive();
    const results = await archive.search(query);
    setSearchResults(results);
  };

  const handleOpenConversation = (conv: ConversationArchive) => {
    setViewingConversation(conv);
  };

  const handleCloseViewer = () => {
    setViewingConversation(null);
  };

  const handleDeleteArchiveConversation = async (conversationId: string) => {
    if (confirm("Delete this conversation from archive? This cannot be undone.")) {
      const archive = getConversationArchive();
      await archive.delete(conversationId);
      loadArchive();
      if (viewingConversation?.conversationId === conversationId) {
        setViewingConversation(null);
      }
    }
  };

  const handleExportConversation = (
    conv: ConversationArchive,
    format: "json" | "markdown" | "txt",
  ) => {
    let content: string;
    let filename: string;
    let mimeType: string;

    const safeName = conv.title.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 30);

    switch (format) {
      case "json":
        content = formatConversationAsJson(conv);
        filename = `aura_conversation_${safeName}.json`;
        mimeType = "application/json";
        break;
      case "markdown":
        content = formatConversationAsMarkdown(conv);
        filename = `aura_conversation_${safeName}.md`;
        mimeType = "text/markdown";
        break;
      case "txt":
        content = formatConversationAsText(conv);
        filename = `aura_conversation_${safeName}.txt`;
        mimeType = "text/plain";
        break;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportAll = async () => {
    const archive = getConversationArchive();
    const all = await archive.getAll();
    if (all.length === 0) {
      alert("No conversations to export.");
      return;
    }

    const content = formatAllConversationsAsJson(all);
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aura_archive_${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportAllMarkdown = async () => {
    const archive = getConversationArchive();
    const all = await archive.getAll();
    if (all.length === 0) {
      alert("No conversations to export.");
      return;
    }

    const content = formatAllConversationsAsMarkdown(all);
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aura_archive_${new Date().toISOString().split("T")[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!validateExport(data)) {
          alert("Invalid archive file. Please select a valid AURA export.");
          return;
        }

        setImportPreview(data);
        setShowImportModal(true);
      } catch {
        alert("Failed to read file. Please select a valid JSON file.");
      }
    };
    input.click();
  };

  const handleImportConfirm = async (mode: "merge" | "replace") => {
    if (!importPreview) return;

    const archive = getConversationArchive();
    const result = archive.importConversations(importPreview, mode);

    let message = `Imported ${result.imported} conversation(s).`;
    if (result.skipped > 0) message += ` ${result.skipped} already existed.`;
    if (result.errors > 0) message += ` ${result.errors} errors.`;

    alert(message);
    setShowImportModal(false);
    setImportPreview(null);
    await loadArchive();
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
          onClick={() => {
            setSelectedPipeline("gemini");
            setCredential("sarvam_api_key", "");
            setCredential("openrouter_api_key", "");
          }}
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
            One key does everything — voice, intelligence, and audio output through a single
            WebSocket.
          </p>
          {geminiSaved && (
            <span className="mt-2 inline-flex items-center gap-1 text-[10px] text-foreground font-medium">
              <CheckCircle className="w-3 h-3" /> Active
            </span>
          )}
        </button>

        <button
          onClick={() => {
            setSelectedPipeline("sarvam");
            setCredential("aura_gemini_api_key", "");
          }}
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
            Best for Hinglish. HD Indian voices via Sarvam + open LLMs via OpenRouter. Two keys
            needed.
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
                  You have a cloud memory copy from{" "}
                  {new Date(syncMeta.updatedAt).toLocaleDateString()}. Add Supabase credentials in
                  Power-Ups below to load it.
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
            onSaved={() => {
              if (onClose) setTimeout(onClose, 800);
            }}
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

          {/* Speech / Accent */}
          <div className="border-t border-border/40 pt-4 space-y-2">
            <label className="text-sm font-semibold text-foreground block">
              🗣️ Speech / Accent (Optional)
            </label>
            <p className="text-xs text-muted-foreground">
              Helps interpret ambiguous transcriptions based on your accent.
            </p>
            <select
              defaultValue={localStorage.getItem("aura_speech_accent") || "Automatic"}
              onChange={(e) => {
                localStorage.setItem("aura_speech_accent", e.target.value);
                // Force a reload so the orchestrator re-initializes with the new preference
                window.location.reload();
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:border-foreground"
            >
              <option value="Automatic">Automatic (Default)</option>
              <option value="en-US">US English</option>
              <option value="en-IN">Indian English</option>
              <option value="en-GB">British English</option>
              <option value="en-AU">Australian English</option>
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
            <p className="text-xs text-muted-foreground">
              Sets listening (STT) and speaking (TTS) language.
            </p>
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

          {/* Speech / Accent */}
          <div className="border-t border-border/40 pt-4 space-y-2">
            <label className="text-sm font-semibold text-foreground block">
              🗣️ Speech / Accent (Optional)
            </label>
            <p className="text-xs text-muted-foreground">
              Helps interpret ambiguous transcriptions based on your accent.
            </p>
            <select
              defaultValue={localStorage.getItem("aura_speech_accent") || "Automatic"}
              onChange={(e) => {
                localStorage.setItem("aura_speech_accent", e.target.value);
                window.location.reload();
              }}
              className="w-full px-3 py-2 bg-background border border-border rounded text-foreground text-sm focus:outline-none focus:border-foreground"
            >
              <option value="Automatic">Automatic (Default)</option>
              <option value="en-US">US English</option>
              <option value="en-IN">Indian English</option>
              <option value="en-GB">British English</option>
              <option value="en-AU">Australian English</option>
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
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground group-hover:text-foreground transition-all duration-200 ${showPowerUps ? "rotate-180" : ""}`}
          />
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
            {getCredential("redis_url") ||
            (import.meta.env.DEV ? import.meta.env.VITE_REDIS_URL : "") ? (
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
          <div
            className={`p-4 rounded-lg border transition-all ${cloudSyncEnabled ? "bg-muted/20 border-foreground/30" : "bg-muted/10 border-border"}`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <Cloud className="w-5 h-5 text-foreground" />
                <div>
                  <label className="text-sm font-semibold text-foreground block">
                    ☁️ Cloud Sync
                    <span className="ml-2 text-muted-foreground text-xs font-normal">
                      PERSISTENCE
                    </span>
                  </label>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Sync conversations across devices with your own Supabase database. Enables
                    relationship memory that survives browser clears.
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
      {/* CONVERSATION ARCHIVE — UNIFIED                                  */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-5 bg-muted/30 rounded-lg border border-border space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderArchive className="w-5 h-5 text-foreground" />
            <label className="text-sm font-semibold text-foreground">Conversation Archive</label>
          </div>
          <button
            onClick={handleToggleArchive}
            className="text-xs text-foreground hover:text-foreground/70 flex items-center gap-1"
          >
            {showArchive ? "Hide" : "Show"}
            <ChevronRight
              className={`w-4 h-4 transition-transform ${showArchive ? "rotate-90" : ""}`}
            />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">
          💾 Conversations are automatically saved on this device.
          <br />
          🔒 Private — never leaves your browser.
        </p>

        {showArchive && (
          <>
            {/* Search and Actions Bar */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search conversations..."
                  value={archiveSearch}
                  onChange={(e) => handleArchiveSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:border-foreground"
                />
              </div>
              <button
                onClick={handleImportClick}
                className="px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded text-xs font-medium transition flex items-center gap-1"
                title="Import Archive"
              >
                <Upload className="w-4 h-4" />
              </button>
              <button
                onClick={handleExportAll}
                className="px-3 py-2 bg-muted hover:bg-muted/80 text-foreground border border-border rounded text-xs font-medium transition flex items-center gap-1"
                title="Export All (JSON)"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div className="mt-2 space-y-2">
                <p className="text-[10px] text-muted-foreground">
                  {searchResults.length} result(s) found
                </p>
                {searchResults.map((result, idx) => (
                  <div key={idx} className="p-2 border border-border/50 rounded bg-background/50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">
                          {result.conversation.title}
                        </p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {result.matchedField === "title"
                            ? "Title match"
                            : `${result.matchedMessage.role} message`}
                        </p>
                        <p className="text-[10px] text-muted-foreground/70 mt-1 truncate">
                          "{result.matchedMessage.content.substring(0, 80)}..."
                        </p>
                      </div>
                      <button
                        onClick={() => handleOpenConversation(result.conversation)}
                        className="p-1 text-foreground/70 hover:text-foreground"
                      >
                        <FolderOpen className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Day-Grouped Conversation List */}
            {archiveConversations.length === 0 && !archiveSearch ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No conversations yet. Start chatting and they'll appear here.
              </p>
            ) : archiveConversations.length === 0 && archiveSearch ? (
              <p className="text-xs text-muted-foreground text-center py-4">
                No conversations match your search.
              </p>
            ) : (() => {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const yesterday = new Date(today);
              yesterday.setDate(yesterday.getDate() - 1);

              const groups: Record<string, ConversationArchive[]> = {};
              for (const conv of archiveConversations) {
                const date = new Date(conv.updatedAt);
                date.setHours(0, 0, 0, 0);
                const key = date.getTime();
                if (!groups[key]) groups[key] = [];
                groups[key].push(conv);
              }

              const formatGroupHeader = (date: Date) => {
                if (date.getTime() === today.getTime()) return "TODAY";
                if (date.getTime() === yesterday.getTime()) return "YESTERDAY";
                return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }).toUpperCase();
              };

              return (
                <div className="mt-2 space-y-4 max-h-80 overflow-y-auto custom-scrollbar">
                  {Object.entries(groups)
                    .sort(([a], [b]) => Number(b) - Number(a))
                    .map(([dateKey, convs]) => (
                      <div key={dateKey}>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          {formatGroupHeader(new Date(Number(dateKey)))}
                        </p>
                        <div className="space-y-1">
                          {convs.map((conv) => (
                            <div
                              key={conv.conversationId}
                              className="flex items-center justify-between p-2 border border-border/50 rounded bg-background hover:bg-muted/30 transition-colors"
                            >
                              <button
                                onClick={() => handleOpenConversation(conv)}
                                className="flex-1 min-w-0 text-left"
                              >
                                <p className="text-xs font-medium text-foreground truncate">{conv.title}</p>
                                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                                  <span className="flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {new Date(conv.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                  <span>{conv.messages.length} messages</span>
                                </div>
                              </button>
                              <div className="flex items-center gap-1 shrink-0 ml-2">
                                <button
                                  onClick={() => handleOpenConversation(conv)}
                                  className="p-1.5 text-foreground/70 hover:text-foreground hover:bg-foreground/10 rounded transition-colors"
                                  title="Open"
                                >
                                  <FolderOpen className="w-4 h-4" />
                                </button>
                                <div className="relative group">
                                  <button
                                    className="p-1.5 text-foreground/70 hover:text-foreground hover:bg-foreground/10 rounded transition-colors"
                                    title="Export"
                                  >
                                    <Download className="w-4 h-4" />
                                  </button>
                                  <div className="absolute right-0 top-full mt-1 bg-background border border-border rounded shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 min-w-[100px]">
                                    <button
                                      onClick={() => handleExportConversation(conv, "json")}
                                      className="w-full px-3 py-1.5 text-xs text-foreground hover:bg-muted flex items-center gap-2 text-left"
                                    >
                                      <FileText className="w-3 h-3" /> JSON
                                    </button>
                                    <button
                                      onClick={() => handleExportConversation(conv, "markdown")}
                                      className="w-full px-3 py-1.5 text-xs text-foreground hover:bg-muted flex items-center gap-2 text-left"
                                    >
                                      <FileText className="w-3 h-3" /> Markdown
                                    </button>
                                    <button
                                      onClick={() => handleExportConversation(conv, "txt")}
                                      className="w-full px-3 py-1.5 text-xs text-foreground hover:bg-muted flex items-center gap-2 text-left"
                                    >
                                      <FileText className="w-3 h-3" /> TXT
                                    </button>
                                  </div>
                                </div>
                                <button
                                  onClick={() => handleDeleteArchiveConversation(conv.conversationId)}
                                  className="p-1.5 text-red-500/70 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                                  title="Delete"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Conversation Viewer Modal */}
      {viewingConversation && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg border border-border max-w-2xl w-full max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="flex-1 min-w-0 pr-4">
                <h3 className="text-sm font-semibold text-foreground truncate">
                  {viewingConversation.title}
                </h3>
                <p className="text-[10px] text-muted-foreground">
                  {viewingConversation.messages.length} messages ·{" "}
                  {new Date(viewingConversation.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleExportConversation(viewingConversation, "json")}
                  className="p-2 text-foreground/70 hover:text-foreground hover:bg-foreground/10 rounded transition-colors"
                  title="Export JSON"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={handleCloseViewer}
                  className="p-2 text-foreground/70 hover:text-foreground hover:bg-foreground/10 rounded transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {viewingConversation.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-4 py-2 rounded-lg ${
                      msg.role === "user"
                        ? "bg-foreground text-background"
                        : "bg-muted text-foreground"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-1">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {showImportModal && importPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg border border-border max-w-md w-full">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Import Archive</h3>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview(null);
                }}
                className="p-1 text-foreground/70 hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="p-3 bg-muted/30 rounded border border-border">
                <p className="text-xs text-foreground">
                  <strong>{importPreview.conversationCount}</strong> conversation(s) ready to import
                </p>
                <ul className="mt-2 space-y-1">
                  {importPreview.conversations.slice(0, 3).map((conv) => (
                    <li key={conv.conversationId} className="text-[10px] text-muted-foreground">
                      • {conv.title} ({conv.messages.length} messages)
                    </li>
                  ))}
                  {importPreview.conversationCount > 3 && (
                    <li className="text-[10px] text-muted-foreground">
                      ...and {importPreview.conversationCount - 3} more
                    </li>
                  )}
                </ul>
              </div>
              <div className="text-xs text-muted-foreground">
                <p>
                  <strong>Merge:</strong> Add new conversations, skip existing
                </p>
                <p>
                  <strong>Replace:</strong> Clear archive and import all
                </p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-border">
              <button
                onClick={() => handleImportConfirm("merge")}
                className="flex-1 py-2 px-4 bg-foreground hover:bg-foreground/90 text-background rounded text-xs font-medium transition"
              >
                Merge
              </button>
              <button
                onClick={() => handleImportConfirm("replace")}
                className="flex-1 py-2 px-4 bg-red-500 hover:bg-red-600 text-white rounded text-xs font-medium transition"
              >
                Replace All
              </button>
              <button
                onClick={() => {
                  setShowImportModal(false);
                  setImportPreview(null);
                }}
                className="py-2 px-4 bg-muted hover:bg-muted/80 text-foreground border border-border rounded text-xs font-medium transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* FOOTER                                                         */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      <div className="p-3 bg-muted/10 rounded border border-border text-xs text-muted-foreground space-y-1">
        <p>
          🔒 <strong>Privacy First:</strong> Keys stored in browser session only. Wiped on tab
          close.
        </p>
        <p>
          💾 <strong>Local Storage:</strong> All conversations saved locally by default.
        </p>
        <p>
          ☁️ <strong>Cloud Sync:</strong> Optional — enable via Power-Ups with your own Supabase.
        </p>
      </div>
    </div>
  );
}
