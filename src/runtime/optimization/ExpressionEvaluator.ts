// src/runtime/optimization/ExpressionEvaluator.ts

export class ExpressionEvaluator {
  private static buffer: string = "";
  
  public static processChunk(chunk: string, onSentenceBoundary: (formatted: string) => void) {
    this.buffer += chunk;
    
    // Check for sentence boundaries: ., !, ?, \n
    if (/[.!?:;\n]/.test(this.buffer)) {
      const formatted = this.evaluateExpressions(this.buffer);
      onSentenceBoundary(formatted);
      this.buffer = "";
    }
  }

  private static evaluateExpressions(text: string): string {
    // Lazy evaluation of expensive Regex replacements (SSML/SSPL)
    // Runs ONLY once per semantic boundary instead of every WS chunk
    let output = text;
    // e.g. Regex replacements
    output = output.replace(/\*(.*?)\*/g, '<emphasis>$1</emphasis>'); 
    return output;
  }
}
