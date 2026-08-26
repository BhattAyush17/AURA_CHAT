import { SpeechStyle } from "./TranscriptStyleClassifier";

export class TranscriptFormatter {
  public formatStyleInstruction(style: SpeechStyle): string {
    return `
[SPEECH STYLE PRESERVATION LAYER]
The user is speaking in the following natural style:
- Detected Style: ${style.style}
- Primary Language: ${style.primary}
- Script Used: ${style.script}
- Language Mixture Ratio: ${style.ratio}

CRITICAL RULES:
1. NEVER normalize everything into one language.
2. Mirror the exact style. If they speak Pure Hindi, answer in Pure Hindi. If they use Balanced Hinglish, respond with the same natural mixture.
3. If they use English words inside Hindi (or vice versa), do the same. Never artificially translate borrowed words.
4. Adapt smoothly if the user gradually shifts their language.
[/SPEECH STYLE PRESERVATION LAYER]\n`;
  }
}
