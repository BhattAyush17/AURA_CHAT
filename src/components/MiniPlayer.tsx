/**
 * AURA Music System — MiniPlayer Component
 * 
 * Persistent in-chat music player with:
 * - Track title + artist
 * - Progress bar (clickable)
 * - Play/Pause, Next, Previous buttons
 * - Volume slider
 * - Collapse/expand animation
 * 
 * Matches AURA's monochrome design system.
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  X,
  Volume2,
  VolumeX,
  ChevronUp,
  ChevronDown,
  Music,
  Repeat,
  Repeat1,
  Shuffle,
} from "lucide-react";
import { useMusicPlayer } from "@/music/useMusicPlayer";

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function MiniPlayer() {
  const {
    state,
    isActive,
    isPlaying,
    isPaused,
    currentTrack,
    position,
    duration,
    volume,
    togglePlayPause,
    stop,
    next,
    previous,
    seek,
    setVolume,
  } = useMusicPlayer();

  const [expanded, setExpanded] = useState(true);
  const [showVolume, setShowVolume] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);
  const [localPosition, setLocalPosition] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Sync position from state (unless user is dragging)
  useEffect(() => {
    if (!isDragging) {
      setLocalPosition(position);
    }
  }, [position, isDragging]);

  // Don't render if no music is active
  if (!isActive) return null;

  const progress = duration > 0 ? (localPosition / duration) * 100 : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const newPosition = ratio * duration;
    setLocalPosition(newPosition);
    seek(newPosition);
  };

  const handleProgressDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setLocalPosition(ratio * duration);
  };

  const handleDragEnd = () => {
    if (isDragging) {
      seek(localPosition);
      setIsDragging(false);
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        className="mini-player"
        id="aura-mini-player"
      >
        {/* ── Collapsed Bar ── */}
        {!expanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mini-player-collapsed"
            onClick={() => setExpanded(true)}
          >
            <div className="mini-player-collapsed-left">
              <div className="mini-player-now-playing-dot" />
              <div className="mini-player-collapsed-info">
                <span className="mini-player-title-sm">{currentTrack?.title || "Unknown"}</span>
                <span className="mini-player-artist-sm">{currentTrack?.artist || ""}</span>
              </div>
            </div>
            <div className="mini-player-collapsed-controls">
              <button
                onClick={(e) => { e.stopPropagation(); togglePlayPause(); }}
                className="mini-player-btn-sm"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              </button>
              <ChevronUp className="w-3.5 h-3.5 mini-player-chevron" />
            </div>
          </motion.div>
        )}

        {/* ── Expanded Player ── */}
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="mini-player-expanded"
          >
            {/* Header */}
            <div className="mini-player-header">
              <div className="mini-player-header-left">
                <Music className="w-3 h-3" strokeWidth={1.5} />
                <span className="mini-player-label">
                  {isPlaying ? "NOW PLAYING" : isPaused ? "PAUSED" : "MUSIC"}
                </span>
                {isPlaying && <div className="mini-player-now-playing-dot" />}
              </div>
              <div className="mini-player-header-actions">
                <button
                  onClick={() => setExpanded(false)}
                  className="mini-player-btn-ghost"
                  aria-label="Minimize player"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={stop}
                  className="mini-player-btn-ghost"
                  aria-label="Close player"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Track Info */}
            <div className="mini-player-track-info">
              {currentTrack?.thumbnail && (
                <div className="mini-player-thumbnail">
                  <img
                    src={currentTrack.thumbnail}
                    alt={currentTrack.title}
                    className="mini-player-thumbnail-img"
                  />
                  {isPlaying && (
                    <div className="mini-player-thumbnail-overlay">
                      <div className="mini-player-eq">
                        <span className="mini-player-eq-bar" style={{ animationDelay: "0ms" }} />
                        <span className="mini-player-eq-bar" style={{ animationDelay: "150ms" }} />
                        <span className="mini-player-eq-bar" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="mini-player-text">
                <span className="mini-player-title">{currentTrack?.title || "Unknown Track"}</span>
                <span className="mini-player-artist">{currentTrack?.artist || "Unknown Artist"}</span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mini-player-progress-container">
              <span className="mini-player-time">{formatTime(localPosition)}</span>
              <div
                ref={progressRef}
                className="mini-player-progress-track"
                onClick={handleProgressClick}
                onMouseDown={() => setIsDragging(true)}
                onMouseMove={handleProgressDrag}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
                role="slider"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={localPosition}
                aria-label="Playback progress"
              >
                <div
                  className="mini-player-progress-fill"
                  style={{ width: `${progress}%` }}
                />
                <div
                  className="mini-player-progress-handle"
                  style={{ left: `${progress}%` }}
                />
              </div>
              <span className="mini-player-time">{formatTime(duration)}</span>
            </div>

            {/* Controls */}
            <div className="mini-player-controls">
              <button
                onClick={previous}
                className="mini-player-btn"
                aria-label="Previous track"
              >
                <SkipBack className="w-4 h-4" fill="currentColor" />
              </button>
              <button
                onClick={togglePlayPause}
                className="mini-player-btn-primary"
                aria-label={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" fill="currentColor" />
                ) : (
                  <Play className="w-5 h-5" fill="currentColor" />
                )}
              </button>
              <button
                onClick={next}
                className="mini-player-btn"
                aria-label="Next track"
              >
                <SkipForward className="w-4 h-4" fill="currentColor" />
              </button>
            </div>

            {/* Volume */}
            <div className="mini-player-volume-row">
              <button
                onClick={() => setShowVolume((v) => !v)}
                className="mini-player-btn-ghost"
                aria-label="Toggle volume"
              >
                {volume === 0 ? (
                  <VolumeX className="w-3.5 h-3.5" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5" />
                )}
              </button>
              <AnimatePresence>
                {showVolume && (
                  <motion.div
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "100%" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="mini-player-volume-slider-container"
                  >
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(volume * 100)}
                      onChange={(e) => setVolume(Number(e.target.value) / 100)}
                      className="mini-player-volume-slider"
                      aria-label="Volume"
                    />
                    <span className="mini-player-volume-label">
                      {Math.round(volume * 100)}%
                    </span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
