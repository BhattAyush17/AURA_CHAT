import urllib.request
import json
import time

url = "https://aura-chat-ml.onrender.com/api/ytmusic/diagnostic"

print("Polling Render deployment...")
for i in range(30):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode())
            if "track_results" in data:
                print("\n=== DIAGNOSTIC RESULTS ===")
                print(json.dumps(data, indent=2))
                exit(0)
            else:
                print("Old endpoint returned, waiting...")
    except Exception as e:
        print(f"Error: {e}, waiting...")
    time.sleep(10)
print("Timeout waiting for deployment.")
