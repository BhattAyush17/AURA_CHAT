from behavior_engine import RuntimeEngine

def test_intensity():
    engine = RuntimeEngine()
    
    test_cases = [
        ("Hey, how are you?", "normal/latent"),
        ("never mind, forget it", "soft frustration"),
        ("pointless... you never listen, always the same", "active frustration"),
        ("THIS IS STUPID! YOU NEVER LISTEN! ALWAYS ALWAYS ALWAYS!", "peak frustration"),
        ("ok", "soft/active withdrawal"),
        ("...", "peak withdrawal"),
    ]
    
    print("\n" + "="*50)
    print("AURA INTENSITY VERIFICATION")
    print("="*50)
    
    for text, expected in test_cases:
        print(f"\nINPUT: '{text}'")
        analysis = engine.analyze(text)
        print(f"STATE: {analysis['emotional_state']}")
        print(f"INTENSITY: {analysis['intensity']}")
        print(f"MODE: {analysis.get('mode', 'N/A')}") # detector specific result might have mode
        
        # Check if instructions contain word caps or specific rules
        instructions = engine.build_instructions(analysis)
        print("-" * 20)
        print("INSTRUCTIONS:")
        print(instructions)
        print("-" * 20)

if __name__ == "__main__":
    test_intensity()
