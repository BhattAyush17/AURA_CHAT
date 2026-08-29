import { MicrophoneCoordinator } from "@/audioRuntime/MicrophoneCoordinator";

export class GeminiAudioInput {
  private micCoordinator: MicrophoneCoordinator;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private onAudioDataCallback: ((base64Data: string) => void) | null = null;
  private onBargeInCallback: (() => void) | null = null;
  private isStreaming: boolean = false;
  private isMuted: boolean = false;

  constructor() {
    this.micCoordinator = MicrophoneCoordinator.getInstance();
    this.handleMicData = this.handleMicData.bind(this);
  }

  public async acquire(): Promise<{ audioContext: AudioContext; analyser: AnalyserNode }> {
    const { audioContext, analyser } = await this.micCoordinator.acquireMicrophone();
    this.audioContext = audioContext;
    this.analyser = analyser;
    return { audioContext, analyser };
  }

  public startStreaming(callback: (base64Data: string) => void, onBargeIn?: () => void) {
    this.onAudioDataCallback = callback;
    this.onBargeInCallback = onBargeIn || null;
    if (!this.isStreaming) {
      this.micCoordinator.subscribeToStream(this.handleMicData);
      this.isStreaming = true;
    }
  }

  public setVadState(isListening: boolean, isSpeaking: boolean, isGracePeriod: boolean) {
    this.micCoordinator.setVadState(isListening, isSpeaking, isGracePeriod);
  }

  public stopStreaming() {
    if (this.isStreaming) {
      this.micCoordinator.unsubscribeFromStream(this.handleMicData);
      this.isStreaming = false;
    }
    this.onAudioDataCallback = null;
    this.onBargeInCallback = null;
  }

  public teardown() {
    this.stopStreaming();
    // Do not release microphone entirely, as it may be used by other parts of the app
    // or persisted across sessions. The VoiceEngine handles lifecycle.
  }

  public mute() {
    this.isMuted = true;
  }

  public unmute() {
    this.isMuted = false;
  }

  public getFrequencyData(): Uint8Array {
    return this.micCoordinator.getInputFrequencyData();
  }

  private handleMicData(msg: any) {
    if (msg.type === "PCM_DATA" && msg.lease && this.onAudioDataCallback) {
      if (!this.isMuted) {
        const b64 = this.float32ToBase64Pcm(msg.lease.data);
        this.onAudioDataCallback(b64);
      }
      msg.lease.release();
    } else if (msg.type === "BARGE_IN_DETECTED" && this.onBargeInCallback) {
      this.onBargeInCallback();
    }
  }

  private float32ToBase64Pcm(f32: Float32Array): string {
    let l = f32.length;
    const buf = new Int16Array(l);
    while (l--) {
      const s = Math.max(-1, Math.min(1, f32[l]));
      buf[l] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return btoa(String.fromCharCode(...new Uint8Array(buf.buffer)));
  }
}
