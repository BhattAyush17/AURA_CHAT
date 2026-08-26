import { RuntimeTelemetry } from "../RuntimeTelemetry";

export class MicrophoneSupervisor {
  private activeStream: MediaStream | null = null;
  private recoveryCallback: (() => Promise<void>) | null = null;
  
  public setRecoveryCallback(cb: () => Promise<void>) {
    this.recoveryCallback = cb;
  }

  public monitor(stream: MediaStream) {
    this.activeStream = stream;
    
    stream.getAudioTracks().forEach(track => {
      track.onended = () => {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Microphone", severity: "error", data: { event: "MicPermissionLost" } });
        this.attemptRecovery();
      };
      
      track.onmute = () => {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Microphone", severity: "warning", data: { event: "MicMuted" } });
      };
      
      track.onunmute = () => {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Microphone", severity: "info", data: { event: "MicRecovered" } });
      };
    });
  }

  private async attemptRecovery() {
    if (this.recoveryCallback) {
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "Microphone", severity: "info", data: { event: "RecoveryStarted" } });
      try {
        await this.recoveryCallback();
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Microphone", severity: "info", data: { event: "RecoveryCompleted" } });
      } catch (e) {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Microphone", severity: "error", data: { event: "MicFailed", reason: "recovery_failed" } });
      }
    }
  }

  public isHealthy(): boolean {
    if (!this.activeStream) return false;
    const tracks = this.activeStream.getAudioTracks();
    return tracks.length > 0 && tracks.every(t => t.readyState === 'live' && !t.muted);
  }
  
  public dispose() {
    if (this.activeStream) {
      this.activeStream.getAudioTracks().forEach(t => {
        t.onended = null;
        t.onmute = null;
        t.onunmute = null;
      });
      this.activeStream = null;
    }
  }
}
