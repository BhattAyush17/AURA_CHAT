export class ThoughtGroupStreamer {
  private buffer: string = "";

  public processStreamToken(token: string, onThoughtGroupReady: (group: string) => void) {
    this.buffer += token;
    
    // Do not stream only at sentence boundaries.
    // Detect semantic "thought groups".
    if (this.isSemanticBoundary(this.buffer)) {
      onThoughtGroupReady(this.buffer.trim());
      this.buffer = "";
    }
  }

  private isSemanticBoundary(text: string): boolean {
    // Basic heuristic for natural phrasing rather than pure sentence completion
    const trimmed = text.trim();
    if (trimmed.endsWith(",") || trimmed.endsWith("...") || trimmed.endsWith(" -")) {
      return true;
    }
    // Also flush if length exceeds natural breathing bounds
    if (trimmed.length > 50 && trimmed.includes(" ")) {
      return true;
    }
    // Final sentence boundaries
    if (trimmed.endsWith(".") || trimmed.endsWith("?") || trimmed.endsWith("!")) {
      return true;
    }
    return false;
  }
}
