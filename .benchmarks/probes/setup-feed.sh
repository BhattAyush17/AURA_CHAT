#!/bin/bash
# Persistent speech feed setup for AURA browser tests.
# Usage: bash .benchmarks/probes/setup-feed.sh [start|stop|status]
set -u
cd "$(dirname "$0")/../.."

WAV=".benchmarks/aura-speech-loop.wav"
STARTED=0

status() {
  echo "--- feed status ---"
  pgrep -af "paplay.*aura-speech" | head -2
  pw-cli list-objects 2>/dev/null | grep -iE "speechfeed|loopback" | head -4
  wpctl get-volume 52 2>/dev/null
}

build_wav() {
  if [ -f "$WAV" ]; then return; fi
  local out=".benchmarks/loop-tmp"
  rm -rf "$out"; mkdir -p "$out"
  local phrases=(
    "hey what do you think can you play some thing about me"
    "it is a robotic voice that sounds great tell me about it"
    "what is the weather today and should I carry an umbrella"
    "can you tell me a story about a robot who learned to sing"
    "I am feeling a bit tired today what should I do"
    "play some calm music in the background please"
    "tell me an interesting fact about deep space"
  )
  local i=0
  for p in "${phrases[@]}"; do
    espeak-ng -v en-us -s 155 -p 55 -a 160 "$p" -w "$out/s$i.wav" 2>/dev/null
    i=$((i+1))
  done
  # concat with 2.5-3.5s gaps
  local args=()
  for f in "$out"/s*.wav; do args+=("$f"); done
  sox ${args[@]} "$WAV" 2>/dev/null || {
    python3 - <<PY
import wave, struct, subprocess, glob, random
phrases_wavs = sorted(glob.glob("$out/s*.wav"))
frames = []
for w in phrases_wavs:
    with wave.open(w) as f:
        frames.append(f.readframes(f.getnframes()))
    frames.append(b"\x00" * int(16000 * random.uniform(2.5, 3.5)))
out = wave.open("$WAV", "wb")
out.setnchannels(1); out.setsampwidth(2); out.setframerate(16000)
out.writeframes(b"".join(frames)); out.close()
PY
  }
  rm -rf "$out"
  echo "wav built: $(du -h "$WAV" | cut -f1)"
}

start() {
  build_wav
  # loopback: speechfeed -> mic capture
  pw-loopback -n speechfeed --capture-props='{ node.name = "speechfeed" }' \
    --playback-props='{ media.class = "Audio/Sink", node.name = "speechfeed-sink" }' \
    --target=$(pw-cli list-objects 2>/dev/null | grep -oE 'node\.name = "alsa_input\.[^"]*"' | head -1 | cut -d'"' -f2) \
    >/dev/null 2>&1 &
  sleep 2
  setsid paplay --device=speechfeed --loop "$WAV" </dev/null >/dev/null 2>&1 &
  sleep 1
  # capture gains (they reset on device reloads)
  amixer -c 1 sset 'Internal Mic Boost' 0 >/dev/null 2>&1
  amixer -c 1 sset 'Capture' 45 >/dev/null 2>&1
  wpctl set-volume 52 1.0
  echo "feed started"
  status
}

stop() {
  pkill -f "paplay.*aura-speech" 2>/dev/null
  pw-cli destroy $(pw-cli list-objects 2>/dev/null | grep -B2 "speechfeed" | grep -oE 'id [0-9]+' | head -1 | cut -d' ' -f2) 2>/dev/null
  echo "feed stopped"
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
esac
