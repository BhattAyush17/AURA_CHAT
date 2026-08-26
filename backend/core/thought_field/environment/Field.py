from dataclasses import dataclass

@dataclass
class Field:
    name: str
    intensity: float = 0.5
    inertia: float = 0.1
    recovery_rate: float = 0.05
    volatility: float = 0.2
    target_baseline: float = 0.5
