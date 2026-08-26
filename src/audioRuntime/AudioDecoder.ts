export class AudioDecoder {
  private ctx: AudioContext | null = null;

  public setContext(ctx: AudioContext) {
    this.ctx = ctx;
  }

  public async decodeRawBytes(buffer: ArrayBuffer): Promise<AudioBuffer | null> {
    if (!this.ctx) {
      console.warn("[AudioDecoder] Missing AudioContext!");
      return null;
    }
    try {
      const clone = buffer.slice(0);
      return await this.ctx.decodeAudioData(clone);
    } catch (e) {
      console.error("[AudioDecoder] Decoding failed", e);
      return null;
    }
  }
}
