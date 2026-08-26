export class IdlePolicy {
  public warningThresholdMs = 60000;
  public terminationThresholdMs = 30000;

  public adjustForMobile(isBackgrounded: boolean, isLocked: boolean) {
    if (isBackgrounded || isLocked) {
      this.warningThresholdMs = 120000; // allow longer idle before warning if backgrounded
      this.terminationThresholdMs = 15000; // close faster after warning to save battery
    } else {
      this.warningThresholdMs = 60000;
      this.terminationThresholdMs = 30000;
    }
  }
}
