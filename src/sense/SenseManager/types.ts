/**
 * AURA Sense System — Core Types
 *
 * Defines the universal contracts for every perception Sense.
 * ATF only ever sees SenseEvidenceV1 — never the internals of any Sense.
 */

export type SenseStatusCode =
  | "disconnected"
  | "connecting"
  | "connected"
  | "active"
  | "error"
  | "recovering"
  | "coming_soon";

export interface SenseHealth {
  status: SenseStatusCode;
  latency: number;
  provider: string | null;
  lastHeartbeat: number;
  lastObservation: number;
  errorCount: number;
  degradedReason?: string;
}

export interface SenseManifest {
  id: string;
  version: string;
  displayName: string;
  description: string;
  icon: string;
  dependencies: string[];
  capabilities: string[];
  providerRequirements: string[];
  requiredPermissions: string[];
}

// ─── Sense Context Payload ───────────────────────────────────────────

/**
 * Deterministic, evidence-level temporal description derived by Fusion from
 * a bounded per-source observation window. These describe signal properties
 * ONLY — never affect states or emotions (those belong to cognition).
 */
export type TemporalFeature =
  | "stable"
  | "increasing"
  | "decreasing"
  | "sudden_change"
  | "persistent"
  | "recently_changed"
  | "returned_to_baseline";

export interface SenseTemporalContext {
  /** Number of observations in the bounded window (1..MAX_WINDOW). */
  windowSize: number;
  /** Derived features for the current window (empty when windowSize < 2). */
  features: TemporalFeature[];
  /** Bounded history, oldest → newest (never grows unbounded). */
  recent: { timestamp: number; confidence: number }[];
  /** Present only after enough history exists — never fabricated. */
  baseline?: { confidence: number; observations: number };
  /** current - baseline (only present alongside baseline). */
  deviation?: number;
}

export type ProvenanceKind = "raw" | "derived";
export type ProvenanceScope = "streaming" | "utterance" | "historical";

export interface EvidenceProvenance {
  /** The exact feature name within the payload or temporal context (e.g., 'wpm', 'persistent') */
  feature: string;
  /** When it was actually observed */
  observedAt: number;
  /** "raw" for direct sensor readings, "derived" for computed states (temporal/baseline) */
  kind: ProvenanceKind;
  /** Whether the observation scope is continuous or utterance-final */
  scope: ProvenanceScope;
  /** Optional unique identifier for referencing in hypotheses */
  observationId?: string;
}

export interface SenseEvidenceV1 {
  version: 1;
  source: string; // "music", "vision", "calendar", etc.
  timestamp: number;
  confidence: number; // 0.0 – 1.0 (Assigned by PerceptionFusionLayer)
  payload: Record<string, any>;
  /** Phase C — additive temporal context; absent when no history exists yet. */
  temporal?: SenseTemporalContext;
  /** Phase F.4 — Structured provenance for every feature in the payload and temporal context. */
  provenance?: Record<string, EvidenceProvenance>;
}

// Internal raw observation produced by a Sense before fusion assigns final confidence
export interface RawSenseObservation {
  source: string;
  timestamp: number;
  estimatedConfidence: number;
  payload: Record<string, any>;
  provenance?: Record<string, EvidenceProvenance>;
}

// ─── Sense Contract (interface every Sense must implement) ───────────
export interface AuraSense {
  readonly manifest: SenseManifest;

  initialize(): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;

  health(): SenseHealth;
  collectContext(): Promise<RawSenseObservation | null>;
}

export interface SenseRegistryEntry {
  sense: AuraSense | null; // null = coming soon placeholder
  manifest: SenseManifest;
  available: boolean;
}
