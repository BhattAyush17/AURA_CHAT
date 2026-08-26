from dataclasses import dataclass, field
from typing import List
from .Value import Value

@dataclass(frozen=True)
class ValueState:
    """
    Immutable representation of all current values.
    """
    active_values: List[Value]
    dormant_values: List[Value]
    extinct_values: List[Value]
    
    # High-level tracking
    dominant_value_theme: str = ""
    total_value_conflict: float = 0.0
