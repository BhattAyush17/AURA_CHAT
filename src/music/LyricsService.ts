export class LyricsService {
  async fetchLyrics(trackId: string): Promise<string | null> {
    // Stub: would fetch lyrics from an API
    return null;
  }
  
  async analyzeThemes(lyrics: string): Promise<string[]> {
    return [];
  }
}
export const lyricsService = new LyricsService();
