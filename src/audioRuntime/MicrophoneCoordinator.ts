import { RuntimeTelemetry } from "../runtime/RuntimeTelemetry";
import { AudioBufferPool, BufferLease } from "./AudioBufferPool";

/**
 * MicrophoneCoordinator
 * 
 * Centralizes the acquisition, lifecycle, and recovery of the user's microphone.
 * Owns AudioContext, Worklets, and Input Streams.
 * Providers now consume from this Coordinator instead of calling getUserMedia themselves.
 */
export class MicrophoneCoordinator {
  private static instance: MicrophoneCoordinator;

  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  
  private isAcquiring: boolean = false;
  private acquisitionPromise: Promise<{ stream: MediaStream, audioContext: AudioContext, analyser: AnalyserNode }> | null = null;
  private subscribers: Set<(data: { type: string; pcm?: Float32Array; lease?: BufferLease; rms?: number; probability?: number; noiseFloor?: number; silenceMs?: number }) => void> = new Set();
  
  // Mobile lifecycle bound status
  private isSuspended: boolean = false;
  
  private constructor() {
    if (typeof window !== "undefined") {
      this.bindMobileLifecycle();
    }
  }

  public static getInstance(): MicrophoneCoordinator {
    if (!this.instance) {
      this.instance = new MicrophoneCoordinator();
    }
    return this.instance;
  }

  /**
   * Acquires the microphone and sets up the AudioContext and Worklet.
   */
  public async acquireMicrophone(): Promise<{ stream: MediaStream, audioContext: AudioContext, analyser: AnalyserNode }> {
    const callerStack = new Error().stack || "";
    RuntimeTelemetry.getInstance().logEvent({ 
      subsystem: "MicrophoneCoordinator", 
      severity: "info", 
      data: { event: "AcquireRequested", callerStack } 
    });

    if (this.stream && this.audioContext && this.inputAnalyser) {
      return { stream: this.stream, audioContext: this.audioContext, analyser: this.inputAnalyser };
    }

    if (this.acquisitionPromise) {
      RuntimeTelemetry.getInstance().logEvent({ 
        subsystem: "MicrophoneCoordinator", 
        severity: "info", 
        data: { event: "AcquireReusingPromise" } 
      });
      return this.acquisitionPromise;
    }

    this.isAcquiring = true;
    this.acquisitionPromise = (async () => {
      try {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "info", data: { event: "Acquiring Mic" } });
        
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        this.audioContext = new AudioContext({ sampleRate: 16000 });
        this.inputAnalyser = this.audioContext.createAnalyser();
        this.inputAnalyser.fftSize = 256;

        const src = this.audioContext.createMediaStreamSource(this.stream);
        
        // High-pass filter
        const highPass = this.audioContext.createBiquadFilter();
        highPass.type = "highpass";
        highPass.frequency.value = 80;

        // Low-pass filter
        const lowPass = this.audioContext.createBiquadFilter();
        lowPass.type = "lowpass";
        lowPass.frequency.value = 8000;

        src.connect(highPass).connect(lowPass).connect(this.inputAnalyser);

        await this.setupWorklet();

        return { stream: this.stream, audioContext: this.audioContext, analyser: this.inputAnalyser };
      } catch (e) {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "error", data: { event: "MicAcquisitionFailed", error: String(e) } });
        throw e;
      } finally {
        this.isAcquiring = false;
        this.acquisitionPromise = null;
      }
    })();

    return this.acquisitionPromise;
  }

  private async setupWorklet() {
    if (!this.audioContext || !this.inputAnalyser) return;

    try {
      await this.audioContext.audioWorklet.addModule("/vad-processor.js");
      this.workletNode = new AudioWorkletNode(this.audioContext, "vad-processor", {
        processorOptions: { inputSampleRate: this.audioContext.sampleRate },
      });
      
      this.workletNode.port.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === "PCM_DATA") {
          const raw = msg.pcm;
          const f32 = raw instanceof Float32Array ? raw : new Float32Array(raw);
          const lease = AudioBufferPool.getInstance().acquire(f32);
          
          this.subscribers.forEach(cb => cb({
            type: "PCM_DATA",
            pcm: lease.data,
            lease: lease,
            rms: msg.rms,
            probability: msg.probability,
            noiseFloor: msg.noiseFloor,
            silenceMs: msg.silenceMs
          }));
        } else if (msg.type === "BARGE_IN_DETECTED") {
          this.subscribers.forEach(cb => cb({
            type: "BARGE_IN_DETECTED",
            rms: msg.rms,
            probability: msg.probability
          }));
        }
      };
      
      this.inputAnalyser.connect(this.workletNode);
      const silent = this.audioContext.createGain();
      silent.gain.value = 0;
      this.workletNode.connect(silent).connect(this.audioContext.destination);
    } catch (err) {
      console.warn("[MicrophoneCoordinator] AudioWorklet failed", err);
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "error", data: { event: "WorkletFailed", error: String(err) } });
    }
  }

  public setVadState(isListening: boolean, isSpeaking: boolean, isGracePeriod: boolean) {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'SET_STATE', isListening, isSpeaking, isGracePeriod });
    }
  }

  public subscribeToStream(callback: (data: any) => void) {
    this.subscribers.add(callback);
  }

  public unsubscribeFromStream(callback: (data: any) => void) {
    this.subscribers.delete(callback);
  }

  public getAnalyser(): AnalyserNode | null {
    return this.inputAnalyser;
  }

  public getStream(): MediaStream | null {
    return this.stream;
  }

  public getInputFrequencyData(): Uint8Array {
    if (!this.inputAnalyser) return new Uint8Array(32);
    const data = new Uint8Array(this.inputAnalyser.frequencyBinCount);
    this.inputAnalyser.getByteFrequencyData(data);
    return data;
  }



  /**
   * Releases the microphone and cleans up all audio graph nodes.
   */
  public releaseMicrophone() {
    const callerStack = new Error().stack || "";
    RuntimeTelemetry.getInstance().logEvent({ 
      subsystem: "MicrophoneCoordinator", 
      severity: "info", 
      data: { event: "ReleaseRequested", callerStack } 
    });

    this.acquisitionPromise = null;
    this.isAcquiring = false;

    if (this.workletNode) {
      this.workletNode.disconnect();
      if (this.workletNode.port) this.workletNode.port.close();
      this.workletNode = null;
    }
    
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    
    if (this.inputAnalyser) {
      this.inputAnalyser.disconnect();
      this.inputAnalyser = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    
    if (this.audioContext) {
      if (this.audioContext.state !== "closed") {
        this.audioContext.close().catch(() => {});
      }
      this.audioContext = null;
    }
    
    this.subscribers.clear();
    RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "info", data: { event: "MicReleased" } });
  }

  public isAudioContextAlive(): boolean {
    return this.audioContext?.state === "running";
  }

  public async resumeAudioContext(): Promise<void> {
    if (this.audioContext && this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
  }

  private bindMobileLifecycle() {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (this.audioContext && this.audioContext.state === "running") {
          this.isSuspended = true;
          RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "warning", data: { event: "SuspendingForBackground" } });
        }
      } else if (document.visibilityState === "visible") {
        if (this.isSuspended && this.audioContext) {
          this.audioContext.resume().then(() => {
            this.isSuspended = false;
            RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "info", data: { event: "ResumedFromBackground" } });
          }).catch(e => {
            RuntimeTelemetry.getInstance().logEvent({ subsystem: "MicrophoneCoordinator", severity: "error", data: { event: "ResumeFailed", error: String(e) } });
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    
    // Explicit user-gesture auto-resume (Android)
    const unlockAudio = () => {
      if (this.audioContext && this.audioContext.state === "suspended") {
        this.audioContext.resume().catch(() => {});
      }
    };
    document.addEventListener("touchstart", unlockAudio, { passive: true });
    document.addEventListener("click", unlockAudio, { passive: true });
  }
}
