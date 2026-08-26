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

  // Bounded per-session baseline for utterance-level features.
  // Never persisted across sessions; used only to interpret current observations
  // relative to an individual's own typical range (baseline deviation, not raw magnitude).
  private readonly BASELINE_MIN_OBSERVATIONS = 3;
  private readonly BASELINE_MAX_HISTORY = 30;
  private readonly WPM_ACTIVATION_REL_DEV = 0.25;
  private readonly RMS_ACTIVATION_REL_DEV = 0.5;
  private wpmHistory: number[] = [];
  private rmsHistory: number[] = [];
  private wpmBaseline: number | undefined;
  private rmsBaseline: number | undefined;

  constructor() {}

  private computeMedian(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  private trackUtteranceBaselines(wpm: number, rms: number) {
    if (wpm > 0 && wpm < 1000) {
      this.wpmHistory.push(wpm);
      if (this.wpmHistory.length > this.BASELINE_MAX_HISTORY) this.wpmHistory.shift();
      if (this.wpmHistory.length >= this.BASELINE_MIN_OBSERVATIONS) {
        this.wpmBaseline = this.computeMedian(this.wpmHistory);
      }
    }
    if (rms >= 0 && Number.isFinite(rms)) {
      this.rmsHistory.push(rms);
      if (this.rmsHistory.length > this.BASELINE_MAX_HISTORY) this.rmsHistory.shift();
      if (this.rmsHistory.length >= this.BASELINE_MIN_OBSERVATIONS) {
        this.rmsBaseline = this.computeMedian(this.rmsHistory);
      }
    }
  }

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
    const updatedTypes = new Set<string>();

    // Retain existing hypotheses (they have already been decayed)
    for (const h of this.currentState.affective.hypotheses) {
      newHypotheses.set(h.type, { ...h });
    }

    let valenceEstimate = Number.isFinite(this.currentState.affective.valence.estimate)
      ? this.currentState.affective.valence.estimate
      : 0;
    let valenceConfidence = Number.isFinite(this.currentState.affective.valence.confidence)
      ? this.currentState.affective.valence.confidence
      : 0;
    let arousalEstimate = Number.isFinite(this.currentState.affective.arousal.estimate)
      ? this.currentState.affective.arousal.estimate
      : 0;
    let arousalConfidence = Number.isFinite(this.currentState.affective.arousal.confidence)
      ? this.currentState.affective.arousal.confidence
      : 0;
    let tensionEstimate = Number.isFinite(this.currentState.affective.tension.estimate)
      ? this.currentState.affective.tension.estimate
      : 0;
    let tensionConfidence = Number.isFinite(this.currentState.affective.tension.confidence)
      ? this.currentState.affective.tension.confidence
      : 0;

    // Cross-modal evidence aggregation
    let hasVoiceActivity = false;
    let voiceIntensityIncreasing = false;
    let voiceIntensityDecreasing = false;
    let voiceHasActivationSignal = false;

    // 1. Process Sense Evidence (e.g. Voice)
    for (const evidence of evidenceList) {
      if (evidence.source === "voice") {
        const speechProb = Number.isFinite(evidence.confidence) ? evidence.confidence : 0;
        hasVoiceActivity = speechProb > 0.3;

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
          const wpm = Number.isFinite(u.wpm) ? u.wpm : 0;
          const rms = Number.isFinite(u.averageRms) ? u.averageRms : 0;

          // Warm the bounded per-session baseline before interpreting the signal.
          this.trackUtteranceBaselines(wpm, rms);

          // Elevated/reduced speech rate: prefer relative deviation from this
          // speaker's own baseline; fall back to absolute thresholds only while
          // the baseline is still warming (low confidence — never false certainty).
          let elevatedWpm = false;
          let reducedWpm = false;
          if (this.wpmBaseline !== undefined) {
            const relDev = wpm / Math.max(this.wpmBaseline, 1) - 1;
            if (relDev >= this.WPM_ACTIVATION_REL_DEV) elevatedWpm = true;
            else if (relDev <= -this.WPM_ACTIVATION_REL_DEV) reducedWpm = true;
          } else {
            if (wpm > 160) elevatedWpm = true;
            else if (wpm < 100 && wpm > 0) reducedWpm = true;
          }

          if (elevatedWpm) {
            voiceHasActivationSignal = true;
            const type = "possible elevated conversational activation";
            updatedTypes.add(type);
            // A baseline-established reading replaces any provisional (baseline-less) claim.
            if (
              this.wpmBaseline !== undefined &&
              newHypotheses
                .get(type)
                ?.supportingEvidence.some((s) => s.includes("no established baseline"))
            ) {
              newHypotheses.delete(type);
            }
            this.addHypothesis(newHypotheses, {
              type,
              confidence: this.wpmBaseline !== undefined ? 0.6 : 0.35,
              supportingEvidence: [
                this.wpmBaseline !== undefined
                  ? `fast speech rate (${Math.round(wpm)} wpm vs baseline ${Math.round(this.wpmBaseline)})`
                  : `fast speech rate (${Math.round(wpm)} wpm, no established baseline)`,
              ],
              supportingReferences: [
                { source: "voice", feature: "utterance.wpm", contribution: "supporting" },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.min(1.0, arousalEstimate + 0.2);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);
          } else if (reducedWpm) {
            const type = "possible reduced conversational activation";
            updatedTypes.add(type);
            if (
              this.wpmBaseline !== undefined &&
              newHypotheses
                .get(type)
                ?.supportingEvidence.some((s) => s.includes("no established baseline"))
            ) {
              newHypotheses.delete(type);
            }
            this.addHypothesis(newHypotheses, {
              type,
              confidence: this.wpmBaseline !== undefined ? 0.5 : 0.3,
              supportingEvidence: [
                this.wpmBaseline !== undefined
                  ? `slow speech rate (${Math.round(wpm)} wpm vs baseline ${Math.round(this.wpmBaseline)})`
                  : `slow speech rate (${Math.round(wpm)} wpm, no established baseline)`,
              ],
              supportingReferences: [
                { source: "voice", feature: "utterance.wpm", contribution: "supporting" },
              ],
              contradictingEvidence: [],
              contradictingReferences: [],
            });
            arousalEstimate = Math.max(-1.0, arousalEstimate - 0.2);
            arousalConfidence = Math.min(1.0, arousalConfidence + 0.1);
          }

          let elevatedRms = false;
          if (rms > 0.12) {
            if (this.rmsBaseline !== undefined) {
              if (rms / Math.max(this.rmsBaseline, 1e-6) - 1 >= this.RMS_ACTIVATION_REL_DEV) {
                elevatedRms = true;
              }
            } else if (rms > 0.15) {
              elevatedRms = true;
            }
          }

          if (elevatedRms) {
            voiceHasActivationSignal = true;
            const type = "possible vocal activation";
            updatedTypes.add(type);
            if (
              this.rmsBaseline !== undefined &&
              newHypotheses
                .get(type)
                ?.supportingEvidence.some((s) => s.includes("no established baseline"))
            ) {
              newHypotheses.delete(type);
            }
            this.addHypothesis(newHypotheses, {
              type,
              confidence: this.rmsBaseline !== undefined ? 0.7 : 0.35,
              supportingEvidence: [
                this.rmsBaseline !== undefined
                  ? `elevated utterance RMS amplitude (${rms.toFixed(3)} vs baseline ${this.rmsBaseline.toFixed(3)})`
                  : "elevated utterance RMS amplitude (no established baseline)",
              ],
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
            const type = "possible uncertainty";
            updatedTypes.add(type);
            this.addHypothesis(newHypotheses, {
              type,
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
            const type = "possible reduced completion confidence";
            updatedTypes.add(type);
            this.addHypothesis(newHypotheses, {
              type,
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
            voiceHasActivationSignal = true;
            const type = "possible increased activation";
            updatedTypes.add(type);
            this.addHypothesis(newHypotheses, {
              type,
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
            voiceHasActivationSignal = true;
            const type = "possible increased interaction intensity";
            updatedTypes.add(type);
            this.addHypothesis(newHypotheses, {
              type,
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
            const type = `contextual linguistic signal (${u.language})`;
            updatedTypes.add(type);
            this.addHypothesis(newHypotheses, {
              type,
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
      voiceHasActivationSignal = true;
      arousalEstimate = Math.min(1.0, arousalEstimate + 0.3);
      arousalConfidence = Math.min(1.0, arousalConfidence + 0.2);

      const type = "possible elevated arousal";
      updatedTypes.add(type);
      this.addHypothesis(newHypotheses, {
        type,
        confidence: 0.6,
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

      const type = "possible reduced arousal";
      updatedTypes.add(type);
      this.addHypothesis(newHypotheses, {
        type,
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
    if (
      transcriptContext?.sentiment !== undefined &&
      Number.isFinite(transcriptContext.sentiment)
    ) {
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

      if ((voiceIntensityIncreasing || voiceHasActivationSignal) && isNeutral) {
        const type = "uncertain / possible tension";
        updatedTypes.add(type);
        this.addHypothesis(newHypotheses, {
          type,
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

        // Explicit contradiction: the neutral linguistic channel opposes the voice
        // activation claims, so the confidence of those contradicted hypotheses is
        // reduced relative to a fully-supportive reading.
        const contradictedTypes = new Set([
          "possible elevated conversational activation",
          "possible vocal activation",
          "possible elevated arousal",
          "possible increased activation",
          "possible increased interaction intensity",
        ]);
        for (const [hypType, hyp] of newHypotheses) {
          if (hypType !== type && contradictedTypes.has(hypType)) {
            hyp.confidence *= 0.6;
          }
        }
      }
    }

    // Once a baseline exists, provisional claims made without one are retracted
    // unless they are re-supported by a baseline-aware observation this turn.
    if (this.wpmBaseline !== undefined || this.rmsBaseline !== undefined) {
      for (const [type, hyp] of Array.from(newHypotheses)) {
        if (
          !updatedTypes.has(type) &&
          hyp.supportingEvidence.some((s) => s.includes("no established baseline"))
        ) {
          newHypotheses.delete(type);
        }
      }
    }

    // Attenuate hypotheses that received no supporting evidence in this turn
    for (const [type, hyp] of newHypotheses) {
      if (!updatedTypes.has(type)) {
        hyp.confidence *= 0.75;
      }
    }

    // If no voice activation signal occurred in this turn, decay arousal estimate back toward 0
    if (!voiceHasActivationSignal && !voiceIntensityIncreasing) {
      arousalEstimate *= 0.85;
      arousalConfidence *= 0.85;
    }

    // Filter out decayed/low-confidence hypotheses
    const activeHypotheses = Array.from(newHypotheses.values()).filter((h) => h.confidence > 0.1);

    // 4. Update the actual state object safely
    this.currentState = {
      ...this.currentState,
      lastUpdated: now,
      affective: {
        ...this.currentState.affective,
        arousal: { estimate: arousalEstimate, confidence: arousalConfidence },
        valence: { estimate: valenceEstimate, confidence: valenceConfidence },
        tension: { estimate: tensionEstimate, confidence: tensionConfidence },
        hypotheses: activeHypotheses,
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
