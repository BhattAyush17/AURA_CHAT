/**
 * AURA Runtime Telemetry — public surface.
 *
 *   auraTelemetry — singleton store (subscribe, getSnapshot, recordX)
 *   begin/end Provider call helpers
 *   RedundancyDetector for same-request duplicate work
 *   InfrastructureTelemetry for per-user infra status + backend polling
 *   token estimation utilities
 *   pure selectors
 *   domain types
 */

export { auraTelemetry } from "./RuntimeTelemetry";

export type {
  AnalyserLifecycle,
  AudioContextLifecycle,
  AudioSourceClass,
  BackendCapabilities,
  BackendCounterDelta,
  BackendTelemetry,
  CallKind,
  CallStatus,
  DspLoopLifecycle,
  MediaSourceLifecycle,
  MemoryOp,
  MemoryOpType,
  MemoryService,
  MobileBrowserClass,
  MobileMusicDiagnosis,
  MobileMusicDspFrame,
  MobileMusicPipelineState,
  MobileMusicTimelineEntry,
  MobileMusicTimelineKind,
  MusicContextScore,
  OperationStatus,
  PerceptionProviderLifecycle,
  ProviderCall,
  ProviderName,
  RequestStatus,
  TelemetryErrorRecord,
  TelemetryListener,
  TelemetryOperation,
  TelemetryRequest,
  TelemetrySession,
  TelemetrySnapshot,
  TokenUsage,
  UsageTokenSource,
} from "./types";

export { beginProviderCall, endProviderCall } from "./ProviderTelemetry";
export type { BeginProviderCallOptions, EndProviderCallOptions } from "./ProviderTelemetry";

export { detectRedundancies } from "./RedundancyDetector";
export type { RedundancyFlag } from "./RedundancyDetector";

export {
  getInfrastructureStatus,
  pollBackendTelemetry,
  startInfraPolling,
  stopInfraPolling,
  resetInfraPollingBaseline,
} from "./InfrastructureTelemetry";
export type { InfraRow } from "./InfrastructureTelemetry";

export { estimateTokenUsage, estimateTokens, SOURCE_LABEL, EST_TOKEN_CHARS } from "./tokenEstimate";

export {
  selectActiveLlm,
  selectMemoryAggregates,
  selectModelAggregates,
  selectProviderAggregates,
  selectRecentRequests,
  selectRequestTimeline,
} from "./selectors";
export type {
  MemoryAggregate,
  ModelAggregate,
  ProviderAggregate,
  RequestTimelineEntry,
} from "./selectors";
