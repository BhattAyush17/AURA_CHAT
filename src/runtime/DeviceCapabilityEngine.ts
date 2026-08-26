export enum CapabilityScore {
  HIGH = "HIGH",
  MEDIUM = "MEDIUM",
  LOW = "LOW"
}

export class DeviceCapabilityEngine {
  public evaluateCapabilities(): CapabilityScore {
    if (typeof window === "undefined") return CapabilityScore.HIGH;

    const cores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as any).deviceMemory || 4; 
    
    if (cores >= 8 && memory >= 8) return CapabilityScore.HIGH;
    if (cores <= 4 || memory <= 4) return CapabilityScore.LOW;
    
    return CapabilityScore.MEDIUM;
  }

  public getReliabilityScore(): number {
    if (typeof window === "undefined") return 100;
    
    let score = 100;
    const cores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as any).deviceMemory || 4;
    
    if (cores <= 4) score -= 20;
    if (memory <= 4) score -= 20;

    return Math.max(0, score);
  }
}
