/**
 * Voice Perception Store — Phase B
 *
 * The smallest safe bridge between the React-owned voice/acoustic perception
 * (useVoiceAcoustics) and the framework-free Sense layer.
 *
 * The hook publishes a snapshot every time it emits the existing
 * "aura:perception" observability event (≥250ms cadence while frames flow).
 * VoiceSense reads this store — it never touches React, the mic, AudioContext,
 * worklets, or the Silero worker.
 *
 * Distinction enforced here and by VoiceSense:
 *   - fresh snapshot          → voice pipeline is perceiving
 *   - stale / never published → pipeline is NOT perceiving (absence, not "no speech")
 */
import type { ListeningState } from "@/hooks/useVoiceAcoustics";

export interface VoicePerceptionSnapshot {
  state: ListeningState;
  /** Wall-clock publish time (Date.now()) — clock-consistent with Sensor uploads/tick. */
  at: number;
}

/**
 * No snapshot this old can come from a live pipeline: frames publish every
 * ~250ms while the mic is open, the supervision tick runs at 1s.
 * 3000ms means the pipeline has not produced perception for 3 consecutive
 * seconds — treat it as unavailable, never as "no speech".
 */
export const VOICE_SNAPSHOT_STALE_MS = 3000;

let snapshot: VoicePerceptionSnapshot | null = null;

export function publishVoicePerception(state: ListeningState): void {
  snapshot = { state: { ...state }, at: Date.now() };
}

export function getVoicePerceptionSnapshot(): VoicePerceptionSnapshot | null {
  return snapshot;
}

export function isVoicePerceptionFresh(s: VoicePerceptionSnapshot): boolean {
  return Date.now() - s.at <= VOICE_SNAPSHOT_STALE_MS;
}

export interface UtterancePerception {
  averageRms: number;
  wpm: number;
  delivery: {
    hesitation: boolean;
    trailing: boolean;
    staccato: boolean;
    assertive: boolean;
  };
  language: string;
}

export interface UtterancePerceptionSnapshot {
  utterance: UtterancePerception;
  at: number;
}

let utteranceSnapshot: UtterancePerceptionSnapshot | null = null;

export function publishUtterancePerception(utterance: UtterancePerception): void {
  utteranceSnapshot = { utterance: { ...utterance }, at: Date.now() };
}

export function consumeUtterancePerceptionSnapshot(): UtterancePerceptionSnapshot | null {
  const snap = utteranceSnapshot;
  utteranceSnapshot = null;
  return snap;
}
