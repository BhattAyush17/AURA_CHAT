#!/bin/bash
# Robust feed relink: finds current port ids and links speechfeed -> Chrome input.
set -u
cd "$(dirname "$0")/../.."

ports=$(env -u LD_LIBRARY_PATH pw-dump 2>/dev/null | python3 -c "
import json,sys
data=json.load(sys.stdin)
names={o['id']:o.get('info',{}).get('props',{}).get('node.name','?') for o in data if o.get('type')=='PipeWire:Interface:Node'}
out={}
for o in data:
    if o.get('type')=='PipeWire:Interface:Port':
        props=o.get('info',{}).get('props',{})
        nid=props.get('node.id'); nm=names.get(nid,'?')
        pn=str(props.get('port.name',''))
        if nm.endswith('output.speechfeed') and pn=='output_FL': out['feed_out']=o['id']
        if nm=='Google Chrome input' and pn=='input_FL': out['chrome_in']=o['id']
print(out.get('feed_out',''), out.get('chrome_in',''))
")
read feed_out chrome_in <<< "$ports"
echo "feed_out=$feed_out chrome_in=$chrome_in"
if [ -z "$feed_out" ] || [ -z "$chrome_in" ]; then
  echo "FAIL: missing ports"
  exit 1
fi
exists=$(env -u LD_LIBRARY_PATH pw-link -l 2>/dev/null | grep -A1 "output.speechfeed:output_FL" | grep -c "Chrome input")
if [ "$exists" -gt 0 ]; then
  echo "link already present"
else
  env -u LD_LIBRARY_PATH pw-link "$feed_out" "$chrome_in" 2>&1 | grep -v flatpak
  echo "linked $feed_out -> $chrome_in"
fi
