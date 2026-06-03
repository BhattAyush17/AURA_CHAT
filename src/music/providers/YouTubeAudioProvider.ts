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
  videoId: string | null;
  title?: string;
  artist?: string;
  thumbnail?: string;
  duration?: number;
}

export class YouTubeAudioProvider implements IAudioProvider {
  readonly name = "youtube";

  async search(query: string): Promise<TrackInfo[]> {
    try {
      const res = await fetch(
        `${BASE_URL}/api/ytmusic/search?query=${encodeURIComponent(query)}`
      );
      const data: YouTubeSearchResult = await res.json();

      if (!data.videoId) return [];

      // The backend currently returns a single result
      const track: TrackInfo = {
        id: data.videoId,
        title: data.title || query,
        artist: data.artist || "Unknown Artist",
        source: "youtube",
        thumbnail: data.thumbnail || `https://img.youtube.com/vi/${data.videoId}/mqdefault.jpg`,
        duration: data.duration || 0,
      };

      return [track];
    } catch (err) {
      console.error("[YouTubeAudioProvider] Search failed:", err);
      return [];
    }
  }

  async getStreamUrl(track: TrackInfo): Promise<string | null> {
    // For YouTube IFrame Player API, we don't need a stream URL.
    // The videoId is used directly by the IFrame player.
    // Return a marker URL that the MusicManager recognizes.
    return `youtube://${track.id}`;
  }
}
