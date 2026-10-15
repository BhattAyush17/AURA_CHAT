import os
import httpx
from typing import List, Dict, Tuple
from backend.infrastructure.logging import get_logger

log = get_logger("llm_pipeline")

# Fallback models on OpenRouter — ordered by quality, DeepSeek first
FALLBACK_MODELS = [
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemini-2.0-flash-lite-001",
    "google/gemma-3-27b-it",
    "openrouter/free",
]

import json

async def stream_openrouter_response(messages: List[Dict[str, str]], system_prompt: str):
    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not or_key:
        yield {"error": "No OpenRouter key"}
        return
        
    headers = {
        "Authorization": f"Bearer {or_key}",
        "Content-Type": "application/json",
        "X-Title": "AURA Voice Companion",
    }
    payload_messages = [{"role": "system", "content": system_prompt}] + messages
    
    async with httpx.AsyncClient(timeout=15.0) as client:
        # Try the primary model
        model = FALLBACK_MODELS[0]
        payload = {
            "model": model,
            "messages": payload_messages,
            "temperature": 0.8,
            "max_tokens": 150,
            "stream": True,
            "frequency_penalty": 0.1,
            "presence_penalty": 0.1,
        }
        
        async with client.stream("POST", "https://openrouter.ai/api/v1/chat/completions", headers=headers, json=payload) as response:
            if response.status_code != 200:
                yield {"error": f"OpenRouter Error: {response.status_code}"}
                return
            
            completed = False
            async for line in response.aiter_lines():
                if line.startswith("data:"):
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    try:
                        parsed = json.loads(data)
                    except json.JSONDecodeError:
                        log.warning("llm_stream_invalid_json", model=model)
                        yield {"error": "Invalid provider stream data"}
                        return
                    if parsed.get("error"):
                        log.warning("llm_stream_provider_error", model=model)
                        yield {"error": "OpenRouter stream failed"}
                        return
                    choices = parsed.get("choices") or []
                    if not choices:  # Usage-only frame.
                        continue
                    choice = choices[0]
                    token = (choice.get("delta") or {}).get("content", "")
                    if token:
                        yield {"text": token}
                    finish_reason = choice.get("finish_reason")
                    if finish_reason in ("length", "content_filter", "error"):
                        log.warning("llm_stream_incomplete", model=model, finish_reason=finish_reason)
                        yield {"error": f"Response incomplete ({finish_reason})"}
                        return
                    if finish_reason:
                        completed = True
            if not completed:
                log.warning("llm_stream_incomplete", model=model, finish_reason="connection_closed")
                yield {"error": "Provider stream ended before completion"}

async def generate_response(messages: List[Dict[str, str]], system_prompt: str) -> Tuple[str, bool, str]:
    """
    Backend LLM Pipeline (L4)
    P1: OpenRouter (with fallback models and auto-routing)
    P2: Gemini Direct API
    P3: Fallback to last cached assistant response (stale)
    
    Returns: (response_text, is_stale, active_llm)
    """
    or_key = os.environ.get("OPENROUTER_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    
    # ── P1: OpenRouter ──────────────────────────────────────────────────
    if or_key:
        headers = {
            "Authorization": f"Bearer {or_key}",
            "Content-Type": "application/json",
            "X-Title": "AURA Voice Companion",
        }
        
        # Combine system prompt with history
        payload_messages = [{"role": "system", "content": system_prompt}] + messages
        
        async with httpx.AsyncClient(timeout=15.0) as client:
            for model in FALLBACK_MODELS:
                try:
                    payload = {
                        "model": model,
                        "messages": payload_messages,
                        "temperature": 0.8,
                        "max_tokens": 300,
                        "route": "fallback",
                        "frequency_penalty": 0.1,
                        "presence_penalty": 0.1,
                    }
                    resp = await client.post(
                        "https://openrouter.ai/api/v1/chat/completions",
                        headers=headers,
                        json=payload
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        text = data["choices"][0]["message"]["content"]
                        if text:
                            log.info("llm_success", provider="openrouter", model=model)
                            return text, False, "openrouter"
                except Exception as e:
                    log.warning("openrouter_failed", model=model, error=str(e))
                    
    # ── P2: Gemini Direct API ───────────────────────────────────────────
    if gemini_key:
        # Convert role names for Gemini API
        gemini_contents = []
        for m in messages:
            role = "model" if m["role"] == "assistant" else "user"
            gemini_contents.append({
                "role": role,
                "parts": [{"text": m["content"]}]
            })
            
        payload = {
            "contents": gemini_contents,
            "systemInstruction": {
                "parts": [{"text": system_prompt}]
            },
            "generationConfig": {
                "maxOutputTokens": 300,
                "temperature": 0.8,
            }
        }
        
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={gemini_key}"
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    data = resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    if text:
                        log.info("llm_success", provider="gemini_direct")
                        return text, False, "gemini_direct"
            except Exception as e:
                log.warning("gemini_direct_failed", error=str(e))

    # ── P3: Stale fallback ──────────────────────────────────────────────
    log.error("llm_pipeline_completely_failed")
    # Find last assistant message or return static fallback
    last_assistant_msg = next((m["content"] for m in reversed(messages) if m["role"] == "assistant"), None)
    fallback_text = last_assistant_msg or "I'm having trouble connecting right now, but I'm here."
    return fallback_text, True, "degraded"
