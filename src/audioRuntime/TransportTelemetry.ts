export class TransportTelemetry {
  public static logDecodeTime(ms: number) {
    // Integrate with Observatory if needed
  }
  public static logBytesReceived(bytes: number) {}
  public static logUnderrun() {}

  public static trackAudioSuspended(reason: string) {
    console.warn(`[TransportTelemetry] Audio suspended. Reason: ${reason}`);
  }

  public static trackWakeLockAcquired(status: boolean) {
    console.info(`[TransportTelemetry] WakeLock acquired: ${status}`);
  }
}
