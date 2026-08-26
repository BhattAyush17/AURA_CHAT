// src/audioRuntime/AudioBufferPool.ts

export class BufferLease {
  public data: Float32Array;
  public isActive: boolean;
  private releaseCallback: (lease: BufferLease) => void;

  constructor(size: number, releaseCallback: (lease: BufferLease) => void) {
    this.data = new Float32Array(size);
    this.isActive = false;
    this.releaseCallback = releaseCallback;
  }

  public release() {
    if (this.isActive) {
      this.isActive = false;
      this.releaseCallback(this);
    }
  }
}

export class AudioBufferPool {
  private static instance: AudioBufferPool;
  private pool: BufferLease[] = [];
  private poolSize: number;
  private bufferSize: number;
  
  public allocationCount: number = 0;
  public reuseCount: number = 0;
  public exhaustionCount: number = 0;

  private constructor(poolSize: number = 50, bufferSize: number = 2048) {
    this.poolSize = poolSize;
    this.bufferSize = bufferSize;
    this.initializePool();
  }

  public static getInstance(): AudioBufferPool {
    if (!AudioBufferPool.instance) {
      AudioBufferPool.instance = new AudioBufferPool();
    }
    return AudioBufferPool.instance;
  }

  private initializePool() {
    for (let i = 0; i < this.poolSize; i++) {
      this.pool.push(new BufferLease(this.bufferSize, this.releaseBuffer.bind(this)));
      this.allocationCount++;
    }
  }

  public acquire(sourceData: Float32Array): BufferLease {
    // Try to find an inactive lease
    let lease = this.pool.find(l => !l.isActive);
    
    if (lease) {
      this.reuseCount++;
    } else {
      // Pool exhausted
      this.exhaustionCount++;
      lease = new BufferLease(this.bufferSize, this.releaseBuffer.bind(this));
      this.pool.push(lease);
      this.allocationCount++;
    }

    lease.isActive = true;
    
    // Copy data into the leased buffer
    if (sourceData.length === this.bufferSize) {
      lease.data.set(sourceData);
    } else if (sourceData.length < this.bufferSize) {
      lease.data.set(sourceData);
      lease.data.fill(0, sourceData.length);
    } else {
      lease.data.set(sourceData.subarray(0, this.bufferSize));
    }

    return lease;
  }

  private releaseBuffer(lease: BufferLease) {
    // No-op, just wait for the next acquire to find isActive === false
  }
  
  public getMetrics() {
    return {
      poolSize: this.pool.length,
      allocationCount: this.allocationCount,
      reuseCount: this.reuseCount,
      exhaustionCount: this.exhaustionCount,
      activeCount: this.pool.filter(l => l.isActive).length
    };
  }
}
