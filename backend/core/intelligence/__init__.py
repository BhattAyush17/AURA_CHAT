"""
AURA General Intelligence Context Layer

A modular middleware system for injecting real-world grounding, temporal awareness,
location diagnostics, and live search fallbacks into the AI pipeline before invocation.
"""

from backend.core.intelligence.time_engine import time_engine, TimeIntelligenceEngine
from backend.core.intelligence.geo_engine import geo_engine, GeoIntelligenceEngine
from backend.core.intelligence.environment_engine import environment_engine, EnvironmentIntelligenceEngine
from backend.core.intelligence.device_engine import device_engine, DeviceIntelligenceEngine
from backend.core.intelligence.network_engine import network_engine, NetworkIntelligenceEngine
from backend.core.intelligence.fallback_engine import fallback_engine, LiveKnowledgeFallbackEngine
from backend.core.intelligence.composer import composer, ContextComposer

__all__ = [
    "time_engine",
    "TimeIntelligenceEngine",
    "geo_engine",
    "GeoIntelligenceEngine",
    "environment_engine",
    "EnvironmentIntelligenceEngine",
    "device_engine",
    "DeviceIntelligenceEngine",
    "network_engine",
    "NetworkIntelligenceEngine",
    "fallback_engine",
    "LiveKnowledgeFallbackEngine",
    "composer",
    "ContextComposer",
]
