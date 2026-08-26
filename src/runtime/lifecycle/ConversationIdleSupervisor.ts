import { IdleState, RuntimeActivityState } from "./LifecycleContracts";
import { IdleDetector } from "./IdleDetector";
import { IdlePolicy } from "./IdlePolicy";
import { RuntimeTelemetry } from "../RuntimeTelemetry";

export class ConversationIdleSupervisor {
  private detector = new IdleDetector();
  private policy = new IdlePolicy();
  private state = IdleState.ACTIVE;
  private intervalId: any = null;
  
  private onWarningCallback: (() => void) | null = null;
  private onTerminateCallback: (() => void) | null = null;

  public start(
    getState: () => RuntimeActivityState,
    onWarning: () => void,
    onTerminate: () => void
  ) {
    this.onWarningCallback = onWarning;
    this.onTerminateCallback = onTerminate;
    this.ping();
    
    // Check every 5 seconds
    this.intervalId = setInterval(() => {
      this.checkState(getState());
    }, 5000);
  }
  
  public ping() {
    this.detector.pingActivity();
    if (this.state !== IdleState.ACTIVE) {
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "IdleSupervisor", severity: "info", data: { event: "IdleCancelled" } });
      this.state = IdleState.ACTIVE;
    }
  }

  private checkState(activity: RuntimeActivityState) {
    if (this.state === IdleState.TERMINATED) return;
    
    this.policy.adjustForMobile(activity.isBackgrounded, false);
    const idleTime = this.detector.getIdleTimeMs(activity);
    
    if (idleTime === 0) {
      if (this.state !== IdleState.ACTIVE) {
        this.state = IdleState.ACTIVE;
      }
      return;
    }
    
    if (this.state === IdleState.ACTIVE && idleTime > 0) {
      this.state = IdleState.WAITING;
    }
    
    if (this.state === IdleState.WAITING && idleTime > this.policy.warningThresholdMs) {
      this.state = IdleState.IDLE_WARNING;
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "IdleSupervisor", severity: "warning", duration: idleTime, data: { event: "IdleWarning" } });
      if (this.onWarningCallback) this.onWarningCallback();
    }
    
    if (this.state === IdleState.IDLE_WARNING && idleTime > (this.policy.warningThresholdMs + this.policy.terminationThresholdMs)) {
      this.state = IdleState.TERMINATING;
      RuntimeTelemetry.getInstance().logEvent({ subsystem: "IdleSupervisor", severity: "info", duration: idleTime, data: { event: "ConversationAutoClosed" } });
      if (this.onTerminateCallback) this.onTerminateCallback();
      this.state = IdleState.TERMINATED;
      this.dispose();
    }
  }

  public dispose() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.state = IdleState.TERMINATED;
  }
}
