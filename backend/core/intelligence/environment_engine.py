"""
AURA General Intelligence Context Layer — Environment Intelligence Engine
"""

import httpx
import logging
from datetime import datetime
from typing import Dict, Any, Optional

logger = logging.getLogger("server")

class EnvironmentIntelligenceEngine:
    """
    Responsibilities:
    - Weather condition mapping (translated from standard WMO codes)
    - Real-time temperature & humidity fetching
    - Sunrise/sunset tracking
    - Dynamic contextual summaries
    - Fail-open seasonal weather approximation
    """

    def __init__(self):
        # WMO Weather interpretation codes (https://open-meteo.com/en/docs)
        self.wmo_codes = {
            0: "Clear sky",
            1: "Mainly clear",
            2: "Partly cloudy",
            3: "Overcast",
            45: "Foggy",
            48: "Depositing rime fog",
            51: "Light drizzle",
            53: "Moderate drizzle",
            55: "Dense drizzle",
            56: "Light freezing drizzle",
            57: "Dense freezing drizzle",
            61: "Slight rain",
            63: "Moderate rain",
            65: "Heavy rain",
            66: "Light freezing rain",
            67: "Heavy freezing rain",
            71: "Slight snow fall",
            73: "Moderate snow fall",
            75: "Heavy snow fall",
            77: "Snow grains",
            80: "Slight rain showers",
            81: "Moderate rain showers",
            82: "Violent rain showers",
            85: "Slight snow showers",
            86: "Heavy snow showers",
            95: "Thunderstorm",
            96: "Thunderstorm with slight hail",
            99: "Thunderstorm with heavy hail"
        }

    def get_seasonal_fallback(self, latitude: float) -> Dict[str, Any]:
        """
        Dynamically approximate realistic weather depending on month and hemisphere.
        Used as a fail-open guarantee when API/network boundaries fail.
        """
        month = datetime.now().month
        is_northern = latitude >= 0

        # India / tropical fallback
        if 8 <= latitude <= 36:
            if month in (6, 7, 8, 9):
                return {
                    "temperature": 27.5,
                    "humidity": 82,
                    "condition": "Cloudy with monsoon showers",
                    "sunrise": "06:00 AM",
                    "sunset": "07:00 PM",
                    "summary": "Monsoon season: warm, humid, and rainy.",
                    "source": "seasonal_monsoon"
                }
            elif month in (11, 12, 1, 2):
                return {
                    "temperature": 21.0,
                    "humidity": 55,
                    "condition": "Cool and pleasant",
                    "sunrise": "06:45 AM",
                    "sunset": "06:00 PM",
                    "summary": "Winter season: cool, dry, and clear.",
                    "source": "seasonal_winter"
                }
            else:
                return {
                    "temperature": 32.0,
                    "humidity": 45,
                    "condition": "Hot and sunny",
                    "sunrise": "05:45 AM",
                    "sunset": "06:45 PM",
                    "summary": "Summer season: dry and very warm.",
                    "source": "seasonal_summer"
                }

        # Temperate Northern Hemisphere
        if is_northern:
            if month in (12, 1, 2):
                return {
                    "temperature": 2.0,
                    "humidity": 78,
                    "condition": "Cold and overcast",
                    "sunrise": "07:30 AM",
                    "sunset": "04:30 PM",
                    "summary": "Winter season: cold, cloudy, and crisp.",
                    "source": "seasonal_winter_temperate"
                }
            elif month in (6, 7, 8):
                return {
                    "temperature": 24.0,
                    "humidity": 60,
                    "condition": "Warm and sunny",
                    "sunrise": "05:30 AM",
                    "sunset": "08:30 PM",
                    "summary": "Summer season: hot, sunny, and bright.",
                    "source": "seasonal_summer_temperate"
                }
            else:
                return {
                    "temperature": 13.0,
                    "humidity": 65,
                    "condition": "Mild and breezy",
                    "sunrise": "06:30 AM",
                    "sunset": "06:30 PM",
                    "summary": "Transition season: pleasant and calm.",
                    "source": "seasonal_transitional"
                }
        else:
            # Southern Hemisphere (opposite seasons)
            if month in (6, 7, 8):
                return {
                    "temperature": 8.0,
                    "humidity": 75,
                    "condition": "Chilly and overcast",
                    "sunrise": "07:15 AM",
                    "sunset": "05:15 PM",
                    "summary": "Winter in Southern Hemisphere.",
                    "source": "seasonal_winter_south"
                }
            else:
                return {
                    "temperature": 22.0,
                    "humidity": 58,
                    "condition": "Warm and pleasant",
                    "sunrise": "05:45 AM",
                    "sunset": "08:15 PM",
                    "summary": "Summer in Southern Hemisphere.",
                    "source": "seasonal_summer_south"
                }

    async def get_context(
        self,
        latitude: float = 19.0760,
        longitude: float = 72.8777
    ) -> Dict[str, Any]:
        """
        Queries Open-Meteo for real-time weather metrics with strict fail-opens.
        """
        try:
            url = (
                f"https://api.open-meteo.com/v1/forecast"
                f"?latitude={latitude}&longitude={longitude}"
                f"&current=temperature_2m,relative_humidity_2m,weather_code"
                f"&daily=sunrise,sunset&timezone=auto&forecast_days=1"
            )

            async with httpx.AsyncClient(timeout=1.5) as client:
                response = await client.get(url)
                if response.status_code == 200:
                    data = response.json()
                    current = data.get("current", {})
                    daily = data.get("daily", {})

                    temp = current.get("temperature_2m", 25.0)
                    humidity = current.get("relative_humidity_2m", 60)
                    wcode = current.get("weather_code", 0)

                    # Extract sunrise/sunset (iso strings, e.g., "2026-05-21T05:45")
                    sunrise_str = daily.get("sunrise", [""])[0]
                    sunset_str = daily.get("sunset", [""])[0]

                    def format_time(iso_str: str) -> str:
                        if not iso_str:
                            return "unknown"
                        try:
                            dt = datetime.fromisoformat(iso_str)
                            return dt.strftime("%I:%M %p")
                        except Exception:
                            return iso_str

                    sunrise = format_time(sunrise_str)
                    sunset = format_time(sunset_str)

                    condition = self.wmo_codes.get(wcode, "Clear sky")

                    # Heuristic summary
                    summary = f"Currently {condition.lower()} at {temp}°C with {humidity}% humidity."
                    if temp > 30:
                        summary += " The environment is warm."
                    elif temp < 10:
                        summary += " The environment is cold."

                    return {
                        "temperature": f"{temp}°C",
                        "humidity": f"{humidity}%",
                        "condition": condition,
                        "sunrise": sunrise,
                        "sunset": sunset,
                        "summary": summary,
                        "source": "open-meteo"
                    }
        except Exception as e:
            logger.debug(f"Open-Meteo weather fetch failed, resorting to seasonal heuristics: {str(e)}")

        # Fallback to seasonal approximation
        fallback = self.get_seasonal_fallback(latitude)
        return {
            "temperature": f"{fallback['temperature']}°C",
            "humidity": f"{fallback['humidity']}%",
            "condition": fallback["condition"],
            "sunrise": fallback["sunrise"],
            "sunset": fallback["sunset"],
            "summary": fallback["summary"],
            "source": fallback["source"]
        }


# Singleton instance
environment_engine = EnvironmentIntelligenceEngine()
