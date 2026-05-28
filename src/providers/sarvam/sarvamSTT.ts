import { getSarvamKey } from "@/lib/api";

/**
 * Sarvam STT — Transcribes audio via Sarvam's speech-to-text API.
 * Includes a 10s timeout to prevent UI hangs on network issues.
 */
export async function transcribeAudio(audioBlob: Blob): Promise<string | null> {
  const key = getSarvamKey();
  if (!key) {
    console.warn("[Sarvam STT] API Key is missing! Cannot transcribe audio.");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const formData = new FormData();
    // Sarvam REST API supports webm, wav, mp3, ogg, flac, aac, etc.
    // Streaming (WebSocket) API only supports wav/pcm — but we use the REST endpoint here.
    const extension = audioBlob.type === "audio/wav" ? "wav" : "webm";
    formData.append("file", audioBlob, `audio.${extension}`);
    formData.append(
      "language_code",
      localStorage.getItem("aura_voice_language")?.split("-")[0] === "hi" ? "hi-IN" : "en-IN",
    );
    formData.append("model", "saaras:v3");
    formData.append("mode", "transcribe");

    const response = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: {
        "api-subscription-key": key,
      },
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[Sarvam STT] HTTP Error ${response.status}:`, errText);
      return null;
    }

    const data = await response.json();
    return data.transcript || null;
  } catch (error: any) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") {
      console.warn("[Sarvam STT] Request timed out after 10s");
    } else {
      console.error("[Sarvam STT] Network/Parse Error:", error);
    }
    return null;
  }
}
