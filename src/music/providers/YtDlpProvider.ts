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
      const timeout = setTimeout(() => controller.abort(), 20000); // Increased timeout to 20s
      const searchEndpoint = ENDPOINTS.health.replace('/health', '/api/ytmusic/search');
      const res = await fetch(`${searchEndpoint}?query=${encodeURIComponent(query)}`, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (res.ok) {
        const data = await res.json();
        if (!data.error && data.youtube_id) {
          let finalUrl = data.audio_stream_url || `https://www.youtube.com/watch?v=${data.youtube_id}`;
          
          if (data.audio_stream_url && data.audio_stream_url.includes('googlevideo.com')) {
            const proxyBase = ENDPOINTS.health.replace('/health', '/api/ytmusic/proxy');
            let proxyUrl = `${proxyBase}?url=${encodeURIComponent(data.audio_stream_url)}`;
            if (data.http_headers) {
              proxyUrl += `&h=${encodeURIComponent(btoa(JSON.stringify(data.http_headers)))}`;
            }
            finalUrl = proxyUrl;
          }

          return [{
            id: data.youtube_id,
            title: data.title || query,
            artist: data.artist || "Unknown Artist",
            albumArt: data.thumbnail || `https://img.youtube.com/vi/${data.youtube_id}/mqdefault.jpg`,
            durationMs: (data.duration || 0) * 1000,
            url: finalUrl,
            source: 'ytdlp'
          }];
        } else if (data.error) {
          console.error(`[YtDlpProvider] Backend returned error: ${data.message}`);
          throw new Error(data.message || "Unknown backend error");
        }
      } else {
         console.error(`[YtDlpProvider] HTTP Error: ${res.status}`);
      }
    } catch (err: any) {
      console.error("[YtDlpProvider] Backend search failed:", err.name === 'AbortError' ? 'Timeout after 20s' : err);
      // Surface the error so MusicService knows it failed
      throw err;
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
