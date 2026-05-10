import json
import sys
import os

# Add current directory to path so it can find behavior_engine
sys.path.append(os.getcwd())

from behavior_engine import compute_withdrawal_score, detect_language

with open('test_withdrawal.json') as f:
    turns = json.load(f)

history = []
for t in turns:
    # Use the history BEFORE this turn to simulate real-time update
    # The actual engine.update() takes turn_history + current_turn
    # compute_withdrawal_score expects history including current turn
    
    turn_obj = {"text": t["text"], "user_initiated": False}
    # result = compute_withdrawal_score(history + [turn_obj]) 
    # But the user's script does it after appending:
    history.append(turn_obj)
    
    result = compute_withdrawal_score(history)
    lang = detect_language(t["text"])
    
    print(f"Turn {t['turn']}: '{t['text']}'")
    print(f"  Score: {result['score']:.3f} | Mode: {result['mode']} | Lang: {lang}")
    print(f"  Word counts: {result['last_word_counts']}")
    print()
