#!/bin/bash
while true; do
  env -u LD_LIBRARY_PATH pw-play --target=speechfeed /home/tensorttx/Projects/Personal/AURA_CHAT/AURA_CHAT/.benchmarks/aura-speech-loop.wav >/dev/null 2>&1
  sleep 0.3
done
