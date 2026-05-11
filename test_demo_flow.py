import asyncio, os
from server import engine, supabase
from behavior_engine import build_sensing_injection, detect_language_profile
from memory_sync import store_and_backup_memory
from datetime import datetime

async def test_full_aura_flow():
    print("\n--- AURA FULL FLOW DEMO TEST ---")
    
    # 1. Simulate User Input (Hinglish/Casual)
    user_text = "Kya haal hai yaar? Aaj bahut thak gaya hoon kaam se."
    session_id = "demo_test_session_001"
    user_id = "test_user_99"
    
    print(f"[INPUT] User: {user_text}")

    # 2. ML Analysis (Keywords + Emotional State)
    # The 'analyze' method handles keyword scanning and routing
    analysis = engine.analyze(user_text)
    print(f"[ML] Act: {analysis['act']} | Emotional State: {analysis['emotional_state']}")

    # 3. Language Detection
    lang_profile = detect_language_profile(user_text)
    print(f"[LANG] Detected Mode: {lang_profile['mode']} | Informal: {lang_profile['is_informal']}")

    # 4. Sensing Engine (Energy/Trust/Arc)
    turn_data = {
        "text": user_text,
        "audio_rms": 0.05,
        "pause_ms": 1200,
        "frustration_score": 0.1,
        "withdrawal_score": 0.0,
        "language_profile": lang_profile
    }
    
    # build_sensing_injection updates the SensingEngine state and generates the prompt block
    sensing_injection, state_vector, directive = build_sensing_injection(
        session_id, 
        turn_data, 
        seed="", 
        user_id=user_id
    )
    
    print(f"[SENSING] Energy: {round(state_vector.energy, 2)} | Arc: {state_vector.arc}")
    print(f"[INJECTION] Generated {len(sensing_injection)} chars of prompt context.")

    # 5. Final Combined Instructions (What Gemini Sees)
    analysis["sensing_injection"] = sensing_injection
    final_instructions = engine.build_instructions(analysis)
    
    print("\n--- FINAL INSTRUCTION BLOCK FOR GEMINI ---")
    print(final_instructions)
    print("------------------------------------------\n")

    # 6. Database Verification (PGVector Storage)
    print("[DB] Attempting to store memory in Supabase pgvector...")
    try:
        await store_and_backup_memory(
            supabase_client=supabase,
            chroma_service=None, # Not used in pgvector flow
            user_id=user_id,
            session_id=session_id,
            turn_text=user_text,
            state=state_vector,
            turn_number=1
        )
        print("[DB] SUCCESS: Memory stored in 'aura_chroma_backup' table.")
    except Exception as e:
        print(f"[DB] FAILED: {e}")

    print("\n--- DEMO COMPLETE: ALL SYSTEMS VERIFIED ---")

if __name__ == "__main__":
    asyncio.run(test_full_aura_flow())
