import { VoiceSpeechProfile } from "./VoiceLanguageTypes";

export class VoiceSpeechInterpreter {
  // Dictionary of common misrecognitions based on variant.
  // key = misrecognized word (lowercase), value = intended word
  private enInDict: Record<string, string> = {
    "cap": "cab",
    "wet": "vet",
    "vine": "wine", // sometimes v/w swap
    "pull": "pool",
    "court": "coat",
  };

  public interpret(
    rawTranscript: string,
    profile: VoiceSpeechProfile,
    recentContext: string[] = []
  ): string {
    if (!rawTranscript || rawTranscript.trim().length === 0) {
      return rawTranscript;
    }

    // Only apply interpretation if we have a known variant that needs it
    // Or if we want to apply generic context correction for proper nouns
    const applyVariantCorrection = profile.variant === "en-IN";
    
    const words = rawTranscript.split(/(\s+)/); // Preserve whitespace
    let modified = false;

    // Build a lowercased context map for quick lookup
    const contextWordsLower = recentContext.map(c => c.toLowerCase().replace(/[.,!?]/g, ''));
    // Preserve original casing from context to restore proper nouns correctly if matched
    const contextOriginalMap = new Map<string, string>();
    for (const c of recentContext) {
      const clean = c.replace(/[.,!?]/g, '');
      if (clean) {
        contextOriginalMap.set(clean.toLowerCase(), clean);
      }
    }

    for (let i = 0; i < words.length; i++) {
      const isWhitespace = /^\s+$/.test(words[i]);
      if (isWhitespace) continue;

      const word = words[i].toLowerCase().replace(/[.,!?]/g, '');
      const punctuation = words[i].match(/[.,!?]/g)?.join('') || '';
      
      // 1. Variant-specific dictionary correction
      if (applyVariantCorrection && this.enInDict[word]) {
        const candidate = this.enInDict[word];
        
        // We require evidence from recentContext to apply the correction
        if (contextWordsLower.includes(candidate)) {
          words[i] = candidate + punctuation;
          modified = true;
          continue;
        }
      }

      // 2. Generic Proper Noun / Context Correction (Accent-Agnostic, relying on context)
      // Check single word
      let matched = false;
      if (word.length >= 4) {
        matched = this.checkContextMatch(word, contextWordsLower, contextOriginalMap, words, i, punctuation);
      }
      
      // 3. Check adjacent pair (e.g. "tensor trottle" -> "TensorThrottle")
      if (!matched && i < words.length - 2) {
        // Since we preserve whitespace, the actual next word is at i+2
        const nextWord = words[i+2].toLowerCase().replace(/[.,!?]/g, '');
        if (word.length + nextWord.length >= 6) {
          const combined = word + nextWord;
          const nextPunctuation = words[i+2].match(/[.,!?]/g)?.join('') || '';
          
          if (this.checkContextMatch(combined, contextWordsLower, contextOriginalMap, words, i, nextPunctuation, true)) {
            // Clear the whitespace and the next word since we combined them
            words[i+1] = "";
            words[i+2] = ""; 
            modified = true;
          }
        }
      }
      
      if (matched) modified = true;
    }

    if (modified) {
      return words.filter(w => w !== "").join('');
    }

    return rawTranscript; // No evidence, preserve original provider transcript
  }

  private checkContextMatch(
    word: string, 
    contextWordsLower: string[], 
    contextOriginalMap: Map<string, string>,
    words: string[],
    index: number,
    punctuation: string,
    isCombined: boolean = false
  ): boolean {
    for (const ctxWord of contextWordsLower) {
      if (ctxWord.length >= 5 && Math.abs(ctxWord.length - word.length) <= 2) {
        const dist = this.levenshtein(word, ctxWord);
        // Thresholds based on length
        let threshold = 1;
        if (ctxWord.length >= 10) threshold = 3;
        else if (ctxWord.length >= 7) threshold = 2;
        
        if (dist > 0 && dist <= threshold) {
           const originalCtxWord = contextOriginalMap.get(ctxWord) || ctxWord;
           // If it's a combined word match, we might want to preserve the space if the original context had one, 
           // but our context words are split by whitespace, so ctxWord is always a single contiguous token.
           words[index] = originalCtxWord + punctuation;
           return true;
        }
      }
    }
    return false;
  }

  // Simple Levenshtein distance for fuzzy context matching
  private levenshtein(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(matrix[i][j - 1] + 1, // insertion
                     matrix[i - 1][j] + 1) // deletion
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }
}
