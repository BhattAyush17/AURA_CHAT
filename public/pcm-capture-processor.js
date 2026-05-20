class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.BUFFER_SIZE = 1024;
    this.noiseFloor = 0.02;
    this.calibrationFrames = 0;
    this.CALIBRATION_LIMIT = 200; // tuned for Hindi phonology
    this.GATE_MULTIPLIER = 1.8; // lowered for Hindi speech patterns
  }

  process(inputs) {
    const input = inputs[0][0];
    if (!input) return true;

    // Calculate RMS energy
    let sum = 0;
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * input[i];
    }
    const rms = Math.sqrt(sum / input.length);

    // Calibration phase — learn noise floor in first 3 seconds
    if (this.calibrationFrames < this.CALIBRATION_LIMIT) {
      this.noiseFloor =
        (this.noiseFloor * this.calibrationFrames + rms) / (this.calibrationFrames + 1);
      this.calibrationFrames++;
      return true;
    }

    // Slowly adapt noise floor to changing environment
    this.noiseFloor = this.noiseFloor * 0.995 + rms * 0.005;

    // Gate — skip chunk if below threshold
    const threshold = this.noiseFloor * this.GATE_MULTIPLIER;
    if (rms < threshold) return true;

    // Buffer the input
    for (let i = 0; i < input.length; i++) {
      this.buffer.push(input[i]);
    }

    // Send when buffer reaches target size
    if (this.buffer.length >= this.BUFFER_SIZE) {
      const chunk = new Float32Array(this.buffer.splice(0, this.BUFFER_SIZE));
      this.port.postMessage({ pcmData: chunk.buffer, rms: rms }, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
