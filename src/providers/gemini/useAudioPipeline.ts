/**
 * useAudioPipeline — Mic capture, playback queue, VAD, and volume metering.
 *
 * Owns the AudioContext lifecycle, AudioWorklet/ScriptProcessor setup,
 * output analyser for visualizations, and the playback scheduling queue
 * that feeds Gemini's PCM response chunks to the speakers.
 *
 * @module
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { emitLatency } from "@/components/LatencyMeter";
import {
  float32ToBase64Pcm,
  base64PcmToFloat32,
  resampleFIR,
  WORKLET_PATH,
  SAMPLE_RATE_IN,
  SAMPLE_RATE_OUT,
  MAX_QUEUE,
} from "./types";
import type { LiveSession, PerfTimings } from "./types";

// ─── Types ──────────────────────────────────────────────────────────

export interface AudioPipelineAPI {
  // --- Refs exposed for composition ---
  audioContextRef: React.MutableRefObject<AudioContext | null>;
  streamRef: React.MutableRefObject<MediaStream | null>;
  inputAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
  outputAnalyserRef: React.MutableRefObject<AnalyserNode | null>;
  activeAudioNodesRef: React.MutableRefObject<Set<AudioBufferSourceNode>>;
  nextPlayTimeRef: React.MutableRefObject<number>;
  audioQueue: React.MutableRefObject<Float32Array[]>;
  currentRmsRef: React.MutableRefObject<number>;

  // --- State ---
  volume: number;
  isSpeaking: boolean;
  isSpeakingRef: React.MutableRefObject<boolean>;
  isActiveVoice: boolean;

  // --- Actions ---
  setIsSpeakingState: (val: boolean) => void;
  setIsActiveVoice: React.Dispatch<React.SetStateAction<boolean>>;
  interruptPlayback: (gracefulMs?: number) => void;
  flushAudioQueue: () => void;
  getInputFrequencyData: () => Uint8Array;
  getOutputFrequencyData: () => Uint8Array;

  /**
   * Initialize the full audio graph: mic → analyser → worklet → session.
   * Returns cleanup function.
   */
  setupAudioGraph: (
    stream: MediaStream,
    sessionRef: React.MutableRefObject<LiveSession | null>,
    sessionStateRef: React.MutableRefObject<string>,
    isSessionReadyRef: React.MutableRefObject<boolean>,
    perfRef: React.MutableRefObject<PerfTimings>,
    isFirstChunkOfTurnRef: React.MutableRefObject<boolean>,
    pauseSinceLastTurnRef: React.MutableRefObject<number>,
    lastTurnEndTimeRef: React.MutableRefObject<number>,
    lastChunkTimeRef: React.MutableRefObject<number | null>,
  ) => Promise<AudioContext>;

  /**
   * Schedule a decoded PCM chunk for playback through the output analyser.
   * Handles adaptive delay for the first chunk via delayOffsetSec.
   */
  schedulePlayback: (
    base64Audio: string,
    audioContext: AudioContext,
    outAnalyser: AnalyserNode,
    delayOffsetSec: number,
  ) => void;

  /** Tear down all audio resources. */
  teardown: () => void;

  /** Start the rAF-based volume metering loop. */
  startVolumeLoop: () => void;
}

// ─── The Hook ───────────────────────────────────────────────────────

export function useAudioPipeline(onInterrupt: () => void): AudioPipelineAPI {
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const inputAnalyserRef = useRef<AnalyserNode | null>(null);
  const outputAnalyserRef = useRef<AnalyserNode | null>(null);
  const nextPlayTimeRef = useRef<number>(0);
  const activeAudioNodesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const audioQueue = useRef<Float32Array[]>([]);
  const currentRmsRef = useRef<number>(0.02);

  const [volume, setVolume] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);
  const [isActiveVoice, setIsActiveVoice] = useState(false);

  // VAD state
  const vadHangtimeRef = useRef<number>(0);
  const isVADActiveRef = useRef<boolean>(false);
  const noiseFloorRef = useRef<number>(0.01);
  const frameRef = useRef<number>(0);
  const updateVolumeRef = useRef<() => void>(null!);
  const onsetCountRef = useRef<number>(0);
  const ONSET_THRESHOLD = 0.015;
  const ONSET_FRAMES = 3;

  const setIsSpeakingState = useCallback((val: boolean) => {
    setIsSpeaking(val);
    isSpeakingRef.current = val;
  }, []);

  const interruptPlayback = useCallback(
    (gracefulMs: number = 20) => {
      import("@/runtime/humanConversation/SpeechCoordinator").then(({ SpeechCoordinator }) => {
        SpeechCoordinator.getInstance().flush();
      });
      setIsSpeakingState(false);
    },
    [setIsSpeakingState],
  );

  const flushAudioQueue = useCallback(() => {
    audioQueue.current = [];
  }, []);

  // ── Volume metering (rAF loop) ────────────────────────────────────

  const updateVolume = useCallback(() => {
    if (!inputAnalyserRef.current) return;
    const dataArray = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
    inputAnalyserRef.current.getByteTimeDomainData(dataArray);
    let sumSquares = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const norm = dataArray[i] / 128.0 - 1.0;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / dataArray.length);
    setVolume(rms);
    currentRmsRef.current = rms;

    // Adaptive noise floor
    if (rms < noiseFloorRef.current)
      noiseFloorRef.current = noiseFloorRef.current * 0.999 + rms * 0.001;
    else if (rms < noiseFloorRef.current * 2)
      noiseFloorRef.current = noiseFloorRef.current * 0.995 + rms * 0.005;

    // NOTE: Onset-based barge-in detection has been moved to the centralized
    // useBargeIn hook in useLive.ts, which adds grace periods, dynamic thresholds,
    // AND fires the WebSocket truncation signal to abort Gemini's generation loop.
    // The old code here only called interruptPlayback() locally without notifying the server.

    // VAD state machine
    const triggerThreshold = Math.max(noiseFloorRef.current * 2.5, 0.02);
    if (rms > triggerThreshold) {
      vadHangtimeRef.current = performance.now();
      if (!isVADActiveRef.current) {
        isVADActiveRef.current = true;
        setIsActiveVoice(true);
      }
    } else {
      if (isVADActiveRef.current && performance.now() - vadHangtimeRef.current > 500) {
        isVADActiveRef.current = false;
        setIsActiveVoice(false);
      }
    }
    frameRef.current = requestAnimationFrame(updateVolumeRef.current);
  }, [interruptPlayback, setIsSpeakingState]);
  updateVolumeRef.current = updateVolume;

  const startVolumeLoop = useCallback(() => {
    frameRef.current = requestAnimationFrame(updateVolumeRef.current);
  }, []);

  // ── Frequency data for visualizers ────────────────────────────────

  const getInputFrequencyData = useCallback(() => {
    const arr = new Uint8Array(64);
    if (inputAnalyserRef.current) {
      const full = new Uint8Array(inputAnalyserRef.current.frequencyBinCount);
      inputAnalyserRef.current.getByteFrequencyData(full);
      for (let i = 0; i < 64; i++) arr[i] = full[i];
    }
    return arr;
  }, []);

  const getOutputFrequencyData = useCallback(() => {
    const arr = new Uint8Array(64);
    if (outputAnalyserRef.current) {
      const full = new Uint8Array(outputAnalyserRef.current.frequencyBinCount);
      outputAnalyserRef.current.getByteFrequencyData(full);
      for (let i = 0; i < 64; i++) arr[i] = full[i];
    }
    return arr;
  }, []);

  // ── Audio graph setup ─────────────────────────────────────────────

  const setupAudioGraph = useCallback(
    async (
      stream: MediaStream,
      sessionRef: React.MutableRefObject<LiveSession | null>,
      sessionStateRef: React.MutableRefObject<string>,
      isSessionReadyRef: React.MutableRefObject<boolean>,
      perfRef: React.MutableRefObject<PerfTimings>,
      isFirstChunkOfTurnRef: React.MutableRefObject<boolean>,
      pauseSinceLastTurnRef: React.MutableRefObject<number>,
      lastTurnEndTimeRef: React.MutableRefObject<number>,
      lastChunkTimeRef: React.MutableRefObject<number | null>,
    ): Promise<AudioContext> => {
      const audioContext = new AudioContext({ sampleRate: SAMPLE_RATE_IN });
      audioContextRef.current = audioContext;
      streamRef.current = stream;

      // ADDED: Explicit state tracking to catch "AUDIO_FALL" conditions
      audioContext.onstatechange = () => {
        console.log(`[AURA_AUDIO_STATE] AudioContext changed to: ${audioContext.state}`);
        if (audioContext.state === "suspended") {
          console.warn(
            "[AURA_AUDIO_FALL] ⚠️ AudioContext suspended unexpectedly! Mic input has fallen. Awaiting user interaction (click/key) to resume.",
          );
        }
      };

      const inAnalyser = audioContext.createAnalyser();
      inAnalyser.fftSize = 256;
      inputAnalyserRef.current = inAnalyser;

      const outAnalyser = audioContext.createAnalyser();
      outAnalyser.fftSize = 256;
      outAnalyser.connect(audioContext.destination);
      outputAnalyserRef.current = outAnalyser;

      const src = audioContext.createMediaStreamSource(stream);

      // High-pass filter (removes low rumble/hum/AC fan)
      const highPass = audioContext.createBiquadFilter();
      highPass.type = "highpass";
      highPass.frequency.value = 80;

      // Low-pass filter (removes high frequency noise like typing)
      const lowPass = audioContext.createBiquadFilter();
      lowPass.type = "lowpass";
      lowPass.frequency.value = 8000;

      // Chain the filters: Source -> HPF -> LPF -> Analyser
      src.connect(highPass).connect(lowPass).connect(inAnalyser);

      nextPlayTimeRef.current = audioContext.currentTime;

      // Audio sender with queue
      const send = (d: Float32Array) => {
        const activeSession = sessionRef.current as any;
        if (
          !activeSession ||
          sessionStateRef.current !== "connected" ||
          !isSessionReadyRef.current
        ) {
          if (audioQueue.current.length < MAX_QUEUE) audioQueue.current.push(d);
          else {
            audioQueue.current.shift();
            audioQueue.current.push(d);
          }
          return;
        }
        if (activeSession.ws && activeSession.ws.readyState !== 1) return;

        try {
          // Flush queued chunks first
          while (audioQueue.current.length > 0) {
            const chunk = audioQueue.current.shift()!;
            if (isSessionReadyRef.current && sessionRef.current) {
              sessionRef.current.sendRealtimeInput({
                audio: { data: float32ToBase64Pcm(chunk), mimeType: "audio/pcm;rate=16000" },
              });
            }
          }
          if (isSessionReadyRef.current && sessionRef.current) {
            sessionRef.current.sendRealtimeInput({
              audio: { data: float32ToBase64Pcm(d), mimeType: "audio/pcm;rate=16000" },
            });
          }
        } catch (err: any) {
          const msg = err?.message ?? "";
          if (msg.includes("CLOSING") || msg.includes("CLOSED") || msg.includes("WebSocket"))
            return;
        }
      };

      // Prefer AudioWorklet; fall back to ScriptProcessor
      try {
        await audioContext.audioWorklet.addModule(WORKLET_PATH);
        const node = new AudioWorkletNode(audioContext, "pcm-capture-processor", {
          processorOptions: { inputSampleRate: audioContext.sampleRate },
        });
        workletNodeRef.current = node;
        node.port.onmessage = (e) => {
          if (!isSessionReadyRef.current || !sessionRef.current) return;
          const raw = e.data;
          const f32 = raw.pcmData
            ? new Float32Array(raw.pcmData)
            : raw instanceof Float32Array
              ? raw
              : new Float32Array(raw);
          if (!f32) return;

          if (isFirstChunkOfTurnRef.current) {
            pauseSinceLastTurnRef.current = performance.now() - lastTurnEndTimeRef.current;
            isFirstChunkOfTurnRef.current = false;
          }
          const now = performance.now();
          if (lastChunkTimeRef.current)
            emitLatency("audioChunkInterval", now - lastChunkTimeRef.current);
          lastChunkTimeRef.current = now;
          send(f32);
        };
        inAnalyser.connect(node);
        const silent = audioContext.createGain();
        silent.gain.value = 0;
        node.connect(silent).connect(audioContext.destination);
      } catch {
        const proc = audioContext.createScriptProcessor(512, 1, 1);
        processorRef.current = proc;
        proc.onaudioprocess = (e) =>
          send(
            resampleFIR(e.inputBuffer.getChannelData(0), audioContext.sampleRate, SAMPLE_RATE_IN),
          );
        inAnalyser.connect(proc);
        const silent = audioContext.createGain();
        silent.gain.value = 0;
        proc.connect(silent).connect(audioContext.destination);
      }

      return audioContext;
    },
    [],
  );

  // ── Playback scheduling ───────────────────────────────────────────

  const schedulePlayback = useCallback(
    (
      base64Audio: string,
      audioContext: AudioContext,
      outAnalyser: AnalyserNode,
      delayOffsetSec: number,
    ) => {
      const f32 = base64PcmToFloat32(base64Audio);
      const buf = audioContext.createBuffer(1, f32.length, SAMPLE_RATE_OUT);
      buf.getChannelData(0).set(f32);
      
      import("@/runtime/humanConversation/SpeechCoordinator").then(({ SpeechCoordinator }) => {
        SpeechCoordinator.getInstance().queueAudioContextBuffer(
          audioContext, 
          buf, 
          outAnalyser, 
          delayOffsetSec, 
          () => {
            if (audioContext.currentTime >= SpeechCoordinator.getInstance().getNextPlayTime() - 0.1) setIsSpeakingState(false);
          }
        );
      });
    },
    [setIsSpeakingState],
  );

  // ── Teardown ──────────────────────────────────────────────────────

  const teardown = useCallback(() => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      if (workletNodeRef.current.port) workletNodeRef.current.port.close();
      workletNodeRef.current = null;
    }
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      import("@/runtime/humanConversation/SpeechCoordinator").then(({ SpeechCoordinator }) => {
        SpeechCoordinator.getInstance().flush();
      });
      if (audioContextRef.current.state !== "closed")
        audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    inputAnalyserRef.current = null;
    outputAnalyserRef.current = null;
    isVADActiveRef.current = false;
    noiseFloorRef.current = 0.01;
  }, []);

  // Auto-resume AudioContext on user gesture (browser policy)
  useEffect(() => {
    const resume = async () => {
      if (audioContextRef.current?.state === "suspended") await audioContextRef.current.resume();
    };
    window.addEventListener("pointerdown", resume, { once: true });
    window.addEventListener("keydown", resume, { once: true });
    return () => {
      window.removeEventListener("pointerdown", resume);
      window.removeEventListener("keydown", resume);
    };
  }, []);

  return {
    audioContextRef,
    streamRef,
    inputAnalyserRef,
    outputAnalyserRef,
    activeAudioNodesRef,
    nextPlayTimeRef,
    audioQueue,
    currentRmsRef,
    volume,
    isSpeaking,
    isSpeakingRef,
    isActiveVoice,
    setIsSpeakingState,
    setIsActiveVoice,
    interruptPlayback,
    flushAudioQueue,
    getInputFrequencyData,
    getOutputFrequencyData,
    setupAudioGraph,
    schedulePlayback,
    teardown,
    startVolumeLoop,
  };
}
