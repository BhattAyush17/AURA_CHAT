// src/runtime/optimization/AnalyzeRequestCoordinator.ts
import { BehaviorAnalysis } from "@/lib/behavior-client";

export class AnalyzeRequestCoordinator {
  private static instance: AnalyzeRequestCoordinator;

  private activeRequestId: string | null = null;
  private activeTranscript: string = "";
  private resolvePromise: ((value: BehaviorAnalysis | null) => void) | null = null;
  private activePromise: Promise<BehaviorAnalysis | null> | null = null;

  public metrics = {
    hitRate: 0,
    missRate: 0,
    cancellationRate: 0,
    duplicatePrevention: 0,
  };

  private constructor() {}

  public static getInstance(): AnalyzeRequestCoordinator {
    if (!AnalyzeRequestCoordinator.instance) {
      AnalyzeRequestCoordinator.instance = new AnalyzeRequestCoordinator();
    }
    return AnalyzeRequestCoordinator.instance;
  }

  /**
   * Dispatches a speculative request. Returns a promise that resolves
   * when the network completes.
   */
  public dispatchSpeculative(transcript: string, fetcher: () => Promise<BehaviorAnalysis>): Promise<BehaviorAnalysis | null> {
    if (this.activePromise && this.activeTranscript === transcript) {
      // Prevent duplicate
      this.metrics.duplicatePrevention++;
      return this.activePromise;
    }

    this.cancelObsolete();

    this.activeRequestId = Math.random().toString(36).substring(7);
    this.activeTranscript = transcript;
    
    this.activePromise = new Promise((resolve) => {
      this.resolvePromise = resolve;
      
      fetcher().then((result) => {
        if (this.resolvePromise === resolve) {
          this.resolvePromise(result);
          this.clearActive();
        }
      }).catch((err) => {
        if (this.resolvePromise === resolve) {
          this.resolvePromise(null);
          this.clearActive();
        }
      });
    });

    return this.activePromise;
  }

  /**
   * Finalizes the turn. If the transcript overlaps closely with the speculative request,
   * reuse the promise. Otherwise, dispatch a new one.
   */
  public getFinalAnalysis(finalTranscript: string, fetcher: () => Promise<BehaviorAnalysis>): Promise<BehaviorAnalysis | null> {
    if (this.activePromise && this.activeTranscript === finalTranscript) {
      this.metrics.hitRate++;
      return this.activePromise;
    }
    
    // Partial hit (simulate 70% threshold overlap)
    if (this.activePromise && finalTranscript.startsWith(this.activeTranscript) && (this.activeTranscript.length / finalTranscript.length) > 0.7) {
      this.metrics.hitRate++;
      return this.activePromise;
    }

    if (this.activePromise) {
      this.metrics.missRate++;
    }

    this.cancelObsolete();
    return fetcher();
  }

  private cancelObsolete() {
    if (this.activePromise && this.resolvePromise) {
      this.metrics.cancellationRate++;
      this.resolvePromise(null); // Resolve with null to abort
      this.clearActive();
    }
  }

  private clearActive() {
    this.activeRequestId = null;
    this.activeTranscript = "";
    this.resolvePromise = null;
    this.activePromise = null;
  }
}
