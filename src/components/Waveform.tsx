import { useEffect, useRef } from "react";

interface WaveformProps {
  active: boolean;
  getFrequencyData: () => Uint8Array;
  color: string;
  isVADActive?: boolean;
}

/**
 * Lightweight canvas waveform driven by the Gemini Live API analyser node.
 * Renders 32 vertical bars that respond to the live audio stream.
 */
export function Waveform({ active, getFrequencyData, color, isVADActive = false }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };
    resize();
    window.addEventListener("resize", resize);

    const BARS = 32;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      let data: Uint8Array | null = null;
      if (active && isVADActive) {
        try {
          data = getFrequencyData();
        } catch {
          data = null;
        }
      }

      const barWidth = w / BARS;
      const step = data ? Math.floor(data.length / BARS) : 0;

      // If VAD is active, highlight explicitly. Otherwise render low opacity
      // We will shift the color to a distinct "Voice Detected" color internally.
      const displayColor = isVADActive ? "#22c55e" : color; // green if active speech, passed color otherwise

      for (let i = 0; i < BARS; i++) {
        let value = 0.04; // idle resting level
        if (data && step > 0) {
          const sample = data[i * step] ?? 0;
          value = Math.max(0.04, sample / 255);
        }

        // The minimum resting level for visual styling
        const barH = value * h * 0.9;
        const x = i * barWidth + barWidth * 0.2;
        const y = (h - barH) / 2;

        ctx.fillStyle = displayColor;
        ctx.globalAlpha = isVADActive ? 0.6 + value * 0.4 : 0.2 + value * 0.2;

        ctx.beginPath();
        const radius = Math.min(barWidth * 0.3, 6 * dpr);
        const bw = barWidth * 0.6;
        // Rounded bar
        ctx.roundRect(x, y, bw, barH, radius);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      rafRef.current = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [active, getFrequencyData, color, isVADActive]);

  return (
    <div className="flex w-full max-w-md flex-col items-center">
      <canvas ref={canvasRef} className="h-12 w-full" aria-hidden="true" />
      {isVADActive && (
        <span className="mt-2 text-[9px] uppercase tracking-[0.2em] text-green-500/80">
          ● active voice detected
        </span>
      )}
      {!isVADActive && active && (
        <span className="mt-2 text-[9px] uppercase tracking-[0.2em] text-muted-foreground/30">
          no active voice
        </span>
      )}
    </div>
  );
}
