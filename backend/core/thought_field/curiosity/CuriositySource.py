from dataclasses import dataclass

class CuriositySource:
    """
    Structural source tags for a curiosity object.
    Every curiosity must declare which cognitive subsystem originated its pressure.
    No raw text or prompts are stored — only subsystem identifiers.
    """
    REFLECTION        = "reflection"
    PREDICTION        = "prediction"
    GOAL_CONFLICT     = "goal_conflict"
    HABIT_DISRUPTION  = "habit_disruption"
    VALUE_TENSION     = "value_tension"
    RELATIONSHIP      = "relationship"
    INCUBATION        = "incubation"
    MONITORING        = "monitoring"
    ECOLOGY           = "ecology"
    UNKNOWN           = "unknown"

    ALL_SOURCES = (
        REFLECTION, PREDICTION, GOAL_CONFLICT, HABIT_DISRUPTION,
        VALUE_TENSION, RELATIONSHIP, INCUBATION, MONITORING, ECOLOGY,
    )
