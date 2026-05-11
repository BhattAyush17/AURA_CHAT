import os
from datetime import datetime
from supabase import create_client
from google import genai
from google.genai import types


def get_gap_context(last_seen: str) -> str:
    """Gap 3: Determine how long since last session for natural reconnection tone."""
    if not last_seen:
        return ""
    try:
        last = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
        gap_hours = (datetime.utcnow() - last.replace(tzinfo=None)).total_seconds() / 3600

        if gap_hours < 1:
            return "just_now"
        elif gap_hours < 6:
            return "few_hours"
        elif gap_hours < 24:
            return "same_day"
        elif gap_hours < 72:
            return "few_days"
        else:
            return "long_time"
    except Exception:
        return ""


async def get_latest_seed(
    supabase_client,
    user_id: str,
    local_seed: str
) -> str:
    try:
        result = supabase_client\
            .table("aura_seeds")\
            .select("seed, updated_at")\
            .eq("user_id", user_id)\
            .order("updated_at", desc=True)\
            .limit(1)\
            .execute()

        if not result.data:
            return local_seed

        supabase_seed = result.data[0].get("seed", "")
        return supabase_seed if supabase_seed else local_seed

    except Exception as e:
        print(f"[AURA] Seed sync failed, using local: {e}")
        return local_seed


async def save_seed_to_supabase(
    supabase_client,
    user_id: str,
    seed: str,
    state_vector: dict,
    device_id: str = "unknown"
):
    try:
        supabase_client.table("aura_seeds").upsert({
            "user_id": user_id,
            "seed": seed,
            "state_vector": state_vector,
            "device_id": device_id,
            "updated_at": datetime.utcnow().isoformat()
        }).execute()
    except Exception as e:
        print(f"[AURA] Seed save to Supabase failed: {e}")


async def persist_state_vector(
    supabase_client,
    session_id: str,
    state
) -> None:
    try:
        supabase_client.table("aura_storage").upsert({
            "session_id": session_id,
            "state_vector": {
                "energy": round(state.energy, 3),
                "warmth": round(state.warmth, 3),
                "engagement": round(state.engagement, 3),
                "trust": round(state.trust, 3),
                "tension": round(state.tension, 3),
                "arc": state.arc,
                "arc_turns": state.arc_turns,
                "session_turn": state.session_turn,
                "companion_boost_count": state.companion_boost_count,
                "total_withdrawals": state.total_withdrawals,
                "peak_reached": state.peak_reached,
            },
            "updated_at": datetime.utcnow().isoformat()
        }).execute()
    except Exception as e:
        print(f"[AURA] State persist failed silently: {e}")


async def store_and_backup_memory(
    supabase_client,
    chroma_service,
    user_id: str,
    session_id: str,
    turn_text: str,
    state,
    turn_number: int
):
    # Only store emotionally significant moments
    if state.energy < 0.3 and state.engagement < 0.3:
        return
    if state.arc_turns < 2:
        return

    embedding_id = f"{session_id}_{turn_number}"
    metadata = {
        "user_id": user_id,
        "session_id": session_id,
        "arc": state.arc,
        "energy": round(state.energy, 2),
        "trust": round(state.trust, 2),
        "warmth": round(state.warmth, 2),
        "turn": turn_number,
        "timestamp": datetime.utcnow().isoformat()
    }

    try:
        gemini_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
        embed_result = gemini_client.models.embed_content(
            model="gemini-embedding-001",
            contents=[turn_text],
            config=types.EmbedContentConfig(output_dimensionality=768)
        )
        emb = list(embed_result.embeddings[0].values)

        # Store in Supabase pgvector
        supabase_client.table("aura_chroma_backup").upsert({
            "user_id": user_id,
            "session_id": session_id,
            "turn_text": turn_text,
            "metadata": metadata,
            "embedding_id": embedding_id,
            "embedding": emb,
            "created_at": datetime.utcnow().isoformat()
        }).execute()
    except Exception as e:
        print(f"[AURA] Store memory failed: {e}")


async def get_chromadb_enrichment(
    chroma_service,
    current_text: str,
    state_vector: dict,
    timeout: float = 0.8
) -> str:
    import asyncio

    try:
        def fetch():
            gemini_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
            supa_client = create_client(
                os.environ.get("SUPABASE_URL", ""),
                os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
            )
            embed_result = gemini_client.models.embed_content(
                model="gemini-embedding-001",
                contents=[current_text],
                config=types.EmbedContentConfig(output_dimensionality=768)
            )
            emb = list(embed_result.embeddings[0].values)
            
            result = supa_client.rpc("match_memories", {
                "query_embedding": emb,
                "match_user_id": None,
                "match_threshold": 0.0,
                "match_count": 3
            }).execute()
            return result.data
            
        results = await asyncio.wait_for(asyncio.to_thread(fetch), timeout=timeout)
        
        if results:
            lines = []
            for r in results:
                m = r.get("metadata", {})
                content = r.get("turn_text") or r.get("content", "")
                lines.append(
                    f"Past moment (arc:{m.get('arc','?')} "
                    f"energy:{m.get('energy','?')}): "
                    f"{content[:120]}"
                )
            return (
                "[MEMORY ENRICHMENT]\n"
                + "\n".join(lines)
                + "\n[END MEMORY]"
            )
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass

    # Fallback — frame from current state
    return frame_from_current_input(current_text, state_vector)


def frame_from_current_input(
    text: str,
    state: dict
) -> str:
    arc = state.get("arc", "opening")
    energy = state.get("energy", 0.5)
    trust = state.get("trust", 0.3)
    return (
        f"[CONTEXT ENRICHMENT]\n"
        f"Current pattern: {arc} arc at "
        f"energy {round(energy, 2)}\n"
        f"Trust established: {round(trust, 2)}\n"
        f"No historical match — respond from present moment.\n"
        f"[END ENRICHMENT]"
    )
