import os
import time
import asyncio
from datetime import datetime
from google import genai
from google.genai import types
from logging_config import get_logger

log = get_logger("memory_sync")


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
        result = await asyncio.to_thread(
            lambda: supabase_client
                .table("aura_seeds")
                .select("seed, updated_at")
                .eq("user_id", user_id)
                .order("updated_at", desc=True)
                .limit(1)
                .execute()
        )

        if not result.data:
            return local_seed

        supabase_seed = result.data[0].get("seed", "")
        return supabase_seed if supabase_seed else local_seed

    except Exception as e:
        log.warning("seed_sync_failed", user_id=user_id, error=str(e))
        return local_seed

async def save_seed_to_supabase(
    supabase_client,
    user_id: str,
    seed: str,
    state_vector: dict,
    device_id: str = "unknown"
):
    try:
        await asyncio.to_thread(
            lambda: supabase_client.table("aura_seeds").upsert({
                "user_id": user_id,
                "seed": seed,
                "state_vector": state_vector,
                "device_id": device_id,
                "updated_at": datetime.utcnow().isoformat()
            }).execute()
        )
    except Exception as e:
        log.warning("seed_save_failed", user_id=user_id, error=str(e))


async def persist_state_vector(
    supabase_client,
    session_id: str,
    state
) -> None:
    try:
        await asyncio.to_thread(
            lambda: supabase_client.table("aura_storage").upsert({
                "user_id": "system",
                "key": f"state_vector_{session_id}",
                "data": {
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
            }, on_conflict="user_id,key").execute()
        )
    except Exception as e:
        log.warning("state_persist_failed", session_id=session_id, error=str(e))


async def store_and_backup_memory(
    supabase_client,
    chroma_service,
    user_id: str,
    session_id: str,
    turn_text: str,
    state,
    turn_number: int,
    embedding_cache=None
):
    # Only store emotionally significant moments
    if state.energy < 0.3 and state.engagement < 0.3:
        log.debug("memory_skipped", user_id=user_id, reason="low_energy_engagement", energy=round(state.energy, 2), engagement=round(state.engagement, 2))
        return
    if state.arc_turns < 2:
        log.debug("memory_skipped", user_id=user_id, reason="low_arc_turns", arc_turns=state.arc_turns)
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
        t_embed = time.perf_counter()
        if embedding_cache:
            emb = await embedding_cache.get_embedding(turn_text)
        else:
            gemini_client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
            embed_result = gemini_client.models.embed_content(
                model="gemini-embedding-001",
                contents=[turn_text],
                config=types.EmbedContentConfig(output_dimensionality=768)
            )
            emb = list(embed_result.embeddings[0].values)
        embedding_ms = round((time.perf_counter() - t_embed) * 1000, 2)

        # Store in Supabase pgvector
        t_insert = time.perf_counter()
        await asyncio.to_thread(
            lambda: supabase_client.table("aura_chroma_backup").upsert({
                "user_id": user_id,
                "session_id": session_id,
                "turn_text": turn_text,
                "metadata": metadata,
                "embedding_id": embedding_id,
                "embedding": emb,
                "created_at": datetime.utcnow().isoformat()
            }).execute()
        )
        insert_ms = round((time.perf_counter() - t_insert) * 1000, 2)
        log.info("memory_stored", user_id=user_id, session_id=session_id, embedding_ms=embedding_ms, insert_ms=insert_ms)
    except Exception as e:
        log.warning("memory_store_failed", user_id=user_id, error=str(e))


async def get_chromadb_enrichment(
    chroma_service,
    current_text: str,
    state_vector: dict,
    timeout: float = 0.8,
    embedding_cache = None
) -> str:
    import asyncio

    try:
        t_query = time.perf_counter()
        results = await asyncio.wait_for(
            chroma_service.query(text=current_text, n=3, embedding_cache=embedding_cache),
            timeout=timeout
        )
        query_ms = round((time.perf_counter() - t_query) * 1000, 2)
        
        if results:
            log.info("memory_queried", result_count=len(results), query_ms=query_ms)
            lines = []
            for r in results:
                m = r.get("metadata", {})
                content = r.get("text") or r.get("turn_text", "")
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
async def get_chromadb_enrichment_v2(
    current_text: str,
    state_vector: dict,
    user_id: str,
    timeout: float = 0.8,
    recency_weight: float = 0.15,
    embedding_cache = None
) -> str:
    """
    Hybrid memory retrieval: semantic similarity + temporal recency.
    Uses match_memories_v2 RPC for weighted scoring.
    Falls back to frame_from_current_input on failure.
    """
    import asyncio
    from chroma_service import chroma_service

    try:
        t_query = time.perf_counter()
        results = await asyncio.wait_for(
            chroma_service.query_memories_v2(
                text=current_text,
                user_id=user_id,
                n=3,
                threshold=0.65,
                max_age_days=365,
                embedding_cache=embedding_cache
            ),
            timeout=timeout
        )
        query_ms = round((time.perf_counter() - t_query) * 1000, 2)

        if results:
            log.info("memory_queried", user_id=user_id, result_count=len(results), query_ms=query_ms)
            lines = []
            for r in results:
                content = r.get("text", "")
                label = r.get("recency_label", "")
                sim = r.get("similarity", 0)
                lines.append(
                    f"[{label}] (sim={sim}) {content[:120]}"
                )
            return (
                "[MEMORY CONTEXT]\n"
                + "\n".join(lines)
                + "\n[/MEMORY CONTEXT]"
            )
    except asyncio.TimeoutError:
        log.warning("memory_v2_timeout", user_id=user_id)
    except Exception as e:
        log.warning("memory_v2_failed", user_id=user_id, error=str(e))

    return frame_from_current_input(current_text, state_vector)


def _age_label(age_hours: float) -> str:
    """Convert age in hours to a human-readable temporal label."""
    if age_hours < 24:
        return "Earlier today"
    if age_hours < 168:
        return "A few days ago"
    if age_hours < 720:
        return "A few weeks ago"
    return "A while back"


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
