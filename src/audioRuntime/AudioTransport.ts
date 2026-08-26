import { AudioFormat } from "./AudioFormat";

export interface AudioTransport {
  supportedInput: AudioFormat;
  supportedOutput: AudioFormat;

  initialize(): Promise<void>;
  /**
   * Receives a raw payload from the provider and returns an ArrayBuffer of raw bytes.
   * If the payload is already an ArrayBuffer, it passes it through.
   * If it's a Base64 string, it decodes it to an ArrayBuffer.
   */
  receive(payload: any): Promise<ArrayBuffer | null>;
  shutdown(): void;
}
