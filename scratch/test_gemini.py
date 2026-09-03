import os
from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

api_key = os.environ.get("VITE_GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY")
print("API Key starts with:", api_key[:10] if api_key else "None")

if not api_key:
    print("No Gemini API key found in .env")
    exit(1)

try:
    client = genai.Client(api_key=api_key)
    # Try a simple text generation request
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents='Hello',
    )
    print("API Key is VALID!")
    print("Response text:", response.text)
except Exception as e:
    print("API Key is INVALID!")
    print("Error:", e)
