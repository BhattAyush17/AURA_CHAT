import { MusicProvider, Track } from '../types';
import { ENDPOINTS } from '@/config/api';

/**
 * YtDlpProvider (Fallback)
 * 
 * Used when the official Google OAuth / YouTube API fails.
 * Connects to a hypothetical backend service running yt-dlp to extract raw audio streams.
 */
export class YtDlpProvider implements MusicProvider {
  id = 'ytdlp';
  name = 'yt-dlp Extraction Pipeline';
  
  async initialize(): Promise<void> {
    // Connect to backend stream service (no auth needed)
  }

  async search(query: string): Promise<Track[]> {
    console.log(`[YtDlpProvider] 🔍 Searching: "${query}"`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const searchEndpoint = ENDPOINTS.health.replace('/health', '/api/ytmusic/search');
      const res = await fetch(`${searchEndpoint}?query=${encodeURIComponent(query)}`, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (res.ok) {
        const data = await res.json();
        if (!data.error && data.youtube_id) {
          return [{
            id: data.youtube_id,
            title: data.title || query,
            artist: data.artist || "Unknown Artist",
            albumArt: data.thumbnail || `https://img.youtube.com/vi/${data.youtube_id}/mqdefault.jpg`,
            durationMs: (data.duration || 0) * 1000,
            url: data.audio_stream_url || `https://www.youtube.com/watch?v=${data.youtube_id}`,
            source: 'ytdlp'
          }];
        }
      }
    } catch (err) {
      console.warn("[YtDlpProvider] Backend search failed:", err);
    }
    return [];
  }

  async getMetadata(trackId: string): Promise<Partial<Track>> {
    return {};
  }

  async getAudioStream(trackId: string): Promise<string | null> {
    return null;
  }

  async getLyrics(trackId: string): Promise<string | null> {
    return null;
  }

  async recommend(context?: any): Promise<Track[]> {
    return [];
  }

  // PlaybackProvider methods are handled by HTMLAudioPlaybackProvider centrally
  // So these remain empty stubs for the unified MusicProvider interface
  async play(trackId: string): Promise<void> {}
  async pause(): Promise<void> {}
  async resume(): Promise<void> {}
  async seek(positionMs: number): Promise<void> {}
  async setVolume(volume: number): Promise<void> {}
  async dispose(): Promise<void> {}
}
