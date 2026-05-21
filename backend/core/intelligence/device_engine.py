"""
AURA General Intelligence Context Layer — Device Intelligence Engine
"""

import platform
import os
import logging
from typing import Dict, Any, Optional

try:
    import psutil
except ImportError:
    psutil = None

logger = logging.getLogger("server")

class DeviceIntelligenceEngine:
    """
    Responsibilities:
    - OS/Platform identification
    - Machine architecture detection
    - Real-time CPU and RAM utilization monitoring
    - Battery percentage and charging status detection
    - Graceful fallback for environments lacking psutil (e.g., containerized / scratch environments)
    """

    def _get_cpu_load_fallback(self) -> float:
        # On Linux, try reading loadavg
        try:
            if os.path.exists("/proc/loadavg"):
                with open("/proc/loadavg", "r") as f:
                    load = float(f.read().split()[0])
                # Express as pseudo percentage based on core count
                cores = os.cpu_count() or 1
                return min(100.0, round((load / cores) * 100, 1))
        except Exception:
            pass
        return 0.0

    def _get_ram_load_fallback(self) -> float:
        # On Linux, try parsing /proc/meminfo
        try:
            if os.path.exists("/proc/meminfo"):
                meminfo = {}
                with open("/proc/meminfo", "r") as f:
                    for line in f:
                        parts = line.split()
                        if len(parts) >= 2:
                            meminfo[parts[0].rstrip(":")] = int(parts[1])
                total = meminfo.get("MemTotal", 0)
                free = meminfo.get("MemFree", 0)
                buffers = meminfo.get("Buffers", 0)
                cached = meminfo.get("Cached", 0)
                if total > 0:
                    usable = free + buffers + cached
                    used = total - usable
                    return round((used / total) * 100, 1)
        except Exception:
            pass
        return 0.0

    def _get_battery_fallback(self) -> Dict[str, Any]:
        # On Linux, try reading /sys/class/power_supply
        try:
            sys_path = "/sys/class/power_supply"
            if os.path.exists(sys_path):
                # Search for batteries (e.g. BAT0, BAT1)
                supplies = os.listdir(sys_path)
                for supply in supplies:
                    if supply.startswith("BAT"):
                        bat_dir = os.path.join(sys_path, supply)
                        capacity_file = os.path.join(bat_dir, "capacity")
                        status_file = os.path.join(bat_dir, "status")
                        
                        percent = 100
                        charging = False
                        
                        if os.path.exists(capacity_file):
                            with open(capacity_file, "r") as f:
                                percent = int(f.read().strip())
                        if os.path.exists(status_file):
                            with open(status_file, "r") as f:
                                status = f.read().strip().lower()
                                charging = "charging" in status or "full" in status
                        
                        return {
                            "percentage": percent,
                            "is_charging": charging,
                            "status": "plugged" if charging else "discharging"
                        }
        except Exception:
            pass
        return {
            "percentage": 100,
            "is_charging": True,
            "status": "AC Power / Unknown"
        }

    async def get_context(self, client_device_info: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Gathers host-level device/runtime state, enriched by client metadata if available.
        """
        try:
            # 1. Base OS and Architecture
            sys_name = platform.system()
            arch = platform.machine()
            release = platform.release()

            # 2. CPU and RAM Load
            if psutil:
                try:
                    cpu_percent = psutil.cpu_percent(interval=None)
                    ram = psutil.virtual_memory()
                    ram_percent = ram.percent
                except Exception:
                    cpu_percent = self._get_cpu_load_fallback()
                    ram_percent = self._get_ram_load_fallback()
            else:
                cpu_percent = self._get_cpu_load_fallback()
                ram_percent = self._get_ram_load_fallback()

            # 3. Battery State
            battery_info = {"percentage": 100, "is_charging": True, "status": "AC Power"}
            if psutil:
                try:
                    bat = psutil.sensors_battery()
                    if bat:
                        battery_info = {
                            "percentage": int(bat.percent),
                            "is_charging": bat.power_plugged,
                            "status": "charging" if bat.power_plugged else "discharging"
                        }
                except Exception:
                    battery_info = self._get_battery_fallback()
            else:
                battery_info = self._get_battery_fallback()

            # 4. Mic and Camera Availability
            # As a backend middleware, we report device capabilities based on request payload,
            # falling back to true capabilities from host.
            mic_available = True
            camera_available = True
            if client_device_info:
                mic_available = client_device_info.get("mic_available", mic_available)
                camera_available = client_device_info.get("camera_available", camera_available)
                # Override OS details if client provided them
                sys_name = client_device_info.get("os", sys_name)
                arch = client_device_info.get("architecture", arch)

            return {
                "os": sys_name,
                "release": release,
                "architecture": arch,
                "cpu_load": f"{cpu_percent}%",
                "ram_load": f"{ram_percent}%",
                "battery": battery_info,
                "io_capabilities": {
                    "microphone": "available" if mic_available else "unavailable",
                    "camera": "available" if camera_available else "unavailable"
                },
                "summary": f"System running on {sys_name} ({arch}) with CPU at {cpu_percent}% and RAM at {ram_percent}% load."
            }
        except Exception as e:
            logger.warning(f"Device intelligence context generation degraded: {str(e)}")
            return {
                "os": "Unknown",
                "release": "Unknown",
                "architecture": "Unknown",
                "cpu_load": "0.0%",
                "ram_load": "0.0%",
                "battery": {
                    "percentage": 100,
                    "is_charging": True,
                    "status": "Unknown"
                },
                "io_capabilities": {
                    "microphone": "available",
                    "camera": "available"
                },
                "summary": "Runtime metrics temporarily unavailable."
            }


# Singleton instance
device_engine = DeviceIntelligenceEngine()
