"""
AURA Behavior Engine API Server v3
"""

import os
import time
import asyncio
import functools
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
    save_seed_to_supabase
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
from backend.infrastructure.runtime_telemetry import runtime_telemetry
from backend.core.intelligence.action_schema import (
    ACTION_SCHEMA,
    RESPONSE_CONTRACT,
    EMOTION_ACKNOWLEDGEMENT_DIRECTIVE,
    build_prompt,
)

# Load env from the project root (two directories up from backend/api).
# `.env.local` is loaded first and wins: load_dotenv() does not override
# already-set keys, so the more specific file takes precedence over `.env`.
# Both are required — SUPABASE_URL / GEMINI_API_KEY live in `.env`, while
# REDIS_URL / OPENROUTER_API_KEY / SARVAM_API_KEY live in `.env.local`.
# Loading only one of them leaves `supabase = None` and silently demotes
# the embedding provider to its next fallback tier.
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
load_dotenv(os.path.join(project_root, ".env.local"))
load_dotenv(os.path.join(project_root, ".env"))
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


def get_supabase() -> "AsyncClient | None":
    """Current Supabase client, resolved at call time.

    `supabase` is None at import and only assigned in `startup_event`. Routers
    that did `from backend.api.main import supabase` captured that None into
    their own module namespace and never saw the real client — every request
    took the `if not supabase` degrade path. Importing this function instead
    defers the lookup to request time, so the rebinding is visible.
    """
    return supabase


from backend.core.behavior import RuntimeEngine, build_sensing_injection, detect_language_profile
from backend.api.contracts import ChatRequest
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
    docs_url="/docs" if ENVIRONMENT != "production" else None,
    # FIX 4: Suppress stack traces and internal paths in production error responses
    openapi_url=None if ENVIRONMENT == "production" else "/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# ═══════════════════════════════════════════════════════════════════
# ROUTER REGISTRATION
#
# All routers are attached to the single `app` created above. This block
# previously ran twice against two different FastAPI instances: an earlier
# `app` received the cron + memory routers, then `app` was rebound to a new
# FastAPI() which only received webhooks + cron. The memory router was
# therefore never mounted on the served application, so
# /api/memory/model/{user_id} and /api/memory/consolidate returned 404 —
# which the frontend gateway could not distinguish from "no memories".
# ═══════════════════════════════════════════════════════════════════

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

try:
    from backend.api.memory_endpoints import router as memory_router
    app.include_router(memory_router)
except ImportError as e:
    log.error("Failed to import memory router", error=str(e))

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

        # P1: Initialize canonical MemoryOrchestrator
        from backend.memory.orchestration.orchestrator import configure_orchestrator
        configure_orchestrator(lambda: supabase, cache=_embedding_cache, degradation=degradation)
        print("[AURA] Memory Orchestrator initialized")

        # P8 FIX: Wire vocab_learner singleton with persistence clients
        from backend.core.vocab import set_vocab_learner_clients
        set_vocab_learner_clients(redis_client=redis_bus.client, supabase_client=supabase)
        print("[AURA] Proactive engine, Rate Limiter, Embedding Cache, and VocabLearner initialized")
    else:
        print("[AURA] Redis unavailable — Brain 3 running in sync fallback mode")
    print("[AURA] Background services initializing...")

# NOTE: CORSMiddleware is registered once, immediately after app creation
# (see above). A second identical add_middleware call used to live here —
# a leftover of the two-`app` era — which stacked the middleware twice and
# emitted duplicate Access-Control-Allow-Origin headers.

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


def timed_endpoint(service: str, op: str):
    """Decorator: record endpoint success/failure + latency into runtime telemetry.

    Observability-only — never alters responses. Places ABOVE the route
    decorator so FastAPI routes the instrumented wrapper:
        @app.post("/x")
        @timed_endpoint("api", "x")
        async def handler(...): ...
    """
    from backend.infrastructure.runtime_telemetry import now_ms as _now_ms

    def deco(fn):
        @functools.wraps(fn)
        async def wrapper(*args, **kwargs):
            t0 = _now_ms()
            try:
                result = await fn(*args, **kwargs)
                runtime_telemetry.record(service, op, status="success", latency_ms=_now_ms() - t0)
                return result
            except Exception:
                runtime_telemetry.record(service, op, status="failure", latency_ms=_now_ms() - t0)
                raise
        return wrapper
    return deco


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
        runtime_telemetry.record("pinecone", "key_configured")

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
        from backend.memory.orchestration.orchestrator import get_orchestrator
        orchestrator = get_orchestrator()
        
        memory_enrichment = ""
        if orchestrator:
            memory_enrichment = await orchestrator.read_context_block(
                user_id=user_id,
                query=text,
                budget_chars=600
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
@timed_endpoint("api", "speculate")
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
@timed_endpoint("api", "analyze")
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
            # Phase 2B (hard-divorce): legacy L1-L5 background pipeline is out
            # of the /api/analyze hot path. Memory writing is handled by the
            # client-side cognitive runtime or the /chat conduit.
            log.info("analyze_background_skipped", session_id=body.session_id, reason="pipeline_divorced")

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


def _build_atmosphere_payload(raw_ctx: dict, query: str) -> dict:
    """
    Normalize the composer's raw context into a bounded, provenance-bearing
    structured AtmosphereContext payload for the frontend.

    IMPORTANT: preserves geographic provenance (source/confidence) so fallback
    coordinates are never reported as verified user location, and preserves
    news semantics (empty results == no fresh results, NOT 'no current events').
    """
    time_data = raw_ctx.get("time", {}) or {}
    geo_data = raw_ctx.get("geo", {}) or {}
    env_data = raw_ctx.get("environment", {}) or {}
    live_data = raw_ctx.get("live_context", {}) or {}
    dev_data = raw_ctx.get("device", {}) or {}
    net_data = raw_ctx.get("network", {}) or {}

    # Geographic provenance — fallback coordinates are NOT trusted location.
    geo_source = geo_data.get("source")
    geo_confidence = (
        "low" if geo_source in ("fallback", "default") or geo_source is None
        else "medium" if geo_source == "ipapi.co"
        else "unknown"
    )

    # News: preserve availability + result count. Empty results MUST remain
    # "no fresh results retrieved", never transformed into "no current events".
    news_items = live_data.get("results") if live_data.get("triggered") else []
    news_available = bool(news_items)
    news = None
    if live_data.get("triggered"):
        news = {
            "available": news_available,
            "resultCount": len(news_items),
            "fetchedAt": None,  # composer does not stamp wall-clock here; freshness via TTL cache
            "source": live_data.get("provider"),
            "query": query,
        }

    return {
        "temporal": {
            "available": bool(time_data.get("timestamp")),
            "timestamp": time_data.get("timestamp"),
            "dayOfWeek": time_data.get("day_of_week"),
            "timezone": time_data.get("timezone"),
            "utcOffset": time_data.get("utc_offset"),
            "period": time_data.get("period"),
            "season": time_data.get("season"),
            "isLateNight": time_data.get("hour") is not None and (
                time_data.get("hour") >= 23 or time_data.get("hour") < 5
            ),
            "isWeekend": time_data.get("is_weekend"),
        },
        "geography": {
            "available": bool(geo_data.get("city")),
            "city": geo_data.get("city"),
            "region": geo_data.get("region"),
            "country": geo_data.get("country"),
            "latitude": geo_data.get("latitude"),
            "longitude": geo_data.get("longitude"),
            "source": geo_source,
            "confidence": geo_confidence,
        },
        "weather": {
            "available": bool(env_data.get("condition")),
            "summary": env_data.get("summary"),
            "temperature": env_data.get("temperature"),
            "humidity": env_data.get("humidity"),
            "conditions": env_data.get("condition"),
            "source": env_data.get("source"),
        },
        "news": news,
        "device": {
            "available": bool(dev_data.get("os")),
            "os": dev_data.get("os"),
            "battery": (dev_data.get("battery") or {}).get("percentage"),
        },
        "network": {
            "available": net_data.get("online") is not None,
            "online": net_data.get("online"),
            "quality": net_data.get("quality"),
            "latencyMs": net_data.get("latency_ms"),
        },
        "freshness": {
            "available": bool(time_data.get("timestamp")),
            "timezone": time_data.get("timezone"),
            "ttlSeconds": 900,
        },
    }


# NOTE: Simple /health removed — the detailed /health endpoint (below) handles
# all health checks and returns checks.supabase.ok for frontend mode detection.


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
        # Phase 1 cognitive-integrity fix: the canonical Path-A prompt was
        # "cognitive_block + length rule" — the action schema (music/seek/…),
        # the Executive plan, and the music state were all severed at this
        # boundary. Now assemble every computed decision that must reach the LLM.
        memory_context = None
        if body.memory_policy != "Ignore" and body.client_memories:
            memory_lines = [
                f"- {(m.get('content') or m.get('text', ''))[:150]}"
                for m in body.client_memories[:5]
                if m.get('content') or m.get('text')
            ]
            if memory_lines:
                memory_context = "[MEMORY ENRICHMENT]\n" + "\n".join(memory_lines) + "\n[END MEMORY]"

        _blocks = [
            ACTION_SCHEMA,
            EMOTION_ACKNOWLEDGEMENT_DIRECTIVE,
            body.executive_plan or None,
            body.music_context_text or None,
            memory_context,
            body.cognitive_block,
        ]
        system_prompt = build_prompt(_blocks)
        system_prompt += (
            "\n\nRESPONSE LENGTH:\n"
            "Answer in 1-3 sentences. Speak naturally, not formally."
        )

        # Log moved down to capture final system_prompt
    else:
        # Fast path routing logic
        raw_analysis = engine.analyze(
            transcript=body.text,
            user_initiated=True,
            turn_history=turn_history
        )
        behavior_instructions = engine.build_instructions(raw_analysis)

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

        # Phase 1 cognitive-integrity fix (C7/parity): the fast path must also
        # receive the action schema, an explicit emotion-acknowledgment rule,
        # the anti-leak response contract, and any music state — otherwise the
        # decision chain is severed on this branch too.
        music_ctx = body.music_context_text or None
        system_prompt = build_prompt([
            ACTION_SCHEMA,
            EMOTION_ACKNOWLEDGEMENT_DIRECTIVE,
            body.executive_plan or None,
            music_ctx,
            behavior_instructions,
        ])
        system_prompt += f"\n\n{RESPONSE_CONTRACT}\n\nRespond in 1-3 sentences. Speak naturally, not formally."

    # Phase 1 (seed activation): the persona mindset seed was fetched above
    # but never reached the LLM. Prefer the client-supplied seed when present,
    # fall back to the session-stored seed. Prepended (not appended) so the
    # identity frame scopes every block assembled above.
    active_seed = body.seed or seed
    if active_seed:
        system_prompt = f"[PERSONA MINDSET]\n{active_seed}\n\n{system_prompt}"

    # ── Atmosphere Context Layer ────────────────────────────────────────────
    # Retrieve real-world grounding from the EXISTING composer (TTL-cached,
    # fail-open). Build a structured, provenance-bearing object for the metadata
    # event. When the frontend attention layer deemed atmosphere relevant this
    # turn (include_atmosphere), prepend the grounded block to the system prompt.
    atmosphere = None
    atmosphere_grounding = ""
    log.info("[atmosphere] gate_check include_atmosphere=%s", body.include_atmosphere)
    if body.include_atmosphere and not (body.cognitive_block and "[ENVIRONMENT CONTEXT]" in body.cognitive_block):
        # Serendipitous / low-latency retrieval: only fetch (and possibly inject)
        # real-world context when the turn is atmosphere-relevant, as decided by
        # the frontend Adaptive Attention gate. Non-relevant turns stay cheap.
        try:
            import asyncio

            from backend.core.intelligence import composer
            client_ip = request.client.host if request.client else None
            raw_ctx = await asyncio.wait_for(
                composer.get_context(
                    query=body.text,
                    ip_address=client_ip,
                    client_device_info={"mic_available": True},
                    session_id=session_id,
                ),
                timeout=10.0,
            )
            atmosphere = _build_atmosphere_payload(raw_ctx, body.text)
            atmosphere_grounding = composer.serialize_to_prompt(raw_ctx) + "\n"
            system_prompt = f"{atmosphere_grounding}{system_prompt}"
            log.info("[atmosphere] composer_invoked session=%s geo_src=%s", session_id, (raw_ctx.get("geo") or {}).get("source"))
        except Exception as e:
            log.error("[atmosphere] fetch_failed session=%s err=%s", session_id, repr(e))

    log.info(
        "cognitive_payload_received",
        endpoint="/api/analyze/stream",
        session_id=session_id,
        has_executive_plan=bool(body.executive_plan),
        executive_plan=body.executive_plan,
        has_client_memories=bool(body.client_memories),
        system_prompt=system_prompt
    )

    async def event_generator():
        # 1. Yield metadata immediately
        initial_metadata = {
            "event": "metadata",
            "emotional_state": raw_analysis.get("emotional_state", "neutral"),
            "behavior_instructions": behavior_instructions,
            "atmosphere": atmosphere,
        }
        yield f"data: {json.dumps(initial_metadata)}\n\n"

        # 2. Yield LLM tokens
        try:
            from backend.core.intelligence.llm_pipeline import stream_openrouter_response
        except ImportError as e:
            log.error("run_turn_pipeline_import_failed", error=str(e))
            yield f"data: {json.dumps({'event': 'error', 'error': 'Pipeline import failed'})}\n\n"
            return
            
        full_response = ""
        try:
            async for chunk in stream_openrouter_response(body.conversation_history, system_prompt):
                if "error" in chunk:
                    yield f"data: {json.dumps({'event': 'error', 'error': chunk['error']})}\n\n"
                    break
                if "text" in chunk:
                    full_response += chunk["text"]
                    yield f"data: {json.dumps({'event': 'text_chunk', 'text': chunk['text']})}\n\n"
        except Exception as e:
            log.error("llm_pipeline_stream_error", error=str(e))
            yield f"data: {json.dumps({'event': 'error', 'error': 'Stream generation failed'})}\n\n"

        # 3. Background task trigger — REMOVED in Phase 2B.
        # The legacy L1-L5 pipeline (via QStash webhook or local background
        # task) is hard-divorced from the streaming hot path. Memory writing is
        # handled by the client-side cognitive runtime or the /chat conduit.
        log.info("stream_background_skipped", session_id=session_id, reason="pipeline_divorced")

        yield f"data: {json.dumps({'event': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/chat")
async def chat_endpoint(body: ChatRequest, request: Request):
    import time
    import os
    t_start = time.perf_counter()

    # ── BYOK: Extract API keys from headers and inject into environment ──
    await update_byok_credentials(request)

    import uuid

    session_id = body.session_id or str(uuid.uuid4())
    user_id = body.user_id or "anonymous"

    log.info(
        "chat_payload_received",
        endpoint="/chat",
        session_id=session_id,
        has_executive_plan=bool(body.executive_plan),
        executive_plan=body.executive_plan,
        has_client_memories=bool(body.client_memories),
        system_prompt=None
    )

    # Phase 2B (hard-divorce): /chat is a pure memory-write conduit. The legacy
    # L1-L5 pipeline and LLM generation are intentionally NOT invoked here —
    # cognition lives in the client-side runtime. This endpoint persists the
    # turn as durable memory and returns a clean 200.

    # Determine which memories to use (client-provided vs server-fetched)
    active_memory_mode = body.memory_mode or "supabase"
    memories_used = []
    if body.client_memories and len(body.client_memories) > 0:
        active_memory_mode = "local"
        memories_used = [m.get("content") or m.get("text", "") for m in body.client_memories[:5]]

    # Store interaction as durable memory (Mode A — server manages storage)
    write_outcome = {"outcome": "skipped", "written": 0}
    if active_memory_mode == "supabase":
        from backend.memory.orchestration.orchestrator import get_orchestrator
        orchestrator = get_orchestrator()
        if orchestrator:
            result = await orchestrator.write(
                user_id=user_id,
                session_id=session_id,
                text=body.text,
                metadata={
                    "via": "chat_conduit",
                    "memory_policy": body.memory_policy,
                    "emotional_state": body.emotional_state,
                },
            )
            write_outcome = {
                "outcome": result.outcome.value,
                "written": result.written,
                "duplicates": result.duplicates,
                "correlation_id": result.correlation_id,
                "duration_ms": round(result.duration_ms, 2),
            }
            if not result.ok:
                log.warning(
                    "chat_memory_write_failed",
                    session_id=session_id,
                    outcome=result.outcome.value,
                    detail=result.detail,
                )

    return {
        "status": "ok",
        "memory_mode": active_memory_mode,
        "memories_used": memories_used,
        "memory_write": write_outcome,
        "latency": round((time.perf_counter() - t_start) * 1000, 2),
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
            try:
                res = await supabase.table("aura_storage").select("key").limit(1).execute()
                runtime_telemetry.record("supabase", "health_probe", status="success")
            except Exception:
                runtime_telemetry.record("supabase", "health_probe", status="failure")
                raise
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


@app.get("/api/telemetry")
async def runtime_telemetry_endpoint(request: Request, response: Response):
    """Runtime telemetry counters + subsystem capability flags.

    Observability-only. Returns aggregated counts (service/op/success/failure/
    latency) and capability flags — NEVER credentials, keys, payloads, or user
    content. The frontend correlates these aggregates with its own per-session
    and per-request timelines.
    """
    client_ip = get_remote_address(request)
    await apply_rate_limit(f"telemetry:{client_ip}", 60, response)
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    stat_map = {
        "status": "ok",
        "embedding_provider": embedding_provider.provider_name,
        "embedding_available": embedding_provider.is_available,
        "chroma_ready": getattr(chroma_service, "is_ready", False),
        "active_vector_store": "supabase_pgvector",
        "pinecone": {
            "key_configured": bool(os.environ.get("PINECONE_API_KEY") or _loaded_pinecone_key),
            "active": False,  # Pinecone key is accepted but not the live vector store
        },
        "supabase_configured": bool(supabase),
        "counters": runtime_telemetry.snapshot(),
    }
    return stat_map


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
    http_headers: Optional[Dict[str, str]] = None
    chapters: Optional[List[Dict[str, Any]]] = None
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
            # Missing dependency causes explicit backend error
            return {
                "error": True,
                "message": "yt-dlp dependency missing on backend"
            }
        ydl_opts = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'default_search': 'ytsearch',
            'extract_flat': False,
            'quiet': True,
            'extractor_args': {'youtube': ['player_client=ios,android,web_creator']},
            'js_runtimes': {'node': {}}
        }
        import os
        import tempfile
        import shutil
        cookie_path = os.environ.get('YOUTUBE_COOKIES_FILE', '/etc/secrets/cookies.txt')
        temp_cookie_path = None

        try:
            if os.path.exists(cookie_path):
                fd, temp_cookie_path = tempfile.mkstemp(prefix='aura-youtube-cookies-', suffix='.txt')
                os.close(fd)
                shutil.copy2(cookie_path, temp_cookie_path)
                os.chmod(temp_cookie_path, 0o600)
                ydl_opts['cookiefile'] = temp_cookie_path
                log.info("ytmusic_cookies", cookies_loaded=True)

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
                        "http_headers": entry.get('http_headers', {}),
                        "chapters": entry.get('chapters')
                    }
                return None
        finally:
            if temp_cookie_path and os.path.exists(temp_cookie_path):
                try:
                    os.remove(temp_cookie_path)
                except:
                    pass


    try:
        result = await asyncio.to_thread(extract_with_ytdlp, query)
        if result:
            return YTMusicSearchResponse(**result)
        return YTMusicSearchResponse(error=True, message="Unable to find playable audio. No result.")
    except Exception as e:
        log.error("ytmusic_search_failed", error=str(e))
        return YTMusicSearchResponse(error=True, message=f"yt-dlp Error: {str(e)}")


@app.get("/api/ytmusic/resolve", response_model=YTMusicSearchResponse)
async def resolve_ytmusic(video_id: str, request: Request, response: Response):
    import asyncio
    client_ip = request.client.host if request.client else "unknown"
    await apply_rate_limit(f"ytmusic_resolve:{client_ip}", 30, response)

    def extract_with_ytdlp(vid: str):
        try:
            import yt_dlp
        except ImportError:
            return {"error": True, "message": "yt-dlp dependency missing on backend"}
        ydl_opts = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'extract_flat': False,
            'quiet': True,
            'extractor_args': {'youtube': ['player_client=ios,android,web_creator']},
            'js_runtimes': {'node': {}}
        }

        import os
        import tempfile
        import shutil
        cookie_path = os.environ.get('YOUTUBE_COOKIES_FILE', '/etc/secrets/cookies.txt')
        temp_cookie_path = None

        try:
            if os.path.exists(cookie_path):
                fd, temp_cookie_path = tempfile.mkstemp(prefix='aura-youtube-cookies-', suffix='.txt')
                os.close(fd)
                shutil.copy2(cookie_path, temp_cookie_path)
                os.chmod(temp_cookie_path, 0o600)
                ydl_opts['cookiefile'] = temp_cookie_path
                log.info("ytmusic_cookies", cookies_loaded=True)

            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={vid}", download=False)
                if info:
                    return {
                        "title": info.get('title'),
                        "artist": info.get('uploader'),
                        "duration": info.get('duration'),
                        "thumbnail": info.get('thumbnail'),
                        "youtube_id": info.get('id'),
                        "audio_stream_url": info.get('url'),
                        "http_headers": info.get('http_headers', {}),
                        "chapters": info.get('chapters')
                    }
                return None
        finally:
            if temp_cookie_path and os.path.exists(temp_cookie_path):
                try:
                    os.remove(temp_cookie_path)
                except:
                    pass


    try:
        result = await asyncio.to_thread(extract_with_ytdlp, video_id)
        if result and result.get("audio_stream_url"):
            return YTMusicSearchResponse(**result)
        if isinstance(result, dict) and result.get("error"):
            return YTMusicSearchResponse(error=True, message=result.get("message", "Couldn't get an audio stream for this track."))
        return YTMusicSearchResponse(error=True, message="Couldn't get an audio stream for this track.")
    except Exception as e:
        log.error("ytmusic_resolve_failed", error=str(e))
        return YTMusicSearchResponse(error=True, message=f"yt-dlp Error: {str(e)}")



# ═══════════════════════════════════════════════════════════════════
# AUDIO PROXY — Streams YouTube audio through the backend to bypass
# browser CORS restrictions on googlevideo.com URLs.
# ═══════════════════════════════════════════════════════════════════
import base64 as b64
from urllib.parse import quote, unquote

# In-memory cache for resolved audio URLs (short TTL, they expire quickly)
_audio_url_cache: dict[str, tuple[str, float]] = {}

@app.get("/api/ytmusic/proxy")
async def proxy_audio(url: str, request: Request, response: Response, h: Optional[str] = None):
    """Stream an audio URL through the backend to bypass CORS restrictions on googlevideo.com."""
    import httpx
    import json
    import base64
    from fastapi.responses import StreamingResponse

    decoded_url = unquote(url)

    # Validate URL is from a trusted source
    from urllib.parse import urlparse
    parsed = urlparse(decoded_url)
    if parsed.scheme not in ("http", "https"):
        return Response(content="Forbidden", status_code=403)
    if not parsed.hostname or not (parsed.hostname.endswith(".googlevideo.com") or parsed.hostname.endswith(".youtube.com") or parsed.hostname.endswith(".ytimg.com") or parsed.hostname in ("googlevideo.com", "youtube.com", "ytimg.com")):
        return Response(content="Forbidden", status_code=403)

    # Build upstream headers: start with yt-dlp http_headers if provided
    upstream_headers: dict = {}
    if h:
        try:
            decoded_h = base64.b64decode(unquote(h)).decode('utf-8')
            parsed_headers = json.loads(decoded_h)
            if isinstance(parsed_headers, dict):
                upstream_headers.update(parsed_headers)
        except Exception as e:
            log.warning("audio_proxy_header_decode_failed", error=str(e))

    # Forward Range header from browser so seek works
    range_header = request.headers.get("range")
    if range_header:
        upstream_headers["Range"] = range_header

    client = httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(15.0, read=120.0))
    try:
        req = client.build_request("GET", decoded_url, headers=upstream_headers)
        upstream_res = await client.send(req, stream=True)
    except Exception as e:
        log.error("audio_proxy_connect_failed", error=str(e))
        await client.aclose()
        return Response(content="Proxy connection failed", status_code=502)

    if upstream_res.status_code not in (200, 206):
        log.error("audio_proxy_upstream_error", status=upstream_res.status_code, host=parsed.hostname)
        await upstream_res.aclose()
        await client.aclose()
        return Response(content=f"Upstream error {upstream_res.status_code}", status_code=502)

    content_type = upstream_res.headers.get("Content-Type", "audio/webm")
    response_headers: dict = {
        "Content-Type": content_type,
        "Accept-Ranges": "bytes",
        "Access-Control-Allow-Origin": "*",
    }
    if "Content-Length" in upstream_res.headers:
        response_headers["Content-Length"] = upstream_res.headers["Content-Length"]
    if "Content-Range" in upstream_res.headers:
        response_headers["Content-Range"] = upstream_res.headers["Content-Range"]

    async def stream_body():
        try:
            async for chunk in upstream_res.aiter_bytes(chunk_size=65536):
                yield chunk
        finally:
            await upstream_res.aclose()
            await client.aclose()

    return StreamingResponse(
        stream_body(),
        status_code=upstream_res.status_code,
        headers=response_headers,
        media_type=content_type,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.api.main:app", host="0.0.0.0", port=8000, reload=True)
