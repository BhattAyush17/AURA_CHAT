"""
AURA General Intelligence Context Layer — Geo Intelligence Engine
"""

import logging
import httpx
import asyncio
from typing import Dict, Any, Optional

logger = logging.getLogger("server")

class GeoIntelligenceEngine:
    """
    Responsibilities:
    - Approximate location lookup
    - Country, city, region extraction
    - Timezone mapping
    - In-memory geolocation caching to prevent spamming public APIs
    """

    def __init__(self, cache_ttl_seconds: int = 86400):
        self.cache: Dict[str, Dict[str, Any]] = {}
        self.cache_ttl_seconds = cache_ttl_seconds
        self.default_geo = {
            "city": "Mumbai",
            "region": "Maharashtra",
            "country": "India",
            "country_code": "IN",
            "latitude": 19.0760,
            "longitude": 72.8777,
            "timezone": "Asia/Kolkata",
            "cached": False,
            "source": "fallback"
        }

    async def get_context(
        self,
        ip_address: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
    ) -> Dict[str, Any]:
        """
        Retrieves approximate location from IP or lat/lon coordinates.
        Uses in-memory cache for IP addresses.
        """
        # If coordinates are explicitly provided by the client, use them
        if latitude is not None and longitude is not None:
            return {
                "city": "Specified Coordinates",
                "region": "Custom",
                "country": "Custom",
                "country_code": "CUSTOM",
                "latitude": latitude,
                "longitude": longitude,
                "timezone": "Asia/Kolkata",  # Default timezone mapping
                "source": "client_coordinates"
            }

        # Determine IP to lookup
        ip = ip_address or ""
        clean_ip = ip.strip()

        # Handle local/loopback IPs
        if not clean_ip or clean_ip in ("127.0.0.1", "localhost", "::1"):
            # If local, lookup the server's public IP
            clean_ip = "self"

        # Check Cache
        if clean_ip in self.cache:
            cached_data = self.cache[clean_ip].copy()
            cached_data["cached"] = True
            return cached_data

        # Perform API lookup with short timeout and fail open using secure HTTPS only
        try:
            url = "https://ipapi.co/json/"
            if clean_ip != "self":
                url = f"https://ipapi.co/{clean_ip}/json/"

            async with httpx.AsyncClient(timeout=1.5) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    if not data.get("error"):
                        geo_info = {
                            "city": data.get("city", "Mumbai"),
                            "region": data.get("region", "Maharashtra"),
                            "country": data.get("country_name", "India"),
                            "country_code": data.get("country_code", "IN"),
                            "latitude": data.get("latitude", 19.0760),
                            "longitude": data.get("longitude", 72.8777),
                            "timezone": data.get("timezone", "Asia/Kolkata"),
                            "source": "ipapi.co"
                        }
                        self.cache[clean_ip] = geo_info
                        return geo_info
        except Exception as e:
            logger.debug(f"Secure geo lookup failed for IP {clean_ip}: {str(e)}")

        return self.default_geo


# Singleton instance
geo_engine = GeoIntelligenceEngine()
