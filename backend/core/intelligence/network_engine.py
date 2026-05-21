"""
AURA General Intelligence Context Layer — Network Intelligence Engine
"""

import time
import httpx
import logging
import socket
from typing import Dict, Any

logger = logging.getLogger("server")

class NetworkIntelligenceEngine:
    """
    Responsibilities:
    - Assess active internet connectivity (using fast DNS or HTTP checks)
    - Measure approximate connection latency/quality
    - Verify specific downstream API reachability (e.g., Gemini API)
    - Provide reliable online/offline fallback signals
    """

    def __init__(self, dns_host: str = "8.8.8.8", dns_port: int = 53, timeout_sec: float = 1.0):
        self.dns_host = dns_host
        self.dns_port = dns_port
        self.timeout_sec = timeout_sec

    def _check_dns_socket(self) -> bool:
        """Lightweight and ultra-fast socket-level connection test to a public DNS server."""
        try:
            socket.setdefaulttimeout(self.timeout_sec)
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.connect((self.dns_host, self.dns_port))
            s.close()
            return True
        except Exception:
            return False

    async def get_context(self) -> Dict[str, Any]:
        """
        Determines connection state and measures latency metrics.
        Fails open/safe, returning structured offline states if isolated.
        """
        connected = False
        gemini_reachable = False
        latency = -1.0
        api_latency = -1.0

        # Fast DNS socket check
        dns_ok = await asyncio.to_thread(self._check_dns_socket)

        if dns_ok:
            connected = True
            
            # Measure web server response latency
            t0 = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=1.0) as client:
                    resp = await client.head("https://www.google.com")
                    if resp.status_code < 400:
                        latency = round((time.perf_counter() - t0) * 1000, 1)
            except Exception:
                pass

            # Check Gemini API reachability
            t1 = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=1.0) as client:
                    # Probe the base endpoint of Gemini Live / GenAI services
                    resp = await client.get("https://generativelanguage.googleapis.com")
                    # Even if 403/404, it means the API server responded (reachable)
                    gemini_reachable = resp.status_code is not None
                    api_latency = round((time.perf_counter() - t1) * 1000, 1)
            except Exception:
                gemini_reachable = False

        quality = "offline"
        if connected:
            if latency > 0 and latency < 100:
                quality = "excellent"
            elif latency >= 100 and latency < 300:
                quality = "moderate"
            else:
                quality = "poor"

        return {
            "online": connected,
            "quality": quality,
            "latency_ms": latency if latency > 0 else "unknown",
            "gemini_api": {
                "reachable": gemini_reachable,
                "latency_ms": api_latency if gemini_reachable else "unreachable"
            },
            "summary": (
                f"Network online ({quality}) with google.com latency at {latency}ms."
                if connected else "Network offline or strictly isolated."
            )
        }


# Import asyncio to support to_thread
import asyncio

# Singleton instance
network_engine = NetworkIntelligenceEngine()
