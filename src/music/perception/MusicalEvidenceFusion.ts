import { MusicPerceptionSignal, MusicalEvidence, MusicalMoment } from "../types";

export class MusicalEvidenceFusion {
  private recentSignals: MusicPerceptionSignal[] = [];
  private generatedMoments: MusicalMoment[] = [];

  // Temporal window in ms for grouping signals into a cluster
  private readonly WINDOW_MS = 1500;
  private readonly MOMENT_COOLDOWN_MS = 3000;

  public processSignals(
    newSignals: MusicPerceptionSignal[],
    trackId: string,
    sessionId: string,
    currentSection?: string,
  ): MusicalMoment[] {
    if (newSignals.length > 0) {
      this.recentSignals.push(...newSignals);
    }

    // 1. Prune old signals (keep last 5 seconds to ensure we capture late-arriving signals for grouping)
    const now = Date.now();
    this.recentSignals = this.recentSignals.filter((s) => now - s.timestampMs < 5000);

    // 2. Find if we have a cluster ready to fuse.
    // A cluster is triggered by a significant event: e.g. section change, transition, energy_change, silence
    const triggers = this.recentSignals.filter(
      (s) =>
        s.type === "section" ||
        s.type === "transition" ||
        s.type === "energy_change" ||
        s.type === "silence",
    );

    if (triggers.length === 0) return [...this.generatedMoments];

    // Use the most recent trigger
    const latestTrigger = triggers[triggers.length - 1];

    // 3. Check if we just generated a moment recently to prevent event spam
    const lastMoment = this.generatedMoments[this.generatedMoments.length - 1];
    if (lastMoment && latestTrigger.timestampMs - lastMoment.startMs < this.MOMENT_COOLDOWN_MS) {
      // Too soon. Skip forming a new moment to prevent spam.
      // (Future improvement: update the existing moment with stronger evidence)
      return [...this.generatedMoments];
    }

    // 4. Group all signals within WINDOW_MS of this trigger
    const cluster = this.recentSignals.filter(
      (s) => Math.abs(s.timestampMs - latestTrigger.timestampMs) <= this.WINDOW_MS,
    );

    // 5. Convert signals to MusicalEvidence
    const evidenceList: MusicalEvidence[] = cluster
      .map((s) => this.signalToEvidence(s))
      .filter(Boolean) as MusicalEvidence[];

    // 6. Deduplicate evidence (e.g. don't have multiple energy_rise in same cluster)
    const uniqueEvidence = this.deduplicateEvidence(evidenceList);

    // 7. Calculate Salience and Determine Transition Type
    const { salience, transition, finalSection } = this.evaluateCluster(
      uniqueEvidence,
      currentSection,
    );

    // 8. Construct MusicalMoment
    const sources = Array.from(new Set(uniqueEvidence.map((e) => e.source)));

    const moment: MusicalMoment = {
      trackId,
      sessionId,
      startMs: latestTrigger.timestampMs,
      section: finalSection,
      trigger: "acoustic_event",
      transition,
      salience,
      evidence: uniqueEvidence,
      sources,
      confidence: this.calculateMomentConfidence(uniqueEvidence),
      observedAt: now,
    };

    // Adjust trigger type if we have a structural boundary
    if (uniqueEvidence.some((e) => e.type === "structural_boundary")) {
      moment.trigger = "section_change";
    }

    this.generatedMoments.push(moment);

    // Keep only last 5 moments
    if (this.generatedMoments.length > 5) {
      this.generatedMoments.shift();
    }

    return [...this.generatedMoments];
  }

  public getRecentMoments(): MusicalMoment[] {
    return [...this.generatedMoments];
  }

  public clear() {
    this.recentSignals = [];
    this.generatedMoments = [];
  }

  private signalToEvidence(signal: MusicPerceptionSignal): MusicalEvidence | null {
    let type: MusicalEvidence["type"];

    if (signal.type === "section") {
      type = "structural_boundary";
    } else if (signal.type === "transition" || signal.type === "energy_change") {
      const energyRatio = signal.metadata?.energyRatio as number | undefined;
      const evidenceArr = signal.metadata?.evidence as string[] | undefined;

      if (energyRatio && energyRatio > 1.2) {
        type = "energy_rise";
      } else if (energyRatio && energyRatio < 0.8) {
        type = "energy_drop";
      } else if (evidenceArr && evidenceArr.includes("spectral_shift")) {
        type = "instrumentation_change";
      } else {
        type = "acoustic_transition";
      }
    } else if (signal.type === "silence") {
      type = "silence";
    } else if (signal.type === "onset") {
      type = "onset_cluster";
    } else {
      return null;
    }

    return {
      type,
      timestampMs: signal.timestampMs,
      confidence: signal.confidence,
      source: signal.source,
      metadata: signal.metadata,
    };
  }

  private deduplicateEvidence(evidence: MusicalEvidence[]): MusicalEvidence[] {
    const seen = new Set<string>();
    return evidence.filter((e) => {
      if (seen.has(e.type)) return false;
      seen.add(e.type);
      return true;
    });
  }

  private evaluateCluster(
    evidence: MusicalEvidence[],
    currentSection?: string,
  ): { salience: number; transition: string; finalSection?: string } {
    let salience = 0;
    let transition = "unknown_transition";
    let finalSection = "Unknown";

    let hasStructural = false;
    let hasEnergyRise = false;
    let hasSilence = false;
    let hasOnset = false;
    let hasSpectral = false;

    for (const e of evidence) {
      if (e.type === "structural_boundary") {
        salience += 0.5;
        hasStructural = true;
        if (e.metadata?.section) finalSection = e.metadata.section as string;
      }
      if (e.type === "energy_rise") {
        salience += 0.3;
        hasEnergyRise = true;
      }
      if (e.type === "energy_drop") {
        salience += 0.2;
      }
      if (e.type === "instrumentation_change" || e.type === "acoustic_transition") {
        salience += 0.3;
        hasSpectral = true;
      }
      if (e.type === "silence") {
        salience += 0.2;
        hasSilence = true;
      }
      if (e.type === "onset_cluster") {
        salience += 0.1;
        hasOnset = true;
      }
    }

    // Cap salience
    salience = Math.min(1.0, salience);

    // Transition classification
    if (hasSilence && hasOnset && hasEnergyRise) {
      transition = "silence_break";
    } else if (hasSpectral && !hasStructural) {
      transition = "instrumentation_change";
    } else if (hasEnergyRise) {
      transition = "energy_rise";
    } else if (evidence.some((e) => e.type === "energy_drop")) {
      transition = "energy_drop";
    }

    // Hierarchy Enforcement
    // 1. Explicit metadata/chapters (structural_boundary)
    if (hasStructural) {
      // finalSection already set from metadata
    } else {
      // Without structural evidence, we cannot claim a new section name.
      // We fall back to the previously known section, or 'Unknown'
      finalSection = currentSection || "Unknown";
    }

    return { salience, transition, finalSection };
  }

  private calculateMomentConfidence(evidence: MusicalEvidence[]): number {
    const confidences = evidence.map((e) => e.confidence);
    if (confidences.length === 0) return 0.5;
    return Math.max(...confidences);
  }
}
