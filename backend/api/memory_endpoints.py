from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import List, Dict, Optional
import time
import uuid

from backend.core.thought_field.identity.UserModel import UserModel, StableIdentity, CommunicationProfile, CurrentState, RecentContext, RelationshipContext, UserModelMetadata
from backend.core.thought_field.identity.IdentityEvolution import IdentityEvolution
from backend.infrastructure.logging import get_logger
from backend.infrastructure.embedding_provider import embedding_provider
# Import supabase from main
from backend.api.main import supabase

log = get_logger("memory_endpoints")
router = APIRouter()

class ConsolidateRequest(BaseModel):
    session_id: str
    user_id: str
    consolidation_id: str = ""
    observations: List[Dict] = []

from backend.core.thought_field.AssociativeThoughtField import AssociativeThoughtField

async def _fetch_user_model(user_id: str) -> UserModel:
    if not supabase:
        log.warning("Supabase client not available, returning new UserModel.")
        return UserModel(user_id=user_id)
        
    try:
        res = await supabase.table("aura_storage").select("data").eq("user_id", user_id).eq("key", f"user_model_{user_id}").execute()
        if res.data and len(res.data) > 0:
            return UserModel.from_dict(res.data[0].get("data", {}))
    except Exception as e:
        log.error(f"Failed to fetch user model for {user_id}: {e}")
        
    return UserModel(user_id=user_id)

async def _save_user_model(model: UserModel):
    if not supabase:
        return
        
    try:
        model.metadata.updated_at = time.time()
        await supabase.table("aura_storage").upsert({
            "user_id": model.user_id,
            "key": f"user_model_{model.user_id}",
            "data": model.to_dict(),
            "updated_at": time.time()
        }).execute()
    except Exception as e:
        log.error(f"Failed to save user model for {model.user_id}: {e}")

@router.post("/api/memory/consolidate")
async def consolidate_memory(request: ConsolidateRequest):
    """
    Executes the Post-Session Consolidation Pipeline.
    Extracts high-signal observations and updates the UserModel.
    """
    if not request.consolidation_id:
        request.consolidation_id = f"fallback_{request.session_id}_{int(time.time())}"
        
    log.info(f"Starting consolidation {request.consolidation_id} for session {request.session_id}")
    
    current_model = await _fetch_user_model(request.user_id)
    
    # Idempotency check
    if request.consolidation_id in current_model.metadata.processed_consolidations:
        log.info(f"Consolidation {request.consolidation_id} already processed. Returning existing model.")
        return {"status": "success", "user_model": current_model.to_dict()}
    
    # Extract accumulated observations from AssociativeThoughtField
    observations = request.observations.copy()
    atf = AssociativeThoughtField.get_instance(request.session_id)
    if atf and hasattr(atf.social_model, "history"):
        for state in atf.social_model.history.states:
            if hasattr(state, "observations") and state.observations:
                observations.extend(state.observations)
    
    log.info(f"Extracted {len(observations)} observations from session.")
    
    # Run Identity Evolution (await if async, else sync)
    if asyncio.iscoroutinefunction(IdentityEvolution.consolidate):
        updated_model = await IdentityEvolution.consolidate(observations, current_model)
    else:
        updated_model = IdentityEvolution.consolidate(observations, current_model)
        
    # Mark as processed
    updated_model.metadata.processed_consolidations.append(request.consolidation_id)
    # Keep list from growing unbounded
    if len(updated_model.metadata.processed_consolidations) > 50:
        updated_model.metadata.processed_consolidations = updated_model.metadata.processed_consolidations[-50:]
    
    # Save back to database
    await _save_user_model(updated_model)
    
    log.info(f"Consolidated user model for {request.user_id}. Extracted {len(updated_model.identity.stable_facts)} stable facts.")
    
    return {"status": "success", "user_model": updated_model.to_dict()}

import asyncio

@router.get("/api/memory/model/{user_id}")
async def get_user_model(user_id: str, query: str = Query("")):
    """
    Fetches the current Three-Tier UserModel for the specified user.
    If query is provided, ranks and packs the context into a 1600-char budget.
    """
    model = await _fetch_user_model(user_id)
    
    # Relevance-Aware Retrieval & Budget Packing
    MAX_CHARS = 1600
    results = []
    
    candidates = []
    
    # Gather candidates from all tiers
    if model.current_state.topic:
        candidates.append({"content": f"Current topic: {model.current_state.topic}", "tier": "current", "base_score": 1.0})
    if model.current_state.goal:
        candidates.append({"content": f"Current goal: {model.current_state.goal}", "tier": "current", "base_score": 1.0})
    
    for t in model.recent_context.unresolved_items:
        if t.status in ("ACTIVE", "PROGRESSING"):
            candidates.append({"content": f"Unresolved: {t.content}", "tier": "recent", "base_score": 0.9})
            
    for f in model.identity.goals:
        candidates.append({"content": f.content, "tier": "stable", "base_score": 0.8 * f.evidence.confidence})
        
    for f in model.identity.stable_facts:
        candidates.append({"content": f.content, "tier": "stable", "base_score": 0.7 * f.evidence.confidence})
        
    for f in model.identity.preferences:
        candidates.append({"content": f.content, "tier": "stable", "base_score": 0.7 * f.evidence.confidence})

    for f in model.identity.interests:
        candidates.append({"content": f.content, "tier": "stable", "base_score": 0.6 * f.evidence.confidence})
        
    # Semantic Ranking if query exists
    if query and embedding_provider.is_available:
        try:
            query_emb = await embedding_provider.embed(query)
            if query_emb:
                from backend.memory.chroma import cosine_similarity
                
                # Fetch all embeddings in parallel
                async def embed_cand(c):
                    e = await embedding_provider.embed(c["content"])
                    if e:
                        sim = cosine_similarity(query_emb, e)
                        c["score"] = c["base_score"] * 0.4 + sim * 0.6
                    else:
                        c["score"] = c["base_score"]
                
                await asyncio.gather(*(embed_cand(c) for c in candidates))
            else:
                for c in candidates:
                    c["score"] = c["base_score"]
        except Exception as e:
            log.warning(f"Semantic ranking failed: {e}")
            for c in candidates:
                c["score"] = c["base_score"]
    else:
        for c in candidates:
            c["score"] = c["base_score"]
            
    # Sort by score descending
    candidates.sort(key=lambda x: x["score"], reverse=True)
    
    total_chars = 0
    for c in candidates:
        if total_chars + len(c["content"]) > MAX_CHARS:
            continue
        results.append({
            "content": c["content"],
            "metadata": {"tier": c["tier"]},
            "similarity": round(c["score"], 2),
            "emotional_match": 1.0
        })
        total_chars += len(c["content"])

    return {
        "status": "success", 
        "user_model": model.to_dict(),
        "results": results,
        "mental_model": model.synthesize_mental_model()
    }
