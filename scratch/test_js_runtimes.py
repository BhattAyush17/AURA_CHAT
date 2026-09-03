import yt_dlp

ydl_opts = {
    'js_runtimes': {'node': {}},
    'quiet': True,
    'extract_flat': True
}

try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        print("Success! yt-dlp accepted js_runtimes format.")
except Exception as e:
    print(f"Error: {e}")
