import { RuntimePolicy } from "./RuntimePolicy";

/**
 * Adapts specific algorithms based on the active runtime policy.
 * (e.g. altering chunking aggressiveness)
 */
export class RuntimeAdapter {
  public static getChunkingStrategy(policy: RuntimePolicy) {
    switch (policy) {
      case RuntimePolicy.LOW_POWER:
      case RuntimePolicy.LOW_LATENCY:
        return "AGGRESSIVE"; // Smaller chunks, faster dispatch
      case RuntimePolicy.FULL_QUALITY:
      default:
        return "SENTENCE"; // Wait for full thought groups
    }
  }
}
