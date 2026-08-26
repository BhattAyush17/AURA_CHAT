import { SpeechCoordinator } from "@/audioRuntime/SpeechCoordinator";

export class GeminiAudioOutput {
  private speechCoordinator: SpeechCoordinator;
  private audioContext: AudioContext | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private volume: number = 1.0;
  
  constructor() {
    this.speechCoordinator = SpeechCoordinator.getInstance();
  }

  public initialize(audioContext: AudioContext, _inputAnalyser: AnalyserNode) {
    this.audioContext = audioContext;
    // Create a dedicated OUTPUT analyser that routes to audioContext.destination.
    // The _inputAnalyser belongs to the microphone input chain (which has a 
    // zero-gain node) — routing playback through it silences all output.
    this.outputAnalyser = audioContext.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.connect(audioContext.destination);
    this.speechCoordinator.initializeMediaRuntime(audioContext, this.outputAnalyser);
  }

  public enqueueChunk(base64Data: string, onEnded?: () => void) {
    if (!this.audioContext) {
      console.warn("[GeminiAudioOutput] AudioContext not initialized. Cannot play chunk.");
      onEnded?.();
      return;
    }

    const f32 = this.base64PcmToFloat32(base64Data);
    
    if (this.volume !== 1.0) {
      for (let i = 0; i < f32.length; i++) {
        f32[i] *= this.volume;
      }
    }

    const buf = this.audioContext.createBuffer(1, f32.length, 24000); // Gemini Live audio output is 24kHz
    buf.getChannelData(0).set(f32);

    this.speechCoordinator.enqueueAudioBuffer(buf, onEnded);
  }

  public stopPlayback() {
    this.speechCoordinator.flush();
  }

  public setVolume(gain: number) {
    this.volume = Math.max(0, Math.min(1, gain));
  }

  public getOutputFrequencyData(): Uint8Array {
    if (!this.outputAnalyser) return new Uint8Array(32);
    const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
    this.outputAnalyser.getByteFrequencyData(data);
    return data;
  }

  private base64PcmToFloat32(b64: string): Float32Array {
    const binaryString = atob(b64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const int16 = new Int16Array(bytes.buffer);
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      f32[i] = int16[i] / (int16[i] < 0 ? 32768 : 32767);
    }
    return f32;
  }
}
