# adaptive_style_engine.py

def generate_adaptive_style(toxicity_score: float, intent: str, slang_profile: dict) -> dict:
    mirror_energy = toxicity_score > 0.5
    preferred_style = slang_profile.get("preferred_style", "neutral")
    
    style = {
        "adaptive_mirroring": mirror_energy,
        "cadence": "human_irregular" if mirror_energy else "normal",
        "slang_usage": slang_profile.get("observed_user_slang", [])[:3] if mirror_energy else []
    }
    return style
