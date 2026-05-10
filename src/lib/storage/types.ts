export type StorageProvider = "supabase" | "firebase" | "pocketbase" | "local";

export interface ConnectionConfig {
  provider: StorageProvider;
  url: string;
  apiKey: string;
  projectId?: string; // Specific for Firebase
}

export interface AuraSeed {
  content: string;
  updatedAt: string; // ISO String
}

export interface AuraSession {
  sessionId: string;
  transcript: any[];
  updatedAt: string;
}

export interface StorageStatus {
  mode: "browser" | "remote";
  synced: boolean;
  lastSync: string | null;
}

export interface Turn {
  text: string;
  user_initiated: boolean;
  timestamp?: number;
}

export const SEED_VERSION = 1 as const;
export type SeedVersion = typeof SEED_VERSION;

export interface SeedData {
  version: SeedVersion; // typed to the literal, not just number
  seed: string; // full [SEED]...[/SEED] block
  auraState: string; // [AURA_STATE] block
  growth: string[]; // last 5 [AURA_GROWTH] entries
  updatedAt: number;
}

export interface SessionData {
  session_id: string;
  transcript: Array<{
    text: string;
    user_initiated: boolean;
    timestamp?: number;
  }>;
  user_id?: string;
  last_active: string; // ISO timestamp
  seed?: string;
}

export interface StorageAdapter {
  save(data: SessionData): Promise<boolean>;
  retrieve(sessionId: string): Promise<SessionData | null>;
  list(): Promise<SessionData[]>;
  delete(sessionId: string): Promise<boolean>;
  testConnection?(): Promise<boolean>;
  getStatus(): any;
  saveSeed(userId: string, seed: SeedData): Promise<boolean>;
  loadSeed(userId: string): Promise<SeedData | null>;
}
