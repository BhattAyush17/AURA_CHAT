import type { BehavioralShift, BehavioralShiftType } from "./SocialDecision";
import { PersonModel } from "./PersonModel";

interface Window {
  avgWordCount: number;
  avgPlayfulness: number;
  avgEnergy: number;
  avgTension: number;
  sampleCount: number;
}

export class BehavioralShiftDetector {
  private baseline: Window | null = null;
  private readonly WINDOW_SIZE = 10;
  private readonly SHIFT_THRESHOLD = 0.45;
  private currentWindow: Window = { avgWordCount: 0, avgPlayfulness: 0, avgEnergy: 0, avgTension: 0, sampleCount: 0 };
  private previousShift: BehavioralShift | null = null;

  observe(
    text: string,
    wordCount: number,
    playfulness: number,
    energy: number,
    tension: number,
  ): BehavioralShift | null {
    // Update current window
    const cw = this.currentWindow;
    cw.sampleCount++;
    cw.avgWordCount += (wordCount - cw.avgWordCount) / cw.sampleCount;
    cw.avgPlayfulness += ((playfulness ?? 0.5) - cw.avgPlayfulness) / cw.sampleCount;
    cw.avgEnergy += ((energy ?? 0.5) - cw.avgEnergy) / cw.sampleCount;
    cw.avgTension += ((tension ?? 0.5) - cw.avgTension) / cw.sampleCount;

    // Build baseline once we have enough data
    if (this.baseline === null && cw.sampleCount >= 5) {
      this.baseline = { ...cw };
      return null;
    }

    // Need baseline to detect shifts
    if (this.baseline === null || cw.sampleCount < 5) return null;

    // Detect shifts
    const shifts: { type: BehavioralShiftType; confidence: number; prev: string; curr: string; desc: string }[] = [];

    // Energy shift (from baseline)
    const energyDelta = Math.abs(cw.avgEnergy - this.baseline.avgEnergy);
    if (energyDelta > this.SHIFT_THRESHOLD) {
      const dir = cw.avgEnergy > this.baseline.avgEnergy ? "more energetic" : "more withdrawn";
      shifts.push({
        type: "energy_change",
        confidence: Math.min(energyDelta, 0.95),
        prev: `avg energy ${this.baseline.avgEnergy.toFixed(2)}`,
        curr: `avg energy ${cw.avgEnergy.toFixed(2)}`,
        desc: `User is ${dir} than earlier in this conversation.`,
      });
    }

    // Playfulness shift
    const playDelta = Math.abs(cw.avgPlayfulness - this.baseline.avgPlayfulness);
    if (playDelta > this.SHIFT_THRESHOLD) {
      const dir = cw.avgPlayfulness > this.baseline.avgPlayfulness ? "more playful" : "more serious";
      shifts.push({
        type: "playfulness_change",
        confidence: Math.min(playDelta, 0.95),
        prev: `avg playfulness ${this.baseline.avgPlayfulness.toFixed(2)}`,
        curr: `avg playfulness ${cw.avgPlayfulness.toFixed(2)}`,
        desc: `User is ${dir} than earlier.`,
      });
    }

    // Decisiveness shift — check for decisiveness keywords
    const decisiveWords = ["definitely", "sure", "certain", "absolutely", "obviously"];
    const cautiousWords = ["maybe", "i don't know", "not sure", "perhaps", "possibly", "i guess"];
    const hasDecisive = decisiveWords.some((w) => text.toLowerCase().includes(w));
    const hasCautious = cautiousWords.some((w) => text.toLowerCase().includes(w));
    if (hasDecisive && this.baseline.avgTension > 0.5) {
      shifts.push({
        type: "decisiveness_change",
        confidence: 0.6,
        prev: "cautious pattern",
        curr: "decisive language",
        desc: "User sounds more decisive than usual.",
      });
    }
    if (hasCautious && this.baseline.avgTension < 0.3) {
      shifts.push({
        type: "decisiveness_change",
        confidence: 0.55,
        prev: "confident pattern",
        curr: "uncertain language",
        desc: "User sounds more hesitant than usual.",
      });
    }

    // Message length shift
    const wordRatio = this.baseline.avgWordCount > 0 ? cw.avgWordCount / this.baseline.avgWordCount : 1;
    if (wordRatio > 2.5) {
      shifts.push({
        type: "message_length_change",
        confidence: Math.min((wordRatio - 2) / 5, 0.85),
        prev: `~${Math.round(this.baseline.avgWordCount)} words avg`,
        curr: `~${Math.round(cw.avgWordCount)} words avg`,
        desc: "User is substantially more detailed than earlier in this conversation.",
      });
    } else if (wordRatio < 0.4 && this.baseline.avgWordCount > 10) {
      shifts.push({
        type: "message_length_change",
        confidence: Math.min((1 - wordRatio) / 0.8, 0.75),
        prev: `~${Math.round(this.baseline.avgWordCount)} words avg`,
        curr: `~${Math.round(cw.avgWordCount)} words avg`,
        desc: "User is substantially briefer than earlier.",
      });
    }

    if (shifts.length === 0) {
      this.previousShift = null;
      return null;
    }

    // Return highest confidence shift
    const top = shifts.reduce((a, b) => (a.confidence > b.confidence ? a : b));
    const shift: BehavioralShift = {
      type: top.type,
      confidence: Math.round(top.confidence * 100) / 100,
      previous_behavior: top.prev,
      current_behavior: top.curr,
      description: top.desc,
    };

    // Don't repeat the same type in a row
    if (this.previousShift && this.previousShift.type === shift.type && this.previousShift.confidence > 0.6) {
      return null;
    }

    this.previousShift = shift;
    return shift;
  }

  reset(): void {
    this.baseline = null;
    this.currentWindow = { avgWordCount: 0, avgPlayfulness: 0, avgEnergy: 0, avgTension: 0, sampleCount: 0 };
    this.previousShift = null;
  }
}
