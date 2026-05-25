// src/modes/JoyfulPassionMode.ts
// SAFE PUBLIC VERSION — Explicit prompt injected via VITE_EXPLICIT_PROMPT env var at build time.
// The actual prompt lives in .env.local (gitignored) and is never committed to source control.

export const isJoyfulPassionMode = true;

export const SECRET_ACTIVATION_PHRASE = "boundless sexuality";
export const SECRET_DEACTIVATION_PHRASE = "boundless desexuality";

// ── Bulletproof fuzzy activation detector ──────────────────────────────
// Speech-to-text often garbles the phrase. This catches all plausible
// variations: spacing, hyphens, partial mishearing, phonetic typos, etc.

/**
 * Normalizes text for matching: lowercases, strips punctuation, collapses whitespace.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[-_.,!?;:'"]/g, " ")  // punctuation → space
    .replace(/\s+/g, " ")            // collapse whitespace
    .trim();
}

/**
 * Levenshtein distance — edit distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Bulletproof detection of the activation phrase "boundless sexuality".
 * 
 * Handles:
 *  - Exact match ("boundless sexuality")
 *  - Hyphenated ("boundless-sexuality")
 *  - Substring match ("I want boundless sexuality now")
 *  - STT mishearing with fuzzy edit-distance (≤3 edits)
 *  - Split-word garbling ("bound less sexual ity")
 *  - Phonetic near-misses ("boundles sexualty", "boundless sexuallity")
 *  - Word-level independent matching ("boundless" + "sexual*")
 */
export function detectActivationPhrase(userText: string): boolean {
  const normalized = normalize(userText);
  const target = normalize(SECRET_ACTIVATION_PHRASE); // "boundless sexuality"

  // ── Layer 1: Exact substring match ──
  if (normalized.includes(target)) return true;

  // ── Layer 1.5: Devanagari Script Transliterations (For Sarvam STT) ──
  // Sarvam's 'saaras:v3' model often transcribes English words phonetically into Hindi script
  const devanagariRegex = /(बाउंड|बाउण्ड|बाउं).*?(सेक्स|एक्स|स्पैच|एक्चु|एक शुड|लिटी)/;
  if (devanagariRegex.test(userText)) return true;

  // ── Layer 2: Check with no spaces (handles garbled spacing) ──
  const noSpaceInput = normalized.replace(/\s/g, "");
  const noSpaceTarget = target.replace(/\s/g, "");
  if (noSpaceInput.includes(noSpaceTarget)) return true;

  // ── Layer 3: Word-level matching ──
  // Both "boundless" and any word starting with "sexual" present
  const words = normalized.split(" ");
  const hasBoundless = words.some(w => levenshtein(w, "boundless") <= 2);
  const hasSexuality = words.some(w => {
    if (w.startsWith("sexual")) return true;
    if (levenshtein(w, "sexuality") <= 2) return true;
    if (levenshtein(w, "sexual") <= 2) return true;
    return false;
  });
  if (hasBoundless && hasSexuality) return true;

  // ── Layer 4: Sliding window fuzzy match ──
  // Extract every substring of length ±4 from target and check edit distance
  const targetLen = target.length;
  for (let windowSize = targetLen - 4; windowSize <= targetLen + 4; windowSize++) {
    if (windowSize <= 0 || windowSize > normalized.length) continue;
    for (let i = 0; i <= normalized.length - windowSize; i++) {
      const window = normalized.substring(i, i + windowSize);
      if (levenshtein(window, target) <= 3) return true;
    }
  }

  return false;
}

/**
 * Bulletproof detection of the deactivation phrase "boundless desexuality".
 */
export function detectDeactivationPhrase(userText: string): boolean {
  const normalized = normalize(userText);
  const target = normalize(SECRET_DEACTIVATION_PHRASE); // "boundless desexuality"

  // ── Layer 1: Exact substring match ──
  if (normalized.includes(target)) return true;

  // ── Layer 1.5: Devanagari Script Transliterations (For Sarvam STT) ──
  const devanagariRegex = /(बाउंडलेस|बाउंड लेस|बाउंडलेस).*?(डीसेक्सुएलिटी|डी एक्सुएलिटी|डिसैक्सुअलिटी|डीसेक्सुअलिटी|डीसेक्स)/;
  if (devanagariRegex.test(userText)) return true;

  // ── Layer 2: Check with no spaces ──
  const noSpaceInput = normalized.replace(/\s/g, "");
  const noSpaceTarget = target.replace(/\s/g, "");
  if (noSpaceInput.includes(noSpaceTarget)) return true;

  // ── Layer 3: Word-level matching ──
  const words = normalized.split(" ");
  const hasBoundless = words.some(w => levenshtein(w, "boundless") <= 2);
  const hasDesexuality = words.some(w => {
    if (w.startsWith("desexual")) return true;
    if (levenshtein(w, "desexuality") <= 3) return true;
    return false;
  });
  if (hasBoundless && hasDesexuality) return true;

  // ── Layer 4: Sliding window ──
  const targetLen = target.length;
  for (let windowSize = targetLen - 4; windowSize <= targetLen + 4; windowSize++) {
    if (windowSize <= 0 || windowSize > normalized.length) continue;
    for (let i = 0; i <= normalized.length - windowSize; i++) {
      const window = normalized.substring(i, i + windowSize);
      if (levenshtein(window, target) <= 4) return true;
    }
  }

  return false;
}

/**
 * The explicit system prompt is loaded from the VITE_EXPLICIT_PROMPT environment variable.
 * - Local dev: set in .env.local (gitignored)
 * - Production: set in Vercel/Render dashboard → Environment Variables
 * - Fallback: safe friendly mode if env var is missing
 */
export const JoyfulPassionSystemPrompt: string =
  import.meta.env.VITE_EXPLICIT_PROMPT ||
  "You are a friendly, helpful companion. Stay respectful and supportive.";

/**
 * Runtime check: returns true only if the real explicit prompt was injected.
 * Useful for conditional UI or logging.
 */
export const isExplicitModeEnabled = (): boolean => {
  const prompt = import.meta.env.VITE_EXPLICIT_PROMPT;
  return typeof prompt === "string" && prompt.length > 100;
};