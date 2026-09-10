from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel
from typing import List, Dict, Optional
import time
import uuid
from datetime import datetime, timezone

from backend.infrastructure.logging import get_logger
from backend.infrastructure.embedding_provider import embedding_provider
from backend.infrastructure.runtime_telemetry import timing
from backend.api.main import get_supabase

log = get_logger("memory_endpoints")
router = APIRouter()

class ConsolidateRequest(BaseModel):
    session_id: str
    user_id: str
    consolidation_id: str = ""
    observations: List[Dict] = []


@router.post("/api/memory/consolidate")
async def manual_consolidation(request: Request, body: ConsolidateRequest):
    return {"status": "success", "consolidated_observations": 0}


@router.get("/api/memory/model/{user_id}")
async def get_user_model(user_id: str, query: str = Query("")):
    with timing("api", "get_user_model"):
        return {
            "status": "success",
            "user_model": {},
            "results": [],
            "mental_model": ""
        }


@router.get("/api/memory/diagnostics")
async def memory_diagnostics():
    with timing("api", "memory_diagnostics"):
        from backend.memory.orchestration.orchestrator import get_orchestrator
        from backend.memory.core.diagnostics import run_diagnostics

        orchestrator = get_orchestrator()
        if not orchestrator:
            return {"status": "FAILED", "reason": "Orchestrator not initialized"}

        report = await run_diagnostics(orchestrator)
        return report
