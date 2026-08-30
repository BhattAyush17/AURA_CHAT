import React, { useEffect, useState } from "react";
import { PlaybackStateData } from "../types";
import { playbackState } from "../PlaybackState";
import { musicEvents } from "../PlaybackEvents";
import { Waveform } from "@/components/Waveform";
import { AnimatePresence, motion } from "framer-motion";

export const MusicPlayer: React.FC = () => {
  const [state, setState] = useState<PlaybackStateData>(playbackState.getState());
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const unsubState = musicEvents.on("stateChanged", (newState: PlaybackStateData) =>
      setState(newState),
    );
    const unsubTrack = musicEvents.on("trackChanged", (t) => {
      setState((s) => ({ ...s, currentTrack: t }));
      // Auto expand on track change, then collapse
      setExpanded(true);
      setTimeout(() => setExpanded(false), 5000);
    });
    return () => {
      unsubState();
      unsubTrack();
    };
  }, []);

  if (!state.currentTrack) return null;

  const { currentTrack, isPlaying } = state;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: isPlaying ? 1 : 0.4, y: 0 }}
        exit={{ opacity: 0 }}
        className="fixed bottom-6 left-6 flex items-center gap-3 z-50 cursor-pointer"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {!expanded ? (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-white/50 hover:text-white/80 transition-colors">
            ♪
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-3"
          >
            <span className="text-[10px] uppercase tracking-widest text-white/80 font-medium">
              ♪ {currentTrack.title}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-white/30">
              — {currentTrack.artist}
            </span>

            {isPlaying && (
              <div className="h-4 w-12 opacity-50 ml-2 pointer-events-none">
                <Waveform
                  active={true}
                  color="#ffffff"
                  getFrequencyData={() => {
                    const arr = new Uint8Array(32);
                    for (let i = 0; i < 32; i++) arr[i] = 128 + Math.random() * 100;
                    return arr;
                  }}
                />
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
