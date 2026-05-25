import { useRef, useCallback, useState } from "react";

export interface AcousticProfile {
  energy: "whisper" | "low" | "normal" | "elevated" | "high";
  pace: "slow" | "normal" | "fast";
  delivery: "hesitant" | "trailing" | "staccato" | "assertive" | "neutral";
  mood: "sad or withdrawn" | "calm and reflective" | "neutral and composed" | "energized and confident" | "excited or agitated" | "frustrated or urgent";
}

export function useVoiceAcoustics() {
  const speechStartTimeRef = useRef<number>(0);
  const totalRmsRef = useRef<number>(0);
  const rmsSamplesRef = useRef<number>(0);
  const animationFrameRef = useRef<number>(0);

  const [liveStats, setLiveStats] = useState({ tone: "Normal", intent: "Listening" });
  
  const startTracking = useCallback((analyser: AnalyserNode | null) => {
    if (!analyser) return;
    speechStartTimeRef.current = Date.now();
    totalRmsRef.current = 0;
    rmsSamplesRef.current = 0;

    const buf = new Float32Array(analyser.fftSize);
    
    // Throttling for UI updates to avoid 60fps React re-renders
    let lastUiUpdate = Date.now();

    const track = () => {
      analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      
      // Only record samples where there is actual sound (above noise floor)
      if (rms > 0.002) {
        totalRmsRef.current += rms;
        rmsSamplesRef.current++;
        
        // Update UI every 500ms
        const now = Date.now();
        if (now - lastUiUpdate > 500) {
          const avgRms = totalRmsRef.current / rmsSamplesRef.current;
          let tone = "Normal";
          if (avgRms < 0.02) tone = "Whispering";
          else if (avgRms < 0.05) tone = "Low";
          else if (avgRms > 0.25) tone = "High / Loud";
          else if (avgRms > 0.15) tone = "Elevated";
          
          setLiveStats((prev: { tone: string; intent: string }) => ({ ...prev, tone }));
          lastUiUpdate = now;
        }
      }
      
      animationFrameRef.current = requestAnimationFrame(track);
    };
    track();
  }, []);

  const stopTrackingAndAnalyze = useCallback((text: string): string => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const durationSeconds = (Date.now() - speechStartTimeRef.current) / 1000;
    const wordCount = text.trim().split(/\s+/).length;
    const wpm = (wordCount / durationSeconds) * 60;
    
    const averageRms = rmsSamplesRef.current > 0 ? totalRmsRef.current / rmsSamplesRef.current : 0;

    // 1. Determine Energy (RMS ranges are approximate, depends on mic gain)
    let energy = "normal";
    if (averageRms < 0.02) energy = "whisper";
    else if (averageRms < 0.05) energy = "low";
    else if (averageRms > 0.25) energy = "high";
    else if (averageRms > 0.15) energy = "elevated";

    // 2. Determine Pace (Words Per Minute)
    let pace = "normal";
    if (wpm < 100) pace = "slow";
    else if (wpm > 160) pace = "fast";

    // 3. Determine Delivery (Textual Heuristics)
    let delivery = "neutral";
    const lowerText = text.toLowerCase();
    
    if (lowerText.match(/\b(um|uh|like|i guess|maybe|not sure)\b/)) delivery = "hesitant";
    else if (text.endsWith("...") || (!text.match(/[.!?]$/) && durationSeconds > 3)) delivery = "trailing";
    else if (wpm > 180 && durationSeconds < 2) delivery = "staccato";
    else if (text.match(/[!]$/)) delivery = "assertive";

    // 4. Derive Mood
    let mood = "neutral and composed";
    if (energy === "whisper" || energy === "low") {
      mood = pace === "slow" ? "sad or withdrawn" : "calm and reflective";
    } else if (energy === "high" || energy === "elevated") {
      mood = pace === "fast" ? "excited or agitated" : "energized and confident";
    }
    
    // Check for explicit frustration
    if (lowerText.match(/\b(fuck|damn|shit|annoying|stupid|wrong|no)\b/)) {
      mood = "frustrated or urgent";
    }

    setLiveStats({ tone: energy.charAt(0).toUpperCase() + energy.slice(1), intent: mood });

    // Build the XML Tag
    return `<audio_context>\n  <energy>${energy} (rms: ${averageRms.toFixed(3)})</energy>\n  <pace>${pace} (${Math.round(wpm)} wpm)</pace>\n  <delivery>${delivery}</delivery>\n  <mood>${mood}</mood>\n</audio_context>\n`;
  }, []);

  return { startTracking, stopTrackingAndAnalyze, liveStats };
}
