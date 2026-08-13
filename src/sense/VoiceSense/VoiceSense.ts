/**
 * AURA Sense System — VoiceSense (Phase B integration)
 *
 * A thin adapter that exposes the ALREADY-RUNNING voice/acoustic perception
 * pipeline (useVoiceAcoustics → ListeningState) under the canonical Sense
 * contract. VoiceSense owns NO microphone infrastructure — no AudioContext,
 * no worklet, no Silero worker, no analyser, no capture loop. It only reads
 * the published perception snapshots and turns them into evidence.
 *
 * Responsibility: "What acoustic/speech evidence is currently observable?"
 *
 * Unavailable ≠ no speech:
 *   - No snapshot / stale snapshot → pipeline not perceiving → collectContext
 *     returns null → NO evidence (absence stays absence).
 *   - Fresh snapshot with low speechProbability → a VALID observation that
 *     little/no speech is currently detected (low confidence per the fusion
 *     contract — cognition's Phase A threshold keeps it out of the prompt).
 */

import { BaseSense } from "../SenseManager/BaseSense";
import type { EvidenceProvenance, RawSenseObservation, SenseManifest } from "../SenseManager/types";
import {
  getVoicePerceptionSnapshot,
  isVoicePerceptionFresh,
  consumeUtterancePerceptionSnapshot,
} from "./voicePerceptionStore";

export class VoiceSense extends BaseSense {
  readonly manifest: SenseManifest = {
    id: "voice",
    version: "1.0.0",
    displayName: "Voice Perception",
    description: "Perceives acoustic and speech-activity evidence from the live voice pipeline.",
    icon: "🎙️",
    dependencies: [],
    capabilities: ["speech_activity", "acoustic_activity"],
    providerRequirements: [],
    requiredPermissions: ["microphone"],
  };

  async initialize(): Promise<void> {
    this.setStatus("connected");
    this._initialized = true;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async start(): Promise<void> {
    this.setStatus("active");
  }

  async stop(): Promise<void> {
    this.setStatus("connected");
  }

  async dispose(): Promise<void> {
    this.setStatus("disconnected");
  }

  async collectContext(): Promise<RawSenseObservation | null> {
    const snapshot = getVoicePerceptionSnapshot();
    if (!snapshot) return null; // pipeline never perceived — absence, not "no speech"
    if (!isVoicePerceptionFresh(snapshot)) return null; // pipeline stopped — unavailable

    const s = snapshot.state;
    const payload = {
      speechProbability: s.speechProbability,
      speechDetected: s.speechDetected,
      realSilenceMs: s.realSilence,
      vadConfidence: s.vadConfidence,
      noiseLevelDb: s.noiseLevel,
      detectionSource: s.detectionSource,
      dominantSpeechDetected: s.dominantSpeechDetected,
      processingEnabled: s.processingEnabled,
      observedAt: snapshot.at,
    };

    const provenance: Record<string, EvidenceProvenance> = {
      speechProbability: {
        feature: "speechProbability",
        observedAt: snapshot.at,
        kind: "raw",
        scope: "streaming",
      },
      speechDetected: {
        feature: "speechDetected",
        observedAt: snapshot.at,
        kind: "raw",
        scope: "streaming",
      },
      realSilenceMs: {
        feature: "realSilenceMs",
        observedAt: snapshot.at,
        kind: "raw",
        scope: "streaming",
      },
      vadConfidence: {
        feature: "vadConfidence",
        observedAt: snapshot.at,
        kind: "raw",
        scope: "streaming",
      },
      noiseLevelDb: {
        feature: "noiseLevelDb",
        observedAt: snapshot.at,
        kind: "raw",
        scope: "streaming",
      },
      detectionSource: {
        feature: "detectionSource",
        observedAt: snapshot.at,
        kind: "raw",
        scope: "streaming",
      },
    };

    const utterance = consumeUtterancePerceptionSnapshot();
    if (utterance) {
      (payload as any).utterance = utterance.utterance;
      const uAt = utterance.at;
      provenance["utterance.wpm"] = {
        feature: "utterance.wpm",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
      provenance["utterance.averageRms"] = {
        feature: "utterance.averageRms",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
      provenance["utterance.language"] = {
        feature: "utterance.language",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
      provenance["utterance.delivery.hesitation"] = {
        feature: "utterance.delivery.hesitation",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
      provenance["utterance.delivery.trailing"] = {
        feature: "utterance.delivery.trailing",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
      provenance["utterance.delivery.staccato"] = {
        feature: "utterance.delivery.staccato",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
      provenance["utterance.delivery.assertive"] = {
        feature: "utterance.delivery.assertive",
        observedAt: uAt,
        kind: "raw",
        scope: "utterance",
      };
    }

    this._health.lastObservation = Date.now();

    return {
      source: "voice",
      timestamp: Date.now(),
      // Primary perception signal: how much speech evidence exists (~0 idle,
      // →1 active speech). vadConfidence stays in the payload as an observable
      // field — it is high for confident silence too, so it must not weight evidence.
      estimatedConfidence: s.speechProbability,
      payload,
      provenance,
    };
  }
}
