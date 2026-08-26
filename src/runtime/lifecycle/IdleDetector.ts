import { RuntimeActivityState } from "./LifecycleContracts";

export class IdleDetector {
  private lastActivityTime: number = Date.now();

  public pingActivity() {
    this.lastActivityTime = Date.now();
  }

  public getIdleTimeMs(state: RuntimeActivityState): number {
    if (state.isSpeaking || state.isThinking || state.isUserSpeaking || state.isRecovering) {
      this.pingActivity();
      return 0;
    }
    return Date.now() - this.lastActivityTime;
  }
}
