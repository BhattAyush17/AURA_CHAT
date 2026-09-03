import yt_dlp
import sys
import json

ydl_opts = {
    'format': 'bestaudio/best',
    'noplaylist': True,
    'default_search': 'ytsearch',
    'extract_flat': False,
    'quiet': True,
    'extractor_args': {'youtube': ['player_client=ios,android,web_creator']},
    'js_runtimes': {'node': {}}
}

try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info("ytsearch1:Counting Stars OneRepublic", download=False)
        
        if 'entries' in info and len(info['entries']) > 0:
            entry = info['entries'][0]
            print(f"Title: {entry.get('title')}")
            print(f"URL: {entry.get('url')[:50]}...")
            print("Extraction successful.")
        else:
            print("No entries found.")
except Exception as e:
    print(f"Error: {e}")
