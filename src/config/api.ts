let rawApiBase = (import.meta as any).env?.VITE_API_BASE?.trim();
if (rawApiBase && rawApiBase.endsWith("/")) {
  rawApiBase = rawApiBase.slice(0, -1);
}

if (!rawApiBase && (import.meta as any).env?.PROD) {
  const errMsg =
    "[AURA] VITE_API_BASE is not set in production. Behavior engine features will be unavailable.";
  console.warn(errMsg);
  if (typeof window !== "undefined") {
    (window as any).__AURA_TELEMETRY__?.recordError?.(new Error(errMsg));
  }
}

let BASE_URL = rawApiBase;
if (!BASE_URL) {
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    const isIP = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname);
    if (isIP || hostname.endsWith(".local") || hostname === "localhost") {
      BASE_URL = `http://${hostname}:8000`;
    } else {
      BASE_URL = "http://localhost:8000";
    }
  } else {
    BASE_URL = "http://localhost:8000";
  }
}

export const ENDPOINTS = {
  base: BASE_URL,
  sessionStart: `${BASE_URL}/session/start`,
  sessionEnd: `${BASE_URL}/session/end`,
  sessionEndSync: `${BASE_URL}/session/end/sync`,
  analyze: `${BASE_URL}/api/analyze`,
  analyzeStream: `${BASE_URL}/api/analyze/stream`,
  health: `${BASE_URL}/health`,
  proactive: `${BASE_URL}/api/proactive`,
  chat: `${BASE_URL}/chat`,
  turnProfileSave: `${BASE_URL}/api/turn-profile/save`,
  turnProfileLoad: `${BASE_URL}/api/turn-profile/load`,
  turnDetect: `${BASE_URL}/api/turn-detect`,
  telemetry: `${BASE_URL}/api/telemetry`,
} as const;

// API_SECRET deliberately removed — VITE_ variables are public.
// Backend enforces security via Origin header check instead.
