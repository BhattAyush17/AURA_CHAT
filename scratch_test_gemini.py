import os
from dotenv import load_dotenv
from behavior_engine import generate_memory_seed

load_dotenv(".env.local")

transcript = [
    {"user_initiated": True, "text": "Hi AURA, I'm feeling a bit tired today."},
    {"user_initiated": False, "text": "I hear you. It's okay to be tired. Let's just talk softly then."},
    {"user_initiated": True, "text": "Thanks. That helps. I've been working on a project for hours."}
]

try:
    print("Testing generate_memory_seed...")
    seed = generate_memory_seed(transcript, previous_seed="", api_key=os.getenv("GEMINI_API_KEY"))
    print("\nSUCCESS! Generated Seed:")
    print(seed)
except Exception as e:
    print(f"\nFAILED: {e}")
