import os
import httpx
from dotenv import load_dotenv

load_dotenv()

if os.path.exists(".env.local"):
    with open(".env.local") as f:
        for line in f:
            if line.strip() and not line.startswith("#"):
                key, val = line.strip().split("=", 1)
                os.environ[key] = val.strip().strip('"').strip("'")

openrouter_key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("VITE_OPENROUTER_API_KEY")
print("OpenRouter Key starts with:", openrouter_key[:10] if openrouter_key else "None")

try:
    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {openrouter_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "google/gemma-2-9b-it:free",
            "messages": [{"role": "user", "content": "Hello"}],
        },
        timeout=10.0
    )
    print("Response status:", response.status_code)
    if response.status_code == 200:
        print("OpenRouter Key is VALID!")
        print("Response:", response.json()["choices"][0]["message"]["content"])
    else:
        print("Response error:", response.text)
except Exception as e:
    print("Error:", e)
