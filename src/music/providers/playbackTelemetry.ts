// Local telemetry shim for HTMLAudioPlaybackProvider.
//
// The committed music checkpoint must not depend on @/telemetry, because the
// telemetry subsystem is only kept in the full working tree (separate, larger
// effort). Vite/Rollup resolves imports at build time and fails the production
// build when the @/telemetry module is absent.
//
// This shim provides a local, no-op-safe implementation that keeps playback
// behavior identical while degrading observability gracefully. All methods
// accept either a partial snapshot or an updater function, mirroring the real
// mobile music telemetry API so call sites compile unchanged.

type AudioElementSnapshot = {
  present: boolean;
  paused: boolean | null;
  readyState: number | null;
  networkState: number | null;
  currentTime: number | null;
  duration: number | null;
  crossOrigin: string | null;
  sourceClass: string;
};

type MobileMusicTimelineKind = string;

type GestureUpdate = {
  lastGestureAt?: number;
  playResolvedAfterGesture?: boolean;
};

type Updater<T> = ((prev: T) => T) | Partial<T>;

interface MobileMusicPipelineState {
  gesture: { lastGestureAt: number | null; playResolvedAfterGesture: boolean };
}

function applyUpdate<T>(prev: T, update: Updater<T>): T {
  if (typeof update === "function") {
    return (update as (p: T) => T)(prev);
  }
  return { ...prev, ...update };
}

const noopState: MobileMusicPipelineState = {
  gesture: { lastGestureAt: null, playResolvedAfterGesture: false },
};

export const playbackTelemetry = {
  updateMobileMusicAudioElement: (_snapshot: AudioElementSnapshot): void => {},
  recordMobileMusicTimeline: (_kind: MobileMusicTimelineKind, _note?: string): void => {},
  updateMobileMusicGesture: (update: Updater<MobileMusicPipelineState["gesture"]>): void => {
    noopState.gesture = applyUpdate(noopState.gesture, update);
  },
  getMobileMusicPipeline: (): MobileMusicPipelineState => noopState,
};

export type { MobileMusicTimelineKind };