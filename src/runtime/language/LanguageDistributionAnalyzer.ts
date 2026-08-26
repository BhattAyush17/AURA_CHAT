import { tokenizeLanguage } from "../../executive/LanguageState";

export class LanguageDistributionAnalyzer {
  /**
   * Token buckets shared with the Executive's language engine (single
   * lexicon, no drift): Devanagari + romanized-Hindi tokens count as
   * Hindi; everything else roman counts as English.
   */
  public analyze(text: string): {
    hindiTokens: number;
    englishTokens: number;
    devanagariTokens: number;
  } {
    const { hindi, english, devanagari } = tokenizeLanguage(text);
    return {
      hindiTokens: hindi,
      englishTokens: english,
      devanagariTokens: devanagari,
    };
  }
}
