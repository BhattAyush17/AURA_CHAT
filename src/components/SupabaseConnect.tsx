/**
 * SupabaseConnect — Guided 4-step Supabase onboarding flow
 *
 * State machine phases:
 *   idle → step_url → step_sql → step_key → connecting → done | error
 *
 * No OAuth, no backend dependency — runs entirely client-side on free tier.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Cloud,
  CheckCircle,
  Loader2,
  ExternalLink,
  RefreshCw,
  XCircle,
  ChevronDown,
  Database,
  Zap,
  Shield,
  Unplug,
  Copy,
  Check,
  Eye,
  EyeOff,
} from "lucide-react";
import { createClient } from "@supabase/supabase-js";
import { initSupabase } from "@/lib/supabase";
import { getStorageManager } from "@/lib/storage/manager";
import { setCredential } from "@/lib/credentials";

// ─── Types ───────────────────────────────────────────────────────
type Phase =
  | "idle"
  | "step_url"
  | "step_sql"
  | "step_key"
  | "connecting"
  | "done"
  | "error";

interface ErrorInfo {
  phase: Phase;
  message: string;
}

interface SupabaseConnectProps {
  onConnected?: (client: any) => void;
}

// ─── Constants ───────────────────────────────────────────────────
const SETUP_SQL = `CREATE TABLE IF NOT EXISTS aura_storage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE aura_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON aura_storage
  FOR ALL TO anon USING (true) WITH CHECK (true);`;

const ERROR_MAP: Record<string, string> = {
  table_missing:
    "SQL setup wasn't detected. Please re-run the setup SQL and try again.",
  connect_failed: "Couldn't connect. Double-check your URL and key.",
  unknown: "Something went wrong. Please try again.",
};

// ─── Validators ──────────────────────────────────────────────────
const isValidSupabaseUrl = (u: string) =>
  /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(u.trim());

const isValidAnonKey = (k: string) => k.trim().startsWith("eyJ");

// ─── Fade/slide animation presets ────────────────────────────────
const fadeSlide = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

// ─── Component ───────────────────────────────────────────────────
export function SupabaseConnect({ onConnected }: SupabaseConnectProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [projectName, setProjectName] = useState("");

  // Step 1 state
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);

  // Step 2 state
  const [sqlDone, setSqlDone] = useState(false);
  const [copied, setCopied] = useState(false);

  // Step 3 state
  const [anonKey, setAnonKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  // Derived: project ref from URL
  const ref = url
    .trim()
    .replace("https://", "")
    .replace(".supabase.co", "");

  // ── On mount: check if already connected ─────────────────────
  useEffect(() => {
    const savedUrl = localStorage.getItem("aura_sb_url");
    const savedKey = localStorage.getItem("aura_sb_key");
    const savedName = localStorage.getItem("aura_sb_project_name");
    if (savedUrl && savedKey) {
      setProjectName(savedName || savedUrl.replace("https://", "").replace(".supabase.co", ""));
      initSupabase(savedUrl, savedKey);
      setPhase("done");
    }
  }, []);

  // ── Error helper ──────────────────────────────────────────────
  const setErrorState = useCallback((failedPhase: Phase, key: string) => {
    setPhase("error");
    setError({ phase: failedPhase, message: ERROR_MAP[key] || ERROR_MAP.unknown });
  }, []);

  // ══════════════════════════════════════════════════════════════
  // STEP 1 → Validate URL and advance
  // ══════════════════════════════════════════════════════════════
  const handleUrlNext = useCallback(() => {
    if (!isValidSupabaseUrl(url)) {
      setUrlError(
        "That doesn't look right. It should be https://xxxxxx.supabase.co"
      );
      return;
    }
    setUrlError(null);
    setPhase("step_sql");
  }, [url]);

  // ══════════════════════════════════════════════════════════════
  // STEP 3 → Connect & validate
  // ══════════════════════════════════════════════════════════════
  const handleConnect = useCallback(async () => {
    if (!isValidAnonKey(anonKey)) {
      setKeyError(
        "That doesn't look like a valid key. It should start with eyJ"
      );
      return;
    }
    setKeyError(null);
    setPhase("connecting");

    try {
      // 1. Validate connection with a lightweight test query
      const client = createClient(url.trim(), anonKey.trim());
      const { error: queryError } = await client
        .from("aura_storage")
        .select("id")
        .limit(1);

      if (queryError && queryError.code !== "PGRST116") {
        // PGRST116 = table exists but empty — that's fine
        throw new Error(queryError.message);
      }

      // 2. Persist to localStorage (reuse existing keys)
      const projectRef = url
        .trim()
        .replace("https://", "")
        .replace(".supabase.co", "");

      localStorage.setItem("aura_sb_url", url.trim());
      localStorage.setItem("aura_sb_key", anonKey.trim());
      localStorage.setItem("aura_sb_project_name", projectRef);
      localStorage.setItem("aura_cloud_sync_enabled", "true");

      // Also set in credentials system
      setCredential("supabase_url", url.trim());
      setCredential("supabase_anon_key", anonKey.trim());

      // Initialize client via the shared module
      const initializedClient = initSupabase(url.trim(), anonKey.trim());

      // Update storage manager
      const manager = getStorageManager();
      manager.initializeRemoteAdapter();

      setProjectName(projectRef);
      setPhase("done");
      onConnected?.(initializedClient);
    } catch (err: any) {
      const msg = err?.message || "";
      if (msg.includes("relation") || msg.includes("does not exist")) {
        setErrorState("connecting", "table_missing");
      } else {
        setErrorState("connecting", "connect_failed");
      }
    }
  }, [url, anonKey, onConnected, setErrorState]);

  // ── Copy SQL to clipboard ────────────────────────────────────
  const handleCopySQL = useCallback(async () => {
    await navigator.clipboard.writeText(SETUP_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // ── Manual connect (advanced) ────────────────────────────────
  const handleManualConnect = useCallback(() => {
    if (!manualUrl.trim() || !manualKey.trim()) return;
    const mUrl = manualUrl.trim();
    const mKey = manualKey.trim();

    localStorage.setItem("aura_sb_url", mUrl);
    localStorage.setItem("aura_sb_key", mKey);
    localStorage.setItem("aura_sb_project_name", "Manual Project");
    localStorage.setItem("aura_cloud_sync_enabled", "true");
    setCredential("supabase_url", mUrl);
    setCredential("supabase_anon_key", mKey);

    const client = initSupabase(mUrl, mKey);
    const manager = getStorageManager();
    manager.initializeRemoteAdapter();

    setProjectName("Manual Project");
    setPhase("done");
    onConnected?.(client);
  }, [manualUrl, manualKey, onConnected]);

  // ── Disconnect ────────────────────────────────────────────────
  const handleDisconnect = useCallback(() => {
    localStorage.removeItem("aura_sb_url");
    localStorage.removeItem("aura_sb_key");
    localStorage.removeItem("aura_sb_project_name");
    localStorage.removeItem("aura_cloud_sync_enabled");
    setPhase("idle");
    setUrl("");
    setAnonKey("");
    setSqlDone(false);
    setProjectName("");
  }, []);

  // ── Retry from error ──────────────────────────────────────────
  const handleRetry = useCallback(() => {
    if (!error) return;
    setError(null);
    // Go back to step_key, not step 1 — don't make them re-enter URL
    setPhase("step_key");
  }, [error]);

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════
  return (
    <div className="sc-root">
      <AnimatePresence mode="wait">
        {/* ── IDLE ─────────────────────────────────────────── */}
        {phase === "idle" && (
          <motion.div key="idle" {...fadeSlide} className="sc-phase">
            <div className="sc-icon-ring">
              <Cloud className="w-7 h-7" />
            </div>
            <h3 className="sc-title">Connect Cloud Storage</h3>
            <p className="sc-subtitle">
              Sync conversations across devices — powered by your own free
              Supabase database. Takes about 4 minutes.
            </p>
            <button
              onClick={() => setPhase("step_url")}
              className="sc-btn-primary"
              id="supabase-connect-btn"
            >
              <Zap className="w-4 h-4" />
              Connect your Supabase database
            </button>
            <div className="sc-security-badge">
              <Shield className="w-3 h-3" />
              <span>Your data stays in your own database</span>
            </div>
            <button
              onClick={() => setShowManual(!showManual)}
              className="sc-toggle-manual"
            >
              <ChevronDown
                className={`w-3 h-3 transition-transform duration-200 ${showManual ? "rotate-180" : ""}`}
              />
              Advanced / Manual setup
            </button>
            <AnimatePresence>
              {showManual && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="sc-manual-form"
                >
                  <input
                    type="url"
                    placeholder="Supabase URL (https://xxx.supabase.co)"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    className="sc-input"
                  />
                  <input
                    type="password"
                    placeholder="Anon key"
                    value={manualKey}
                    onChange={(e) => setManualKey(e.target.value)}
                    className="sc-input"
                  />
                  <button
                    onClick={handleManualConnect}
                    disabled={!manualUrl.trim() || !manualKey.trim()}
                    className="sc-btn-secondary"
                  >
                    Connect Manually
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* ── STEP 1: URL ──────────────────────────────────── */}
        {phase === "step_url" && (
          <motion.div key="step_url" {...fadeSlide} className="sc-phase">
            <div className="sc-step-header">
              <span className="sc-step-badge">Step 1 of 3</span>
              <h3 className="sc-title">Your Project URL</h3>
              <p className="sc-subtitle">
                Create a free project at supabase.com first if you haven't.
              </p>
            </div>
            <a
              href="https://supabase.com/dashboard/new"
              target="_blank"
              rel="noopener noreferrer"
              className="sc-btn-secondary sc-btn-with-icon"
            >
              Open Supabase → Create Project
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <input
              type="url"
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setUrlError(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && handleUrlNext()}
              className={`sc-input sc-input-wide ${urlError ? "sc-input-error" : ""}`}
            />
            {urlError && <p className="sc-field-error">{urlError}</p>}
            <div className="sc-nav-row">
              <button
                onClick={() => setPhase("idle")}
                className="sc-btn-ghost"
              >
                Back
              </button>
              <button onClick={handleUrlNext} className="sc-btn-primary">
                Next
              </button>
            </div>
          </motion.div>
        )}

        {/* ── STEP 2: SQL ──────────────────────────────────── */}
        {phase === "step_sql" && (
          <motion.div key="step_sql" {...fadeSlide} className="sc-phase">
            <div className="sc-step-header">
              <span className="sc-step-badge">Step 2 of 3</span>
              <h3 className="sc-title">One-time Setup</h3>
              <p className="sc-subtitle">
                Run this SQL once in your Supabase dashboard. Takes 10 seconds.
              </p>
            </div>

            <div className="sc-code-block">
              <div className="sc-code-header">
                <span className="sc-code-lang">SQL</span>
                <button onClick={handleCopySQL} className="sc-copy-btn">
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" /> Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" /> Copy SQL
                    </>
                  )}
                </button>
              </div>
              <pre className="sc-code-pre">{SETUP_SQL}</pre>
            </div>

            <a
              href={`https://supabase.com/dashboard/project/${ref}/sql/new`}
              target="_blank"
              rel="noopener noreferrer"
              className="sc-btn-secondary sc-btn-with-icon"
            >
              Open SQL Editor
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <label className="sc-checkbox-label">
              <input
                type="checkbox"
                checked={sqlDone}
                onChange={(e) => setSqlDone(e.target.checked)}
                className="sc-checkbox"
              />
              <span>I ran the SQL ✓</span>
            </label>

            <div className="sc-nav-row">
              <button
                onClick={() => setPhase("step_url")}
                className="sc-btn-ghost"
              >
                Back
              </button>
              <button
                disabled={!sqlDone}
                onClick={() => setPhase("step_key")}
                className="sc-btn-primary"
              >
                Next
              </button>
            </div>
          </motion.div>
        )}

        {/* ── STEP 3: ANON KEY ─────────────────────────────── */}
        {phase === "step_key" && (
          <motion.div key="step_key" {...fadeSlide} className="sc-phase">
            <div className="sc-step-header">
              <span className="sc-step-badge">Step 3 of 3</span>
              <h3 className="sc-title">Your Anon Key</h3>
              <p className="sc-subtitle">
                This is your public API key. It's safe to paste here.
              </p>
            </div>

            <a
              href={`https://supabase.com/dashboard/project/${ref}/settings/api`}
              target="_blank"
              rel="noopener noreferrer"
              className="sc-btn-secondary sc-btn-with-icon"
            >
              Find my anon key
              <ExternalLink className="w-3.5 h-3.5" />
            </a>

            <div className="sc-input-wrapper">
              <input
                type={showKey ? "text" : "password"}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                value={anonKey}
                onChange={(e) => {
                  setAnonKey(e.target.value);
                  setKeyError(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && handleConnect()}
                className={`sc-input sc-input-wide ${keyError ? "sc-input-error" : ""}`}
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="sc-input-toggle"
                type="button"
                aria-label={showKey ? "Hide key" : "Show key"}
              >
                {showKey ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
            {keyError && <p className="sc-field-error">{keyError}</p>}

            <div className="sc-nav-row">
              <button
                onClick={() => setPhase("step_sql")}
                className="sc-btn-ghost"
              >
                Back
              </button>
              <button onClick={handleConnect} className="sc-btn-primary">
                <Database className="w-4 h-4" />
                Connect
              </button>
            </div>
          </motion.div>
        )}

        {/* ── CONNECTING ───────────────────────────────────── */}
        {phase === "connecting" && (
          <motion.div key="connecting" {...fadeSlide} className="sc-phase">
            <Loader2 className="w-6 h-6 sc-spinner" />
            <h3 className="sc-title">Validating connection…</h3>
            <p className="sc-subtitle">
              Testing your database and verifying the setup.
            </p>
          </motion.div>
        )}

        {/* ── DONE ─────────────────────────────────────────── */}
        {phase === "done" && (
          <motion.div key="done" {...fadeSlide} className="sc-phase">
            <div className="sc-icon-ring sc-icon-ring-success">
              <CheckCircle className="w-7 h-7" />
            </div>
            <h3 className="sc-title">Connected to {projectName}</h3>
            <p className="sc-subtitle">
              Your conversations are now syncing privately to your own database.
            </p>
            <div className="sc-done-actions">
              <button onClick={handleDisconnect} className="sc-btn-ghost">
                <Unplug className="w-3.5 h-3.5" /> Disconnect
              </button>
              <button
                onClick={() => {
                  handleDisconnect();
                  setTimeout(() => setPhase("step_url"), 100);
                }}
                className="sc-btn-ghost"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Change project
              </button>
            </div>
          </motion.div>
        )}

        {/* ── ERROR ────────────────────────────────────────── */}
        {phase === "error" && error && (
          <motion.div key="error" {...fadeSlide} className="sc-phase">
            <div className="sc-icon-ring sc-icon-ring-error">
              <XCircle className="w-7 h-7" />
            </div>
            <p className="sc-error-msg">{error.message}</p>
            <button onClick={handleRetry} className="sc-btn-primary">
              <RefreshCw className="w-4 h-4" /> Retry
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
