// src/audioRuntime/decodeWorker.ts

self.onmessage = function(e) {
  const base64 = e.data;
  
  if (!base64 || typeof base64 !== "string") {
    (self as any).postMessage({ error: "Invalid payload" });
    return;
  }
  
  try {
    const start = performance.now();
    
    // 1. Base64 to Binary String
    const binaryStr = atob(base64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    
    // 2. Binary to Uint8Array
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    
    // 3. Uint8Array to Int16Array
    const int16Array = new Int16Array(bytes.buffer);
    
    // 4. Int16Array to Float32Array (Normalization)
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    
    const latency = performance.now() - start;
    
    // Transfer the ArrayBuffer ownership back to the main thread
    (self as any).postMessage(
      { pcmData: float32Array, latency }, 
      [float32Array.buffer]
    );
  } catch (err: any) {
    (self as any).postMessage({ error: err.message || "Decode failed" });
  }
};
