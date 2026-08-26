/**
 * AudioWorkletProcessor for capturing PCM data.
 * Features an adaptive noise gate and efficient memory management.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    
    // Configuration via processorOptions, with sensible defaults
    this.bufferSize = options?.processorOptions?.bufferSize || 1024;
    this.calibrationLimit = options?.processorOptions?.calibrationLimit || 200; // Tuned for Hindi phonology
    this.gateMultiplier = options?.processorOptions?.gateMultiplier || 1.8;     // Lowered for Hindi speech patterns
    this.noiseFloorAlpha = options?.processorOptions?.noiseFloorAlpha || 0.005;

    // State
    this.noiseFloor = 0.02;
    this.calibrationFrames = 0;
    
    // Efficient memory management: Pre-allocate typed array to avoid garbage collection
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferOffset = 0;
  }

  /**
   * Calculates the Root Mean Square (RMS) energy of the audio chunk.
   * @param {Float32Array} channelData 
   * @returns {number}
   */
  calculateRMS(channelData) {
    let sum = 0;
    for (let i = 0; i < channelData.length; i++) {
      sum += channelData[i] * channelData[i];
    }
    return Math.sqrt(sum / channelData.length);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    const rms = this.calculateRMS(channelData);

    // Calibration phase — learn noise floor in the initial frames
    if (this.calibrationFrames < this.calibrationLimit) {
      this.noiseFloor = (this.noiseFloor * this.calibrationFrames + rms) / (this.calibrationFrames + 1);
      this.calibrationFrames++;
      return true;
    }

    // Slowly adapt noise floor to changing environment
    this.noiseFloor = this.noiseFloor * (1 - this.noiseFloorAlpha) + rms * this.noiseFloorAlpha;

    // Gate — skip chunk if below threshold
    const threshold = this.noiseFloor * this.gateMultiplier;
    if (rms < threshold) return true;

    // Buffer the input sequentially
    for (let i = 0; i < channelData.length; i++) {
      this.buffer[this.bufferOffset++] = channelData[i];

      // Send chunk when buffer reaches target size
      if (this.bufferOffset >= this.bufferSize) {
        // Create a copy of the buffer to transfer ownership
        const chunk = new Float32Array(this.buffer);
        
        this.port.postMessage(
          { pcmData: chunk.buffer, rms: rms }, 
          [chunk.buffer]
        );
        
        this.bufferOffset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm-capture-processor", PcmCaptureProcessor);
