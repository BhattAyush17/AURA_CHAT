/**
 * AURA Music System — YouTubeAudioProvider
 * 
 * Provider that uses yt-dlp backend for search and resolves audio 
 * through a server-side proxy to bypass CORS restrictions.
 * 
 * Flow:
 *   1. Search: /api/ytmusic/search → yt-dlp resolves direct audio URL
 *   2. Proxy:  /api/ytmusic/proxy?url=<encoded_url> → backend streams audio
 *   3. Play:   HTMLAudioElement plays the proxied stream (no CORS issues)
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
      console.log(`[YouTubeAudioProvider] 🔍 Searching: "${query}"`);
      const res = await fetch(
        `${BASE_URL}/api/ytmusic/search?query=${encodeURIComponent(query)}`
      );
      const data: YouTubeSearchResult = await res.json();

      console.log("[YouTubeAudioProvider] 📦 Backend response:", {
        title: data.title,
        artist: data.artist,
        has_stream: !!data.audio_stream_url,
        error: data.error,
      });

      if (data.error || !data.audio_stream_url) return [];

      // Route through the backend proxy to avoid CORS
      const proxyUrl = `${BASE_URL}/api/ytmusic/proxy?url=${encodeURIComponent(data.audio_stream_url)}`;

      const track: TrackInfo = {
        id: data.youtube_id || "unknown",
        title: data.title || query,
        artist: data.artist || "Unknown Artist",
        source: "ytdlp",
        thumbnail: data.thumbnail || `https://img.youtube.com/vi/${data.youtube_id}/mqdefault.jpg`,
        duration: data.duration || 0,
        streamUrl: proxyUrl,
      };

      console.log(`[YouTubeAudioProvider] ✅ Track resolved: ${track.title} — ${track.artist}`);
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
