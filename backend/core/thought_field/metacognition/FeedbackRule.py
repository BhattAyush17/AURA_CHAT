from dataclasses import dataclass
from typing import Callable
from .MonitoringState import MonitoringState

@dataclass
class FeedbackRule:
    name: str
    target_parameter: str # e.g., "mental_energy", "comfort"
    evaluate: Callable[[MonitoringState], float] # Returns the proposed microscopic adjustment
