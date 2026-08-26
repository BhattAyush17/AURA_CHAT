# Reflection Infrastructure
Version: 1.0

Status:
**FROZEN**

## Description
The Reflection Subsystem is a core biological infrastructure layer of AURA's metacognitive architecture. It has achieved a continuous, self-stabilizing lifecycle. Its internal mechanisms, data schemas, and execution pipelines are now permanently frozen to prevent architectural drift and accidental coupling.

## Public API (Frozen)
Future phases must rely strictly on consuming these existing properties.
- `ReflectionState` (Struct)
- `ReflectionLifecycle` (Enum)
- `ReflectionPattern` (Struct)
- `ReflectionConfidence` (Float property)
- `ReflectionCoherence` (String category property)

## Allowed Consumers
The following future metacognitive layers are strictly permitted to **read** the outputs of the Reflection Subsystem:
- Phase 5.3.3: Cognitive Monitoring
- Phase 5.3.4: Introspective Feedback
- Phase 5.4: Predictive Consciousness
- Phase 5.5: Social Intelligence

## Forbidden Operations
Under no circumstances may any future feature or module violate the following constraints:
- **Schema Changes:** Do not add new fields, classes, or structures to the Reflection subsystem.
- **Direct ThoughtGraph Access:** The reflection layer must never read raw memory or thought nodes.
- **Behavior Generation:** Reflection must never emit commands or decisions.
- **Speech Generation:** Reflection must never produce language or LLM prompts.
- **Planning:** Reflection must never produce goals or strategies.
- **State Mutation:** Allowed consumers may *read* `ReflectionState`, but they are forbidden from *modifying* it or interacting directly with the `ReflectionStabilizer`.

*This freeze guarantees that AURA's higher-level metacognition is built upon a biologically stable, immutable foundation of self-awareness.*
