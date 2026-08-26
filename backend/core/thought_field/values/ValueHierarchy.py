from typing import Dict, List
from .Value import Value

class ValueHierarchy:
    """
    Represents the lightweight influence structure among values.
    
    A value may support or reinforce other values, creating a natural priority
    hierarchy. Hierarchy represents influence, NOT ownership.
    
    Rules:
    - Influence flows top-down: root values provide a salience boost to their
      supported children.
    - No recursive traversal — depth is capped at 2 to remain lightweight.
    - The hierarchy is never used to DELETE or OVERRIDE values; only to gently
      redistribute salience.
    """
    def __init__(self):
        # Map: parent_id -> list of child_ids
        self._edges: Dict[str, List[str]] = {}

    def add_influence(self, parent_id: str, child_id: str):
        if parent_id not in self._edges:
            self._edges[parent_id] = []
        if child_id not in self._edges[parent_id]:
            self._edges[parent_id].append(child_id)

    def propagate_salience(self, values: Dict[str, "Value"]) -> None:
        """
        Propagates a fractional salience boost from high-salience parent values
        to their children. Only one level of propagation is applied per tick.
        """
        for parent_id, children in self._edges.items():
            parent = values.get(parent_id)
            if parent is None or parent.salience < 0.5:
                continue  # Only active parents propagate
            boost = parent.salience * 0.1  # Small, bounded boost
            for child_id in children:
                child = values.get(child_id)
                if child is not None:
                    child.salience = min(1.0, child.salience + boost)
                    child.hierarchy_depth = 1

    def depth_of(self, value_id: str) -> int:
        """Returns the hierarchy depth of a value (0 = root, 1 = child)."""
        for children in self._edges.values():
            if value_id in children:
                return 1
        return 0
