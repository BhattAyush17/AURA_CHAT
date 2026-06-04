/**
 * AURA Music System — YouTubeAudioProvider
 * 
 * Provider that searches for music via the backend yt-dlp endpoint,
 * with a client-side fallback when the backend is unreachable.
 * 
 * Playback uses the YouTube IFrame Player API (source: "youtube"),
 * which only needs a video ID — no backend proxy required.
 * 
 * Flow:
 *   1. Search: /api/ytmusic/search → yt-dlp resolves video ID + metadata
 *   2. Fallback: If backend is down, uses noembed.com to resolve video metadata
 *   3. Play: YouTube IFrame Player loads video by ID (no CORS issues)
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
    // Try backend first (has yt-dlp for best results)
    try {
      console.log(`[YouTubeAudioProvider] 🔍 Searching via backend: "${query}"`);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      
      const res = await fetch(
        `${BASE_URL}/api/ytmusic/search?query=${encodeURIComponent(query)}`,
        { signal: controller.signal }
      );
      clearTimeout(timeout);
      const data: YouTubeSearchResult = await res.json();

      console.log("[YouTubeAudioProvider] 📦 Backend response:", {
        title: data.title,
        artist: data.artist,
        youtube_id: data.youtube_id,
        error: data.error,
      });

      if (!data.error && data.youtube_id) {
        const track: TrackInfo = {
          id: data.youtube_id,
          title: data.title || query,
          artist: data.artist || "Unknown Artist",
          source: "youtube",
          thumbnail: data.thumbnail || `https://img.youtube.com/vi/${data.youtube_id}/mqdefault.jpg`,
          duration: data.duration || 0,
        };

        console.log(`[YouTubeAudioProvider] ✅ Track resolved: ${track.title} — ${track.artist}`);
        return [track];
      }
    } catch (err) {
      console.warn("[YouTubeAudioProvider] Backend search failed, trying fallback:", err);
    }

    // Fallback: Use YouTube search via Invidious public API
    try {
      console.log(`[YouTubeAudioProvider] 🔄 Fallback search: "${query}"`);
      const res = await fetch(
        `https://vid.puffyan.us/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const results = await res.json();
        if (results.length > 0) {
          const first = results[0];
          const track: TrackInfo = {
            id: first.videoId,
            title: first.title || query,
            artist: first.author || "Unknown Artist",
            source: "youtube",
            thumbnail: `https://img.youtube.com/vi/${first.videoId}/mqdefault.jpg`,
            duration: first.lengthSeconds || 0,
          };
          console.log(`[YouTubeAudioProvider] ✅ Fallback track: ${track.title} — ${track.artist}`);
          return [track];
        }
      }
    } catch (fallbackErr) {
      console.warn("[YouTubeAudioProvider] Fallback search also failed:", fallbackErr);
    }

    console.warn("[YouTubeAudioProvider] All search methods failed for query:", query);
    return [];
  }

  async getStreamUrl(track: TrackInfo): Promise<string | null> {
    // YouTube IFrame player doesn't need a stream URL — it plays by video ID
    return null;
  }
}

