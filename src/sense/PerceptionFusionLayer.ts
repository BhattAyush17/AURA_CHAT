import {
  EvidenceProvenance,
  RawSenseObservation,
  SenseEvidenceV1,
  SenseTemporalContext,
  TemporalFeature,
} from "./SenseManager/types";

const MAX_WINDOW = 10;
const BASELINE_MIN_OBSERVATIONS = 5;
const BASELINE_MAX_WINDOW = 50;

class FusionSourceState {
  recent: { timestamp: number; confidence: number }[] = [];
  baselineHistory: number[] = [];

  ingest(timestamp: number, confidence: number) {
    this.recent.push({ timestamp, confidence });
    if (this.recent.length > MAX_WINDOW) {
      this.recent.shift();
    }

    this.baselineHistory.push(confidence);
    if (this.baselineHistory.length > BASELINE_MAX_WINDOW) {
      this.baselineHistory.shift();
    }
  }

  getBaseline() {
    if (this.baselineHistory.length < BASELINE_MIN_OBSERVATIONS) {
      return undefined;
    }
    const sorted = [...this.baselineHistory].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return {
      confidence: median,
      observations: this.baselineHistory.length,
    };
  }

  computeFeatures(baseline?: { confidence: number }): TemporalFeature[] {
    if (this.recent.length < 2) return [];
    const features = new Set<TemporalFeature>();

    const current = this.recent[this.recent.length - 1].confidence;
    const prev = this.recent[this.recent.length - 2].confidence;
    const diff = current - prev;

    if (Math.abs(diff) <= 0.05) features.add("stable");
    else if (diff > 0.05) features.add("increasing");
    else if (diff < -0.05) features.add("decreasing");

    if (Math.abs(diff) >= 0.3) {
      features.add("sudden_change");
    }

    if (this.recent.length >= 3) {
      const prev2 = this.recent[this.recent.length - 3].confidence;
      if (Math.abs(prev - prev2) >= 0.2 && Math.abs(current - prev) <= 0.05) {
        features.add("recently_changed");
      }
    }

    if (this.recent.length >= 3) {
      const isPersistent = this.recent.every((r) => r.confidence >= 0.6);
      if (isPersistent) features.add("persistent");
    }

    if (baseline) {
      if (
        Math.abs(prev - baseline.confidence) >= 0.2 &&
        Math.abs(current - baseline.confidence) <= 0.05
      ) {
        features.add("returned_to_baseline");
      }
    }

    return Array.from(features);
  }
}

/**
 * Perception Fusion Layer
 *
 * Canonical integration point for all Senses (Music, Vision, Voice, Environment, etc.)
 * Normalizes evidence, deduplicates, assigns timestamps and aggregates confidence
 * before routing exactly one standardized Evidence Payload into the ATF.
 */
export class PerceptionFusionLayer {
  private observationQueue: RawSenseObservation[] = [];
  private sourceStates = new Map<string, FusionSourceState>();

  // Called by SenseManager when Senses emit context
  ingest(observation: RawSenseObservation) {
    this.observationQueue.push(observation);
  }

  // Flushes buffer into ATF (Adaptive Thought Framework)
  // Called precisely at the start of the inference tick to ensure temporal synchronization
  flushToATF(): SenseEvidenceV1[] {
    if (this.observationQueue.length === 0) return [];

    const fused = new Map<string, SenseEvidenceV1>();
    const flushTimestamp = Date.now();

    this.observationQueue.sort((a, b) => a.timestamp - b.timestamp);

    for (const obs of this.observationQueue) {
      const source = obs.source.toLowerCase();

      let state = this.sourceStates.get(source);
      if (!state) {
        state = new FusionSourceState();
        this.sourceStates.set(source, state);
      }

      let finalConfidence = obs.estimatedConfidence;
      if (finalConfidence < 0.1) finalConfidence = 0.1;
      if (finalConfidence > 1.0) finalConfidence = 1.0;

      state.ingest(obs.timestamp, finalConfidence);

      const baseline = state.getBaseline();
      const features = state.computeFeatures(baseline);
      const recentCopy = state.recent.map((r) => ({ ...r }));

      let deviation: number | undefined = undefined;
      if (baseline) {
        deviation = finalConfidence - baseline.confidence;
      }

      const temporal: SenseTemporalContext = {
        windowSize: state.recent.length,
        features,
        recent: recentCopy,
        baseline,
        deviation,
      };

      const evidence: SenseEvidenceV1 = {
        version: 1,
        source: source,
        timestamp: flushTimestamp, // Override with fusion timestamp to sync cycle
        confidence: finalConfidence,
        payload: obs.payload,
        temporal,
      };

      if (obs.provenance) {
        evidence.provenance = { ...obs.provenance };
      } else {
        evidence.provenance = {};
      }

      // Add derived temporal provenance
      features.forEach((f) => {
        evidence.provenance![`temporal.${f}`] = {
          feature: `temporal.${f}`,
          observedAt: flushTimestamp,
          kind: "derived",
          scope: "streaming",
        };
      });

      if (baseline) {
        evidence.provenance!["temporal.baseline"] = {
          feature: "temporal.baseline",
          observedAt: flushTimestamp,
          kind: "derived",
          scope: "historical",
        };
      }

      if (deviation !== undefined) {
        evidence.provenance!["temporal.deviation"] = {
          feature: "temporal.deviation",
          observedAt: flushTimestamp,
          kind: "derived",
          scope: "streaming",
        };
      }

      fused.set(source, evidence);
    }

    this.observationQueue = []; // Clear queue after synchronization
    return Array.from(fused.values());
  }
}

export const perceptionFusionLayer = new PerceptionFusionLayer();
