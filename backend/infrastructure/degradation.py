import time
import asyncio
import logging
from enum import Enum
from dataclasses import dataclass

logger = logging.getLogger(__name__)

class DegradationLevel(str, Enum):
    FULL = "full"              # All systems operational
    NO_MEMORY = "no_memory"    # Supabase down → no memory enrichment, behavior still works
    NO_SENSING = "no_sensing"  # Redis/Worker down → no behavioral steering, raw Gemini
    VOICE_ONLY = "voice_only"  # Backend fully degraded → Gemini + system prompt only
    OFFLINE = "offline"        # Everything down

class CircuitState(str, Enum):
    CLOSED = "closed"      # Healthy — requests flow through
    OPEN = "open"          # Tripped — requests short-circuit to fallback
    HALF_OPEN = "half_open" # Recovering — one probe request allowed

@dataclass
class CircuitBreaker:
    name: str
    failure_threshold: int = 3          # Failures before tripping
    recovery_timeout_seconds: float = 30 # Time before trying again
    state: CircuitState = CircuitState.CLOSED
    failure_count: int = 0
    last_failure_time: float = 0.0
    total_trips: int = 0

    def record_success(self) -> None:
        if self.state == CircuitState.HALF_OPEN:
            logger.info(f"Circuit '{self.name}' recovered (HALF_OPEN → CLOSED)")
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    def record_failure(self) -> None:
        self.failure_count += 1
        self.last_failure_time = time.time()
        if self.failure_count >= self.failure_threshold:
            if self.state != CircuitState.OPEN:
                logger.warning(f"Circuit '{self.name}' TRIPPED (failures: {self.failure_count})")
                self.total_trips += 1
            self.state = CircuitState.OPEN

    @property
    def should_allow_request(self) -> bool:
        if self.state == CircuitState.CLOSED:
            return True
        if self.state == CircuitState.OPEN:
            if time.time() - self.last_failure_time > self.recovery_timeout_seconds:
                self.state = CircuitState.HALF_OPEN
                logger.info(f"Circuit '{self.name}' → HALF_OPEN (probing)")
                return True
            return False
        # HALF_OPEN – allow one request as probe
        return True

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "state": self.state.value,
            "failure_count": self.failure_count,
            "total_trips": self.total_trips,
        }

class DegradationManager:
    def __init__(self) -> None:
        self.circuits = {
            "redis": CircuitBreaker("redis", failure_threshold=3, recovery_timeout_seconds=15),
            "supabase": CircuitBreaker("supabase", failure_threshold=3, recovery_timeout_seconds=30),
            "worker": CircuitBreaker("worker", failure_threshold=5, recovery_timeout_seconds=45),
            "embedding_api": CircuitBreaker("embedding_api", failure_threshold=3, recovery_timeout_seconds=60),
        }

    @property
    def level(self) -> DegradationLevel:
        return self._evaluate()

    def _evaluate(self) -> DegradationLevel:
        """Read-only evaluation — does NOT transition circuits.
        Use this for health checks, logging, and degradation level display.
        Circuit state transitions only happen inside execute_with_circuit()."""
        redis_ok = self.circuits["redis"].state != CircuitState.OPEN
        supabase_ok = self.circuits["supabase"].state != CircuitState.OPEN
        worker_ok = self.circuits["worker"].state != CircuitState.OPEN

        if redis_ok and supabase_ok and worker_ok:
            return DegradationLevel.FULL
        if redis_ok and worker_ok and not supabase_ok:
            return DegradationLevel.NO_MEMORY
        if not redis_ok or not worker_ok:
            if supabase_ok:
                return DegradationLevel.NO_SENSING
            return DegradationLevel.VOICE_ONLY
        return DegradationLevel.VOICE_ONLY

    async def execute_with_circuit(self, circuit_name: str, coroutine, fallback=None, timeout: float = 2.0):
        """Execute an awaitable with circuit‑breaker protection.
        Returns the result of *coroutine* if the circuit permits and the call succeeds.
        On failure or an OPEN circuit the *fallback* (value or callable) is returned.

        Args:
            circuit_name: Key in self.circuits.
            coroutine: The awaitable to execute.
            fallback: Value (or callable returning value) on failure/open circuit.
            timeout: Max seconds to wait for the coroutine. Callers should set this
                     based on their latency budget (e.g. 0.5s for hot-path reads,
                     3.0s for background writes with embedding).
        """
        circuit = self.circuits.get(circuit_name)
        if circuit is None:
            logger.warning(f"Unknown circuit '{circuit_name}' – proceeding without protection")
            return await coroutine

        if not circuit.should_allow_request:
            logger.debug(f"Circuit '{circuit_name}' is OPEN – using fallback")
            return fallback() if callable(fallback) else fallback
        try:
            result = await asyncio.wait_for(coroutine, timeout=timeout)
            circuit.record_success()
            return result
        except Exception as e:
            circuit.record_failure()
            logger.warning(f"Circuit '{circuit_name}' failure: {e}")
            return fallback() if callable(fallback) else fallback

    def status(self) -> dict:
        return {
            "degradation_level": self.level.value,
            "circuits": {name: cb.to_dict() for name, cb in self.circuits.items()},
        }

# Global singleton used by the server
degradation = DegradationManager()
