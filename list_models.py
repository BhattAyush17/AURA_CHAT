import os
from google import genai
from dotenv import load_dotenv

load_dotenv(".env.local")
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))

try:
    print("Available models:")
    for m in client.models.list():
        print(f" - {m.name}")
except Exception as e:
    print(f"Error listing models: {e}")

