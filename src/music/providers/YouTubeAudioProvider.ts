/**
 * AURA Music System — YouTubeAudioProvider
 * 
 * Provider implementation that uses the existing ytmusicapi backend
 * for search and resolves audio via YouTube IFrame Player API 
 * with postMessage-based programmatic control.
 * 
 * For Phase 1, we use a hybrid approach:
 *   - Search: ytmusicapi backend endpoint (/api/ytmusic/search)
 *   - Playback: YouTube IFrame Player API (embedded, production-safe)
 *   - Control: postMessage API for play/pause/seek/volume
 */

import type { IAudioProvider, TrackInfo } from "../types";
import { ENDPOINTS } from "@/config/api";

const BASE_URL = ENDPOINTS.analyzeStream.replace("/api/analyze/stream", "");

export interface YouTubeSearchResult {
  youtube_id: string | null;
  title?: string;
  artist?: string;
  thumbnail?: string;
  duration?: number;
  audio_stream_url?: string;
  error?: boolean;
}

export class YouTubeAudioProvider implements IAudioProvider {
  readonly name = "ytdlp";

  async search(query: string): Promise<TrackInfo[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/api/ytmusic/search?query=${encodeURIComponent(query)}`
      );
      const data: YouTubeSearchResult = await res.json();

      if (data.error || !data.audio_stream_url) return [];

      const track: TrackInfo = {
        id: data.youtube_id || "unknown",
        title: data.title || query,
        artist: data.artist || "Unknown Artist",
        source: "ytdlp",
        thumbnail: data.thumbnail || `https://img.youtube.com/vi/${data.youtube_id}/mqdefault.jpg`,
        duration: data.duration || 0,
        streamUrl: data.audio_stream_url,
      };

      return [track];
    } catch (err) {
      console.error("[YouTubeAudioProvider] Search failed:", err);
      return [];
    }
  }

  async getStreamUrl(track: TrackInfo): Promise<string | null> {
    return track.streamUrl || null;
  }
}
