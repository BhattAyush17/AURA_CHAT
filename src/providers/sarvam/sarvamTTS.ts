/**
 * Sarvam TTS — Generates speech audio via Sarvam's text-to-speech API.
 * Includes a 10s timeout to prevent UI hangs on network issues.
 * Returns base64-encoded audio or null (caller falls back to browser TTS).
 */
export async function generateSpeech(
  text: string,
  speaker: string = "anushka",
): Promise<string | null> {
  const key = sessionStorage.getItem("aura_sarvam_api_key") || import.meta.env.VITE_SARVAM_API_KEY;
  if (!key) {
    console.warn("[Sarvam TTS] API Key is missing! Falling back to browser native TTS.");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const langCode =
      localStorage.getItem("aura_voice_language")?.split("-")[0] === "hi" ? "hi-IN" : "en-IN";

    // Support both modern "text" and legacy "inputs" schemas in a single payload
    const payload = {
      inputs: [text],
      text: text,
      target_language_code: langCode,
      speaker,
      model: "bulbul:v3",
      pace: 1.1,
      loudness: 1.0,
      speech_sample_rate: 22050,
      enable_preprocessing: true,
    };

    const response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": key,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[Sarvam TTS] HTTP Error ${response.status}:`, errText);
      return null;
    }

    const data = await response.json();
    return data.audios?.[0] || null; // Base64 string
  } catch (error: any) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      console.warn("[Sarvam TTS] Request timed out after 10s, falling back to browser TTS");
    } else {
      console.error("[Sarvam TTS] Error:", error);
    }
    return null;
  }
}
