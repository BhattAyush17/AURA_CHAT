import { musicService } from './MusicService';

/**
 * Executes structured tool calls invoked by the LLM (ATF).
 * No string-parsing or intent guessing happens here.
 * This merely routes the rigidly defined JSON arguments to the MusicService.
 */
export class MusicIntentResolver {
  async executeTool(toolName: string, args: any): Promise<string> {
    try {
      switch (toolName) {
        case 'play_music':
          if (args.query) {
            const results = await musicService.search(args.query);
            if (results.length > 0) {
              await musicService.playTrack(results[0]);
              return `Started playing: ${results[0].title} by ${results[0].artist}`;
            }
            return "No matching track found.";
          }
          break;
        case 'pause_music':
          await musicService.pause();
          return "Playback paused.";
        case 'resume_music':
          await musicService.resume();
          return "Playback resumed.";
        case 'next_track':
          await musicService.next();
          return "Skipped to next track.";
        case 'previous_track':
          await musicService.previous();
          return "Returned to previous track.";
        case 'set_volume':
          if (typeof args.volume === 'number') {
            await musicService.setVolume(args.volume);
            return `Volume set to ${args.volume}%.`;
          }
          break;
        default:
          return `Unknown music tool: ${toolName}`;
      }
      return "Executed successfully.";
    } catch (e: any) {
      return `Failed to execute ${toolName}: ${e?.message || 'Unknown error'}`;
    }
  }
}

export const musicIntentResolver = new MusicIntentResolver();
