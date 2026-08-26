// Pure, dependency-free speech-VAD math.
// Used by:
//   - the main-thread ScriptProcessor fallback path (when the AudioWorklet
//     is unavailable), via useVoiceAcoustics
//   - public/vad-processor.js (inline copy — worklets cannot import modules)
//
// This is the "statistical VAD" tier: noise-floor estimation + SNR-based
// speech probability. It sits between Silero (preferred) and legacy RMS
// thresholding (final fallback).

export const SPEECH_PROB_MID_SNR_DB = 6;
export const SPEECH_PROB_STEEPNESS = 0.5;
export const NOISE_CALIBRATION_FRAMES = 200;

export const PROB_SPEECH_ON = 0.6;
export const PROB_SPEECH_OFF = 0.3;
export const PROB_BARGE_IN = 0.9;
/** Sustained probability at which we flag the target speaker (no identity). */
export const PROB_DOMINANT_SPEECH = 0.8;

/**
 * Hysteresis speech gate: rise above PROB_SPEECH_ON turns speech on;
 * once on, stays on until prob drops at or below PROB_SPEECH_OFF.
 */
export function nextSpeechDetected(prev: boolean, prob: number): boolean {
  return prob >= PROB_SPEECH_ON || (prev && prob > PROB_SPEECH_OFF);
}

/** Root-mean-square of a PCM frame. */
export function rmsOf(pcm: Float32Array | ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
  return Math.sqrt(sum / pcm.length);
}

/** Running-mean during the calibration window (first ~N frames). */
export function calibrateNoise(prev: number, rms: number, n: number): number {
  return (prev * n + rms) / (n + 1);
}

/** Slow adaptive noise-floor estimate after calibration. */
export function emaNoise(prev: number, rms: number, alpha = 0.005): number {
  return prev * (1 - alpha) + rms * alpha;
}

export function snrDb(rms: number, noiseFloor: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6) / Math.max(noiseFloor, 1e-6));
}

/**
 * Speech probability in [0, 1] from instantaneous RMS vs the noise floor.
 * Sigmoid centered at SPEECH_PROB_MID_SNR_DB dB SNR.
 */
export function speechProbability(rms: number, noiseFloor: number): number {
  const snr = snrDb(rms, noiseFloor);
  return 1 / (1 + Math.exp(-SPEECH_PROB_STEEPNESS * (snr - SPEECH_PROB_MID_SNR_DB)));
}

/** Noise level in dBFS (for diagnostics). */
export function noiseLevelDb(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-6));
}

/** How confident the VAD is: 0 at prob 0.5, 1 at prob 0 or 1. */
export function vadConfidence(prob: number): number {
  return Math.min(1, Math.abs(prob - 0.5) * 2);
}
