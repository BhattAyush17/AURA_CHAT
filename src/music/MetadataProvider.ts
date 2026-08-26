import { Track } from './types';

export class MetadataProvider {
  async enrichTrack(track: Track): Promise<Track> {
    // Stub: fetch detailed metadata from MusicBrainz, Last.fm, etc.
    return track;
  }
}
export const metadataProvider = new MetadataProvider();
