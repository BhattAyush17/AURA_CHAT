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
import { getGeminiKey } from "@/lib/api";
import {
  Cloud,
  Key,
  CheckCircle,
  Zap,
  ChevronDown,
  Eye,
  EyeOff,
} from "lucide-react";
import { setCredential, hasRequiredCredentials } from "@/lib/credentials";
import { loadSyncMeta, SyncMeta } from "@/lib/sync-meta";
import { SupabaseConnect } from "@/components/SupabaseConnect";

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

  const handleSupabaseConnected = () => {
    setCloudSyncEnabled(true);
    setShowCloudPrompt(false);
  };

  // ═══════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-background rounded-lg border border-border shadow-sm space-y-6">
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
              <strong>Tip:</strong> For seamless connectivity across devices, click here to add
              your Supabase credentials.
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
        </button>
      )}

      {/* Cloud Sync Section - Show by default after 5 conversations, or if already enabled */}
      {(showCloudSyncSection || cloudSyncEnabled) && (
        <div
          className={`p-5 rounded-lg border transition-all space-y-4 ${showCloudPrompt
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
