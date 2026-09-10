from fastapi import APIRouter, Request

router = APIRouter()


@router.post("/api/webhooks/process_memory")
async def process_memory_webhook(payload: dict):
    # Phase 2B (hard-divorce): the legacy L1-L5 pipeline is out of the memory
    # path entirely. This webhook was its QStash backdoor; the streaming and
    # /api/analyze endpoints no longer publish here. It is retained as a
    # no-op that returns cleanly rather than a 404/500 for any straggler
    # enqueued messages already in flight.
    return {"status": "skipped", "reason": "pipeline_divorced"}
