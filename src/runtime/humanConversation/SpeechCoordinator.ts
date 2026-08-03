export class SpeechCoordinator {
  private static instance: SpeechCoordinator;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private activeAudioSource: AudioBufferSourceNode | null = null;
  private activeGainNode: GainNode | null = null;
  private activeAudioContext: AudioContext | null = null;
  
  private constructor() {}

  public static getInstance(): SpeechCoordinator {
    if (!SpeechCoordinator.instance) {
      SpeechCoordinator.instance = new SpeechCoordinator();
    }
    return SpeechCoordinator.instance;
  }

  // Queue state for AudioContext chunks
  private activeNodes = new Set<AudioBufferSourceNode>();
  private nextPlayTime = 0;

  public getNextPlayTime(): number {
    return this.nextPlayTime;
  }

  public registerWebSpeech(utterance: SpeechSynthesisUtterance) {
    this.flush(); // Ensure old streams die
    this.activeUtterance = utterance;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.speak(utterance);
    }
  }

  public registerAudioContextStream(
    ctx: AudioContext,
    source: AudioBufferSourceNode,
    gain: GainNode
  ) {
    this.flush(); // Ensure old streams die
    this.activeAudioContext = ctx;
    this.activeAudioSource = source;
    this.activeGainNode = gain;
    source.start(0);
  }

  public queueAudioContextBuffer(
    ctx: AudioContext,
    buffer: AudioBuffer,
    outAnalyser: AnalyserNode,
    delayOffsetSec: number,
    onEnded?: () => void
  ) {
    // If WebSpeech is playing, kill it. (Since this is Gemini's queue)
    if (this.activeUtterance && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.activeUtterance = null;
    }

    this.activeAudioContext = ctx;
    
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    
    // Smooth gain for prevent clicking
    const gain = ctx.createGain();
    node.connect(gain);
    gain.connect(outAnalyser);

    const startAt = Math.max(ctx.currentTime, this.nextPlayTime);
    const scheduledAt = startAt + delayOffsetSec;

    node.start(scheduledAt);
    this.activeNodes.add(node);
    this.nextPlayTime = scheduledAt + buffer.duration;

    node.onended = () => {
      this.activeNodes.delete(node);
      onEnded?.();
    };
  }

  public flush() {
    console.log("[SpeechCoordinator] 🛑 Flushing stale streams...");

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.activeUtterance = null;
    }

    if (this.activeAudioSource && this.activeGainNode && this.activeAudioContext) {
      try {
        const now = this.activeAudioContext.currentTime;
        this.activeGainNode.gain.setValueAtTime(this.activeGainNode.gain.value, now);
        this.activeGainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        this.activeAudioSource.stop(now + 0.15);
      } catch (e) {
        // Fallback hard stop
        try { this.activeAudioSource.stop(); } catch {}
      }
    } else if (this.activeAudioSource) {
      try { this.activeAudioSource.stop(); } catch {}
    }

    this.activeNodes.forEach(node => {
        try { node.stop(); } catch {}
    });
    this.activeNodes.clear();
    this.nextPlayTime = this.activeAudioContext ? this.activeAudioContext.currentTime : 0;

    // Cleanup references after fade
    setTimeout(() => {
      if (this.activeAudioSource) {
        this.activeAudioSource.disconnect();
        this.activeAudioSource = null;
      }
      if (this.activeGainNode) {
        this.activeGainNode.disconnect();
        this.activeGainNode = null;
      }
    }, 200);
  }
}
