import { RuntimeTelemetry } from "../RuntimeTelemetry";

export class AudioReliabilitySupervisor {
  private context: AudioContext | null = null;
  private recoveryAttempts = 0;

  public monitor(ctx: AudioContext) {
    this.context = ctx;
    ctx.onstatechange = () => {
      if (ctx.state === 'suspended') {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "warning", data: { event: "AudioFailed", reason: "suspended" } });
        this.attemptRecovery();
      } else if (ctx.state === 'interrupted') {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "warning", data: { event: "AudioFailed", reason: "interrupted" } });
      } else if (ctx.state === 'running') {
        RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "info", data: { event: "AudioRecovered" } });
        this.recoveryAttempts = 0;
      }
    };
  }

  public async attemptRecovery() {
    if (!this.context) return;
    RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "info", data: { event: "RecoveryStarted" } });
    if (this.recoveryAttempts > 3) {
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "error", data: { event: "AudioFailed", reason: "max_recovery_attempts" } });
      return;
    }
    
    this.recoveryAttempts++;
    try {
      await this.context.resume();
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "info", data: { event: "RecoveryCompleted" } });
    } catch (e) {
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "Audio", severity: "warning", data: { event: "AudioFailed", reason: "resume_failed" } });
    }
  }

  public isHealthy(): boolean {
    return this.context ? this.context.state === 'running' : true;
  }
  
  public dispose() {
    if (this.context) {
      this.context.onstatechange = null;
      this.context = null;
    }
  }
}
