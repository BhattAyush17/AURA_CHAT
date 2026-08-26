export type GeminiTraceEvent =
  | 'GEMINI_CONNECTED'
  | 'GEMINI_DISCONNECTED'
  | 'GEMINI_CONNECT_REQUESTED'
  | 'GEMINI_CONNECT_RESOLVED'
  | 'GEMINI_SETUP_COMPLETE'
  | 'GEMINI_SESSION_ACTIVE'
  | 'GEMINI_SESSION_INACTIVE'
  | 'GEMINI_SESSION_CLOSED'
  | 'GEMINI_RECONNECT_REQUESTED'
  | 'GEMINI_RECONNECT_RESOLVED'
  | 'CAPTURE_REQUESTED'
  | 'AUDIO_CONTEXT_READY'
  | 'MIC_STREAM_READY'
  | 'FIRST_PCM_FRAME'
  | 'PCM_FRAME_OBSERVED'
  | 'VOICESENSE_OBSERVATION'
  | 'SPEECH_DETECTED'
  | 'SPEECH_CONFIDENT'
  | 'USER_TURN_START'
  | 'USER_TURN_END_CANDIDATE'
  | 'GEMINI_TURN_END'
  | 'STT_AVAILABLE'
  | 'COGNITION_START'
  | 'SENSE_COLLECTION_COMPLETE'
  | 'FUSION_COMPLETE'
  | 'HUMAN_STATE_COMPLETE'
  | 'COGNITION_COMPLETE'
  | 'DECISION_START'
  | 'DECISION_COMPLETE'
  | 'GEMINI_REQUEST_SENT'
  | 'GEMINI_RESPONSE_STARTED'
  | 'FIRST_RESPONSE_AUDIO_BYTE'
  | 'FIRST_RESPONSE_AUDIO_CHUNK'
  | 'PLAYBACK_SCHEDULED'
  | 'PLAYBACK_STARTED'
  | 'AUDIBLE_RESPONSE_ESTIMATE'
  | 'RESPONSE_COMPLETED'
  | 'BARGE_IN_DETECTED'
  | 'PLAYBACK_INTERRUPTED';

export interface TraceRecord {
  turnId: string;
  event: GeminiTraceEvent;
  timestamp: number;
  data?: any;
}

class GeminiTimingTrace {
  private events: TraceRecord[] = [];
  private currentTurnId: string = 'gemini-turn-001';
  private turnCounter = 1;

  public startNewTurn() {
    this.turnCounter++;
    this.currentTurnId = `gemini-turn-${this.turnCounter.toString().padStart(3, '0')}`;
  }

  public getTurnId() {
    return this.currentTurnId;
  }

  public setTurnId(turnId: string) {
    this.currentTurnId = turnId;
  }

  public record(event: GeminiTraceEvent, data?: any, turnId?: string) {
    this.events.push({
      turnId: turnId || this.currentTurnId,
      event,
      timestamp: performance.now(),
      data
    });
    if (this.events.length > 500) {
      this.events.shift();
    }
  }

  public getEvents(): TraceRecord[] {
    return [...this.events];
  }

  public clear() {
    this.events = [];
  }

  public dump(): string {
    return JSON.stringify(this.events, null, 2);
  }
}

export const geminiTrace = new GeminiTimingTrace();

// Expose to window for browser subagent / puppeteer to extract
if (typeof window !== 'undefined') {
  (window as any).__GEMINI_TRACE__ = geminiTrace;
}
