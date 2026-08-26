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
from backend.infrastructure.degradation import degradation, DegradationLevel
from backend.infrastructure.logging import setup_logging, get_logger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from backend.memory.chroma import chroma_service
from backend.memory.sync import (
    get_latest_seed,
    save_seed_to_supabase,
    persist_state_vector,
    store_and_backup_memory,
    get_chromadb_enrichment_v2,
    get_gap_context
)
from backend.bus.redis import (
    redis_bus,
    publish_transcript,
    read_cached_analysis,
    expire_session_cache,
    STREAM_KEY,
    CONSUMER_GROUP,
)
from backend.infrastructure.embedding_cache import EmbeddingCache
from backend.infrastructure.embedding_provider import embedding_provider

# Load .env.local from the project root (two directories up from backend/api)
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(project_root, ".env.local"))
import sys
import os

# FIX: Import collision workaround. The local ./supabase/ directory (CLI) 
# overrides the pip 'supabase' package. Temporarily drop cwd from path to import.
_cwd = sys.path.pop(0) if sys.path and (sys.path[0] == '' or sys.path[0] == os.getcwd()) else None
from supabase._async.client import AsyncClient, create_client as async_create_client
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
supabase: AsyncClient | None = None

from backend.core.behavior import RuntimeEngine, build_sensing_injection, detect_language_profile
from backend.core.vocab import vocab_learner
from backend.core.proactive import ProactiveEngine
from backend.infrastructure.rate_limiter import RateLimiter
from backend.core.intelligence import composer

# Module-level proactive engine and rate limiter (initialized at startup with Redis client)
_proactive_engine: ProactiveEngine | None = None
_rate_limiter: RateLimiter | None = None
_embedding_cache: EmbeddingCache | None = None

# gemini_embed_fn removed — replaced by embedding_provider.embed()
# which handles Gemini → Cohere → FastEmbed → None fallback chain.

# C4 FIX: Initialize logging BEFORE app creation so get_logger returns configured loggers
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
setup_logging(env=ENVIRONMENT)
log = get_logger("server")


# ═══════════════════════════════════════════════════════════════════
# FASTAPI APP CREATION
# ═══════════════════════════════════════════════════════════════════

app = FastAPI(
    title="AURA Behavior Engine",
    version="3.0",
    docs_url="/docs" if ENVIRONMENT != "production" else None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from backend.api.cron import router as cron_router
app.include_router(cron_router)

from backend.api.memory_endpoints import router as memory_router
app.include_router(memory_router)


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

try:
    from backend.api import webhooks
    app.include_router(webhooks.router)
except ImportError:
    pass

try:
    from backend.api.cron import router as cron_router
    app.include_router(cron_router)
except ImportError as e:
    log.error("Failed to import cron router", error=str(e))
    pass

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

@app.on_event("startup")
async def startup_event():
    global supabase
    if SUPABASE_URL and SUPABASE_KEY:
        supabase = await async_create_client(SUPABASE_URL, SUPABASE_KEY)

    asyncio.create_task(
        chroma_service.initialize(
            supabase_client=supabase,
            rebuild_user_id=None
        )
    )
    # ── Brain 3: Redis bus ──
    redis_ok = await redis_bus.initialize()
    if redis_ok:
        print("[AURA] Brain 3 Redis bus initialized (BackgroundTasks pipeline active)")
        # Initialize proactive engine and rate limiter with Redis client
        global _proactive_engine, _rate_limiter, _embedding_cache
        _proactive_engine = ProactiveEngine(redis_bus.client)
        _rate_limiter = RateLimiter(redis_bus.client)
        # Wire embedding cache with the multi-tier provider's embed function.
        # Cache works regardless of which backend (Gemini/Cohere/FastEmbed) is active.
        _embedding_cache = EmbeddingCache(redis_bus.client, embedding_provider.embed)
        # P8 FIX: Wire vocab_learner singleton with persistence clients
        from backend.core.vocab import set_vocab_learner_clients
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
    is_open = degradation.circuits['redis'].state.value == 'open' if 'redis' in degradation.circuits else False
    if not _rate_limiter or is_open:
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
    was_interrupted: Optional[bool] = False
    music_context: Optional[dict] = None

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
    intelligence_context: Optional[Dict[str, Any]] = None

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
                res = await supabase.table("aura_storage").select("data").eq("key", f"active_session_{session_id}").execute()
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
                await supabase.table("aura_storage").upsert({
                    "user_id": data.get("user_id", "local-user"),
                    "key": f"active_session_{session_id}",
                    "data": data,
                    "updated_at": datetime.utcnow().isoformat()
                }, on_conflict="user_id,key").execute()
            except Exception as e:
                log.warning("session_save_failed", error=str(e))

    async def pop(self, session_id: str, default=None):
        val = self.local_cache.pop(session_id, default)
        if supabase:
            try:
                await supabase.table("aura_storage").delete().eq("key", f"active_session_{session_id}").execute()
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
_loaded_gemini_key = None
_loaded_or_key = None
_loaded_cohere_key = None
_loaded_pinecone_key = None
_loaded_redis_url = None

async def update_byok_credentials(request: Request):
    global _loaded_gemini_key, _loaded_or_key, _loaded_cohere_key, _loaded_pinecone_key, _loaded_redis_url
    import os
    
    gemini_key = request.headers.get("x-gemini-key", "").strip(' \t\n\r"')
    or_key = request.headers.get("x-openrouter-key", "").strip(' \t\n\r"')
    cohere_key = request.headers.get("x-cohere-key", "").strip(' \t\n\r"')
    pinecone_key = request.headers.get("x-pinecone-key", "").strip(' \t\n\r"')
    redis_url = request.headers.get("x-redis-url", "").strip(' \t\n\r"')
    
    changed_embed = False
    
    if gemini_key and gemini_key != _loaded_gemini_key:
        os.environ["GEMINI_API_KEY"] = gemini_key
        _loaded_gemini_key = gemini_key
        changed_embed = True
        
    if or_key and or_key != _loaded_or_key:
        os.environ["OPENROUTER_API_KEY"] = or_key
        _loaded_or_key = or_key
        
    if cohere_key and cohere_key != _loaded_cohere_key:
        os.environ["COHERE_API_KEY"] = cohere_key
        _loaded_cohere_key = cohere_key
        changed_embed = True
        
    if pinecone_key and pinecone_key != _loaded_pinecone_key:
        os.environ["PINECONE_API_KEY"] = pinecone_key
        _loaded_pinecone_key = pinecone_key
        
    if redis_url and redis_url != _loaded_redis_url:
        os.environ["REDIS_URL"] = redis_url
        _loaded_redis_url = redis_url
        from backend.bus.redis import redis_bus
        await redis_bus.initialize()
        
    if changed_embed:
        from backend.infrastructure.embedding_provider import embedding_provider
        await embedding_provider.initialize()

# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

try:
    from upstash_qstash import Client
    qstash_token = os.environ.get("QSTASH_TOKEN")
    qstash_client = Client(qstash_token) if qstash_token else None
except ImportError:
    qstash_client = None

async def prefetch_memory(text: str, session_id: str, user_id: str):
    try:
        from backend.memory.sync import get_chromadb_enrichment_v2
        from backend.core.behavior import _sensing_engines
        state_dict = {}
        if session_id in _sensing_engines:
            state_dict = _sensing_engines[session_id].state.__dict__
        memory_enrichment = await get_chromadb_enrichment_v2(
            current_text=text,
            state_vector=state_dict,
            user_id=user_id,
            timeout=2.0,
            embedding_cache=_embedding_cache
        )
        if redis_bus.client:
            await redis_bus.client.set(f"speculative_mem:{session_id}", memory_enrichment, ex=10)
        else:
            active_sessions.local_cache[f"speculative_mem:{session_id}"] = memory_enrichment
    except Exception as e:
        log.warning("prefetch_failed", error=str(e))

async def retrieve_prefetched_memory(session_id: str) -> str:
    if redis_bus.client:
        mem = await redis_bus.client.get(f"speculative_mem:{session_id}")
        if mem:
            return mem
    else:
        return active_sessions.local_cache.pop(f"speculative_mem:{session_id}", "")
    return ""

@app.post("/api/speculate")
async def speculate_memory(payload: dict, background_tasks: BackgroundTasks):
    session_id = payload.get("session_id")
    partial_text = payload.get("text", "")
    user_id = payload.get("user_id", "anonymous")
    
    background_tasks.add_task(
        prefetch_memory,
        text=partial_text,
        session_id=session_id,
        user_id=user_id
    )
    return {"status": "speculating"}

@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(request: Request, body: AnalyzeRequest, response: Response, background_tasks: BackgroundTasks):
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

    # ── BYOK: Extract API keys from headers and inject into environment ──
    await update_byok_credentials(request)

    if not body.user_text.strip():
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

        turn_history = session_data.get("turn_history", []) if session_data else []
        
        # Update session immediately
        turn_history.append({"text": body.user_text, "user_initiated": body.user_initiated})
        if len(turn_history) > 10: turn_history.pop(0)
        if session_data:
            session_data["turn_history"] = turn_history
            background_tasks.add_task(active_sessions.set, body.session_id, session_data)

        # 1. HOT PATH: Instant Emotional Routing (< 5ms)
        # Calculate the 15-dimensional state dynamically inline. No DB calls.
        raw_analysis = engine.analyze(
            transcript=body.user_text, 
            ideology=body.ideology_hint,
            user_initiated=body.user_initiated,
            turn_history=turn_history
        )
        
        # 2. INSTANT RAG: Retrieve the memory that was speculatively fetched moments ago
        cached_memory = await retrieve_prefetched_memory(body.session_id)
        
        # Build the exact behavioral instructions to steer the LLM
        behavior_instructions = engine.build_instructions(raw_analysis)
        if cached_memory:
            behavior_instructions += f"\n\n{cached_memory}"

        # 3. BACKGROUND PATH: Supabase Memory, Vocab, & Deep Context
        # Instead of BackgroundTasks, publish to QStash if configured
        if qstash_client:
            qstash_client.publish_json(
                url=f"{os.environ.get('VERCEL_URL', 'http://localhost:8000')}/api/webhooks/process_memory",
                body={
                    "session_id": body.session_id,
                    "user_id": body.user_id,
                    "user_text": body.user_text,
                    "audio_rms": body.audio_rms,
                    "ideology_hint": body.ideology_hint,
                    "user_initiated": body.user_initiated,
                    "pause_ms": body.pause_ms,
                    "turn_history": turn_history,
                    "seed": seed,
                }
            )
        else:
            from backend.core.pipeline import run_turn_pipeline
            client_ip = request.client.host if request.client else None
            background_tasks.add_task(
                run_turn_pipeline,
                engine=engine,
                user_text=body.user_text,
                session_id=body.session_id,
                user_id=body.user_id or "anonymous",
                ideology_hint=body.ideology_hint,
                user_initiated=body.user_initiated,
                audio_rms=body.audio_rms,
                pause_ms=body.pause_ms,
                seed=seed,
                turn_history=list(turn_history),
                vocab_learner=vocab_learner,
                embedding_cache=_embedding_cache,
                ip_address=client_ip,
                memory_timeout=2.0,
                music_context=body.music_context
            )

        # Record activity for proactive engine
        if _proactive_engine:
            background_tasks.add_task(_proactive_engine.record_activity, body.session_id)

        # 3. INSTANT RETURN: Deliver instructions to the voice loop immediately
        log.info("analyze_request_eager", session_id=body.session_id, duration_ms=round((time.perf_counter() - t0) * 1000, 2))
        return AnalyzeResponse(
            act=raw_analysis.get("act"),
            tags=raw_analysis.get("tags", []),
            template=raw_analysis.get("template"),
            source="eager_dual_path",
            energy=raw_analysis.get("energy", "neutral"),
            behavior_instructions=behavior_instructions,
            emotional_state=raw_analysis.get("emotional_state", "neutral"),
            intensity=raw_analysis.get("intensity", 0.5),
            sensing_state=None,
            status="success",
            memory_layer="background",
            memory_enrichment="",
            degradation_level=level.value
        )
    except Exception as e:

        # FIX 4: Never expose internal exception details in production
        if ENVIRONMENT == "production":
            raise HTTPException(status_code=500, detail="Internal server error")
        raise HTTPException(status_code=500, detail=str(e))



from backend.core.behavior import generate_memory_seed, _sensing_engines
from backend.core.sensing import summarize_arc_for_seed, SensingEngine


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


# NOTE: Simple /health removed — the detailed /health endpoint (below) handles
# all health checks and returns checks.supabase.ok for frontend mode detection.


class ChatRequest(BaseModel):
    text: str = Field(..., max_length=2000)
    user_id: str = Field(..., max_length=200)
    session_id: Optional[str] = Field(None, max_length=200)
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)
    # Phase 3: client-side memory injection for local browser mode
    client_memories: Optional[List[Dict[str, Any]]] = Field(None, max_length=5)
    memory_mode: Optional[str] = Field("supabase", max_length=20)
    # Phase 10: the Executive's directive (strategy/register/budget/clarify/…)
    # and its memory usage decision. Previously sent but silently dropped —
    # the Executive chain severed at the API boundary.
    executive_plan: Optional[str] = Field(None, max_length=2000)
    memory_policy: Optional[str] = Field(None, max_length=20)
    # Phase E: Canonical cognitive block generated by frontend ConversationInterpreter
    cognitive_block: Optional[str] = Field(None, max_length=4000)
    music_context: Optional[dict] = None

@app.post("/api/analyze/stream")
async def analyze_turn_stream(request: Request, body: ChatRequest, response: Response, background_tasks: BackgroundTasks):
    from fastapi.responses import StreamingResponse
    import json
    await apply_rate_limit(f"analyze_stream:{body.session_id}", 60, response)
    
    # ── BYOK: Extract API keys ──
    await update_byok_credentials(request)
    
    session_id = body.session_id or "default"
    
    base_id = get_base_session_id(session_id)
    session_data = await active_sessions.get(base_id)
    if not session_data:
        session_data = await active_sessions.get(session_id)
    seed = session_data.get("seed", "") if session_data else ""
    turn_history = session_data.get("turn_history", []) if session_data else []
    
    turn_history.append({"text": body.text, "user_initiated": True})
    if len(turn_history) > 10: turn_history.pop(0)

    if body.cognitive_block:
        # Canonical Path: Frontend ConversationInterpreter already did the work.
        raw_analysis = {"emotional_state": "neutral"}
        behavior_instructions = ""
        system_prompt = f"{body.cognitive_block}\n\nRespond in 1-3 sentences. Speak naturally, not formally."
    else:
        # Fast path routing logic
        raw_analysis = engine.analyze(
            transcript=body.text, 
            user_initiated=True,
            turn_history=turn_history
        )
        behavior_instructions = engine.build_instructions(raw_analysis)
        
        # Phase 10: the Executive directive is the plan of record — it must
        # reach the LLM or the entire decision chain is severed. First position
        # = highest priority for the model.
        if body.executive_plan:
            behavior_instructions = f"{body.executive_plan}\n\n{behavior_instructions}"
        
        # Phase 10: memory enforcement — memories the Executive ignored never
        # reach the LLM; local-mode memories (previously dropped on this path)
        # are injected when the policy allows.
        memory_lines = []
        if body.memory_policy != "Ignore" and body.client_memories:
            memory_lines = [
                f"- {(m.get('content') or m.get('text', ''))[:150]}"
                for m in body.client_memories[:5]
                if m.get('content') or m.get('text')
            ]
        cached_memory = await retrieve_prefetched_memory(session_id)
        if cached_memory and body.memory_policy != "Ignore":
            behavior_instructions += f"\n\n{cached_memory}"
        if memory_lines:
            behavior_instructions += f"\n\n[MEMORY ENRICHMENT]\n" + "\n".join(memory_lines) + "\n[END MEMORY]"
            
        system_prompt = f"{behavior_instructions}\n\nRespond in 1-3 sentences. Speak naturally, not formally."
    
    async def event_generator():
        # 1. Yield metadata immediately
        initial_metadata = {
            "event": "metadata",
            "emotional_state": raw_analysis.get("emotional_state", "neutral"),
            "behavior_instructions": behavior_instructions
        }
        yield f"data: {json.dumps(initial_metadata)}\n\n"
        
        # 2. Yield LLM tokens
        from backend.core.intelligence.llm_pipeline import stream_openrouter_response
        full_response = ""
        async for chunk in stream_openrouter_response(body.conversation_history, system_prompt):
            if "error" in chunk:
                yield f"data: {json.dumps({'event': 'error', 'error': chunk['error']})}\n\n"
                break
            if "text" in chunk:
                full_response += chunk["text"]
                yield f"data: {json.dumps({'event': 'text_chunk', 'text': chunk['text']})}\n\n"
            
        # 3. Trigger background tasks
        if qstash_client:
            qstash_client.publish_json(
                url=f"{os.environ.get('VERCEL_URL', 'http://localhost:8000')}/api/webhooks/process_memory",
                body={
                    "session_id": session_id,
                    "user_id": body.user_id,
                    "user_text": body.text,
                    "audio_rms": 0.04,
                    "ideology_hint": None,
                    "user_initiated": True,
                    "pause_ms": 500,
                    "turn_history": turn_history,
                    "seed": seed,
                }
            )
        else:
            from backend.core.pipeline import run_turn_pipeline
            client_ip = request.client.host if request.client else None
            background_tasks.add_task(
                run_turn_pipeline,
                engine=engine,
                user_text=body.text,
                session_id=session_id,
                user_id=body.user_id,
                ideology_hint=None,
                user_initiated=True,
                audio_rms=0.04,
                pause_ms=500,
                seed=seed,
                turn_history=list(turn_history),
                vocab_learner=vocab_learner,
                embedding_cache=_embedding_cache,
                ip_address=client_ip,
                memory_timeout=2.0
            )
        
        yield f"data: {json.dumps({'event': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/chat")
async def chat_endpoint(body: ChatRequest, request: Request):
    import time
    import os
    t_start = time.perf_counter()
    
    # ── BYOK: Extract API keys from headers and inject into environment ──
    await update_byok_credentials(request)

    from backend.core.pipeline import run_turn_pipeline
    from backend.core.intelligence.llm_pipeline import generate_response
    import uuid

    session_id = body.session_id or str(uuid.uuid4())
    user_id = body.user_id or "anonymous"
    client_ip = request.client.host if request.client else None

    # L1-L5 pipeline shared with /api/analyze (Phase 2 DRY fix)
    turn_result = await run_turn_pipeline(
        engine=engine,
        user_text=body.text,
        session_id=session_id,
        user_id=user_id,
        user_initiated=True,
        vocab_learner=vocab_learner,
        embedding_cache=_embedding_cache,
        ip_address=client_ip,
        memory_timeout=0.4,
        music_context=body.music_context
    )

    # Determine which memories to use (client-provided vs server-fetched)
    active_memory_mode = body.memory_mode or "supabase"
    # Phase 10: memories the Executive ignored never reach the LLM.
    if body.memory_policy == "Ignore":
        memory_lines = []
    elif body.client_memories and len(body.client_memories) > 0:
        # Client provided local memories — override server retrieval
        memory_lines = [f"- {(m.get('content') or m.get('text', ''))[:150]}" for m in body.client_memories[:5] if m.get('content') or m.get('text')]
        memory_context = "Past context:\n" + "\n".join(memory_lines) if memory_lines else ""
        if memory_context:
            turn_result.sensing_injection += f"\n\n[MEMORY ENRICHMENT]\n{memory_context}\n[END MEMORY]"
        active_memory_mode = "local"
        memories_used = [m.get("content") or m.get("text", "") for m in body.client_memories[:5]]
    else:
        # Used server retrieved memories from pipeline
        memories_used = [turn_result.memory_enrichment] if turn_result.memory_enrichment else []

    # Format the final LLM prompt (L4)
    # The pipeline's sensing_injection already contains behavior instructions + memory enrichment
    emotion_str = ", ".join([f"{k}={v:.1f}" for k, v in turn_result.all_scores.items()]) if turn_result.all_scores else turn_result.emotional_state
    system_prompt = f"{turn_result.sensing_injection}\n\nCurrent emotional state: {emotion_str}\n\nRespond in 1-3 sentences. Speak naturally, not formally."

    # Phase 10: the Executive directive is the plan of record — first position.
    if body.executive_plan:
        system_prompt = f"{body.executive_plan}\n\n{system_prompt}"

    # L4 — LLM generation
    response_text, is_stale, active_llm = await generate_response(body.conversation_history, system_prompt)

    # Store interaction (only when server manages storage — Mode A)
    if active_memory_mode == "supabase":
        _safe_background(degradation.execute_with_circuit(
            'supabase',
            store_and_backup_memory(
                supabase_client=supabase,
                chroma_service=chroma_service,
                user_id=user_id,
                session_id=session_id,
                turn_text=body.text,
                state=type('_sv', (), turn_result.sensing_state)(),
                turn_number=turn_result.sensing_state.get("session_turn", 0),
                embedding_cache=_embedding_cache
            ),
            fallback=None,
            timeout=3.0,
        ), name="store_chat_memory")

    return {
        "response_text": response_text,
        "emotional_state": turn_result.all_scores or {"dominant": turn_result.emotional_state},
        "memories_used": memories_used,
        "memory_mode": active_memory_mode,
        "latency": round((time.perf_counter() - t_start) * 1000, 2),
        "is_stale": is_stale,
        "active_llm": active_llm
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
            saved_state = await supabase.table("aura_storage").select("data").eq("user_id", "system").eq("key", f"state_vector_{session_id}").execute()
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
        from backend.core.relationship import RelationshipTracker
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
            seed_row = await supabase.table("aura_seeds").select("updated_at").eq("user_id", user_id).order("updated_at", desc=True).limit(1).execute()
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
            res = await supabase.table("aura_storage").select("key").limit(1).execute()
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

# ═══════════════════════════════════════════════════════════════════
# REDIS UI ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.get("/api/redis/stats")
async def get_redis_stats(request: Request):
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    
    await update_byok_credentials(request)
    
    from backend.bus.redis import redis_bus
    if not redis_bus.available or not redis_bus.client:
        return {"available": False, "message": "Redis is not connected"}
        
    client = redis_bus.client
    
    try:
        info = await client.info("memory")
        used_memory_human = info.get("used_memory_human", "0B")
        
        stats = await client.info("stats")
        total_commands_processed = stats.get("total_commands_processed", 0)
        
        keys = await client.keys("aura:analysis:*")
        sessions = []
        for key in keys:
            ttl = await client.ttl(key)
            session_id = key.replace("aura:analysis:", "")
            sessions.append({
                "id": session_id,
                "ttl": ttl
            })
            
        try:
            stream_len = await client.xlen("aura:transcripts")
        except Exception:
            stream_len = 0
            
        return {
            "available": True,
            "memory_used": used_memory_human,
            "total_commands": total_commands_processed,
            "active_sessions": sessions,
            "stream_length": stream_len
        }
    except Exception as e:
        return {"available": False, "message": str(e)}

@app.delete("/api/redis/session/{session_id}")
async def delete_redis_session(session_id: str, request: Request):
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    await update_byok_credentials(request)
    from backend.bus.redis import redis_bus
    if not redis_bus.available or not redis_bus.client:
        raise HTTPException(status_code=503, detail="Redis unavailable")
    await redis_bus.client.delete(f"aura:analysis:{session_id}")
    return {"status": "success", "message": f"Deleted session {session_id}"}
    
@app.delete("/api/redis/stream")
async def clear_redis_stream(request: Request):
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")
    await update_byok_credentials(request)
    from backend.bus.redis import redis_bus
    if not redis_bus.available or not redis_bus.client:
        raise HTTPException(status_code=503, detail="Redis unavailable")
    await redis_bus.client.delete("aura:transcripts")
    return {"status": "success", "message": "Cleared transcript stream"}


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


# ═══════════════════════════════════════════════════════════════════
# ADAPTIVE TURN DETECTION — Profile & Telemetry Endpoints
# ═══════════════════════════════════════════════════════════════════

from backend.adaptive_turn_detection import AdaptiveTurnDetector

# Per-user detector instances (server-side, for profile persistence)
_turn_detectors: Dict[str, AdaptiveTurnDetector] = {}

def _get_detector(user_id: str) -> AdaptiveTurnDetector:
    if user_id not in _turn_detectors:
        _turn_detectors[user_id] = AdaptiveTurnDetector(user_id=user_id)
    return _turn_detectors[user_id]


class TurnProfilePayload(BaseModel):
    user_id: str = Field(..., max_length=200)
    profile: Dict[str, Any]


class TurnDetectPayload(BaseModel):
    user_id: str = Field(..., max_length=200)
    silence_ms: float = 0.0
    text: str = Field("", max_length=2000)
    emotional_intensity: float = 0.0
    context_signals: Optional[Dict[str, float]] = None


@app.post("/api/turn-profile/save")
async def save_turn_profile(request: Request, body: TurnProfilePayload):
    """Persist a user's adaptive speech profile server-side."""
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    detector = _get_detector(body.user_id)
    detector.load_profile_dict(body.profile)

    # Persist to Supabase if available
    if supabase:
        try:
            await supabase.table("aura_storage").upsert({
                "user_id": body.user_id,
                "key": "speech_profile",
                "data": body.profile,
                "updated_at": datetime.utcnow().isoformat()
            }, on_conflict="user_id,key").execute()
        except Exception as e:
            log.warning("turn_profile_save_failed", error=str(e))

    return {"status": "ok"}


@app.get("/api/turn-profile/load")
async def load_turn_profile(request: Request, user_id: str):
    """Load a user's adaptive speech profile from server storage."""
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    # Try Supabase first
    if supabase:
        try:
            res = await supabase.table("aura_storage").select("data").eq(
                "user_id", user_id
            ).eq("key", "speech_profile").execute()
            if res.data and res.data[0].get("data"):
                return {"status": "ok", "profile": res.data[0]["data"]}
        except Exception as e:
            log.debug("turn_profile_load_failed", error=str(e))

    # Fallback: return in-memory profile or defaults
    detector = _get_detector(user_id)
    return {"status": "ok", "profile": detector.profile.to_dict()}


@app.post("/api/turn-detect")
async def turn_detect(request: Request, body: TurnDetectPayload):
    """
    Server-side turn confidence calculation.

    Used for observability and debugging — the primary detection
    runs client-side for zero-latency.
    """
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    detector = _get_detector(body.user_id)
    result = detector.calculate_turn_confidence(
        silence_ms=body.silence_ms,
        text=body.text,
        emotional_intensity=body.emotional_intensity,
        context_signals=body.context_signals,
    )

    return {
        "confidence": result.confidence,
        "should_respond": result.should_respond,
        "effective_threshold": result.effective_threshold,
        "reason": result.reason,
        "telemetry": detector.get_telemetry(),
    }


# ═══════════════════════════════════════════════════════════════════
# YTMUSIC INTEGRATION
# ═══════════════════════════════════════════════════════════════════
class YTMusicSearchResponse(BaseModel):
    title: Optional[str] = None
    artist: Optional[str] = None
    duration: Optional[int] = None
    thumbnail: Optional[str] = None
    youtube_id: Optional[str] = None
    audio_stream_url: Optional[str] = None
    source: str = "youtube"
    error: bool = False
    message: Optional[str] = None

@app.get("/api/ytmusic/search", response_model=YTMusicSearchResponse)
async def search_ytmusic(query: str, request: Request, response: Response):
    import asyncio
    client_ip = request.client.host if request.client else "unknown"
    await apply_rate_limit(f"ytmusic:{client_ip}", 30, response)
    
    def extract_with_ytdlp(q: str):
        try:
            import yt_dlp
        except ImportError:
            # Fallback mock for testing in restricted environments if yt_dlp is missing
            return {
                "title": q,
                "artist": "Unknown",
                "duration": 180,
                "thumbnail": "",
                "youtube_id": "mock_id",
                "audio_stream_url": "mock_url"
            }
        ydl_opts = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'default_search': 'ytsearch',
            'extract_flat': False,
            'quiet': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch1:{q}", download=False)
            if 'entries' in info and len(info['entries']) > 0:
                entry = info['entries'][0]
                return {
                    "title": entry.get('title'),
                    "artist": entry.get('uploader'),
                    "duration": entry.get('duration'),
                    "thumbnail": entry.get('thumbnail'),
                    "youtube_id": entry.get('id'),
                    "audio_stream_url": entry.get('url'),
                }
            return None

    try:
        result = await asyncio.to_thread(extract_with_ytdlp, query)
        if result:
            return YTMusicSearchResponse(**result)
        return YTMusicSearchResponse(error=True, message="Unable to find playable audio.")
    except Exception as e:
        log.error("ytmusic_search_failed", error=str(e))
        return YTMusicSearchResponse(error=True, message="Unable to find playable audio.")


# ═══════════════════════════════════════════════════════════════════
# AUDIO PROXY — Streams YouTube audio through the backend to bypass
# browser CORS restrictions on googlevideo.com URLs.
# ═══════════════════════════════════════════════════════════════════
import base64 as b64
from urllib.parse import quote, unquote

# In-memory cache for resolved audio URLs (short TTL, they expire quickly)
_audio_url_cache: dict[str, tuple[str, float]] = {}

@app.get("/api/ytmusic/proxy")
async def proxy_audio(url: str, request: Request, response: Response):
    """Proxy an audio stream URL to bypass CORS restrictions."""
    import httpx
    import time

    decoded_url = unquote(url)
    
    # Validate URL is from a trusted source
    if not any(domain in decoded_url for domain in ["googlevideo.com", "youtube.com", "ytimg.com"]):
        return Response(content="Forbidden", status_code=403)

    # Forward range headers for seeking support
    headers = {}
    range_header = request.headers.get("range")
    if range_header:
        headers["Range"] = range_header

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            upstream = await client.get(decoded_url, headers=headers)
            
            response_headers = {
                "Content-Type": upstream.headers.get("Content-Type", "audio/webm"),
                "Accept-Ranges": "bytes",
                "Access-Control-Allow-Origin": "*",
            }
            
            if "Content-Length" in upstream.headers:
                response_headers["Content-Length"] = upstream.headers["Content-Length"]
            if "Content-Range" in upstream.headers:
                response_headers["Content-Range"] = upstream.headers["Content-Range"]
            
            return Response(
                content=upstream.content,
                status_code=upstream.status_code,
                headers=response_headers,
            )
    except Exception as e:
        log.error("audio_proxy_failed", error=str(e))
        return Response(content="Proxy error", status_code=502)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api.main:app", host="0.0.0.0", port=8000, reload=True)
