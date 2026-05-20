/**
 * useTranscriptManager — Conversation history and partial transcript tracking.
 *
 * Manages the sliding window of conversation turns, sessionStorage backup,
 * and session highlights for thread references.
 *
 * @module
 */

import { useState, useRef, useCallback } from "react";
import type { TranscriptEntry } from "./types";

const MAX_TRANSCRIPT_LENGTH = 100;
const MAX_HIGHLIGHTS = 5;

export interface TranscriptManagerAPI {
  /** React state: full conversation transcript */
  transcript: TranscriptEntry[];
  /** Ref: same data, for use in callbacks without stale closures */
  transcriptRef: React.MutableRefObject<TranscriptEntry[]>;
  /** Add a turn (user or model) */
  addTurn: (text: string, userInitiated: boolean) => void;
  /** Session highlights for thread injection */
  sessionHighlightsRef: React.MutableRefObject<string[]>;
  /** Turn counter for this session */
  turnCountRef: React.MutableRefObject<number>;
  /** Reset all transcript state (on session end) */
  reset: () => void;
}

export function useTranscriptManager(): TranscriptManagerAPI {
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const transcriptRef = useRef<TranscriptEntry[]>([]);
  const sessionHighlightsRef = useRef<string[]>([]);
  const turnCountRef = useRef<number>(0);

  const addTurn = useCallback((text: string, userInitiated: boolean) => {
    const turn: TranscriptEntry = { text, user_initiated: userInitiated, timestamp: Date.now() };
    transcriptRef.current = [...transcriptRef.current, turn];
    sessionStorage.setItem("aura_transcript_backup", JSON.stringify(transcriptRef.current));
    setTranscript((prev) => {
      const updated = [...prev, turn];
      return updated.length > MAX_TRANSCRIPT_LENGTH
        ? updated.slice(-MAX_TRANSCRIPT_LENGTH)
        : updated;
    });

    // Capture significant user turns as session highlights
    if (userInitiated && text.length > 15 && sessionHighlightsRef.current.length < MAX_HIGHLIGHTS) {
      sessionHighlightsRef.current.push(text.slice(0, 80));
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript([]);
    transcriptRef.current = [];
    sessionHighlightsRef.current = [];
    turnCountRef.current = 0;
  }, []);

  return { transcript, transcriptRef, addTurn, sessionHighlightsRef, turnCountRef, reset };
}
