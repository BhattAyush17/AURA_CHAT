import { AudioFormat } from "./AudioFormat";
import { AudioTransport } from "./AudioTransport";
import { TransportTelemetry } from "./TransportTelemetry";

export class SarvamTransport implements AudioTransport {
  supportedInput = AudioFormat.BASE64_JSON;
  supportedOutput = AudioFormat.WAV; // Emits ArrayBuffer ready for decode

  async initialize(): Promise<void> {}

  async receive(payload: string): Promise<ArrayBuffer | null> {
    const start = performance.now();
    try {
      // Decode Base64 off-main-thread ideally, but using standard JS here
      // For Milestone 5, this removes it from React hook at least.
      const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0));
      TransportTelemetry.logDecodeTime(performance.now() - start);
      TransportTelemetry.logBytesReceived(bytes.byteLength);
      return bytes.buffer;
    } catch (e) {
      console.error("[SarvamTransport] Base64 Decode Failed", e);
      return null;
    }
  }

  shutdown(): void {}
}
