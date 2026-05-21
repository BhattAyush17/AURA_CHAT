"""
AURA General Intelligence Context Layer — Time Intelligence Engine
"""

import time
from datetime import datetime
from typing import Dict, Any, List, Optional

try:
    import pytz
except ImportError:
    pytz = None

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None


class TimeIntelligenceEngine:
    """
    Responsibilities:
    - Current timestamp (epoch and ISO format)
    - Date, day of week, month, year details
    - Timezone name and UTC offset detection
    - Period of day inference (morning, afternoon, evening, night)
    - Weekday vs. weekend detection
    - Season inference (adjusted for hemisphere via latitude)
    - Festival/holiday awareness (lightweight static dictionary)
    """

    def __init__(self, default_timezone: str = "Asia/Kolkata"):
        self.default_timezone = default_timezone

    def get_tz_now(self, tz_name: Optional[str] = None) -> datetime:
        target_tz = tz_name or self.default_timezone
        if pytz:
            try:
                tz = pytz.timezone(target_tz)
                return datetime.now(tz)
            except Exception:
                pass
        if ZoneInfo:
            try:
                tz = ZoneInfo(target_tz)
                return datetime.now(tz)
            except Exception:
                pass
        return datetime.now()

    def get_utc_offset(self, dt: datetime) -> str:
        offset = dt.utcoffset()
        if offset is None:
            return "UTC+00:00"
        total_seconds = int(offset.total_seconds())
        sign = "+" if total_seconds >= 0 else "-"
        abs_seconds = abs(total_seconds)
        hours = abs_seconds // 3600
        minutes = (abs_seconds % 3600) // 60
        return f"UTC{sign}{hours:02d}:{minutes:02d}"

    def infer_period(self, hour: int) -> str:
        if 5 <= hour < 12:
            return "morning"
        elif 12 <= hour < 17:
            return "afternoon"
        elif 17 <= hour < 21:
            return "evening"
        else:
            return "night"

    def infer_season(self, month: int, latitude: float) -> str:
        # Determine season based on month and hemisphere (latitude)
        is_northern = latitude >= 0
        if month in (12, 1, 2):
            return "Winter" if is_northern else "Summer"
        elif month in (3, 4, 5):
            return "Spring" if is_northern else "Autumn"
        elif month in (6, 7, 8):
            return "Summer" if is_northern else "Winter"
        else:
            return "Autumn" if is_northern else "Spring"

    def get_holidays(self, month: int, day: int) -> List[str]:
        # Simple, fast static dictionary of major national and global holidays
        holidays_map = {
            (1, 1): ["New Year's Day"],
            (1, 26): ["Republic Day (India)"],
            (3, 8): ["International Women's Day"],
            (5, 1): ["International Workers' Day"],
            (8, 15): ["Independence Day (India)"],
            (10, 2): ["Gandhi Jayanti (India)"],
            (10, 31): ["Halloween"],
            (12, 25): ["Christmas Day"],
            (12, 31): ["New Year's Eve"],
        }
        return holidays_map.get((month, day), [])

    async def get_context(
        self,
        timezone: Optional[str] = None,
        latitude: float = 20.5937,  # Default to India lat if unknown
    ) -> Dict[str, Any]:
        """
        Retrieves fully-grounded temporal reasoning data.
        Never blocks; fails open gracefully.
        """
        try:
            tz_to_use = timezone or self.default_timezone
            now = self.get_tz_now(tz_to_use)

            hour = now.hour
            month = now.month
            day = now.day

            holidays = self.get_holidays(month, day)

            return {
                "timestamp": now.isoformat(),
                "epoch": int(time.time()),
                "year": now.year,
                "month": now.month,
                "day": now.day,
                "hour": hour,
                "minute": now.minute,
                "day_of_week": now.strftime("%A"),
                "is_weekend": now.weekday() >= 5,
                "timezone": tz_to_use,
                "utc_offset": self.get_utc_offset(now),
                "period": self.infer_period(hour),
                "season": self.infer_season(month, latitude),
                "holidays": holidays,
                "description": f"It is {now.strftime('%A')} afternoon ({now.strftime('%I:%M %p')}) in the {self.infer_season(month, latitude)} season."
            }
        except Exception as e:
            # Shield main pipeline from any date/time formatting errors
            fallback_now = datetime.utcnow()
            return {
                "timestamp": fallback_now.isoformat(),
                "epoch": int(time.time()),
                "year": fallback_now.year,
                "month": fallback_now.month,
                "day": fallback_now.day,
                "hour": fallback_now.hour,
                "minute": fallback_now.minute,
                "day_of_week": fallback_now.strftime("%A"),
                "is_weekend": fallback_now.weekday() >= 5,
                "timezone": "UTC",
                "utc_offset": "+00:00",
                "period": "unknown",
                "season": "unknown",
                "holidays": [],
                "description": "Temporal information degraded; running on UTC fallback."
            }


# Singleton instance
time_engine = TimeIntelligenceEngine()
