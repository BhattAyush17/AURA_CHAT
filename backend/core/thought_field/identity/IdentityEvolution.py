import time
import asyncio
from typing import List, Dict, Optional
from .UserModel import UserModel, CandidateFact, IdentityFact, Evidence, UnresolvedThread
from backend.infrastructure.embedding_provider import embedding_provider
from backend.infrastructure.logging import get_logger

log = get_logger("identity_evolution")

def cosine_similarity(v1, v2):
    import math
    if not v1 or not v2: return 0.0
    dot = sum(x * y for x, y in zip(v1, v2))
    mag1 = math.sqrt(sum(x * x for x in v1))
    mag2 = math.sqrt(sum(x * x for x in v2))
    if mag1 == 0 or mag2 == 0: return 0.0
    return dot / (mag1 * mag2)

class IdentityEvolution:
    """
    Implements the Promotion Pipeline: Observation -> Candidate Fact -> Supported -> Stable Fact
    """
    
    @staticmethod
    def evaluate_signal_quality(evidence: Evidence, consistency_factor: float) -> float:
        """
        Signal Quality = Evidence Strength * Consistency * Recency * Relevance * Specificity
        """
        source_weights = {
            "explicit_statement": 1.0,
            "repeated_behavior": 0.8,
            "music_behavior": 0.6,
            "acoustic_signal": 0.4,
            "inference": 0.2
        }
        strength = source_weights.get(evidence.source, 0.4)
        
        elapsed = time.time() - evidence.last_reinforced
        recency = max(0.1, 1.0 - (elapsed / (86400 * 30)))
        
        return strength * consistency_factor * recency * evidence.confidence
        
    @staticmethod
    async def _find_semantic_match(content: str, items: List[any], get_text=lambda x: x.content, threshold=0.85):
        if not embedding_provider.is_available:
            # Fallback deterministic
            content_lower = content.lower()
            for item in items:
                if content_lower in get_text(item).lower() or get_text(item).lower() in content_lower:
                    return item
            return None
            
        emb = await embedding_provider.embed(content)
        if not emb:
            return None
            
        best_item = None
        best_score = -1.0
        
        for item in items:
            text = get_text(item)
            item_emb = await embedding_provider.embed(text)
            if item_emb:
                score = cosine_similarity(emb, item_emb)
                if score > best_score and score > threshold:
                    best_score = score
                    best_item = item
        return best_item

    @staticmethod
    async def consolidate(session_observations: List[Dict], user_model: UserModel) -> UserModel:
        """
        Async semantic consolidation and deduplication.
        """
        now = time.time()
        
        # Age out old threads
        for t in user_model.recent_context.unresolved_items:
            if t.status in ("ACTIVE", "PROGRESSING") and (now - t.updated_at) > 86400 * 30:
                t.status = "ARCHIVED"
                t.updated_at = now
                user_model.recent_changes.append(f"Thread archived due to inactivity: {t.content}")

        for obs in session_observations:
            topic = obs.get("topic", "general")
            content = obs.get("content", "")
            if not content: continue
            
            source = obs.get("source", "inference")
            confidence = obs.get("confidence", 0.5)
            status = obs.get("status", "CONSIDERATION").upper()
            
            evidence = Evidence(
                confidence=confidence, recency=1.0, source=source,
                supporting_observations=[content], first_observed=now, last_reinforced=now
            )
            
            candidate = CandidateFact(topic=topic, content=content, evidence=evidence, status=status)
            quality = IdentityEvolution.evaluate_signal_quality(candidate.evidence, 1.0)
            
            # --- 1. Music Preferences (Special Case) ---
            if source == "music_behavior":
                # Music is a PREFERENCE CANDIDATE
                match = await IdentityEvolution._find_semantic_match(content, user_model.identity.preferences)
                if match:
                    match.evidence.confidence = min(1.0, match.evidence.confidence + 0.1)
                    match.evidence.last_reinforced = now
                else:
                    if quality > 0.5: # Repeated or strong enough
                        user_model.identity.preferences.append(IdentityFact(topic, content, evidence))
                continue
                
            # --- 2. Contradiction & Deduplication in Identity ---
            all_facts = user_model.identity.stable_facts + user_model.identity.preferences + user_model.identity.interests + user_model.identity.goals
            match = await IdentityEvolution._find_semantic_match(content, all_facts, threshold=0.82)
            
            if match:
                # Contradiction check: Does the temporal context differ, or is it just reinforcing?
                # Semantic similarity > 0.82 handles rewording. If it's highly similar, we reinforce.
                # If there's an explicit semantic contradiction (e.g. "I don't like X"), 
                # a more advanced LLM agent should handle it. Here we just update.
                if evidence.confidence > match.evidence.confidence:
                    match.content = content # Update wording to most recent confident version
                match.evidence.confidence = min(1.0, match.evidence.confidence + evidence.confidence * 0.5)
                match.evidence.last_reinforced = now
                if match.topic == "general": match.topic = topic
                continue
                
            # --- 3. Thought Classification & Lifecycle ---
            if status in ["CONSIDERATION", "THOUGHT"]:
                # Temporary thought. Ignore for stable identity.
                pass
                
            elif status in ["INTENTION", "GOAL", "ACTIVE GOAL", "COMMITMENT"]:
                # Manage via Active Goals and Unresolved Threads
                t_match = await IdentityEvolution._find_semantic_match(content, user_model.recent_context.unresolved_items)
                if t_match:
                    if t_match.status == "RESOLVED":
                        t_match.status = "ACTIVE"
                        t_match.updated_at = now
                        user_model.recent_changes.append(f"Thread reopened: {content}")
                    else:
                        t_match.status = "PROGRESSING"
                        t_match.updated_at = now
                else:
                    thread = UnresolvedThread(topic=topic, content=content, status="ACTIVE", created_at=now, updated_at=now)
                    user_model.recent_context.unresolved_items.append(thread)
                    user_model.recent_changes.append(f"New goal/intention: {content}")
                    
                if quality > 0.6:
                    # Also make it a Stable Goal if quality is high
                    user_model.identity.goals.append(IdentityFact(topic, content, evidence))
                    
            else:
                # Default Stable Fact / Preference / Interest Promotion
                if quality > 0.65 or status == "STABLE_FACT":
                    fact = IdentityFact(topic=topic, content=content, evidence=evidence)
                    if "prefer" in content.lower():
                        user_model.identity.preferences.append(fact)
                    elif "like" in content.lower() or "interest" in content.lower():
                        user_model.identity.interests.append(fact)
                    else:
                        user_model.identity.stable_facts.append(fact)
                        
        # Ensure lists are bounded
        user_model.recent_changes = user_model.recent_changes[-20:]
        
        return user_model
