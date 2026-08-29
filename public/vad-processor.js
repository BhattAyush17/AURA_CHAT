// public/vad-processor.js
// AudioWorkletProcessor for non-blocking VAD (Voice Activity Detection).
// This runs off the main thread, ensuring barge-in works even in background tabs.
//
// Phase 7.2 — upgraded from RMS-only to a statistical VAD tier:
//   1. Noise-floor estimation (calibration window, then slow EMA)
//   2. Per-frame speech probability (SNR-based sigmoid, see src/audioRuntime/vadMath.ts)
//   3. Continuous-silence timer (real silence, not fixed timers)
//   4. Barge-in triggers on sustained high speech probability (RMS sanity clamp)
//
// Messages out:
//   PCM_DATA         { pcm, probability, noiseFloor, silenceMs, rms }   (every 2048 samples)
//   BARGE_IN_DETECTED { rms, probability }                               (sustained speech)
// Messages in:
//   SET_STATE        { isListening, isSpeaking, isGracePeriod }          (main-thread sync)

class VadProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 2048;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;

    // Legacy RMS configuration — kept as the final sanity clamp.
    this.baseThreshold = 0.04;
    this.bargeInThreshold = 0.15;
    this.currentThreshold = this.baseThreshold;

    this.sustainedFramesRequired = 15;
    this.loudFrameCount = 0;

    this.isListening = false;
    this.isSpeaking = false;
    this.isGracePeriod = false;

    // ── Phase 7.2: statistical VAD state ──
    this.noiseFloor = 0.02;
    this.calibrationFrames = 0;
    this.CALIBRATION_LIMIT = 200; // ~1.6s of 8ms render quanta
    this.NOISE_EMA_ALPHA = 0.005;
    this.PROB_SPEECH_ON = 0.6;
    this.PROB_SPEECH_OFF = 0.3;
    this.PROB_BARGE_IN = 0.9;
    this.SILENCE_PROB = 0.3;
    this.sampleRate_ = sampleRate || 16000;

    // Silence tracking (in render-quantum counts, converted to ms on post)
    this.silenceQuanta = 0;
    this.lastSpeechQuantum = 0;
    this.quantumCount = 0;
    this.silenceMs = 0;
    this.frameProb = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg.type === 'SET_STATE') {
        this.isListening = msg.isListening;
        this.isSpeaking = msg.isSpeaking;
        this.isGracePeriod = msg.isGracePeriod;
        this.currentThreshold = msg.isSpeaking ? this.bargeInThreshold : this.baseThreshold;
        if (!msg.isListening && !msg.isSpeaking) {
          this.loudFrameCount = 0;
        }
      }
    };
  }

  // Inline copy of src/audioRuntime/vadMath.ts (worklets cannot import).
  _speechProbability(rms) {
    const snr = 20 * Math.log10(Math.max(rms, 1e-6) / Math.max(this.noiseFloor, 1e-6));
    return 1 / (1 + Math.exp(-0.5 * (snr - 6)));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;

    const channelData = input[0];

    // RMS over this render quantum
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) {
      sum += channelData[i] * channelData[i];
    }
    const rms = Math.sqrt(sum / channelData.length);

    // ── Phase 7.2: noise-floor estimation ──
    if (this.calibrationFrames < this.CALIBRATION_LIMIT) {
      this.noiseFloor = (this.noiseFloor * this.calibrationFrames + rms) / (this.calibrationFrames + 1);
      this.calibrationFrames++;
    } else {
      this.noiseFloor = this.noiseFloor * (1 - this.NOISE_EMA_ALPHA) + rms * this.NOISE_EMA_ALPHA;
    }

    // ── Phase 7.2: per-frame speech probability ──
    this.frameProb = this._speechProbability(rms);

    // ── Phase 7.2: continuous-silence timer ──
    this.quantumCount++;
    if (this.frameProb < this.SILENCE_PROB) {
      this.silenceQuanta++;
      this.silenceMs = (this.silenceQuanta * channelData.length * 1000) / this.sampleRate_;
    } else {
      this.silenceQuanta = 0;
      this.silenceMs = 0;
      this.lastSpeechQuantum = this.quantumCount;
    }

    // Push data to PCM buffer to send to main thread if recording
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferIndex++] = channelData[i];
      if (this.bufferIndex >= this.bufferSize) {
        // Send PCM chunk + perception snapshot to main thread
        this.port.postMessage({
          type: 'PCM_DATA',
          pcm: this.buffer.slice(), // copy
          probability: this.frameProb,
          noiseFloor: this.noiseFloor,
          silenceMs: this.silenceMs,
          rms: rms,
        });
        this.bufferIndex = 0;
      }
    }

    // ── Barge-In Logic (speech probability, RMS sanity clamp) ──
    if (!this.isListening && !this.isSpeaking) return true;
    if (this.isGracePeriod) {
      this.loudFrameCount = 0;
      return true;
    }

    const rmsClamp = this.isSpeaking
      ? Math.max(this.bargeInThreshold, this.noiseFloor * 4)
      : Math.max(this.baseThreshold, this.noiseFloor * 3);

    if (this.frameProb >= this.PROB_BARGE_IN && rms > rmsClamp) {
      this.loudFrameCount++;
      if (this.loudFrameCount >= this.sustainedFramesRequired) {
        // Fire interrupt!
        this.port.postMessage({ type: 'BARGE_IN_DETECTED', rms, probability: this.frameProb });
        this.loudFrameCount = 0; // reset to avoid spam
      }
    } else {
      this.loudFrameCount = 0;
    }

    return true; // Keep processor alive
  }
}

registerProcessor('vad-processor', VadProcessor);
