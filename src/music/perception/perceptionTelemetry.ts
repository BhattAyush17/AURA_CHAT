// Local telemetry shim for music perception providers.
//
// The committed music checkpoint must not depend on @/telemetry, because the
// telemetry subsystem is only kept in the full working tree (separate, larger
// effort). Vite/Rollup resolves imports at build time and fails the production
// build when the @/telemetry module is absent.
//
// This shim provides a local, no-op-safe implementation that keeps perception
// behavior identical while degrading observability gracefully. All methods
// accept either a partial snapshot or an updater function, mirroring the real
// mobile music telemetry API so call sites compile unchanged.

type MobileMusicTimelineKind = string;

type Updater<T> = ((prev: T) => T) | Partial<T>;

interface MobileMusicPipelineState {
  perception: Record<string, unknown>;
  evidence: Record<string, unknown>;
  audioContext: Record<string, unknown>;
  analyser: Record<string, unknown>;
  dspLoop: Record<string, unknown>;
  mediaElementSource: Record<string, unknown>;
  gesture: { lastGestureAt: number | null; playResolvedAfterGesture: boolean };
}

function applyUpdate<T>(prev: T, update: Updater<T>): T {
  if (typeof update === "function") {
    return (update as (p: T) => T)(prev);
  }
  return { ...prev, ...update };
}

const noopState: MobileMusicPipelineState = {
  perception: {},
  evidence: {},
  audioContext: {},
  analyser: {},
  dspLoop: {},
  mediaElementSource: {},
  gesture: { lastGestureAt: null, playResolvedAfterGesture: false },
};

export const perceptionTelemetry = {
  updateMobileMusicPerception: (update: Updater<MobileMusicPipelineState["perception"]>): void => {
    noopState.perception = applyUpdate(noopState.perception, update);
  },
  updateMobileMusicEvidence: (update: Updater<MobileMusicPipelineState["evidence"]>): void => {
    noopState.evidence = applyUpdate(noopState.evidence, update);
  },
  updateMobileMusicAudioContext: (update: Updater<MobileMusicPipelineState["audioContext"]>): void => {
    noopState.audioContext = applyUpdate(noopState.audioContext, update);
  },
  updateMobileMusicAnalyser: (update: Updater<MobileMusicPipelineState["analyser"]>): void => {
    noopState.analyser = applyUpdate(noopState.analyser, update);
  },
  updateMobileMusicDspLoop: (update: Updater<MobileMusicPipelineState["dspLoop"]>): void => {
    noopState.dspLoop = applyUpdate(noopState.dspLoop, update);
  },
  updateMobileMusicMediaElementSource: (
    update: Updater<MobileMusicPipelineState["mediaElementSource"]>,
  ): void => {
    noopState.mediaElementSource = applyUpdate(noopState.mediaElementSource, update);
  },
  updateMobileMusicGesture: (update: Updater<MobileMusicPipelineState["gesture"]>): void => {
    noopState.gesture = applyUpdate(noopState.gesture, update);
  },
  recordMobileMusicTimeline: (_kind: MobileMusicTimelineKind, _note?: string): void => {},
  getMobileMusicPipeline: (): MobileMusicPipelineState => noopState,
};

export type { MobileMusicTimelineKind };