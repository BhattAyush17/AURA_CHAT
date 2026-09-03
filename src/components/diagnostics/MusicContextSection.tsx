/**
 * MusicContextSection — observability for the music context block that
 * gets appended to the live system instruction. Surfaces only the size of
 * the last block and an ESTIMATED token count; never the block content
 * itself, since the music context is shaped by potentially-sensitive user
 * state.
 */

import { useEffect, useState } from "react";
import { Music } from "lucide-react";
import { DiagnosticSection } from "./DiagnosticSection";
import { auraTelemetry, type MusicContextScore, type TelemetrySnapshot } from "@/telemetry";

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function MusicContextSection() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot>(auraTelemetry.getSnapshot());
  useEffect(() => auraTelemetry.subscribe(setSnapshot), []);

  const music: MusicContextScore | null = snapshot.music;
  const lastBuilt = music?.lastBuiltAt;

  return (
    <DiagnosticSection
      title="Music Context"
      icon={Music}
      badge={music ? (music.musicAvailable ? "active" : "no block") : "not built"}
    >
      <div className="space-y-2 font-mono text-xs">
        {music ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground block">
                  Context chars
                </span>
                <span className="text-sm font-bold text-foreground">
                  {music.contextChars.toLocaleString()}
                </span>
              </div>
              <div className="rounded-xl border border-border/30 bg-background/40 p-2.5">
                <span className="text-[9px] uppercase tracking-widest text-muted-foreground block">
                  Estimated tokens
                </span>
                <span className="text-sm font-bold text-foreground">{music.estimatedTokens}</span>
                <span className="text-[9px] text-amber-400/80 ml-1">est.</span>
              </div>
            </div>

            <div className="rounded-xl border border-border/30 bg-background/40 p-3 text-[10px] text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Last built</span>
                <span className="text-foreground">{lastBuilt ? timeAgo(lastBuilt) : "—"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Music available</span>
                <span
                  className={music.musicAvailable ? "text-emerald-400" : "text-muted-foreground"}
                >
                  {music.musicAvailable ? "yes" : "no"}
                </span>
              </div>
            </div>

            <p className="text-[9px] text-amber-400/80">
              Token count is an estimate (~4 chars / token). Music context itself is never sent to
              the diagnostics panel — only its size.
            </p>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground font-mono">
            No music context has been built this session yet. Start a voice session to attach a
            music block to the system prompt.
          </p>
        )}
      </div>
    </DiagnosticSection>
  );
}
