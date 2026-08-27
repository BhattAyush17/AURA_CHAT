import { SearchProvider, Track } from '../types';
import { googleIdentityService } from '../../auth/GoogleIdentityService';
import { ENDPOINTS } from '@/config/api';

export class YouTubeSearchProvider implements SearchProvider {
  id = 'youtube_search';
  name = 'YouTube Music Search';

  async initialize(): Promise<void> {
    // Initialization is silent, no OAuth here.
  }

  async search(query: string): Promise<Track[]> {
    console.log(`[YouTubeSearchProvider] 🔍 Searching: "${query}"`);
    
    // 1. Try Authenticated API (only if session already exists)
    const session = googleIdentityService.getSession();
    if (session?.accessToken) {
      try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=5`, {
          headers: { Authorization: `Bearer ${session.accessToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            return data.items.map((item: any) => ({
              id: item.id.videoId,
              title: item.snippet.title,
              artist: item.snippet.channelTitle,
              albumArt: item.snippet.thumbnails.default.url,
              durationMs: 0,
              source: 'youtube'
            }));
          }
        }
      } catch (e) {
        console.warn("[YouTubeSearchProvider] Authenticated search failed, falling back:", e);
      }
    }

    // 2. Try Backend yt-dlp proxy
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
            source: 'youtube'
          }];
        }
      }
    } catch (err) {
      console.warn("[YouTubeSearchProvider] Backend search failed, falling back to Invidious:", err);
    }

    // 3. Try Invidious Public API
    try {
      const res = await fetch(`https://vid.puffyan.us/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`, { 
        signal: AbortSignal.timeout(5000) 
      });
      if (res.ok) {
        const results = await res.json();
        if (results && results.length > 0) {
          const first = results[0];
          return [{
            id: first.videoId,
            title: first.title || query,
            artist: first.author || "Unknown Artist",
            albumArt: `https://img.youtube.com/vi/${first.videoId}/mqdefault.jpg`,
            durationMs: (first.lengthSeconds || 0) * 1000,
            source: 'youtube'
          }];
        }
      }
    } catch (fallbackErr) {
      console.warn("[YouTubeSearchProvider] Invidious fallback search failed:", fallbackErr);
    }

    console.warn("[YouTubeSearchProvider] All search methods failed for query:", query);
    return [];
  }

  async getMetadata(trackId: string): Promise<Partial<Track>> {
    return {};
  }

  async getLyrics(trackId: string): Promise<string | null> {
    return null;
  }

  async recommend(context?: any): Promise<Track[]> {
    return [];
  }
}
