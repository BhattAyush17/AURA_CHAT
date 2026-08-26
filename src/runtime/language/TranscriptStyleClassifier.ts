import { LanguageDistributionAnalyzer } from "./LanguageDistributionAnalyzer";

export interface SpeechStyle {
  primary: string;
  secondary: string;
  ratio: string;
  script: string;
  style: string;
  uiLabel: string;
}

export class TranscriptStyleClassifier {
  private analyzer = new LanguageDistributionAnalyzer();
  
  public classify(text: string): SpeechStyle {
    const { hindiTokens, englishTokens, devanagariTokens } = this.analyzer.analyze(text);
    const total = hindiTokens + englishTokens;
    
    if (total === 0) return { primary: "Unknown", secondary: "None", ratio: "0/0", script: "Unknown", style: "Unknown", uiLabel: "Unknown" };

    const hindiRatio = (hindiTokens / total) * 100;
    const englishRatio = (englishTokens / total) * 100;
    const script = devanagariTokens > 0 ? "Devanagari" : "Roman";

    if (hindiRatio > 90) {
      return { primary: "Hindi", secondary: "English", ratio: `${Math.round(hindiRatio)}/${Math.round(englishRatio)}`, script, style: "Pure Hindi", uiLabel: "🇮🇳 Pure Hindi" };
    } else if (englishRatio > 90) {
      return { primary: "English", secondary: "Hindi", ratio: `${Math.round(englishRatio)}/${Math.round(hindiRatio)}`, script: "Roman", style: "Pure English", uiLabel: "🇬🇧 Pure English" };
    } else if (hindiRatio >= 60) {
      return { primary: "Hindi", secondary: "English", ratio: `${Math.round(hindiRatio)}/${Math.round(englishRatio)}`, script, style: "Mostly Hindi", uiLabel: "English (Hindi Terms)" };
    } else if (englishRatio >= 60) {
      return { primary: "English", secondary: "Hindi", ratio: `${Math.round(englishRatio)}/${Math.round(hindiRatio)}`, script: "Roman", style: "Mostly English", uiLabel: "Hindi (English Terms)" };
    } else {
      return { primary: "Mixed", secondary: "Mixed", ratio: `${Math.round(hindiRatio)}/${Math.round(englishRatio)}`, script, style: "Balanced Hinglish", uiLabel: "🇮🇳🇬🇧 Hinglish" };
    }
  }
}
