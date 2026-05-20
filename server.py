"""
AURA Behavior Engine API Server v3
"""

import os
import time
import asyncio
from datetime import datetime, timedelta
try:
    import pytz
except ImportError:
    pytz = None
    try:
        from zoneinfo import ZoneInfo
    except ImportError:
        ZoneInfo = None
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field          # ← ADD: Field for max_length
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv
from degradation import degradation, DegradationLevel
from logging_config import setup_logging, get_logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from chroma_service import chroma_service
from memory_sync import (
    get_latest_seed,
    save_seed_to_supabase,
    persist_state_vector,
    store_and_backup_memory,
    get_chromadb_enrichment_v2,
    get_gap_context
)
from redis_bus import (
    redis_bus,
    publish_transcript,
    read_cached_analysis,
    expire_session_cache,
    STREAM_KEY,
    CONSUMER_GROUP,
)
from embedding_cache import EmbeddingCache
from google import genai
from google.genai import types

load_dotenv(os.path.join(os.path.dirname(__file__), ".env.local"))
import sys
import os

# FIX: Import collision workaround. The local ./supabase/ directory (CLI) 
# overrides the pip 'supabase' package. Temporarily drop cwd from path to import.
_cwd = sys.path.pop(0) if sys.path and (sys.path[0] == '' or sys.path[0] == os.getcwd()) else None
from supabase import create_client, Client
if _cwd is not None:
    sys.path.insert(0, _cwd)

ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
    "http://localhost:5174",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "https://aurachat-beige.vercel.app",
]

# FIX 1: API_SECRET removed. Origin check replaces it — see /api/analyze below.
# A VITE_ prefixed secret is compiled into the public JS bundle and is
# readable by anyone in DevTools. Never use VITE_ for secrets.

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

from behavior_engine import RuntimeEngine, build_sensing_injection, detect_language_profile
from vocab_learner import vocab_learner
from proactive_engine import ProactiveEngine
from rate_limiter import RateLimiter

# Module-level proactive engine and rate limiter (initialized at startup with Redis client)
_proactive_engine: ProactiveEngine | None = None
_rate_limiter: RateLimiter | None = None
_embedding_cache: EmbeddingCache | None = None

async def gemini_embed_fn(text: str) -> list[float]:
    """Async wrapper around Gemini embedding-001 (768-dim)."""
    client = genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))
    def _call():
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=[text],
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        return list(result.embeddings[0].values)
    return await asyncio.to_thread(_call)

# C4 FIX: Initialize logging BEFORE app creation so get_logger returns configured loggers
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
setup_logging(env=ENVIRONMENT)
log = get_logger("server")


# ═══════════════════════════════════════════════════════════════════
# SAFE BACKGROUND TASK HELPER
# ═══════════════════════════════════════════════════════════════════

def _safe_background(coro, *, name: str = "unknown"):
    """Create a fire-and-forget task that logs exceptions instead of swallowing them.
    Python's default behavior for unhandled task exceptions is a stderr warning
    that bypasses structured logging. This wrapper catches them and routes to structlog."""
    async def _wrapper():
        try:
            await coro
        except asyncio.CancelledError:
            pass
        except Exception as e:
            log.warning("background_task_failed", task=name, error=str(e))
    return asyncio.create_task(_wrapper())


app = FastAPI(
    title="AURA Behavior Engine",
    version="3.0",
    # FIX 4: Suppress stack traces and internal paths in production error responses
    openapi_url=None if ENVIRONMENT == "production" else "/openapi.json",
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.on_event("startup")
async def startup_event():
    asyncio.create_task(
        chroma_service.initialize(
            supabase_client=supabase,
            rebuild_user_id=None
        )
    )
    # ── Brain 3: Redis bus + async consumer ──
    redis_ok = await redis_bus.initialize()
    if redis_ok:
        from behavior_engine_consumer import run_behavior_consumer
        asyncio.create_task(run_behavior_consumer(engine))
        print("[AURA] Brain 3 consumer started (async via Redis)")
        # Initialize proactive engine and rate limiter with Redis client
        global _proactive_engine, _rate_limiter, _embedding_cache
        _proactive_engine = ProactiveEngine(redis_bus.client)
        _rate_limiter = RateLimiter(redis_bus.client)
        _embedding_cache = EmbeddingCache(redis_bus.client, gemini_embed_fn)
        # P8 FIX: Wire vocab_learner singleton with persistence clients
        from vocab_learner import set_vocab_learner_clients
        set_vocab_learner_clients(redis_client=redis_bus.client, supabase_client=supabase)
        print("[AURA] Proactive engine, Rate Limiter, Embedding Cache, and VocabLearner initialized")
    else:
        print("[AURA] Redis unavailable — Brain 3 running in sync fallback mode")
    print("[AURA] Background services initializing...")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = RuntimeEngine(
    data_dir="./extracted_data",
    db_dir="./chroma_behavior_db",
)

# Exempt OPTIONS from rate limiting — slowapi intercepts preflight otherwise
from fastapi.responses import Response

@app.options("/{rest_of_path:path}")
async def preflight_handler(rest_of_path: str):
    return Response(status_code=200)

async def apply_rate_limit(identifier: str, max_requests: int, response: Response):
    """Fail-open rate limiting using Redis."""
    if not _rate_limiter or degradation.circuit_open('redis'):
        log.warning("rate_limit_bypassed", reason="limiter_missing" if not _rate_limiter else "redis_circuit_open")
        return
    try:
        await _rate_limiter.check(identifier, max_requests)
        rem = await _rate_limiter.get_remaining(identifier, max_requests)
        response.headers["X-RateLimit-Remaining"] = str(rem)
    except HTTPException as e:
        if e.status_code == 429:
            log.warning("rate_limit_exceeded", identifier=identifier, limit=max_requests)
        raise


# ═══════════════════════════════════════════════════════════════════
# MODELS — FIX 3: max_length on every string field
# ═══════════════════════════════════════════════════════════════════

class AnalyzeRequest(BaseModel):
    user_text:     str           = Field(..., max_length=2000)
    session_id:    str           = Field(..., max_length=200)
    user_id:       str           = ""
    audio_rms:     float         = 0.04
    pause_ms:      float         = 500
    ideology_hint: Optional[str] = Field(None, max_length=200)
    user_initiated: Optional[bool] = True

class SensingStateResponse(BaseModel):
    energy: float
    warmth: float
    engagement: float
    trust: float
    tension: float
    arc: str
    arc_turns: int
    mode: str
    injection_type: str
    session_turn: int
    chroma_ready: bool = False
    response_delay_hint: int = 300

class AnalyzeResponse(BaseModel):
    act: Optional[str]
    tags: List[str]
    template: Optional[str]
    source: Optional[str]
    energy: str
    behavior_instructions: str
    emotional_state: str
    intensity: float
    sensing_state: Optional[SensingStateResponse] = None
    status: str
    memory_layer: str = "live"
    memory_enrichment: str = ""
    language_profile: Optional[Dict[str, Any]] = None
    degradation_level: str = "full"

class Turn(BaseModel):
    text:           str  = Field(..., max_length=4000)
    user_initiated: bool
    timestamp:      Optional[int] = None      # epoch ms, used for merge ordering

class SessionEndRequest(BaseModel):
    session_id:    str           = Field(..., max_length=200)
    user_id:       str           = Field(..., max_length=200)
    transcript:    List[Turn]    = Field(..., max_items=50)   # hard cap: 50 turns max
    previous_seed: Optional[str] = Field("", max_length=8000)

class SessionEndResponse(BaseModel):
    seed: str
    session_id: str


# ═══════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════

def is_allowed_origin(request: Request) -> bool:
    """
    FIX 1: Origin-based access control for internal endpoints.
    The Origin header is set by browsers automatically and cannot be
    spoofed by JavaScript. It is not present in server-to-server calls,
    so we also allow requests with no Origin (curl, health checks, etc.)
    only from localhost in development.
    """
    origin = request.headers.get("origin", "")
    if not origin:
        # No Origin header: allow in development, block in production
        return ENVIRONMENT != "production"
    return origin.rstrip("/") in [o.rstrip("/") for o in ALLOWED_ORIGINS]

def get_base_session_id(sid: str) -> str:
    return sid.split("__tab_")[0]

def merge_transcripts(existing: List[Dict], incoming: List[Turn]) -> List[Dict]:
    incoming_dicts = [t.dict() for t in incoming]
    def to_tuple(t): return (t.get("text"), t.get("user_initiated"), t.get("timestamp"))
    seen = set()
    merged = []
    for t in existing + incoming_dicts:
        key = to_tuple(t)
        if key not in seen:
            seen.add(key)
            merged.append(t)
    return sorted(merged, key=lambda x: x.get("timestamp", 0))


# ═══════════════════════════════════════════════════════════════════
# SESSION STORE
# ═══════════════════════════════════════════════════════════════════

class SessionStore:
    def __init__(self):
        self.local_cache: Dict[str, Any] = {}

    async def get(self, session_id: str) -> Optional[Dict]:
        if session_id in self.local_cache:
            return self.local_cache[session_id]
        if supabase:
            try:
                import asyncio
                res = await asyncio.to_thread(
                    lambda: supabase.table("aura_storage").select("data").eq("key", f"active_session_{session_id}").execute()
                )
                if res.data:
                    data = res.data[0]["data"]
                    self.local_cache[session_id] = data
                    return data
            except Exception as e:
                log.debug("session_get_supabase_error", error=str(e))
        return None

    async def set(self, session_id: str, data: Dict):
        self.local_cache[session_id] = data
        if supabase:
            try:
                await asyncio.to_thread(
                    lambda: supabase.table("aura_storage").upsert({
                        "user_id": data.get("user_id", "local-user"),
                        "key": f"active_session_{session_id}",
                        "data": data,
                        "updated_at": datetime.utcnow().isoformat()
                    }, on_conflict="user_id,key").execute()
                )
            except Exception as e:
                log.warning("session_save_failed", error=str(e))

    async def pop(self, session_id: str, default=None):
        val = self.local_cache.pop(session_id, default)
        if supabase:
            try:
                await asyncio.to_thread(
                    lambda: supabase.table("aura_storage").delete().eq("key", f"active_session_{session_id}").execute()
                )
            except Exception as e:
                log.debug("session_pop_supabase_error", error=str(e))
        return val

    def list_expired(self, ttl_hours: int) -> List[str]:
        now = datetime.utcnow()
        ttl = timedelta(hours=ttl_hours)
        expired = []
        for sid, data in self.local_cache.items():
            last_active = data.get("last_active", now)
            if isinstance(last_active, str):
                try:
                    last_active = datetime.fromisoformat(last_active.replace("Z", "+00:00"))
                except:
                    last_active = now
            
            # Ensure last_active is naive if now is naive (utc)
            if last_active.tzinfo:
                last_active = last_active.replace(tzinfo=None)
                
            if now - last_active > ttl:
                expired.append(sid)
        return expired

active_sessions = SessionStore()
SESSION_TTL_HOURS = 2


# ═══════════════════════════════════════════════════════════════════
# STARTUP / CLEANUP
# ═══════════════════════════════════════════════════════════════════

@app.on_event("startup")
async def start_cleanup_task():
    asyncio.create_task(cleanup_expired_sessions())

async def cleanup_expired_sessions():
    while True:
        await asyncio.sleep(3600)
        expired = active_sessions.list_expired(SESSION_TTL_HOURS)
        for sid in expired:
            await active_sessions.pop(sid)
            # P1 FIX: Clean up sensing engines for abandoned sessions
            _sensing_engines.pop(sid, None)
        if expired:
            log.info("session_cleanup", closed=len(expired))


# ═══════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(request: Request, body: AnalyzeRequest, response: Response):
    await apply_rate_limit(f"analyze:{body.session_id}", 60, response)
    """Runtime cascade: keyword → ChromaDB → fallback. Target <200ms.
    
    Brain 3 path (Redis available):
      1. Publish transcript to Redis Stream (fire-and-forget, <1ms)
      2. Read cached analysis from previous consumer run
      3. Enrich with ChromaDB memory (async)
      4. Return immediately
    
    Sync fallback path (Redis unavailable or cache cold):
      Original synchronous pipeline — identical to pre-migration behavior.
    """
    # FIX 1: Origin check replaces the broken X-Internal-Key approach.
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not body.user_text.strip():
        raise HTTPException(status_code=400, detail="user_text cannot be empty")

    import re
    body.user_text = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', body.user_text).strip()
    if not body.user_text:
        raise HTTPException(status_code=400, detail="user_text cannot be empty")

    t0 = time.perf_counter()
    level = degradation.level
    
    if level == DegradationLevel.VOICE_ONLY:
        log.warning("analyze_request", session_id=body.session_id, degradation_level="voice_only", cache_hit=False, duration_ms=round((time.perf_counter() - t0) * 1000, 2))
        return AnalyzeResponse(
            act="chat",
            tags=[],
            template=None,
            source="fallback",
            energy="neutral",
            behavior_instructions="",
            emotional_state="neutral",
            intensity=0.5,
            sensing_state=None,
            status="voice_only",
            memory_enrichment="",
            degradation_level="voice_only"
        )

    try:
        base_id = get_base_session_id(body.session_id)
        session_data = await active_sessions.get(base_id)
        if not session_data:
            session_data = await active_sessions.get(body.session_id)
        seed = session_data.get("seed", "") if session_data else ""

        # ── Brain 3 async path: publish + cache read ──────────────────
        if redis_bus.available:
            # Fire-and-forget publish to Redis Stream
            _safe_background(degradation.execute_with_circuit(
                'redis',
                publish_transcript(
                    session_id=body.session_id,
                    turn_data={
                        "user_text": body.user_text,
                        "session_id": body.session_id,
                        "user_id": body.user_id or "anonymous",
                        "audio_rms": body.audio_rms,
                        "pause_ms": body.pause_ms,
                        "ideology_hint": body.ideology_hint,
                        "user_initiated": body.user_initiated,
                        "seed": seed,
                    },
                ),
                fallback=None,
                timeout=1.0,
            ), name="publish_transcript")

            # Record activity for proactive engine (fire-and-forget)
            if _proactive_engine:
                _safe_background(_proactive_engine.record_activity(body.session_id), name="record_activity")

            # Try to read cached analysis from previous turn
            cached = await degradation.execute_with_circuit(
                'redis',
                read_cached_analysis(body.session_id),
                fallback=None,
                timeout=0.5,
            )
            if cached:
                # Memory enrichment is now included in the cached result
                # (populated by the Brain 3 worker). No inline pgvector call needed.
                enrichment = cached.get("memory_enrichment", "")

                # Inject chroma_ready into sensing_state
                if cached.get("sensing_state"):
                    cached["sensing_state"]["chroma_ready"] = chroma_service.is_ready
                # Strip internal metadata before returning
                cached.pop("_turn_number", None)
                cached.pop("_processed_by", None)
                cached.pop("_memory_retrieved_at", None)
                
                cached["degradation_level"] = level.value
                log.info("analyze_request", session_id=body.session_id, cache_hit=True, degradation_level=level.value, duration_ms=round((time.perf_counter() - t0) * 1000, 2), instruction_length=len(cached.get("behavior_instructions", "")), has_memories=bool(enrichment))
                return AnalyzeResponse(**cached)

        # ── Sync fallback: Redis down or cache cold (first turn) ─────
        result = engine.analyze(body.user_text, body.ideology_hint, body.user_initiated)
        
        # Language detection
        lang_profile = detect_language_profile(body.user_text)

        # Build sensing injection (includes language directive)
        turn_data = {
            "text": body.user_text,
            "audio_rms": body.audio_rms,
            "pause_ms": body.pause_ms,
            "frustration_score": result["all_scores"].get("frustration", 0.0),
            "withdrawal_score": result["all_scores"].get("withdrawal", 0.0),
            "language_profile": lang_profile,
        }
        
        sensing_injection, state_vector, directive = build_sensing_injection(body.session_id, turn_data, seed, user_id=body.user_id or "anonymous")
        
        # Persist StateVector to Supabase async — never blocks response
        _safe_background(degradation.execute_with_circuit(
            'supabase',
            persist_state_vector(supabase, body.session_id, state_vector),
            fallback=None,
            timeout=2.0,
        ), name="persist_state_vector")

        # Get memory enrichment — sync fallback with tighter timeout (was 800ms)
        enrichment = await degradation.execute_with_circuit(
            'embedding_api',
            get_chromadb_enrichment_v2(
                current_text=body.user_text,
                state_vector={
                    "arc": state_vector.arc,
                    "energy": state_vector.energy,
                    "trust": state_vector.trust
                },
                user_id=body.user_id or "anonymous",
                timeout=0.4,  # Tighter than default — sync path must stay fast
                embedding_cache=_embedding_cache
            ),
            fallback="",
            timeout=0.5,
        )

        # Store significant emotional moments async
        _safe_background(degradation.execute_with_circuit(
            'supabase',
            store_and_backup_memory(
                supabase_client=supabase,
                chroma_service=chroma_service,
                user_id=body.user_id,
                session_id=body.session_id,
                turn_text=body.user_text,
                state=state_vector,
                turn_number=state_vector.session_turn if hasattr(state_vector, "session_turn") else 0,
                embedding_cache=_embedding_cache
            ),
            fallback=None,
            timeout=3.0,
        ), name="store_memory")
        
        # Determine emotional state for vocab learning
        emotional_state = (
            "anger" if result["all_scores"].get("frustration", 0) > 0.6
            else "sadness" if state_vector.arc == "withdrawing"
            else "joy" if state_vector.arc == "building"
            else "frustration" if result["all_scores"].get("frustration", 0) > 0.3
            else "neutral"
        )

        # Ingest this turn into vocab learner
        vocab_learner.ingest_turn(
            user_id=body.user_id or "anonymous",
            text=body.user_text,
            lang_profile=lang_profile,
            emotional_state=emotional_state,
            is_greeting=state_vector.session_turn <= 1
        )

        # Enrich lang_profile with learned user abuse vocab
        vocab_summary_dict = vocab_learner.get_vocab_summary(body.user_id or "anonymous")
        if vocab_summary_dict.get("abuse_vocab"):
            lang_profile["user_abuse_vocab"] = vocab_summary_dict["abuse_vocab"]

        # Build vocab injection and combine with sensing injection
        vocab_injection = vocab_learner.build_vocab_injection(body.user_id or "anonymous")
        combined_injection = sensing_injection + (vocab_injection or "")

        # Update result with full combined injection
        result["sensing_injection"] = f"{combined_injection}\n\n{enrichment}"
        instructions = engine.build_instructions(result)
        
        resp = AnalyzeResponse(
            act=result["act"],
            tags=result["tags"],
            template=result.get("template"),
            source=result["source"],
            energy=result["energy"],
            behavior_instructions=instructions,
            emotional_state=result["emotional_state"],
            intensity=result["intensity"],
            sensing_state=SensingStateResponse(
                energy=round(state_vector.energy, 2),
                warmth=round(state_vector.warmth, 2),
                engagement=round(state_vector.engagement, 2),
                trust=round(state_vector.trust, 2),
                tension=round(state_vector.tension, 2),
                arc=state_vector.arc,
                arc_turns=state_vector.arc_turns,
                mode=directive["mode"],
                injection_type=directive.get("injection_type", "passive"),
                session_turn=state_vector.session_turn,
                chroma_ready=chroma_service.is_ready,
                response_delay_hint=directive.get("response_delay_hint", 300)
            ),
            status="success",
            memory_enrichment=enrichment,
            language_profile=lang_profile,
            degradation_level=level.value,
        )
        log.info("analyze_request", session_id=body.session_id, cache_hit=False, degradation_level=level.value, duration_ms=round((time.perf_counter() - t0) * 1000, 2), instruction_length=len(instructions), has_memories=bool(enrichment))
        return resp
    except Exception as e:
        # FIX 4: Never expose internal exception details in production
        if ENVIRONMENT == "production":
            raise HTTPException(status_code=500, detail="Internal server error")
        raise HTTPException(status_code=500, detail=str(e))


from behavior_engine import generate_memory_seed, _sensing_engines
from sensing_engine import summarize_arc_for_seed, SensingEngine


def get_time_context(user_timezone: str = "Asia/Kolkata") -> dict:
    """Gap 3: Give AURA awareness of time-of-day and day-of-week."""
    if pytz:
        tz = pytz.timezone(user_timezone)
        now = datetime.now(tz)
    elif ZoneInfo:
        tz = ZoneInfo(user_timezone)
        now = datetime.now(tz)
    else:
        # Final fallback to UTC or local time if no timezone support
        now = datetime.utcnow()
    
    hour = now.hour

    period = (
        "रात के बाद" if hour < 5       # late night
        else "सुबह" if hour < 12        # morning
        else "दोपहर" if hour < 17       # afternoon
        else "शाम" if hour < 21         # evening
        else "रात"                       # night
    )

    return {
        "period": period,
        "hour": hour,
        "is_late_night": hour < 5 or hour >= 23,
        "day": now.strftime("%A")
    }


@app.post("/session/start")
@limiter.limit("5/minute")            # FIX 2: Rate limit was missing here
async def start_session(request: Request, user_id: str, seed: Optional[str] = "", device_id: Optional[str] = "unknown"):
    import uuid
    session_id = str(uuid.uuid4())
    await active_sessions.set(session_id, {
        "user_id": user_id,
        "device_id": device_id,
        "transcript": [],
        "seed": seed,
        "created_at": datetime.utcnow().isoformat(),
        "last_active": datetime.utcnow().isoformat()
    })
    
    # Sync seed with Supabase — use whichever is newer
    canonical_seed = await get_latest_seed(
        supabase_client=supabase,
        user_id=user_id,
        local_seed=seed
    )

    _sensing_engines[session_id] = SensingEngine(canonical_seed or "")
    
    # Rehydrate StateVector from Supabase if available
    try:
        if supabase:
            saved_state = await asyncio.to_thread(
                lambda: supabase
                    .table("aura_storage")
                    .select("data")
                    .eq("user_id", "system")
                    .eq("key", f"state_vector_{session_id}")
                    .execute()
            )
            if saved_state.data and saved_state.data[0].get("data"):
                sv = saved_state.data[0]["data"]
                engine = _sensing_engines[session_id]
                engine.state.trust = sv.get("trust", engine.state.trust)
                engine.state.companion_boost_count = sv.get(
                    "companion_boost_count", 0
                )
                engine.state.total_withdrawals = sv.get(
                    "total_withdrawals", 0
                )
    except Exception as e:
        log.debug("state_rehydrate_failed", error=str(e))

    # ── Gap 3: Time awareness + session gap context ──
    time_ctx = get_time_context()
    time_note = f"[TIME] {time_ctx['period']}, {time_ctx['day']}. Late night: {time_ctx['is_late_night']} [/TIME]"

    try:
        from relationship_tracker import RelationshipTracker
        _rel_tracker = RelationshipTracker(
            redis_client=redis_bus.client,
            supabase_client=supabase  # C6 FIX: was missing — relationship data was Redis-only
        )
        asyncio.create_task(_rel_tracker.increment_session(user_id))
    except Exception as e:
        log.warning("relationship_increment_failed", error=str(e))

    # Determine gap since last interaction
    last_seen = ""
    try:
        if supabase:
            seed_row = await asyncio.to_thread(
                lambda: supabase.table("aura_seeds")
                    .select("updated_at")
                    .eq("user_id", user_id)
                    .order("updated_at", desc=True)
                    .limit(1).execute()
            )
            if seed_row.data:
                last_seen = seed_row.data[0].get("updated_at", "")
    except Exception:
        pass
    gap = get_gap_context(last_seen)
    gap_note = f"[GAP] {gap} [/GAP]" if gap else ""
    
    if _proactive_engine and last_seen:
        try:
            last = datetime.fromisoformat(last_seen.replace("Z", "+00:00"))
            gap_hours = (datetime.utcnow() - last.replace(tzinfo=None)).total_seconds() / 3600
            if gap_hours > 24:
                asyncio.create_task(_proactive_engine.mark_return_greeting(session_id, gap_hours))
        except Exception:
            pass

    log.info("session_start", session_id=session_id, user_id=user_id, memory_loaded=bool(canonical_seed))
    return {
        "session_id": session_id,
        "status": "ok",
        "canonical_seed": canonical_seed,
        "memory_loaded": bool(canonical_seed),
        "time_context": time_note,
        "gap_context": gap_note,
        "is_late_night": time_ctx["is_late_night"]
    }


@app.post("/session/end", response_model=SessionEndResponse)
@limiter.limit("5/minute")
async def end_session(request: Request, body: SessionEndRequest):
    if len(body.transcript) < 3:
        return SessionEndResponse(seed=body.previous_seed or "", session_id=body.session_id)

    base_id = get_base_session_id(body.session_id)
    session_data = await active_sessions.get(base_id)
    if not session_data:
        session_data = await active_sessions.get(body.session_id)
    existing_transcript = session_data.get("transcript", []) if session_data else []
    merged = merge_transcripts(existing_transcript, body.transcript)
    transcript_to_process = merged[-30:]

    sensing_engine = _sensing_engines.get(base_id) or _sensing_engines.get(body.session_id)
    arc_summary = ""
    state_vector_dict = {}
    if sensing_engine:
        engine_state = sensing_engine.state
        arc_summary = summarize_arc_for_seed(engine_state)
        state_vector_dict = {
            "energy": round(engine_state.energy, 3),
            "warmth": round(engine_state.warmth, 3),
            "engagement": round(engine_state.engagement, 3),
            "trust": round(engine_state.trust, 3),
            "tension": round(engine_state.tension, 3),
            "arc": engine_state.arc,
            "companion_boost_count": engine_state.companion_boost_count,
            "total_withdrawals": engine_state.total_withdrawals,
            "peak_reached": engine_state.peak_reached,
        }
        _sensing_engines.pop(base_id, None)
        _sensing_engines.pop(body.session_id, None)

    # API key extraction no longer strictly necessary if generation moves to backend entirely
    # but we will await the updated generate_memory_seed
    # Serialize vocab profile for seed persistence
    vocab_summary = vocab_learner.serialize(
        session_data.get("user_id", body.user_id) if session_data else body.user_id
    )

    seed = await generate_memory_seed(
        turns=transcript_to_process,
        arc_summary=arc_summary,
        vocab_summary=vocab_summary
    )

    asyncio.create_task(
        save_seed_to_supabase(
            supabase_client=supabase,
            user_id=session_data.get("user_id", body.user_id) if session_data else body.user_id,
            seed=seed,
            state_vector=state_vector_dict,
            device_id=session_data.get("device_id", "unknown") if session_data else "unknown"
        )
    )

    active_sessions.local_cache.pop(base_id, None)
    active_sessions.local_cache.pop(body.session_id, None)

    return SessionEndResponse(seed=seed, session_id=body.session_id)


async def generate_and_store_seed_background(data: dict):
    vocab_summary = vocab_learner.serialize(
        data.get("user_id", "unknown")
    )
    seed = await generate_memory_seed(
        turns=data['transcript'][-30:],
        arc_summary=data.get('arc_summary', ""),
        vocab_summary=vocab_summary
    )
    asyncio.create_task(
        save_seed_to_supabase(
            supabase_client=supabase,
            user_id=data.get("user_id", "unknown"),
            seed=seed,
            state_vector=data.get("state_vector_dict", {}),
            device_id=data.get("device_id", "unknown")
        )
    )


@app.post("/session/end/sync")
@limiter.limit("5/minute")
async def end_session_sync(request: Request, body: SessionEndRequest, background_tasks: BackgroundTasks):
    if len(body.transcript) < 3:
        return {"status": "skipped"}

    api_key = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    base_id = get_base_session_id(body.session_id)
    session_data = await active_sessions.get(base_id)
    if not session_data:
        session_data = await active_sessions.get(body.session_id)
    existing_transcript = session_data.get("transcript", []) if session_data else []
    merged = merge_transcripts(existing_transcript, body.transcript)

    payload = body.dict()
    payload['transcript'] = merged
    payload['api_key'] = api_key
    
    sensing_engine = _sensing_engines.get(base_id) or _sensing_engines.get(body.session_id)
    arc_summary = ""
    state_vector_dict = {}
    if sensing_engine:
        engine_state = sensing_engine.state
        arc_summary = summarize_arc_for_seed(engine_state)
        state_vector_dict = {
            "energy": round(engine_state.energy, 3),
            "warmth": round(engine_state.warmth, 3),
            "engagement": round(engine_state.engagement, 3),
            "trust": round(engine_state.trust, 3),
            "tension": round(engine_state.tension, 3),
            "arc": engine_state.arc,
            "companion_boost_count": engine_state.companion_boost_count,
            "total_withdrawals": engine_state.total_withdrawals,
            "peak_reached": engine_state.peak_reached,
        }
        _sensing_engines.pop(base_id, None)
        _sensing_engines.pop(body.session_id, None)

    payload['arc_summary'] = arc_summary
    payload['state_vector_dict'] = state_vector_dict
    payload['user_id'] = session_data.get("user_id", body.user_id) if session_data else body.user_id
    payload['device_id'] = session_data.get("device_id", "unknown") if session_data else "unknown"

    background_tasks.add_task(generate_and_store_seed_background, payload)
    return {"status": "processing"}


# ═══════════════════════════════════════════════════════════════════
# PROACTIVE ENGAGEMENT
# ═══════════════════════════════════════════════════════════════════

from fastapi import Query as FastAPIQuery

@app.get("/api/proactive/{session_id}")
async def check_proactive(request: Request, session_id: str, response: Response, user_id: str = FastAPIQuery(...)):
    await apply_rate_limit(f"proactive:{session_id}", 10, response)
    """Check if AURA should speak unprompted. Polled every 15s by frontend during idle periods."""
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not _proactive_engine:
        return {"action": None}

    try:
        action = await _proactive_engine.check(session_id, user_id)
        if action:
            return {
                "action": action.type.value,
                "inject_text": action.inject_text,
                "priority": action.priority,
            }
    except Exception:
        pass  # Proactive is optional — never error out

    return {"action": None}


@app.get("/health")
async def health(request: Request, response: Response):
    client_ip = get_remote_address(request)
    await apply_rate_limit(f"health:{client_ip}", 30, response)
    """
    System-wide health check. Each subsystem is probed independently
    with its own timeout so one slow/dead service never blocks the others.

    Overall status logic:
      - "critical"  — Redis is down (Brain 3 cannot function at all)
      - "degraded"  — Redis OK but consumer dead OR Supabase unreachable
      - "healthy"   — all checks pass
    """
    import time as _time

    checks = {}
    overall = "healthy"

    # ──────────────────────────────────────────────────────────────
    # 1. Redis PING  (timeout: 2s)
    # ──────────────────────────────────────────────────────────────
    redis_ok = False
    redis_latency = -1.0
    try:
        async def _redis_ping():
            client = redis_bus.client
            if not client:
                return False, -1.0
            t0 = _time.monotonic()
            await client.ping()
            return True, round((_time.monotonic() - t0) * 1000, 2)

        redis_ok, redis_latency = await asyncio.wait_for(_redis_ping(), timeout=2.0)
    except asyncio.TimeoutError:
        redis_ok = False
        redis_latency = -1.0
    except Exception:
        redis_ok = False
        redis_latency = -1.0

    checks["redis"] = {"ok": redis_ok, "latency_ms": redis_latency}
    if not redis_ok:
        overall = "critical"

    # ──────────────────────────────────────────────────────────────
    # 2. Consumer heartbeat + lag  (timeout: 2s)
    # ──────────────────────────────────────────────────────────────
    consumer_ok = False
    heartbeat_ago = -1.0
    consumer_lag = -1
    try:
        async def _consumer_check():
            client = redis_bus.client
            if not client:
                return False, -1.0, -1

            # Heartbeat: the consumer writes this key with a 30s TTL.
            # If the key is missing, the consumer has been dead for >30s.
            hb_raw = await client.get("aura:consumer:heartbeat")
            if hb_raw:
                ago = round(_time.time() - float(hb_raw), 2)
                alive = ago < 30.0
            else:
                ago = -1.0
                alive = False

            # Lag: XINFO GROUPS returns pending count per group.
            lag = 0
            try:
                groups = await client.xinfo_groups(STREAM_KEY)
                for g in groups:
                    if g.get("name") == CONSUMER_GROUP:
                        lag = int(g.get("lag", g.get("pending", 0)))
                        break
            except Exception:
                lag = -1

            return alive, ago, lag

        consumer_ok, heartbeat_ago, consumer_lag = await asyncio.wait_for(
            _consumer_check(), timeout=2.0
        )
    except asyncio.TimeoutError:
        consumer_ok = False
    except Exception:
        consumer_ok = False

    checks["consumer"] = {
        "ok": consumer_ok,
        "last_heartbeat_seconds_ago": heartbeat_ago,
        "lag": consumer_lag,
    }
    if not consumer_ok and overall == "healthy":
        overall = "degraded"

    # ──────────────────────────────────────────────────────────────
    # 3. Supabase connectivity  (timeout: 3s)
    # ──────────────────────────────────────────────────────────────
    supa_ok = False
    supa_latency = -1.0
    try:
        async def _supabase_check():
            if not supabase:
                return False, -1.0
            t0 = _time.monotonic()
            # Lightweight probe: read one row from a table we know exists.
            # This validates both the connection and the service-role key.
            res = await asyncio.to_thread(
                lambda: supabase.table("aura_storage").select("key").limit(1).execute()
            )
            latency = round((_time.monotonic() - t0) * 1000, 2)
            return True, latency

        supa_ok, supa_latency = await asyncio.wait_for(
            _supabase_check(), timeout=3.0
        )
    except asyncio.TimeoutError:
        supa_ok = False
        supa_latency = -1.0
    except Exception:
        supa_ok = False
        supa_latency = -1.0

    checks["supabase"] = {"ok": supa_ok, "latency_ms": supa_latency}
    if not supa_ok and overall == "healthy":
        overall = "degraded"

    log.info("health_check", status=overall, degradation_level=degradation.level.value)
    return {
        "status": overall,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "version": "4.1",
        **degradation.status(),
        "checks": checks,
        "embedding_cache": (await _embedding_cache.get_stats()) if _embedding_cache else {"status": "not_initialized"}
    }


import httpx


# ═══════════════════════════════════════════════════════════════════
# SUPABASE CONNECT — FALLBACK PROXY ENDPOINT
# ═══════════════════════════════════════════════════════════════════

class SqlSetupRequest(BaseModel):
    access_token: str = Field(..., max_length=4000)
    project_ref:  str = Field(..., max_length=100)
    sql:          str = Field(..., max_length=10000)

@app.post("/supabase/setup-sql")
async def supabase_setup_sql(request: Request, body: SqlSetupRequest):
    """Run AURA setup SQL against a user's Supabase project via Management API.
    Kept as fallback for advanced users — the primary flow runs SQL via the dashboard."""
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    async with httpx.AsyncClient() as client:
        res = await client.post(
            f"https://api.supabase.com/v1/projects/{body.project_ref}/database/query",
            headers={
                "Authorization": f"Bearer {body.access_token}",
                "Content-Type": "application/json",
            },
            json={"query": body.sql},
            timeout=30.0,
        )
        if res.status_code != 200 and res.status_code != 201:
            return {"status": "error", "detail": res.text}
        return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
