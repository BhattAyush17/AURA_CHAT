import { ExperienceHealthEngine } from "@/resilience/phase2/ExperienceHealthEngine";
import { RuntimePolicy } from "./RuntimePolicy";
import { DeviceCapabilityEngine, CapabilityScore } from "./DeviceCapabilityEngine";

export class AdaptiveExecutionEngine {
  private healthEngine = new ExperienceHealthEngine();
  private capabilityEngine = new DeviceCapabilityEngine();

  public determinePolicy(): RuntimePolicy {
    const confidence = this.healthEngine.getSnapshot().score;
    const cap = this.capabilityEngine.evaluateCapabilities();

    if (confidence > 85 && cap === CapabilityScore.HIGH) {
      return RuntimePolicy.FULL_QUALITY;
    }
    
    if (confidence < 40 || cap === CapabilityScore.LOW) {
      return RuntimePolicy.LOW_POWER; // Fallback to smaller buffers, faster execution
    }

    if (confidence < 70) {
      return RuntimePolicy.LOW_LATENCY;
    }

    return RuntimePolicy.NORMAL;
  }

  public getHealthEngine() {
    return this.healthEngine;
  }
}
