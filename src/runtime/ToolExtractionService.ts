import { auraTelemetry } from "@/telemetry/RuntimeTelemetry";

/**
 * Contract for a tool call embedded in LLM output.
 * Only `tool` is mandatory; all other fields are optional and depend on the
 * specific tool being invoked (currently only `play_music` is supported).
 */
export interface ToolPayload {
  tool: string;
  query?: string;
  user_query?: string;
  mood?: string;
  energy?: string;
  genre?: string;
  activity?: string;
  intent?: "explicit_song" | "mood_based" | "contextual" | "similar" | "preference_based";
  start_at?: string;
  [key: string]: unknown; // forward-compatible with future tool fields
}

/** Hard ceiling on buffered bytes. If an LLM opens a `{` and never closes it,
 *  we flush the buffer as plain text rather than accumulating until OOM. */
const MAX_BUFFER_BYTES = 4096;

export class ToolExtractionService {
  private buffer = "";
  private extractedTools: ToolPayload[] = [];

  /**
   * Feeds an incoming chunk from the LLM stream.
   * Returns the non-tool conversational text that should be spoken/displayed.
   * Any complete `{"tool": ...}` objects are silently extracted and queued.
   */
  public feed(chunk: string): string {
    this.buffer += chunk;
    let cleanText = "";

    while (this.buffer.length > 0) {
      // Safety: if the buffer has grown past the cap, the LLM is likely
      // emitting malformed output. Flush everything as text to unblock TTS.
      if (this.buffer.length > MAX_BUFFER_BYTES) {
        auraTelemetry.recordError({
          code: "tool_extractor_buffer_overflow",
          message: `Buffer exceeded ${MAX_BUFFER_BYTES}B (${this.buffer.length}B). Flushing as text.`,
        });
        cleanText += this.buffer;
        this.buffer = "";
        break;
      }

      const startIndex = this.buffer.indexOf("{");
      if (startIndex === -1) {
        cleanText += this.buffer;
        this.buffer = "";
        break;
      }

      // Everything before the first `{` is clean text.
      cleanText += this.buffer.slice(0, startIndex);
      this.buffer = this.buffer.slice(startIndex);

      // Buffer now starts with `{`. Walk forward to find the matching `}`.
      let braceCount = 0;
      let inString = false;
      let escapeNext = false;
      let endIndex = -1;

      for (let i = 0; i < this.buffer.length; i++) {
        const char = this.buffer[i];

        if (escapeNext) {
          escapeNext = false;
          continue;
        }

        if (inString) {
          if (char === "\\") {
            escapeNext = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }

        // Outside of a string
        if (char === '"') {
          inString = true;
          continue;
        }

        if (char === "{") braceCount++;
        if (char === "}") braceCount--;

        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }

      if (endIndex !== -1) {
        // Complete JSON candidate found.
        const jsonString = this.buffer.slice(0, endIndex + 1);
        try {
          const parsed = JSON.parse(jsonString);
          if (parsed && typeof parsed === "object" && typeof parsed.tool === "string") {
            this.extractedTools.push(parsed as ToolPayload);
          } else {
            // Valid JSON but not a tool call — release as text.
            cleanText += jsonString;
          }
        } catch {
          // Invalid JSON. Emit telemetry (Rule 4) and treat the leading `{`
          // as normal text so the parser can advance.
          auraTelemetry.recordError({
            code: "tool_extractor_parse_failure",
            message: `Failed to parse JSON tool block (${jsonString.length} chars)`,
          });
          cleanText += "{";
          this.buffer = this.buffer.slice(1);
          continue;
        }

        // Remove the processed block from the buffer.
        this.buffer = this.buffer.slice(endIndex + 1);
      } else {
        // Incomplete object — wait for more chunks.
        break;
      }
    }

    return cleanText;
  }

  /**
   * Retrieves all fully assembled tools since the last call and clears them.
   */
  public extractTools(): ToolPayload[] {
    const tools = this.extractedTools;
    this.extractedTools = [];
    return tools;
  }

  /**
   * Resets internal state. Call at the start of each new turn/request.
   */
  public reset(): void {
    this.buffer = "";
    this.extractedTools = [];
  }
}
