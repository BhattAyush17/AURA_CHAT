export class ProviderSupervisor {
  private failures: Record<string, number> = {};
  private lastFailureTime: Record<string, number> = {};
  
  private CIRCUIT_BREAKER_THRESHOLD = 3;
  private CIRCUIT_BREAKER_TIMEOUT = 30000; // 30 seconds

  public reportFailure(providerId: string, latencyMs?: number) {
    this.failures[providerId] = (this.failures[providerId] || 0) + 1;
    this.lastFailureTime[providerId] = Date.now();
    console.warn(`[ProviderSupervisor] ${providerId} failed. Consecutive failures: ${this.failures[providerId]}`);
  }

  public reportSuccess(providerId: string, latencyMs: number) {
    if (this.failures[providerId] > 0) {
      console.log(`[ProviderSupervisor] ${providerId} recovered.`);
    }
    this.failures[providerId] = 0;
  }

  public isCircuitBroken(providerId: string): boolean {
    const fails = this.failures[providerId] || 0;
    const lastFail = this.lastFailureTime[providerId] || 0;
    
    if (fails >= this.CIRCUIT_BREAKER_THRESHOLD) {
      const timeSinceFail = Date.now() - lastFail;
      if (timeSinceFail < this.CIRCUIT_BREAKER_TIMEOUT) {
        return true; // Circuit is open (broken)
      } else {
        // Half-open: we will allow one attempt, but if it fails, circuit opens immediately again.
        this.failures[providerId] = this.CIRCUIT_BREAKER_THRESHOLD - 1; 
      }
    }
    return false;
  }

  public getProviderHealthScore(providerId: string): number {
    if (this.isCircuitBroken(providerId)) return 0;
    const fails = this.failures[providerId] || 0;
    return Math.max(0, 100 - (fails * 33));
  }
}
