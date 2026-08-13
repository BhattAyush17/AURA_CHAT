import type { SenseEvidenceV1 } from "@/sense/SenseManager/types";
import {
  createInitialHumanState,
  type HumanState,
  type HumanStateHypothesis,
  type AffectiveState,
  type ConversationalState,
} from "./HumanStateTypes";

/**
 * AURA Phase F - Human State Model
 *
 * Computes human state hypotheses from fused SenseEvidence.
 * This model preserves contradictions, handles temporal decay, and never
 * treats state estimates as unquestionable ground truths.
 */
export class HumanStateModel {
  private currentState: HumanState = createInitialHumanState();

  // Controls how fast a state decays toward neutral (0) in milliseconds.
  private readonly DECAY_HALF_LIFE_MS = 60000;

  constructor() {}

  /**
   * Updates the HumanState based on new evidence.
   */
  public processEvidence(
    evidenceList: SenseEvidenceV1[],
    transcriptContext?: {
      currentTurnText?: string;
      isTurnComplete?: boolean;
      sentiment?: number; // -1 to 1 (optional, if provided by cognition)
    },
  ): HumanState {
    const now = Date.now();
    this.applyDecay(now);

    const newHypotheses: Map<string, HumanStateHypothesis> = new Map();
    // Retain existing hypotheses (they have already been decayed)
    for (const h of this.currentState.affective.hypotheses) {
      newHypotheses.set(h.type, { ...h });
    }

    let valenceEstimate = this.currentState.affective.valence.estimate;
    let valenceConfidence = this.currentState.affective.valence.confidence;
    let arousalEstimate = this.currentState.affective.arousal.estimate;
    let arousalConfidence = this.currentState.affective.arousal.confidence;
    let tensionEstimate = this.currentState.affective.tension.estimate;
    let tensionConfidence = this.currentState.affective.tension.confidence;

    // Cross-modal evidence aggregation
    let hasVoiceActivity = false;
    let voiceIntensityIncreasing = false;
    let voiceIntensityDecreasing = false;

    // 1. Process Sense Evidence (e.g. Voice)
    for (const evidence of evidenceList) {
      if (evidence.source === "voice") {
        hasVoiceActivity = (evidence.payload.speechProbability || 0) > 0.3;

        // Analyze temporal trajectory if available
        if (evidence.temporal) {
          if (evidence.temporal.features.includes("increasing")) {
            voiceIntensityIncreasing = true;
          } else if (evidence.temporal.features.includes("decreasing")) {
            voiceIntensityDecreasing = true;
          }
        }

        // Utterance-final evidence mapping
        if (evidence.payload.utterance) {
          const u = evidence.payload.utterance;

          if (u.wpm > 160) {
            this.addHypothesis(newHypotheses, {
              type: "possible elevated conversational activation",
              confidence: 0.6,
              supportingEvidence: [`fast speech rate (${Math.round(u.wpm)} wpm)`],
              supportingReferences: [
                { source: "voice", feature: "utterance.wpm", contribution: "supporting" },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.min(1.0, arousalEstimate + 0.2);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);
          } else if (u.wpm < 100 && u.wpm > 0) {
            this.addHypothesis(newHypotheses, {
              type: "possible reduced conversational activation",
              confidence: 0.5,
              supportingEvidence: [`slow speech rate (${Math.round(u.wpm)} wpm)`],
              supportingReferences: [
                { source: "voice", feature: "utterance.wpm", contribution: "supporting" },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.max(-1.0, arousalEstimate - 0.2);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);
          }

          if (u.averageRms > 0.15) {
            this.addHypothesis(newHypotheses, {
              type: "possible vocal activation",
              confidence: 0.7,
              supportingEvidence: ["elevated utterance RMS amplitude"],
              supportingReferences: [
                { source: "voice", feature: "utterance.averageRms", contribution: "supporting" },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.min(1.0, arousalEstimate + 0.25);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.15);
          }

          if (u.delivery?.hesitation) {
            this.addHypothesis(newHypotheses, {
              type: "possible uncertainty",
              confidence: 0.6,
              supportingEvidence: ["hesitant delivery markers"],
              supportingReferences: [
                {
                  source: "voice",
                  feature: "utterance.delivery.hesitation",
                  contribution: "supporting",
                },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            tensionEstimate = Math.min(1.0, tensionEstimate + 0.2);
            tensionConfidence = Math.min(1.0, tensionConfidence + 0.1);
          }

          if (u.delivery?.trailing) {
            this.addHypothesis(newHypotheses, {
              type: "possible reduced completion confidence",
              confidence: 0.6,
              supportingEvidence: ["trailing delivery pattern"],
              supportingReferences: [
                {
                  source: "voice",
                  feature: "utterance.delivery.trailing",
                  contribution: "supporting",
                },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
          }

          if (u.delivery?.staccato) {
            this.addHypothesis(newHypotheses, {
              type: "possible increased activation",
              confidence: 0.6,
              supportingEvidence: ["staccato delivery pattern"],
              supportingReferences: [
                {
                  source: "voice",
                  feature: "utterance.delivery.staccato",
                  contribution: "supporting",
                },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.min(1.0, arousalEstimate + 0.15);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);
          }

          if (u.delivery?.assertive) {
            this.addHypothesis(newHypotheses, {
              type: "possible increased interaction intensity",
              confidence: 0.7,
              supportingEvidence: ["assertive delivery markers"],
              supportingReferences: [
                {
                  source: "voice",
                  feature: "utterance.delivery.assertive",
                  contribution: "supporting",
                },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.min(1.0, arousalEstimate + 0.2);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);
          }

          if (u.language && u.language !== "English") {
            this.addHypothesis(newHypotheses, {
              type: `contextual linguistic signal (${u.language})`,
              confidence: 0.8,
              supportingEvidence: [`language detected as ${u.language}`],
              supportingReferences: [
                { source: "voice", feature: "utterance.language", contribution: "supporting" },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
          }
        }
      }
    }

    // 2. Compute Hypotheses based on evidence
    if (voiceIntensityIncreasing) {
      // Increase arousal hypothesis
      arousalEstimate = Math.min(1.0, arousalEstimate + 0.3);
      arousalConfidence = Math.min(1.0, arousalConfidence + 0.2);

      this.addHypothesis(newHypotheses, {
        type: "possible elevated arousal",
        confidence: 0.6, // Moderate initial confidence
        supportingEvidence: ["increased vocal intensity or speech probability"],
        supportingReferences: [
          { source: "voice", feature: "temporal.increasing", contribution: "supporting" },
        ],
        contradictingEvidence: [],
        contradictingReferences: [],
      });
    }

    if (voiceIntensityDecreasing) {
      arousalEstimate = Math.max(-1.0, arousalEstimate - 0.2);
      arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);

      this.addHypothesis(newHypotheses, {
        type: "possible reduced arousal",
        confidence: 0.5,
        supportingEvidence: ["decreasing vocal intensity or speech probability"],
        supportingReferences: [
          { source: "voice", feature: "temporal.decreasing", contribution: "supporting" },
        ],
        contradictingEvidence: [],
        contradictingReferences: [],
      });
    }

    // 3. Cross-modal contradictions (Linguistic vs Voice)
    if (transcriptContext?.sentiment !== undefined) {
      const isPositive = transcriptContext.sentiment > 0.3;
      const isNegative = transcriptContext.sentiment < -0.3;
      const isNeutral = !isPositive && !isNegative;

      if (isPositive) {
        valenceEstimate = Math.min(1.0, valenceEstimate + 0.2);
        valenceConfidence = Math.min(1.0, valenceConfidence + 0.2);
      } else if (isNegative) {
        valenceEstimate = Math.max(-1.0, valenceEstimate - 0.2);
        valenceConfidence = Math.min(1.0, valenceConfidence + 0.2);
      }

      // Detect contradiction: Voice increasing (high arousal) + Neutral/Negative text
      if (voiceIntensityIncreasing && isNeutral) {
        this.addHypothesis(newHypotheses, {
          type: "uncertain / possible tension",
          confidence: 0.5,
          supportingEvidence: ["increased vocal intensity"],
          supportingReferences: [
            { source: "voice", feature: "temporal.increasing", contribution: "supporting" },
          ],
          contradictingEvidence: ["neutral linguistic content"],
          contradictingReferences: [
            { source: "language", feature: "sentiment", contribution: "contradicting" },
          ],
        });

        tensionEstimate = Math.min(1.0, tensionEstimate + 0.3);
        tensionConfidence = Math.min(1.0, tensionConfidence + 0.2);
      }
    }

    // 4. Update the actual state object safely
    this.currentState = {
      ...this.currentState,
      lastUpdated: now,
      affective: {
        ...this.currentState.affective,
        arousal: { estimate: arousalEstimate, confidence: arousalConfidence },
        valence: { estimate: valenceEstimate, confidence: valenceConfidence },
        tension: { estimate: tensionEstimate, confidence: tensionConfidence },
        hypotheses: Array.from(newHypotheses.values()),
      },
      conversational: {
        ...this.currentState.conversational,
        completion: transcriptContext?.isTurnComplete ? 1 : 0,
      },
    };

    return this.currentState;
  }

  /**
   * Helper to merge/add hypotheses
   */
  private addHypothesis(map: Map<string, HumanStateHypothesis>, hyp: HumanStateHypothesis) {
    if (map.has(hyp.type)) {
      const existing = map.get(hyp.type)!;
      // Increase confidence due to temporal persistence
      existing.confidence = Math.min(1.0, existing.confidence + 0.15);
      existing.supportingEvidence = [
        ...new Set([...existing.supportingEvidence, ...hyp.supportingEvidence]),
      ];
      existing.contradictingEvidence = [
        ...new Set([...existing.contradictingEvidence, ...hyp.contradictingEvidence]),
      ];

      const combinedSupp = [
        ...(existing.supportingReferences || []),
        ...(hyp.supportingReferences || []),
      ];
      existing.supportingReferences = combinedSupp.filter(
        (v, i, a) => a.findIndex((t) => t.source === v.source && t.feature === v.feature) === i,
      );

      const combinedContr = [
        ...(existing.contradictingReferences || []),
        ...(hyp.contradictingReferences || []),
      ];
      existing.contradictingReferences = combinedContr.filter(
        (v, i, a) => a.findIndex((t) => t.source === v.source && t.feature === v.feature) === i,
      );
    } else {
      map.set(hyp.type, hyp);
    }
  }

  /**
   * Exponential decay function to return states toward neutral and confidence toward 0
   */
  private applyDecay(now: number) {
    const elapsed = now - this.currentState.lastUpdated;
    if (elapsed <= 0) return;

    const decayFactor = Math.pow(0.5, elapsed / this.DECAY_HALF_LIFE_MS);

    const applyToDimension = (dim: { estimate: number; confidence: number }) => {
      dim.estimate *= decayFactor;
      dim.confidence *= decayFactor;
    };

    applyToDimension(this.currentState.affective.valence);
    applyToDimension(this.currentState.affective.arousal);
    applyToDimension(this.currentState.affective.tension);
    applyToDimension(this.currentState.affective.engagement);

    // Decay hypotheses confidences
    this.currentState.affective.hypotheses.forEach((hyp) => {
      hyp.confidence *= decayFactor;
    });
    // Filter out decayed hypotheses
    this.currentState.affective.hypotheses = this.currentState.affective.hypotheses.filter(
      (h) => h.confidence > 0.1,
    );
  }

  public getState(): HumanState {
    this.applyDecay(Date.now());
    return this.currentState;
  }

  public reset() {
    this.currentState = createInitialHumanState();
  }
}
