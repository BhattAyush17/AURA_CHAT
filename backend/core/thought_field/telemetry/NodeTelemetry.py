from backend.infrastructure.logging import get_logger
from ..ecology.ThoughtGraph import ThoughtGraph
from ..presence.CognitivePresence import CognitivePresence
from ..incubation.IncubationSeed import IncubationState

log = get_logger("core.thought_ecology")

class NodeTelemetry:
    @staticmethod
    def emit(session_id: str, graph: ThoughtGraph, presence: CognitivePresence):
        dominant_count = len(graph.get_dominant_nodes())
        echo_count = len(graph.get_echo_nodes())
        
        dormant = len([n for n in graph.nodes.values() if n.state.name == "DORMANT"])
        
        dormant = len([n for n in graph.nodes.values() if n.state.name == "DORMANT"])
        
        try:
            log.info(
                "living_ecology_tick",
                session_id=session_id,
                ForegroundPopulation=dominant_count,
                EchoPersistence=echo_count,
                DormantPopulation=dormant,
                RelationshipDensity=len(graph.relationships),
                TopologyStability=sum(r.stability for r in graph.relationships.values()) / max(1, len(graph.relationships)),
                PresenceDensity=sum(presence.pressures.values()),
                PerspectiveShift=getattr(graph, 'perspective_shifts_this_tick', 0),
                ActiveIncubationSeeds=len(graph.incubation_seeds),
                MergedSeeds=getattr(graph, 'merged_seeds_this_tick', 0),
                SuppressedSeeds=getattr(graph, 'suppressed_seeds_this_tick', 0),
                InsightCompetition=len([s for s in graph.incubation_seeds.values() if s.state == IncubationState.INSIGHT]),
                SilentResolutions=getattr(graph, 'silent_resolutions_this_tick', 0),
                EmergingInsights=len(graph.insights),
                MeaningEvolution=0, # Placeholder for more complex topology tracking
                NaturalThoughtBirthRate=0, # placeholder for diagnostic
            )
        except Exception:
            pass
