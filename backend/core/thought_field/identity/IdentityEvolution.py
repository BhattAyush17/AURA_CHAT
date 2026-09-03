import time
import asyncio
import re
from typing import List, Dict, Optional, Tuple, Callable, Awaitable
from .UserModel import UserModel, CandidateFact, IdentityFact, Evidence, UnresolvedThread
from backend.infrastructure.embedding_provider import embedding_provider
from backend.infrastructure.logging import get_logger

log = get_logger("identity_evolution")

# ── Turn-level live state cache ─────────────────────────────────────────────
# Per-(user_id, session_id) in-memory cache of the most recently observed
# UserModel. This is an OPTIMIZATION only — the authoritative copy is the
# Supabase `aura_storage` row. Bounded by TTL + max entries; entries not
# touched within the TTL are evicted on the next access.
_live_state_cache: Dict[Tuple[str, str], UserModel] = {}
_live_state_cache_time: Dict[Tuple[str, str], float] = {}
_LIVE_STATE_TTL_SEC = 1800.0  # 30 min
_LIVE_STATE_MAX_ENTRIES = 256  # bounded size cap


def _evict_stale_live_state(now: float) -> None:
    """Drop cache entries not accessed within the TTL or beyond the size cap."""
    # TTL eviction
    stale = [k for k, t in _live_state_cache_time.items() if now - t > _LIVE_STATE_TTL_SEC]
    for k in stale:
        _live_state_cache.pop(k, None)
        _live_state_cache_time.pop(k, None)
    # Size cap: if still over, drop the oldest
    if len(_live_state_cache) > _LIVE_STATE_MAX_ENTRIES:
        ordered = sorted(_live_state_cache_time.items(), key=lambda kv: kv[1])
        for k, _ in ordered[: len(_live_state_cache) - _LIVE_STATE_MAX_ENTRIES]:
            _live_state_cache.pop(k, None)
            _live_state_cache_time.pop(k, None)


# ── Conservative topic acceptance predicate ────────────────────────────────
# Reject None / empty / generic control / turn-management themes so a weak
# turn never overwrites an established topic. This is a *filter*, not a
# vocabulary — we accept anything that looks like a real concept, and we
# reject a small set of clearly low-signal words.
_LOW_SIGNAL_TOPIC_PATTERNS = (
    "none", "", "general", "continuation", "conversation", "unknown",
    "greeting", "acknowledgment", "acknowledgement", "small talk", "chitchat",
    "turn", "response", "reply", "meta", "misc", "other", "ambiguous",
    "continuing", "ongoing", "current", "present", "context",
)
_topic_word_re = re.compile(r"^[A-Za-z][A-Za-z0-9 \-_/&]{1,60}$")


def _is_meaningful_topic(theme: Optional[str]) -> bool:
    """Conservative acceptance predicate for a candidate topic.

    Returns True only if the theme is a non-empty, reasonably-shaped concept
    that is not in the small low-signal rejection list.
    """
    if not theme or not isinstance(theme, str):
        return False
    t = theme.strip()
    if not t:
        return False
    if t.lower() in _LOW_SIGNAL_TOPIC_PATTERNS:
        return False
    if not _topic_word_re.match(t):
        return False
    return True


# ── Conservative unresolved-thread detection ───────────────────────────────
# We only act on a small, explicit set of patterns. This is intentionally
# narrow to avoid false positives from ordinary statements/questions.
_UNRESOLVED_CREATE_RE = re.compile(
    r"\b(i (?:still )?(?:need|have|had) to|"
    r"i(?:'ve| have) (?:got|gotten) to|"
    r"i (?:must|should) (?:still )?|"
    r"i(?:'m| am) (?:supposed|expected) to|"
    r"need to|have to|got to|"
    r"haven'?t (?:finished|done|submitted|completed|started)|"
    r"haven'?t yet|"
    r"i (?:still )?need to|"
    r"i forgot to|"
    r"i haven'?t|"
    r"i still need)\b",
    re.IGNORECASE,
)
_UNRESOLVED_RESOLVE_RE = re.compile(
    r"\b(i (?:just )?(?:finished|done|submitted|completed|sent|fixed|resolved|handled|called|emailed|mailed)|"
    r"i (?:just )?(?:wrapped|wrapped up|wrapped it up)|"
    r"i (?:got|got it) done|"
    r"(?:it'?s| thats|that'?s) (?:done|finished|handled|resolved|submitted|completed)|"
    r"all (?:done|set|finished|handled))\b",
    re.IGNORECASE,
)
_QUESTION_OR_FACTUAL_RE = re.compile(
    r"^\s*(what|why|how|when|where|who|which|explain|tell me|define|describe|"
    r"can you|could you|would you|do you|are you|is it|is the)\b",
    re.IGNORECASE,
)


def _looks_like_unresolved_statement(text: str) -> bool:
    if not text or len(text) > 400:
        return False
    if _QUESTION_OR_FACTUAL_RE.match(text):
        return False
    return bool(_UNRESOLVED_CREATE_RE.search(text))


def _looks_like_resolution_statement(text: str) -> bool:
    if not text or len(text) > 400:
        return False
    return bool(_UNRESOLVED_RESOLVE_RE.search(text))


def _normalize_thread_text(text: str) -> str:
    """Light normalization for matching — lowercase, collapse whitespace, strip trailing punct."""
    return re.sub(r"\s+", " ", (text or "").strip().lower()).rstrip(".!?")


def _find_matching_thread(model: UserModel, key: str) -> Tuple[Optional[UnresolvedThread], int]:
    """Find an existing UnresolvedThread whose content shares a key token.

    No embeddings — pure deterministic matching on normalized content.
    Returns (thread, index) or (None, -1).
    """
    if not key:
        return None, -1
    tokens = [t for t in key.split() if len(t) > 3]
    if not tokens:
        return None, -1
    for idx, t in enumerate(model.recent_context.unresolved_items):
        if t.status == "ARCHIVED":
            continue
        existing = _normalize_thread_text(t.content)
        if not existing:
            continue
        # Heuristic: any of our key tokens present in the existing content, or vice versa.
        for tok in tokens:
            if tok in existing or existing in key:
                return t, idx
    return None, -1


# ── Public API: conservative live-state observation ────────────────────────


def _observe_topic(model: UserModel, dominant_theme: Optional[str]) -> bool:
    """Update `current_state.topic` only if the new theme is meaningful.

    Returns True if the topic was changed, False otherwise.
    Weak / empty / low-signal themes preserve the existing topic.
    """
    if not _is_meaningful_topic(dominant_theme):
        return False
    new_topic = dominant_theme.strip()
    if model.current_state.topic and model.current_state.topic.strip().lower() == new_topic.lower():
        # Same topic — just bump timestamp, no mutation needed.
        return False
    model.current_state.topic = new_topic
    model.current_state.last_updated = time.time()
    return True


def _observe_unresolved_threads(model: UserModel, transcript: str) -> bool:
    """Conservatively merge unresolved-thread observations into the model.

    Returns True if the model was mutated.
    """
    if not transcript:
        return False
    now = time.time()
    mutated = False

    # 1) Resolution: if user says they finished/did something, try to mark
    #    the matching active thread as RESOLVED.
    if _looks_like_resolution_statement(transcript):
        key = _normalize_thread_text(transcript)
        thread, _ = _find_matching_thread(model, key)
        if thread and thread.status != "RESOLVED":
            thread.status = "RESOLVED"
            thread.updated_at = now
            model.recent_changes.append(f"Thread resolved: {thread.content}")
            if len(model.recent_changes) > 20:
                model.recent_changes = model.recent_changes[-20:]
            mutated = True

    # 2) Creation: if user expresses a still-to-do, try to add a thread
    #    unless one already covers the same content.
    if _looks_like_unresolved_statement(transcript):
        # Extract the "what to do" tail as the thread content.
        m = re.search(
            r"(?:need to|have to|got to|must|should|supposed to|expected to|"
            r"haven'?t (?:finished|done|submitted|completed|started)|"
            r"haven'?t yet|forgot to|haven'?t|still need to|still need)\s+(.+?)(?:[.!?]|$)",
            transcript,
            re.IGNORECASE,
        )
        content = (m.group(1).strip() if m else transcript).strip().rstrip(".!?")
        if not content or len(content) > 240:
            return mutated
        key = _normalize_thread_text(content)
        existing, _ = _find_matching_thread(model, key)
        if existing:
            # Reinforce: bump updated_at and mark PROGRESSING.
            if existing.status in ("ACTIVE", "PROGRESSING"):
                existing.status = "PROGRESSING"
                existing.updated_at = now
                mutated = True
        else:
            topic = " ".join(content.split()[:3]) or "general"
            thread = UnresolvedThread(
                topic=topic,
                content=content,
                status="ACTIVE",
                created_at=now,
                updated_at=now,
            )
            model.recent_context.unresolved_items.append(thread)
            model.recent_changes.append(f"New unresolved: {content}")
            if len(model.recent_changes) > 20:
                model.recent_changes = model.recent_changes[-20:]
            mutated = True
    return mutated


async def observe_turn_live(
    *,
    user_id: str,
    session_id: str,
    transcript: str,
    dominant_theme: Optional[str],
    fetch_model: Optional[Callable[[str], Awaitable[Optional[UserModel]]]] = None,
    persist_model: Optional[Callable[[UserModel], Awaitable[None]]] = None,
) -> Optional[UserModel]:
    """Turn-level live-state observation. Fail-open. Non-blocking on persistence.

    - On cache miss: calls fetch_model(user_id) to load the authoritative
      UserModel (or creates a fresh one if fetch returns None or is absent).
    - Applies conservative topic + unresolved-thread updates.
    - Updates the in-memory cache synchronously (microseconds).
    - If persist_model is provided, schedules a fire-and-forget background
      task that re-reads the DB row and merges only the live-state fields
      we own (`current_state`, `recent_context.unresolved_items`).
    - All exceptions are caught and logged; the conversation path is never
      blocked or failed by this function.
    """
    if not user_id or user_id == "anonymous":
        return None
    cache_key = (user_id, session_id)
    now = time.time()
    try:
        _evict_stale_live_state(now)
        model = _live_state_cache.get(cache_key)
        if model is None:
            if fetch_model is not None:
                try:
                    fetched = await fetch_model(user_id)
                except Exception as e:
                    log.warning("live_state_fetch_failed user=%s err=%s", user_id, e)
                    fetched = None
                model = fetched if fetched is not None else UserModel(user_id=user_id)
            else:
                model = UserModel(user_id=user_id)
            _live_state_cache[cache_key] = model
            _live_state_cache_time[cache_key] = now
        else:
            _live_state_cache_time[cache_key] = now

        # Apply local observations synchronously.
        topic_changed = _observe_topic(model, dominant_theme)
        unresolved_changed = _observe_unresolved_threads(model, transcript)

        if not (topic_changed or unresolved_changed):
            return model

        # Schedule background persistence (fire-and-forget). The coroutine
        # is fully self-contained so it never raises back to the caller.
        if persist_model is not None:
            captured_user_id = user_id
            captured_session_id = session_id
            captured_model_ref = model  # live in-memory reference

            async def _persist():
                try:
                    await persist_model(captured_model_ref)
                except Exception as e:
                    log.warning(
                        "live_state_persist_failed user=%s session=%s err=%s",
                        captured_user_id,
                        captured_session_id,
                        e,
                    )

            try:
                loop = asyncio.get_event_loop()
                loop.create_task(_persist())
            except Exception:
                # If we cannot schedule, drop the persistence silently.
                pass
        return model
    except Exception as e:
        log.warning("live_state_observe_failed user=%s session=%s err=%s", user_id, session_id, e)
        return None


def invalidate_live_state(user_id: Optional[str] = None, session_id: Optional[str] = None) -> None:
    """Evict cache entries. Used by tests and explicit session-end paths."""
    if user_id is None and session_id is None:
        _live_state_cache.clear()
        _live_state_cache_time.clear()
        return
    keys = [k for k in _live_state_cache.keys() if (
        (user_id is None or k[0] == user_id) and
        (session_id is None or k[1] == session_id)
    )]
    for k in keys:
        _live_state_cache.pop(k, None)
        _live_state_cache_time.pop(k, None)

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
