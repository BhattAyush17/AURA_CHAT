/**
 * useResilience — React hook for consuming the AURA Resilience Layer.
 *
 * Provides:
 *   - The singleton ResilienceOrchestrator instance
 *   - Current experience mode and adaptation policy
 *   - Health scores for all subsystems
 *   - Event subscription for UI feedback
 *
 * Usage:
 *   const { orchestrator, mode, policy, health } = useResilience(sessionId);
 *
 * The orchestrator is created once and persists across re-renders.
 * It starts automatically when the hook mounts and stops on unmount.
 *
 * @module resilience/hooks
 */

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { ResilienceOrchestrator } from "../orchestrator";
import type {
  ExperienceMode,
  AdaptationPolicy,
  ExperienceHealthSnapshot,
  ResilienceEvent,
  ResilienceState,
} from "../types";

export interface ResilienceAPI {
  /** The singleton orchestrator — use this for signal ingestion */
  orchestrator: ResilienceOrchestrator;

  /** Current experience mode */
  mode: ExperienceMode;

  /** Current adaptation policy for LLM/TTS consumers */
  policy: AdaptationPolicy;

  /** Full experience health snapshot */
  health: ExperienceHealthSnapshot;

  /** Phase 1 resilience state */
  resilience: ResilienceState;

  /** Whether the system is currently recovering from a failure */
  isRecovering: boolean;

  /** Subscribe to specific event kinds */
  onEvent: (listener: (event: ResilienceEvent) => void) => () => void;
}

// Module-level singleton to prevent re-creation across Fast Refresh
let _orchestratorInstance: ResilienceOrchestrator | null = null;
let _orchestratorSessionId: string | null = null;

function getOrCreateOrchestrator(sessionId: string): ResilienceOrchestrator {
  if (_orchestratorInstance && _orchestratorSessionId === sessionId) {
    return _orchestratorInstance;
  }

  // Destroy old instance if session changed
  if (_orchestratorInstance) {
    _orchestratorInstance.destroy();
  }

  _orchestratorInstance = new ResilienceOrchestrator(sessionId);
  _orchestratorSessionId = sessionId;
  return _orchestratorInstance;
}

export function useResilience(sessionId: string): ResilienceAPI {
  const orchestratorRef = useRef<ResilienceOrchestrator>(
    getOrCreateOrchestrator(sessionId)
  );

  const [mode, setMode] = useState<ExperienceMode>("HEALTHY");
  const [policy, setPolicy] = useState<AdaptationPolicy>(
    orchestratorRef.current.getPolicy()
  );
  const [health, setHealth] = useState<ExperienceHealthSnapshot>(
    orchestratorRef.current.experienceEngine.getSnapshot()
  );
  const [resilience, setResilience] = useState<ResilienceState>(
    orchestratorRef.current.getResilienceState()
  );
  const [isRecovering, setIsRecovering] = useState(false);

  // Start orchestrator on mount
  useEffect(() => {
    const orch = orchestratorRef.current;
    orch.start();

    // Poll state at a relaxed rate (1Hz) to update React state
    const pollHandle = setInterval(() => {
      const state = orch.getState();
      setMode(state.mode);
      setPolicy(state.adaptationPolicy);
      setHealth(state.experienceHealth);
      setResilience(state.resilience);
      setIsRecovering(state.isRecovering);
    }, 1000);

    // Listen for mode changes to update immediately
    const unsub = orch.addEventListener((event) => {
      if (event.kind === "mode_changed") {
        setMode(event.to);
        setPolicy(orch.getPolicy());
      }
    });

    return () => {
      clearInterval(pollHandle);
      unsub();
      orch.stop();
    };
  }, [sessionId]);

  const onEvent = useCallback(
    (listener: (event: ResilienceEvent) => void): (() => void) => {
      return orchestratorRef.current.addEventListener(listener);
    },
    []
  );

  return useMemo(
    () => ({
      orchestrator: orchestratorRef.current,
      mode,
      policy,
      health,
      resilience,
      isRecovering,
      onEvent,
    }),
    [mode, policy, health, resilience, isRecovering, onEvent]
  );
}

/**
 * useAdaptationPolicy — Lightweight hook for components that only
 * need the current adaptation policy (e.g., LLM prompt builders).
 */
export function useAdaptationPolicy(sessionId: string): AdaptationPolicy {
  const { policy } = useResilience(sessionId);
  return policy;
}

/**
 * useExperienceMode — Lightweight hook for components that only
 * need the current mode string.
 */
export function useExperienceMode(sessionId: string): ExperienceMode {
  const { mode } = useResilience(sessionId);
  return mode;
}
