import urllib.request
import json
import time
import sys

url = "https://aura-chat-ml.onrender.com/api/ytmusic/diagnostic"

print("Polling Render deployment for cookie diagnostic...")
for i in range(30):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if "yt_dlp_ejs_present" in data:
                print("\n=== FINAL DIAGNOSTIC RESULT ===")
                print(json.dumps(data, indent=2))
                sys.exit(0)
            else:
                print("Old endpoint returned, waiting...")
    except Exception as e:
        print(f"Error: {e}, waiting...")
    time.sleep(10)
print("Timeout waiting for deployment.")
