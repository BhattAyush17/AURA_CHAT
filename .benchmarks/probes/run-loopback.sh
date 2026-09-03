#!/bin/bash
env -u LD_LIBRARY_PATH pw-loopback -n speechfeed -c 1 \
  --capture-props='{ media.class = "Audio/Sink" node.name = "speechfeed" }'
