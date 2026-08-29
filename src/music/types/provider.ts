export type MusicProviderId = "youtube" | "youtube_music";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authorizing"
  | "connected"
  | "error"
  | "revoked";

export interface MusicProviderAdapter {
  id: MusicProviderId;
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
  getAccountEmail(): string | null;
  getLastError(): string | null;
}
