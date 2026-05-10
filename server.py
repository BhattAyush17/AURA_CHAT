"""
AURA Behavior Engine API Server v3
"""

import os
import asyncio
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field          # ← ADD: Field for max_length
from typing import Optional, List, Dict, Any
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

load_dotenv(".env.local")
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

from behavior_engine import RuntimeEngine, build_sensing_injection

app = FastAPI(
    title="AURA Behavior Engine",
    version="3.0",
    # FIX 4: Suppress stack traces and internal paths in production error responses
    openapi_url=None if os.getenv("ENVIRONMENT") == "production" else "/openapi.json",
)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

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


# ═══════════════════════════════════════════════════════════════════
# MODELS — FIX 3: max_length on every string field
# ═══════════════════════════════════════════════════════════════════

class AnalyzeRequest(BaseModel):
    user_text:     str           = Field(..., max_length=2000)
    session_id:    str           = Field(..., max_length=200)
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

    def get(self, session_id: str) -> Optional[Dict]:
        if session_id in self.local_cache:
            return self.local_cache[session_id]
        if supabase:
            try:
                res = supabase.table("aura_storage").select("data").eq("key", f"active_session_{session_id}").execute()
                if res.data:
                    data = res.data[0]["data"]
                    self.local_cache[session_id] = data
                    return data
            except: pass
        return None

    def set(self, session_id: str, data: Dict):
        self.local_cache[session_id] = data
        if supabase:
            try:
                supabase.table("aura_storage").upsert({
                    "user_id": data.get("user_id", "local-user"),
                    "key": f"active_session_{session_id}",
                    "data": data,
                    "updated_at": datetime.utcnow().isoformat()
                }).execute()
            except Exception as e:
                print(f"[DB ERROR] Session save failed: {e}")

    def pop(self, session_id: str, default=None):
        val = self.local_cache.pop(session_id, default)
        if supabase:
            try:
                supabase.table("aura_storage").delete().eq("key", f"active_session_{session_id}").execute()
            except: pass
        return val

    def list_expired(self, ttl_hours: int) -> List[str]:
        now = datetime.utcnow()
        ttl = timedelta(hours=ttl_hours)
        return [
            sid for sid, data in self.local_cache.items()
            if now - data.get("last_active", now) > ttl
        ]

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
            active_sessions.pop(sid)
        if expired:
            print(f"[CLEANUP] Closed {len(expired)} hanging sessions")


# ═══════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════

@app.post("/api/analyze", response_model=AnalyzeResponse)
async def analyze(request: Request, body: AnalyzeRequest):
    """Runtime cascade: keyword → ChromaDB → fallback. Target <200ms."""
    # FIX 1: Origin check replaces the broken X-Internal-Key approach.
    # VITE_ variables are embedded in the public JS bundle — any user
    # could read VITE_API_SECRET from DevTools and forge the header.
    # The browser's Origin header cannot be set by JS and is reliable.
    if not is_allowed_origin(request):
        raise HTTPException(status_code=403, detail="Forbidden")

    if not body.user_text.strip():
        raise HTTPException(status_code=400, detail="user_text cannot be empty")

    try:
        result = engine.analyze(body.user_text, body.ideology_hint, body.user_initiated)
        
        # NEW — build sensing injection
        turn_data = {
            "text": body.user_text,
            "audio_rms": body.audio_rms,
            "pause_ms": body.pause_ms,
            "frustration_score": result["all_scores"].get("frustration", 0.0),
            "withdrawal_score": result["all_scores"].get("withdrawal", 0.0),
        }
        
        base_id = get_base_session_id(body.session_id)
        session_data = active_sessions.get(base_id) or active_sessions.get(body.session_id)
        seed = session_data.get("seed", "") if session_data else ""
        sensing_injection, state_vector, directive = build_sensing_injection(body.session_id, turn_data, seed)
        
        # Update result with sensing injection for build_instructions
        result["sensing_injection"] = sensing_injection
        instructions = engine.build_instructions(result)
        
        return AnalyzeResponse(
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
                session_turn=state_vector.session_turn
            ),
            status="success",
        )
    except Exception as e:
        # FIX 4: Never expose internal exception details in production
        if ENVIRONMENT == "production":
            raise HTTPException(status_code=500, detail="Internal server error")
        raise HTTPException(status_code=500, detail=str(e))


from behavior_engine import generate_memory_seed, _sensing_engines
from sensing_engine import summarize_arc_for_seed, SensingEngine

@app.post("/session/start")
@limiter.limit("5/minute")            # FIX 2: Rate limit was missing here
async def start_session(request: Request, user_id: str, seed: Optional[str] = ""):
    import uuid
    session_id = str(uuid.uuid4())
    active_sessions.set(session_id, {
        "user_id": user_id,
        "transcript": [],
        "seed": seed,
        "created_at": datetime.utcnow().isoformat(),
        "last_active": datetime.utcnow().isoformat()
    })
    
    _sensing_engines[session_id] = SensingEngine(seed or "")
    
    return {"session_id": session_id, "memory_loaded": bool(seed)}


@app.post("/session/end", response_model=SessionEndResponse)
@limiter.limit("5/minute")
async def end_session(request: Request, body: SessionEndRequest):
    if len(body.transcript) < 3:
        return SessionEndResponse(seed=body.previous_seed or "", session_id=body.session_id)

    base_id = get_base_session_id(body.session_id)
    session_data = active_sessions.get(base_id) or active_sessions.get(body.session_id)
    existing_transcript = session_data.get("transcript", []) if session_data else []
    merged = merge_transcripts(existing_transcript, body.transcript)
    transcript_to_process = merged[-30:]

    sensing_engine = _sensing_engines.get(base_id) or _sensing_engines.get(body.session_id)
    arc_summary = summarize_arc_for_seed(sensing_engine.state) if sensing_engine else None

    api_key = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    seed = generate_memory_seed(
        transcript=transcript_to_process,
        previous_seed=body.previous_seed or "",
        api_key=api_key,
        arc_summary=arc_summary
    )

    active_sessions.pop(base_id, None)
    active_sessions.pop(body.session_id, None)

    return SessionEndResponse(seed=seed, session_id=body.session_id)


async def generate_and_store_seed_background(data: dict):
    seed = generate_memory_seed(
        transcript=data['transcript'][-30:],
        previous_seed=data.get('previous_seed', ''),
        api_key=data.get('api_key', ''),
        arc_summary=data.get('arc_summary')
    )
    # TODO: Push directly to Supabase from backend here if needed


@app.post("/session/end/sync")
@limiter.limit("5/minute")
async def end_session_sync(request: Request, body: SessionEndRequest, background_tasks: BackgroundTasks):
    if len(body.transcript) < 3:
        return {"status": "skipped"}

    api_key = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    base_id = get_base_session_id(body.session_id)
    session_data = active_sessions.get(base_id) or active_sessions.get(body.session_id)
    existing_transcript = session_data.get("transcript", []) if session_data else []
    merged = merge_transcripts(existing_transcript, body.transcript)

    payload = body.dict()
    payload['transcript'] = merged
    payload['api_key'] = api_key
    
    sensing_engine = _sensing_engines.get(base_id) or _sensing_engines.get(body.session_id)
    payload['arc_summary'] = summarize_arc_for_seed(sensing_engine.state) if sensing_engine else None

    background_tasks.add_task(generate_and_store_seed_background, payload)
    return {"status": "processing"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "version": "4.0-lightweight",
        "keyword_ideologies": len(engine.keywords.maps),
        "template_ideologies": len(engine.templates.templates),
        "withdrawal_mode": getattr(engine, "withdrawal_manager", None) is not None
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
