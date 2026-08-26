export class PlaybackScheduler {
  protected activeNodes = new Set<AudioBufferSourceNode>();
  protected nextPlayTime = 0;
  protected ctx: AudioContext | null = null;
  protected destination: AudioNode | null = null;

  public setContext(ctx: AudioContext, destination: AudioNode) {
    this.ctx = ctx;
    this.destination = destination;
    this.nextPlayTime = ctx.currentTime;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public scheduleBuffer(buffer: AudioBuffer, onEnded?: () => void): AudioBufferSourceNode | null {
    if (!this.ctx || !this.destination) return null;

    const node = this.ctx.createBufferSource();
    node.buffer = buffer;

    const gain = this.ctx.createGain();
    node.connect(gain);
    gain.connect(this.destination);

    const startAt = Math.max(this.ctx.currentTime, this.nextPlayTime);
    node.start(startAt);
    this.activeNodes.add(node);

    this.nextPlayTime = startAt + buffer.duration;

    node.onended = () => {
      this.activeNodes.delete(node);
      onEnded?.();
    };

    (node as any)._gainNode = gain;
    (node as any)._startAt = startAt;
    return node;
  }

  /**
   * Soft stop — halts audio that has already started but keeps pending
   * (not-yet-started) buffers scheduled, so the next transport can pick
   * up at the sentence boundary instead of being cut mid-paragraph.
   */
  public stopPlaying() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.activeNodes.forEach((node) => {
      const startAt = (node as any)._startAt as number | undefined;
      if (startAt !== undefined && startAt > now) return;

      try {
        const gain = (node as any)._gainNode as GainNode;
        if (gain) {
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          node.stop(now + 0.15);
        } else {
          node.stop(now);
        }
      } catch {}
      this.activeNodes.delete(node);
    });
  }

  public flush() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.activeNodes.forEach((node) => {
      try {
        const gain = (node as any)._gainNode as GainNode;
        if (gain) {
          gain.gain.setValueAtTime(gain.gain.value, now);
          gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
          node.stop(now + 0.15);
        } else {
          node.stop(now);
        }
      } catch {}
    });
    this.activeNodes.clear();
    this.nextPlayTime = this.ctx.currentTime;
  }

  public addSilence(seconds: number) {
    if (this.ctx) {
      this.nextPlayTime = Math.max(this.ctx.currentTime, this.nextPlayTime) + seconds;
    }
  }
}
