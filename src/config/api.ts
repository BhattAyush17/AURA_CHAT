const API_BASE = import.meta.env.VITE_API_BASE;

if (!API_BASE && import.meta.env.PROD) {
  console.warn(
    "[AURA] VITE_API_BASE is not set. Behavior engine features will be unavailable. " +
      "Set it in your Vercel environment variables if you have a backend deployed.",
  );
}

const BASE_URL = API_BASE || "http://localhost:8000";

export const ENDPOINTS = {
  sessionStart: `${BASE_URL}/session/start`,
  sessionEnd: `${BASE_URL}/session/end`,
  sessionEndSync: `${BASE_URL}/session/end/sync`,
  analyze: `${BASE_URL}/api/analyze`,
  health: `${BASE_URL}/health`,
  proactive: `${BASE_URL}/api/proactive`,
  chat: `${BASE_URL}/chat`,
} as const;

// API_SECRET deliberately removed — VITE_ variables are public.
// Backend enforces security via Origin header check instead.
