/**
 * AtmosphereContext — structured real-world grounding, delivered by the
 * backend composer and preserved through the cognitive pipeline as
 * ENVIRONMENTAL EVIDENCE (never as a personality/behavioral directive).
 *
 * Every field carries an `available` flag so a missing source degrades to
 * "unknown" rather than to a fabricated default. Geographic provenance is
 * preserved so fallback coordinates are never treated as verified location.
 */

export interface AtmosphereTemporal {
  available: boolean;
  timestamp?: string;
  dayOfWeek?: string;
  timezone?: string;
  utcOffset?: string;
  period?: string;
  season?: string;
  isLateNight?: boolean;
  isWeekend?: boolean;
}

export interface AtmosphereGeography {
  available: boolean;
  city?: string;
  region?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  /** "ipapi.co" (verified-ish) | "fallback" | "client_coordinates" | "unknown" */
  source?: string;
  confidence?: "low" | "medium" | "high" | "unknown";
}

export interface AtmosphereWeather {
  available: boolean;
  summary?: string;
  temperature?: string;
  humidity?: string;
  conditions?: string;
  source?: string;
}

export interface AtmosphereNews {
  available: boolean;
  resultCount: number;
  fetchedAt?: string | null;
  source?: string;
  query?: string;
}

export interface AtmosphereDevice {
  available: boolean;
  os?: string;
  battery?: number;
}

export interface AtmosphereNetwork {
  available: boolean;
  online?: boolean;
  quality?: string;
  latencyMs?: number;
}

export interface AtmosphereFreshness {
  available: boolean;
  timezone?: string;
  ttlSeconds?: number;
}

export interface AtmosphereContext {
  /** Where did this atmosphere come from? */
  provenance: "backend";
  temporal?: AtmosphereTemporal;
  geography?: AtmosphereGeography;
  weather?: AtmosphereWeather;
  news?: AtmosphereNews;
  device?: AtmosphereDevice;
  network?: AtmosphereNetwork;
  freshness?: AtmosphereFreshness;
}

// ─── Mapper from backend composer payload ────────────────────────────────

interface ComposerAtmospherePayload {
  temporal?: Record<string, unknown>;
  geography?: Record<string, unknown>;
  weather?: Record<string, unknown>;
  news?: Record<string, unknown> | null;
  device?: Record<string, unknown>;
  network?: Record<string, unknown>;
  freshness?: Record<string, unknown>;
}

export function atmosphereFromComposer(
  payload: ComposerAtmospherePayload | null | undefined,
): AtmosphereContext | null {
  if (!payload) return null;
  return {
    provenance: "backend",
    temporal: payload.temporal as AtmosphereTemporal | undefined,
    geography: payload.geography as AtmosphereGeography | undefined,
    weather: payload.weather as AtmosphereWeather | undefined,
    news: payload.news as AtmosphereNews | undefined,
    device: payload.device as AtmosphereDevice | undefined,
    network: payload.network as AtmosphereNetwork | undefined,
    freshness: payload.freshness as AtmosphereFreshness | undefined,
  };
}

/**
 * Browser wall-clock temporal baseline. Always available with zero latency and
 * no network dependency — used by Gemini Live (which builds its system
 * instruction once at session start and cannot fetch backend grounding
 * per-turn) so it shares temporal awareness with the other providers.
 */
export function browserTemporalAtmosphere(): AtmosphereContext {
  const now = new Date();
  const hour = now.getHours();
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  })();
  return {
    provenance: "backend",
    temporal: {
      available: true,
      timestamp: now.toISOString(),
      dayOfWeek: now.toLocaleDateString("en", { weekday: "long" }),
      timezone: tz,
      utcOffset: undefined,
      period:
        hour < 5
          ? "night"
          : hour < 12
            ? "morning"
            : hour < 17
              ? "afternoon"
              : hour < 21
                ? "evening"
                : "night",
      season: undefined,
      isLateNight: hour >= 23 || hour < 5,
      isWeekend: now.getDay() === 0 || now.getDay() === 6,
    },
  };
}

// ─── Bounded relevance-gated prompt renderer ─────────────────────────────

/**
 * Renders ONLY the atmosphere dimensions an attention decision marked relevant.
 * This is the anti-pollution gate: an irrelevant atmosphere produces an empty
 * string, so it never reaches the LLM's cognitive context.
 */
export function buildAtmosphereContextBlock(
  atmosphere: AtmosphereContext | null | undefined,
  relevant: {
    temporal?: boolean;
    geography?: boolean;
    weather?: boolean;
    news?: boolean;
  },
): string {
  if (!atmosphere) return "";

  const lines: string[] = [];

  if (relevant.temporal && atmosphere.temporal?.available) {
    const t = atmosphere.temporal;
    lines.push(`Time: ${t.dayOfWeek ?? ""} ${t.period ?? ""} (${t.timestamp ?? "unknown"})`);
    if (t.timezone) lines.push(`Timezone: ${t.timezone}${t.utcOffset ? ` (${t.utcOffset})` : ""}`);
    if (t.season) lines.push(`Season: ${t.season}`);
  }

  if (relevant.geography && atmosphere.geography?.available) {
    const g = atmosphere.geography;
    lines.push(
      `Location: ${[g.city, g.region, g.country].filter(Boolean).join(", ")}${
        g.confidence ? ` (${g.confidence} confidence, ${g.source ?? "unknown"} source)` : ""
      }`,
    );
  }

  if (relevant.weather && atmosphere.weather?.available) {
    const w = atmosphere.weather;
    lines.push(`Weather: ${w.conditions ?? ""} ${w.temperature ?? ""} ${w.humidity ?? ""}`.trim());
  }

  if (relevant.news && atmosphere.news?.available && atmosphere.news.resultCount > 0) {
    lines.push(
      `Live news retrieved from ${atmosphere.news.source ?? "unknown"} (${atmosphere.news.resultCount} result(s) for "${atmosphere.news.query ?? ""}")`,
    );
  }

  if (lines.length === 0) return "";
  return `\n[ENVIRONMENT CONTEXT]\n${lines.join("\n")}\n[/ENVIRONMENT CONTEXT]\n`;
}
