"""
AURA General Intelligence Context Layer — Context Composer
"""

import time
import json
import logging
from typing import Dict, Any, Optional

from backend.core.intelligence.time_engine import time_engine
from backend.core.intelligence.geo_engine import geo_engine
from backend.core.intelligence.environment_engine import environment_engine
from backend.core.intelligence.device_engine import device_engine
from backend.core.intelligence.network_engine import network_engine
from backend.core.intelligence.fallback_engine import fallback_engine

logger = logging.getLogger("server")

class ContextComposer:
    """
    Responsibilities:
    - Coordinate & aggregate all engine outputs
    - Normalize execution schema
    - Short-lived caching of high-overhead or slow operations (Geo, Environment, Network, Device)
    - Compile a compact, token-efficient prompt context payload
    """

    def __init__(self):
        # In-memory caches mapped by session_id to prevent leakage
        self._geo_caches: Dict[str, Dict[str, Any]] = {}
        self._geo_cache_times: Dict[str, float] = {}
        self._geo_ttl = 900.0  # 15 minutes

        self._env_caches: Dict[str, Dict[str, Any]] = {}
        self._env_cache_times: Dict[str, float] = {}
        self._env_ttl = 900.0  # 15 minutes

        self._device_caches: Dict[str, Dict[str, Any]] = {}
        self._device_cache_times: Dict[str, float] = {}
        self._device_ttl = 30.0  # 30 seconds

        self._net_caches: Dict[str, Dict[str, Any]] = {}
        self._net_cache_times: Dict[str, float] = {}
        self._net_ttl = 30.0  # 30 seconds

    async def get_context(
        self,
        query: str,
        ip_address: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        client_device_info: Optional[Dict[str, Any]] = None,
        session_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Gathers intelligence context across all dimensions.
        Employs selective caching for sub-millisecond hot-path operations.
        """
        now = time.time()
        sid = session_id or "default_session"

        # Periodic cleanup of stale sessions (e.g. older than 2 hours) to prevent memory leaks
        stale_sessions = [
            s_id for s_id, t in list(self._geo_cache_times.items())
            if now - t > 7200.0
        ]
        for s_id in stale_sessions:
            self._geo_caches.pop(s_id, None)
            self._geo_cache_times.pop(s_id, None)
            self._env_caches.pop(s_id, None)
            self._env_cache_times.pop(s_id, None)
            self._device_caches.pop(s_id, None)
            self._device_cache_times.pop(s_id, None)
            self._net_caches.pop(s_id, None)
            self._net_cache_times.pop(s_id, None)

        # 1. Geo Context (Cache-enabled per session)
        geo_cached = self._geo_caches.get(sid)
        geo_time = self._geo_cache_times.get(sid, 0.0)
        if (
            not geo_cached 
            or (now - geo_time > self._geo_ttl) 
            or latitude is not None 
            or longitude is not None
        ):
            geo_ctx = await geo_engine.get_context(ip_address, latitude, longitude)
            self._geo_caches[sid] = geo_ctx
            self._geo_cache_times[sid] = now
        else:
            geo_ctx = geo_cached

        # Extract lat/lon for environment engine
        lat = geo_ctx.get("latitude", 19.0760)
        lon = geo_ctx.get("longitude", 72.8777)
        tz = geo_ctx.get("timezone", "Asia/Kolkata")

        # 2. Time Context (Completely dynamic - no caching)
        time_ctx = await time_engine.get_context(timezone=tz, latitude=lat)

        # 3. Environment Context (Cache-enabled per session)
        env_cached = self._env_caches.get(sid)
        env_time = self._env_cache_times.get(sid, 0.0)
        if not env_cached or (now - env_time > self._env_ttl):
            env_ctx = await environment_engine.get_context(latitude=lat, longitude=lon)
            self._env_caches[sid] = env_ctx
            self._env_cache_times[sid] = now
        else:
            env_ctx = env_cached

        # 4. Device Context (Cache-enabled per session)
        device_cached = self._device_caches.get(sid)
        device_time = self._device_cache_times.get(sid, 0.0)
        if not device_cached or (now - device_time > self._device_ttl):
            device_ctx = await device_engine.get_context(client_device_info)
            self._device_caches[sid] = device_ctx
            self._device_cache_times[sid] = now
        else:
            device_ctx = device_cached

        # 5. Network Context (Cache-enabled per session)
        net_cached = self._net_caches.get(sid)
        net_time = self._net_cache_times.get(sid, 0.0)
        if not net_cached or (now - net_time > self._net_ttl):
            net_ctx = await network_engine.get_context()
            self._net_caches[sid] = net_ctx
            self._net_cache_times[sid] = now
        else:
            net_ctx = net_cached

        # 6. Live Knowledge Fallback (Triggered only when query requires freshness)
        live_ctx = await fallback_engine.get_context(query)

        # Output in the requested schema
        return {
            "time": time_ctx,
            "environment": env_ctx,
            "device": device_ctx,
            "network": net_ctx,
            "geo": geo_ctx,
            "live_context": live_ctx
        }

    def serialize_to_prompt(self, context: Dict[str, Any]) -> str:
        """
        Serializes the composite intelligence data into a compact, token-efficient
        system instruction format. Prevents prompt bloat while preserving exact context.
        """
        time_data = context.get("time", {})
        geo_data = context.get("geo", {})
        env_data = context.get("environment", {})
        dev_data = context.get("device", {})
        net_data = context.get("network", {})
        live_data = context.get("live_context", {})

        # Build highly-optimized short grounding text
        lines = [
            "[REAL-WORLD GROUNDING CONTEXT]",
            f"• Time: {time_data.get('timestamp')} | {time_data.get('day_of_week')} {time_data.get('period')} | Season: {time_data.get('season')} | Holidays: {', '.join(time_data.get('holidays', [])) or 'None'}",
            f"• Geo: {geo_data.get('city')}, {geo_data.get('region')}, {geo_data.get('country')} (Timezone: {time_data.get('timezone')}, Offset: {time_data.get('utc_offset')})",
            f"• Weather: {env_data.get('condition')} | Temp: {env_data.get('temperature')} | Humidity: {env_data.get('humidity')} (Sun: ↑{env_data.get('sunrise')} ↓{env_data.get('sunset')})",
            f"• Host Device: OS={dev_data.get('os')} ({dev_data.get('architecture')}) | CPU={dev_data.get('cpu_load')} | RAM={dev_data.get('ram_load')} | Battery={dev_data.get('battery', {}).get('percentage')}% ({dev_data.get('battery', {}).get('status')})",
            f"• Network: Online={net_data.get('online')} | Quality={net_data.get('quality')} | RTT={net_data.get('latency_ms')}ms | GeminiAPI={net_data.get('gemini_api', {}).get('reachable')}",
        ]

        # Inject Live Search results if triggered
        if live_data.get("triggered") and live_data.get("results"):
            lines.append("• Live Search Grounding:")
            for idx, res in enumerate(live_data["results"], 1):
                lines.append(f"  [{idx}] {res.get('title')}: \"{res.get('snippet')}\" (Source: {res.get('link')})")

        lines.append("[END CONTEXT]")
        return "\n".join(lines)


# Singleton instance
composer = ContextComposer()
