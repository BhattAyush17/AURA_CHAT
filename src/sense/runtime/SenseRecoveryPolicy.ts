/**
 * Sense Recovery Policy
 * Implements bounded exponential backoff for recovering degraded or failed senses.
 */

export class SenseRecoveryPolicy {
  private readonly BASE_DELAY = 1000; // 1 second
  private readonly MAX_DELAY = 60000; // 1 minute
  private readonly MAX_ATTEMPTS = 5;

  getDelay(attempts: number): number {
    if (attempts >= this.MAX_ATTEMPTS) return -1; // -1 indicates terminal failure
    
    // Exponential backoff with jitter
    const delay = Math.min(this.MAX_DELAY, this.BASE_DELAY * Math.pow(2, attempts));
    const jitter = delay * 0.1 * Math.random();
    
    return delay + jitter;
  }

  shouldRetry(attempts: number): boolean {
    return attempts < this.MAX_ATTEMPTS;
  }
}

export const senseRecoveryPolicy = new SenseRecoveryPolicy();
