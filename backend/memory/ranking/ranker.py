"""Ranking, deduplication and context budgeting.

Pure functions over `RetrievedMemory` — no I/O, no database, no prompt strings.
The output is the bounded, ordered set that the cognitive layer may inject.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.memory.core.contracts import (
    LIMITS,
    MemoryTier,
    RetrievedMemory,
    normalize_text,
)

#: Tier priority. A durable, consolidated fact outranks an equally-similar
#: ephemeral turn, so low-value chatter cannot crowd out identity-level memory.
_TIER_WEIGHT: dict[MemoryTier, float] = {
    MemoryTier.DURABLE: 0.20,
    MemoryTier.SEED: 0.12,
    MemoryTier.DEEP: 0.05,
    MemoryTier.LIVE: 0.0,
}

#: Weight of the retrieval score vs. the tier/recency adjustments. Keeps
#: semantic relevance dominant while letting tier and recency break ties.
_SIMILARITY_WEIGHT = 0.70
_RECENCY_WEIGHT = 0.10


@dataclass
class RankedContext:
    memories: list[RetrievedMemory]
    dropped_duplicates: int
    dropped_by_budget: int
    total_chars: int


def score(memory: RetrievedMemory) -> float:
    """Composite rank. Deterministic for a given input set."""
    base = memory.final_score or memory.similarity
    tier_bonus = _TIER_WEIGHT.get(memory.tier, 0.0)
    return round(
        base * _SIMILARITY_WEIGHT + memory.recency_score * _RECENCY_WEIGHT + tier_bonus, 6
    )


def deduplicate(memories: list[RetrievedMemory]) -> tuple[list[RetrievedMemory], int]:
    """Collapse memories with identical normalized text, keeping the best-scoring.

    Duplicates otherwise consume context budget twice — which is exactly how a
    high-value memory gets pushed out by a repeated one.
    """
    best: dict[str, RetrievedMemory] = {}
    order: list[str] = []
    dropped = 0
    for m in memories:
        key = m.dedup_key
        if not key:
            dropped += 1
            continue
        existing = best.get(key)
        if existing is None:
            best[key] = m
            order.append(key)
        else:
            dropped += 1
            if score(m) > score(existing):
                best[key] = m
    return [best[k] for k in order], dropped


def rank_and_budget(
    memories: list[RetrievedMemory],
    *,
    max_chars: int = LIMITS.max_context_chars,
    max_count: int = LIMITS.max_retrieval_count,
) -> RankedContext:
    """Dedup → rank → bound. The result is always within both limits.

    Budgeting is greedy over the ranked order: a memory that does not fit is
    skipped rather than truncated, because a half-sentence memory is worse than
    no memory.
    """
    deduped, dropped_dupes = deduplicate(memories)
    deduped.sort(key=score, reverse=True)

    kept: list[RetrievedMemory] = []
    total = 0
    dropped_budget = 0
    for m in deduped:
        if len(kept) >= max_count:
            dropped_budget += 1
            continue
        cost = len(m.text)
        if total + cost > max_chars:
            dropped_budget += 1
            continue
        kept.append(m)
        total += cost

    return RankedContext(
        memories=kept,
        dropped_duplicates=dropped_dupes,
        dropped_by_budget=dropped_budget,
        total_chars=total,
    )


def format_context_block(memories: list[RetrievedMemory]) -> str:
    """Render the prompt-injectable block.

    Kept here rather than in a storage adapter so no adapter contains prompt
    logic. Empty input yields an empty string — never a header with no body.
    """
    if not memories:
        return ""
    lines = [f"- {m.text}" for m in memories]
    return "[MEMORY CONTEXT]\n" + "\n".join(lines) + "\n[/MEMORY CONTEXT]"
