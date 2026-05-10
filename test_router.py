import sys
import os

# Add current directory to path
sys.path.append(os.getcwd())

from emotional_router import EmotionalStateRouter

router = EmotionalStateRouter()

# Test case: withdrawal then frustration
turns = [
    {"text": "yeah", "user_initiated": False},
    {"text": "idk", "user_initiated": False},
    {"text": "this never works", "user_initiated": False},
    {"text": "you always say the same thing", "user_initiated": False},
    {"text": "seriously, forget it", "user_initiated": False},
]

history = []
for i, turn in enumerate(turns, 1):
    result = router.resolve(history, turn)
    history.append(turn) # append after resolve to match logic
    
    print(f"\n--- Turn {i}: '{turn['text']}' ---")
    print(f"Dominant State: {result['state']}")
    print(f"Intensity: {result['intensity']:.3f}")
    print(f"Language: {result['language']}")
    print(f"Scores: {result['all_scores']}")
    
    if result['prompt_override']:
        print(f"\nPrompt Override (first 100 chars):")
        print(result['prompt_override'][:100].replace('\n', ' ') + "...")
