import { VoiceLanguageObservation, ResolvedVoiceLanguage } from "./VoiceLanguageTypes";

export class VoiceLanguageResolver {
  private speechBuffer: string = "";
  private readonly MAX_BUFFER_LENGTH = 300;
  private readonly SINGLE_THRESHOLD = 0.85;
  private readonly MIXED_THRESHOLD = 0.15;

  public resolve(
    observation: VoiceLanguageObservation,
    preferredLanguage: string,
    currentState: ResolvedVoiceLanguage
  ): Omit<ResolvedVoiceLanguage, "responseLanguage"> {
    let detectedLanguage = currentState.detectedLanguage;
    let secondaryLanguage = currentState.secondaryLanguage;
    let dominantLanguage = currentState.dominantLanguage;
    let classification = currentState.classification;
    let confidence = currentState.confidence;
    let source = currentState.source;
    let stable = currentState.stable;

    // Priority 1: Provider explicitly told us the language
    if (observation.language && observation.source === "provider") {
      detectedLanguage = observation.language;
      secondaryLanguage = observation.secondaryLanguage || null;
      confidence = observation.confidence ?? 1.0;
      classification = secondaryLanguage ? "MIXED_LANGUAGE" : "SINGLE_LANGUAGE";
      dominantLanguage = detectedLanguage;
      source = "provider";
      stable = true; // Provider signals are usually considered stable
      this.speechBuffer = ""; // Reset heuristic buffer
    } 
    // Priority 2 & 3 & 4: Text heuristic fallback
    else if (observation.text) {
      this.speechBuffer += " " + observation.text.trim();
      if (this.speechBuffer.length > this.MAX_BUFFER_LENGTH) {
        this.speechBuffer = this.speechBuffer.substring(this.speechBuffer.length - this.MAX_BUFFER_LENGTH);
      }

      const heuristicResult = this.analyzeTextBuffer(preferredLanguage);
      if (heuristicResult.classification !== "UNCERTAIN") {
        detectedLanguage = heuristicResult.detectedLanguage;
        secondaryLanguage = heuristicResult.secondaryLanguage;
        dominantLanguage = heuristicResult.dominantLanguage;
        classification = heuristicResult.classification;
        confidence = heuristicResult.confidence;
        source = "resolver";
        stable = this.checkStability(currentState, detectedLanguage);
      } else {
        // Remain uncertain if not enough chars, but keep previous state
      }
    }

    return {
      preferredLanguage,
      detectedLanguage,
      secondaryLanguage,
      dominantLanguage,
      classification,
      confidence,
      source,
      stable,
      updatedAt: Date.now()
    };
  }

  private checkStability(currentState: ResolvedVoiceLanguage, newDetected: string | null): boolean {
    // If it matches the current stable state, it's stable.
    if (currentState.detectedLanguage === newDetected && currentState.stable) {
      return true;
    }
    // Simple temporal stability: we consider it stable immediately if confidence is high, 
    // or we could require multiple turns. For now, since we use a 300-character buffer, 
    // the buffer itself provides hysteresis. So if it shifts, the shift is stable based on the buffer.
    return true;
  }

  private analyzeTextBuffer(preferredLanguage: string) {
    const text = this.speechBuffer.trim();
    let latinCount = 0;
    let devanagariCount = 0;
    let totalSignificantChars = 0;

    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (text[i].match(/[\s\d.,!?]/)) continue;
      
      totalSignificantChars++;
      if (code >= 0x0900 && code <= 0x097F) {
        devanagariCount++;
      } else if ((code >= 0x0041 && code <= 0x005A) || (code >= 0x0061 && code <= 0x007A)) {
        latinCount++;
      }
    }

    if (totalSignificantChars < 4) {
      return { classification: "UNCERTAIN" as const, detectedLanguage: null, secondaryLanguage: null, dominantLanguage: null, confidence: null };
    }

    const devanagariRatio = devanagariCount / totalSignificantChars;
    const latinRatio = latinCount / totalSignificantChars;

    // Hinglish detection (Latin script but Hindi words)
    const hinglishWords = new Set([
      'hai', 'kya', 'haan', 'nahi', 'main', 'tum', 'aap', 'kaise', 'ho', 'mera', 'naam', 
      'bhai', 'koi', 'aur', 'hi', 'bhi', 'karo', 'kar', 'kaha', 'yaha', 'waha', 'mat', 
      'raha', 'rahi', 'rahe', 'tha', 'thi', 'the', 'hun', 'kese', 'apne', 'sab', 'kuch', 
      'sirf', 'toh', 'ab', 'jab', 'tab', 'kab', 'kyu', 'kyun', 'bol', 'bole', 'karna', 
      'hua', 'gaya', 'chalo', 'ya', 'woh', 'yeh', 'unko', 'inka', 'iski', 'uski', 'kisko', 
      'jiski', 'wale', 'wala', 'wali', 'karte', 'karti', 'mujhe', 'tujhe', 'hum'
    ]);
    
    let isHinglish = false;
    const words = text.toLowerCase().split(/[\s.,!?]+/);
    for (const word of words) {
       if (hinglishWords.has(word)) {
          isHinglish = true;
          break;
       }
    }

    let newDetected: string | null = null;
    let newSecondary: string | null = null;
    let newDominant: string | null = null;
    let newClass: "SINGLE_LANGUAGE" | "MIXED_LANGUAGE" | "UNCERTAIN" = "UNCERTAIN";
    let newConfidence = 1.0;

    if (devanagariRatio > this.SINGLE_THRESHOLD) {
      newClass = "SINGLE_LANGUAGE";
      newDetected = "Hindi";
      newConfidence = devanagariRatio;
    } else if (latinRatio > this.SINGLE_THRESHOLD) {
      newClass = "SINGLE_LANGUAGE";
      // We map Latin to English by default, unless preferred is another latin language.
      newDetected = (preferredLanguage.includes("Hindi") || preferredLanguage.includes("भारत")) ? "English" : preferredLanguage;
      newConfidence = latinRatio;
    } 
    
    if (devanagariRatio > this.MIXED_THRESHOLD && latinRatio > this.MIXED_THRESHOLD) {
      newClass = "MIXED_LANGUAGE";
      if (devanagariRatio >= latinRatio) {
        newDetected = "Hindi";
        newSecondary = "English";
        newDominant = "Hindi";
        newConfidence = devanagariRatio;
      } else {
        newDetected = "English";
        newSecondary = "Hindi";
        newDominant = "English";
        newConfidence = latinRatio;
      }
    } else if (isHinglish && newClass === "SINGLE_LANGUAGE" && newDetected !== "Hindi") {
      // If we detected it as English (Latin), but found Hinglish words, override to Mixed
      newClass = "MIXED_LANGUAGE";
      newDetected = "Hindi";
      newSecondary = "English";
      newDominant = "Hindi";
      newConfidence = 0.9;
    } else if (newClass === "UNCERTAIN") {
      return { classification: "UNCERTAIN" as const, detectedLanguage: null, secondaryLanguage: null, dominantLanguage: null, confidence: null };
    }

    return {
      classification: newClass,
      detectedLanguage: newDetected,
      secondaryLanguage: newSecondary,
      dominantLanguage: newDominant,
      confidence: newConfidence
    };
  }

  public reset() {
    this.speechBuffer = "";
  }
}
