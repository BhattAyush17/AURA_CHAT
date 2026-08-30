import { SearchProvider, Track, isValidMediaUrl } from "../types";
import { googleIdentityService } from "../../auth/GoogleIdentityService";
import { ENDPOINTS } from "@/config/api";

export class YouTubeSearchProvider implements SearchProvider {
  id = "youtube_search";
  name = "YouTube Music Search";

  async initialize(): Promise<void> {
    // Initialization is silent, no OAuth here.
  }

  async search(query: string): Promise<Track[]> {
    console.log(`[YouTubeSearchProvider] 🔍 Searching: "${query}"`);

    // 1. Try Authenticated API (only if session already exists)
    const session = googleIdentityService.getSession();
    if (session?.accessToken) {
      try {
        const res = await fetch(
          `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoCategoryId=10&maxResults=5`,
          {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          },
        );
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            console.log(`[MUSIC_SEARCH] YouTube result videoId=${data.items[0].id.videoId}`);
            const resolveEndpoint = ENDPOINTS.health.replace("/health", "/api/ytmusic/resolve");

            const resolvedItems = await Promise.all(
              data.items.map(async (item: any) => {
                const videoId = item.id.videoId;
                let audioUrl: string | undefined = undefined;
                let resolveData: Record<string, unknown> | null = null;

                try {
                  console.log(`[MUSIC_RESOLVE] Resolving videoId=${videoId}`);
                  const resolveRes = await fetch(
                    `${resolveEndpoint}?video_id=${encodeURIComponent(videoId)}`,
                  );
                  if (resolveRes.ok) {
                    resolveData = await resolveRes.json();
                    if (!resolveData?.error && resolveData?.audio_stream_url) {
                      audioUrl = resolveData.audio_stream_url as string;
                      if (audioUrl && audioUrl.includes("googlevideo.com")) {
                        const proxyBase = ENDPOINTS.health.replace("/health", "/api/ytmusic/proxy");
                        let proxyUrl = `${proxyBase}?url=${encodeURIComponent(audioUrl)}`;
                        if (resolveData.http_headers) {
                          proxyUrl += `&h=${encodeURIComponent(btoa(JSON.stringify(resolveData.http_headers)))}`;
                        }
                        audioUrl = proxyUrl;
                      }
                      console.log(`[MUSIC_RESOLVE] audio stream acquired for videoId=${videoId}`);
                    }
                  }
                } catch (resolveErr) {
                  console.warn(
                    `[MUSIC_ERROR] Backend resolution failed for ${videoId}:`,
                    resolveErr,
                  );
                }

                return {
                  id: videoId,
                  title: item.snippet.title,
                  artist: item.snippet.channelTitle,
                  albumArt: item.snippet.thumbnails.default.url,
                  durationMs: 0,
                  chapters: resolveData?.chapters,
                  source: "youtube",
                  url: audioUrl,
                };
              }),
            );

            const playableItems = resolvedItems.filter((item) => isValidMediaUrl(item.url));
            if (playableItems.length > 0) {
              console.log(`[MUSIC_TRACK] playable=true`);
              return playableItems as Track[];
            } else {
              console.warn("[MUSIC_ERROR] Couldn't get an audio stream for this track.");
            }
          }
        }
      } catch (e) {
        console.warn("[YouTubeSearchProvider] Authenticated search failed, falling back:", e);
      }
    }

    // 2. Try Backend yt-dlp proxy
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45000); // Increased timeout to 45s
      const searchEndpoint = ENDPOINTS.health.replace("/health", "/api/ytmusic/search");
      const res = await fetch(`${searchEndpoint}?query=${encodeURIComponent(query)}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        if (!data.error && data.youtube_id && data.audio_stream_url) {
          let finalUrl = data.audio_stream_url;
          if (finalUrl.includes("googlevideo.com")) {
            const proxyBase = ENDPOINTS.health.replace("/health", "/api/ytmusic/proxy");
            let proxyUrl = `${proxyBase}?url=${encodeURIComponent(finalUrl)}`;
            if (data.http_headers) {
              proxyUrl += `&h=${encodeURIComponent(btoa(JSON.stringify(data.http_headers)))}`;
            }
            finalUrl = proxyUrl;
          }

          if (isValidMediaUrl(finalUrl)) {
            return [
              {
                id: data.youtube_id,
                title: data.title || query,
                artist: data.artist || "Unknown Artist",
                albumArt:
                  data.thumbnail || `https://img.youtube.com/vi/${data.youtube_id}/mqdefault.jpg`,
                durationMs: (data.duration || 0) * 1000,
                chapters: data.chapters,
                url: finalUrl,
                source: "youtube",
              },
            ];
          } else {
            console.warn(
              "[YouTubeSearchProvider] Backend resolved invalid audio stream URL:",
              finalUrl,
            );
          }
        } else if (data.error) {
          console.warn(`[MUSIC_ERROR] Backend error: ${data.message}`);
        }
      }
    } catch (err: any) {
      console.warn(
        "[YouTubeSearchProvider] Backend search failed:",
        err.name === "AbortError" ? "Timeout after 20s" : err,
      );
    }

    // 3. Try Invidious Public API
    try {
      const res = await fetch(
        `https://vid.puffyan.us/api/v1/search?q=${encodeURIComponent(query)}&type=video&sort_by=relevance`,
        {
          signal: AbortSignal.timeout(5000),
        },
      );
      if (res.ok) {
        const results = await res.json();
        if (results && results.length > 0) {
          const first = results[0];
          let invidiousAudioUrl: string | undefined = undefined;
          if (Array.isArray(first.adaptiveFormats)) {
            const audioFormat = first.adaptiveFormats.find((f: any) => f.type?.includes("audio"));
            if (audioFormat?.url) {
              invidiousAudioUrl = audioFormat.url;
            }
          }
          if (isValidMediaUrl(invidiousAudioUrl)) {
            return [
              {
                id: first.videoId,
                title: first.title || query,
                artist: first.author || "Unknown Artist",
                albumArt: `https://img.youtube.com/vi/${first.videoId}/mqdefault.jpg`,
                durationMs: (first.lengthSeconds || 0) * 1000,
                url: invidiousAudioUrl,
                source: "youtube",
              },
            ];
          }
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
