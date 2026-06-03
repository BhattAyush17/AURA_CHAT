import sys
try:
    from ytmusicapi import YTMusic
except ImportError:
    print("ytmusicapi not installed")
    sys.exit(1)

import json

yt = YTMusic()
query = "Counting Stars"
print(f"Searching for: {query}")
results = yt.search(query, filter="songs")

if results:
    first = results[0]
    output = {
        "videoId": first.get("videoId"),
        "title": first.get("title"),
        "artist": first.get("artists", [{}])[0].get("name") if first.get("artists") else "Unknown",
        "duration": first.get("duration")
    }
    print("SUCCESS: Found track.")
    print(json.dumps(output, indent=2))
else:
    print("FAILURE: No track found.")
