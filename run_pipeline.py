"""
AURA Pipeline Runner v4 (Lightweight)

Usage:
  python run_pipeline.py extract    # Batch extract all 6 chat files (1 API call each)
  python run_pipeline.py serve      # Start the lightweight behavior engine server
  python run_pipeline.py test       # Run runtime cascade test
"""

import sys
import os

def step_extract():
    print("\n" + "="*60)
    print("STEP 1: Batch Extract (1 Gemini call per chat file)")
    print("="*60)
    from batch_extract import main as extract_main
    extract_main()

def step_serve():
    print("\n" + "="*60)
    print("STEP 2: Starting LIGHTWEIGHT Behavior Engine Server (port 8000)")
    print("="*60)
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)

def step_test():
    print("\n" + "="*60)
    print("RUNTIME CASCADE TEST (LIGHTWEIGHT)")
    print("="*60)
    from behavior_engine import RuntimeEngine
    engine = RuntimeEngine()
    
    tests = [
        ("Bhai paisa bhej de jaldi", "RAW_CHAOTIC_MALE_HOSTEL"),
        ("I feel so lost today", None),
        ("Bruh that was hilarious lmao", "GENZ_PLAYFUL_BOND_DEEP_UNDERCURRENT"),
        ("Let's schedule the standup for 10am", "FORMAL_PROFESSIONAL_COLLABORATIVE"),
        ("kuch nhi bas baitha hu", None),
    ]
    
    for text, ideo in tests:
        result = engine.analyze(text, ideo)
        instructions = engine.build_instructions(result)
        print(f"\n📝 \"{text}\"")
        print(f"   Act: {result['act']} | Mode: {result['withdrawal_mode']} | Energy: {result['energy']}")
        print(f"   Instructions:\n   {instructions}")
        print("-"*40)

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    
    cmd = sys.argv[1].lower()
    if cmd == "extract":
        step_extract()
    elif cmd == "serve":
        step_serve()
    elif cmd == "test":
        step_test()
    elif cmd == "all":
        step_extract()
        step_serve()
    else:
        print(f"Unknown: {cmd}")
        print(__doc__)

if __name__ == "__main__":
    main()
