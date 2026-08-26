import { AudioDecoder } from "@/audioRuntime/AudioDecoder";
import { PlaybackScheduler } from "@/audioRuntime/PlaybackScheduler";
import { AudioReliabilitySupervisor } from "@/runtime/resilience/AudioReliabilitySupervisor";

export class SpeechCoordinator {
  private static instance: SpeechCoordinator;
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private decoder: AudioDecoder = new AudioDecoder();
  private scheduler: PlaybackScheduler = new PlaybackScheduler();
  private audioSupervisor: AudioReliabilitySupervisor = new AudioReliabilitySupervisor();
  private isContextInitialized = false;

  private constructor() {}

  public static getInstance(): SpeechCoordinator {
    if (!SpeechCoordinator.instance) {
      SpeechCoordinator.instance = new SpeechCoordinator();
    }
    return SpeechCoordinator.instance;
  }

  public initializeMediaRuntime(ctx: AudioContext, destination: AudioNode) {
    if (this.isContextInitialized && this.scheduler.getContext() === ctx) return;
    this.decoder.setContext(ctx);
    this.scheduler.setContext(ctx, destination);
    this.audioSupervisor.monitor(ctx);
    this.isContextInitialized = true;
  }

  public registerWebSpeech(utterance: SpeechSynthesisUtterance) {
    this.stopPlaying(); // Cancel in-flight audio only; keep pending sentence buffers
    this.activeUtterance = utterance;
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.speak(utterance);
    }
  }

  /**
   * Transport switch without paragraph amputation: stops audio that is
   * already playing (fading out) but preserves scheduled, not-yet-started
   * buffers so the next transport resumes at the sentence boundary.
   */
  public stopPlaying() {
    if (typeof window !== "undefined" && window.speechSynthesis && this.activeUtterance) {
      window.speechSynthesis.cancel();
      this.activeUtterance = null;
    }
    this.scheduler.stopPlaying();
  }

  /**
   * Universal Transport Enqueue
   * Consumes raw bytes from ANY transport (Sarvam, ElevenLabs, etc.)
   * and schedules them for gapless playback.
   */
  public async enqueueRawBytes(rawBytes: ArrayBuffer, onEnded?: () => void) {
    if (this.activeUtterance && typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.activeUtterance = null;
    }

    if (!this.isContextInitialized) {
      console.warn("[SpeechCoordinator] AudioContext not initialized! Cannot decode.");
      onEnded?.();
      return;
    }

    try {
      const audioBuffer = await this.decoder.decodeRawBytes(rawBytes);
      if (audioBuffer) {
        this.scheduler.scheduleBuffer(audioBuffer, onEnded);
      } else {
        onEnded?.();
      }
    } catch (e) {
      console.error("[SpeechCoordinator] Audio Decode Exception:", e);
      onEnded?.();
    }
  }

  public enqueueAudioBuffer(audioBuffer: AudioBuffer, onEnded?: () => void) {
    if (!this.isContextInitialized) {
      console.warn("[SpeechCoordinator] AudioContext not initialized! Cannot play buffer.");
      onEnded?.();
      return;
    }
    this.scheduler.scheduleBuffer(audioBuffer, onEnded);
  }

  public flush() {
    console.log("[SpeechCoordinator] 🛑 Flushing stale streams...");

    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      this.activeUtterance = null;
    }

    this.scheduler.flush();
    this.audioSupervisor.dispose();
  }
}
