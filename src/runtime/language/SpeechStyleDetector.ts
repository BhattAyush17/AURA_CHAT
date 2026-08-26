import { TranscriptStyleClassifier, SpeechStyle } from "./TranscriptStyleClassifier";
import { LanguageTelemetry } from "./LanguageTelemetry";

export class SpeechStyleDetector {
  private classifier = new TranscriptStyleClassifier();
  private history: SpeechStyle[] = [];
  
  public detectStyle(transcript: string): SpeechStyle {
    const currentStyle = this.classifier.classify(transcript);
    this.history.push(currentStyle);
    if (this.history.length > 5) this.history.shift();
    
    // Smooth transitions using rolling window
    const primaryCounts: Record<string, number> = {};
    for (const s of this.history) {
      primaryCounts[s.primary] = (primaryCounts[s.primary] || 0) + 1;
    }
    
    // Calculate drift and stability
    const isStable = this.history.every(s => s.primary === currentStyle.primary);
    
    LanguageTelemetry.getInstance().log({
      primary: currentStyle.primary,
      secondary: currentStyle.secondary,
      ratio: currentStyle.ratio,
      script: currentStyle.script,
      style: currentStyle.style,
      drift: isStable ? "Low" : "High",
      stability: isStable ? "Stable" : "Shifting"
    });
    
    return currentStyle;
  }
}
