from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any

class ChatRequest(BaseModel):
    text: str
    session_id: Optional[str] = None
    user_id: Optional[str] = None
    cognitive_block: Optional[str] = None
    memory_policy: Optional[str] = "Normal"
    client_memories: Optional[List[Dict[str, Any]]] = None
    executive_plan: Optional[str] = None
    music_context_text: Optional[str] = None
    conversation_history: List[Dict[str, Any]] = []
    seed: Optional[str] = None
    include_atmosphere: Optional[bool] = False
    emotional_state: Optional[str] = "neutral"
    memory_mode: Optional[str] = "supabase"
