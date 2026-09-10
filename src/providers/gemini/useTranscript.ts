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
import { playbackState } from "@/music/PlaybackState";
import { resolveDeicticReference } from "@/music/DeicticResolver";
import {
  getAdaptiveAttentionLayer,
  type ResponseMode,
} from "@/runtime/attention/AdaptiveAttentionLayer";

const MAX_TRANSCRIPT_LENGTH = 100;
const MAX_HIGHLIGHTS = 5;

export interface TranscriptManagerAPI {
  /** React state: full conversation transcript */
  transcript: TranscriptEntry[];
  /** Ref: same data, for use in callbacks without stale closures */
  transcriptRef: React.MutableRefObject<TranscriptEntry[]>;
  /** Add a turn (user or model) */
  addTurn: (text: string, userInitiated: boolean, interpretedText?: string) => void;
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

  const addTurn = useCallback((text: string, userInitiated: boolean, interpretedText?: string) => {
    const s = playbackState.getState();
    const sessionId = s.musicSessionId;
    const trackId = s.currentTrack?.id;
    const mediaTime = s.currentTrack ? Math.round(s.positionMs / 1000) : undefined;
    const perception = s.perception;
    const section = perception?.structure?.section;

    let musicReferenceType;
    let musicReferenceConfidence;
    let musicMoment;

    if (userInitiated) {
      const resolution = resolveDeicticReference(text, s, perception?.recentMoments);
      musicReferenceType = resolution.category;
      musicReferenceConfidence = resolution.confidence;
      musicMoment = resolution.moment;
    } else {
      musicMoment = perception?.recentMoments?.[perception.recentMoments.length - 1];
    }

    const turn: TranscriptEntry = {
      text,
      interpreted_text: interpretedText,
      user_initiated: userInitiated,
      timestamp: Date.now(),
      musicTrackId: trackId,
      musicMediaTime: mediaTime,
      musicSection: section,
      musicMoment,
      musicReferenceType,
      musicReferenceConfidence,
    };

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

    if (sessionId) {
      playbackState.addTemporalEvent({
        id: Math.random().toString(36).substring(2),
        sessionId,
        trackId,
        type: userInitiated ? "user_utterance" : "aura_response",
        timestamp: Date.now(),
        mediaTime,
        metadata: { text, section },
      });
    }

    // ── Adaptive Attention: record the completed AURA turn ──────────────
    // The shared completion point for Gemini, OpenRouter, and Sarvam. The
    // attention layer's recordTurn() needs:
    //   - userCarried:        derived from the preceding user turn (text only)
    //   - auraAskedQuestion:  derived from the AURA response text
    //   - auraResponseMode:   derived from the current stance mode (or fallback)
    // All providers flow through this hook so the attention feedback loop
    // is provider-agnostic. Fail-open: any exception is caught locally and
    // the response is still recorded in the transcript.
    if (!userInitiated) {
      try {
        const attention = getAdaptiveAttentionLayer();
        const prev = transcriptRef.current;
        let prevUserText = "";
        for (let i = prev.length - 2; i >= 0; i--) {
          if (prev[i].user_initiated) {
            prevUserText = prev[i].text;
            break;
          }
        }
        const userCarried = attention.detectUserCarrying(prevUserText);
        const auraAskedQuestion = attention.detectQuestion(text);
        const auraResponseMode: ResponseMode = (() => {
          const mode = attention.getCurrentStance()?.mode;
          switch (mode) {
            case "empathetic":
            case "supportive":
              return "reflection";
            case "reflective":
              return "reflection";
            case "curious":
              return auraAskedQuestion ? "question" : "acknowledgement";
            case "concise":
            case "grounded":
              return "answer";
            case "playful":
              return "reaction";
            default:
              return auraAskedQuestion ? "question" : "answer";
          }
        })();
        attention.recordTurn({
          userCarried,
          auraAskedQuestion,
          auraResponseMode,
        });
      } catch {
        // fail-open: never let attention feedback break the response path
      }
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
