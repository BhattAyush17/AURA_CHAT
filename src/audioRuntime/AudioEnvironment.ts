export type AudioEnvironment = "speaker" | "headphones" | "bluetooth" | "unknown";

/**
 * Detects the current audio output environment by enumerating devices.
 * 
 * Falls back to "unknown" if permission hasn't been granted or if
 * the browser obfuscates labels for privacy.
 */
export async function detectAudioEnvironment(): Promise<AudioEnvironment> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return "unknown";
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioOutputs = devices.filter(d => d.kind === "audiooutput");

    if (audioOutputs.length === 0) {
      return "unknown";
    }

    // Combine all labels to search for keywords. 
    // If permission is denied, labels will be empty strings.
    const labels = audioOutputs.map(d => d.label.toLowerCase()).join(" ");

    if (!labels.trim()) {
      return "unknown"; // Labels obfuscated
    }

    if (labels.includes("bluetooth") || labels.includes("airpods") || labels.includes("buds") || labels.includes("hands-free") || labels.includes("bose") || labels.includes("sony")) {
      return "bluetooth";
    }

    if (labels.includes("headphone") || labels.includes("headset") || labels.includes("earphone")) {
      return "headphones";
    }

    if (labels.includes("speaker") || labels.includes("built-in") || labels.includes("internal")) {
      return "speaker";
    }

    return "unknown";
  } catch (e) {
    console.warn("[AudioEnvironment] Failed to detect environment", e);
    return "unknown";
  }
}
