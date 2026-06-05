import { useState, useEffect } from 'react';

export type ExperienceMode = "A" | "B" | "C" | "D";

export interface ExperienceMetrics {
  deviceCapabilityScore: number;
  networkHealthScore: number;
  experienceHealthScore: number;
  mode: ExperienceMode;
}

export function useExperienceHealth(): ExperienceMetrics {
  const [metrics, setMetrics] = useState<ExperienceMetrics>({
    deviceCapabilityScore: 100,
    networkHealthScore: 100,
    experienceHealthScore: 100,
    mode: "A"
  });

  useEffect(() => {
    let deviceScore = 80;
    if (typeof navigator !== 'undefined') {
      const cores = navigator.hardwareConcurrency || 4;
      const mem = (navigator as any).deviceMemory || 4;
      
      if (cores >= 8 && mem >= 8) deviceScore = 100;
      else if (cores >= 4 && mem >= 4) deviceScore = 75;
      else deviceScore = 40;

      if (/Android [4-7]/.test(navigator.userAgent) || /iPhone OS [8-11]/.test(navigator.userAgent)) {
        deviceScore -= 20;
      }
    }

    let lastTime = performance.now();
    let frameCount = 0;
    let frameScore = 100;
    
    const checkFrames = () => {
      const now = performance.now();
      frameCount++;
      if (now - lastTime >= 1000) {
        const fps = frameCount;
        if (fps < 30) frameScore = 50;
        else if (fps < 45) frameScore = 75;
        else frameScore = 100;
        
        frameCount = 0;
        lastTime = now;
        
        updateMetrics();
      }
      requestAnimationFrame(checkFrames);
    };
    const reqId = requestAnimationFrame(checkFrames);

    let netScore = 100;
    const conn = (navigator as any).connection;

    const updateMetrics = () => {
      const deviceCapabilityScore = (deviceScore * 0.7) + (frameScore * 0.3);
      const networkHealthScore = netScore;
      
      const experienceHealthScore = Math.min(100, Math.max(0, (deviceCapabilityScore * 0.4) + (networkHealthScore * 0.6)));

      let mode: ExperienceMode = "A";
      if (experienceHealthScore > 80) mode = "A";
      else if (experienceHealthScore >= 50) mode = "B";
      else if (experienceHealthScore >= 25) mode = "C";
      else mode = "D";

      setMetrics({
        deviceCapabilityScore,
        networkHealthScore,
        experienceHealthScore,
        mode
      });
    };

    updateMetrics();
    
    const interval = setInterval(() => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            netScore = 10;
            updateMetrics();
        } else {
            netScore = 100;
            if (conn) {
              if (conn.rtt > 300) netScore -= 20;
              if (conn.downlink < 1.5) netScore -= 20;
              if (conn.effectiveType === '2g' || conn.effectiveType === '3g') netScore -= 30;
            }
            updateMetrics();
        }
    }, 5000);

    return () => {
        cancelAnimationFrame(reqId);
        clearInterval(interval);
    };
  }, []);

  return metrics;
}
