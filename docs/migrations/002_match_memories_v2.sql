-- ═══════════════════════════════════════════════════════════════════
-- AURA Migration 002: Hybrid Memory Retrieval (Semantic + Temporal)
-- ═══════════════════════════════════════════════════════════════════
--
-- PURPOSE:
--   match_memories_v2 scores memories by BOTH semantic similarity
--   AND recency. A relevant memory from yesterday ranks higher
--   than an equally relevant memory from 6 months ago.
--
-- FORMULA:
--   final_score = similarity * (1 - recency_weight)
--               + recency_score * recency_weight
--
--   recency_score uses inverse-time decay:
--     1.0 / (1.0 + age_in_days)
--     → 1.0 for just-created, 0.5 at 1 day, 0.1 at 9 days
--
-- INDEXES USED:
--   - idx_chroma_embedding_hnsw (HNSW, vector_cosine_ops)
--   - idx_chroma_user_created (user_id, created_at DESC)
--
-- DOES NOT DROP match_memories (backward compatible).
-- IDEMPOTENT: CREATE OR REPLACE is safe to re-run.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION match_memories_v2(
    query_embedding   vector(768),
    p_user_id         text,
    match_threshold   float DEFAULT 0.65,
    match_count       int   DEFAULT 3,
    recency_weight    float DEFAULT 0.15,
    max_age_days      int   DEFAULT 365
)
RETURNS TABLE (
    id              bigint,
    turn_text       text,
    metadata        jsonb,
    similarity      float,
    recency_score   float,
    final_score     float,
    age_hours       float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    -- Match HNSW index build parameters (ef_search=40 → ~97% recall)
    SET LOCAL hnsw.ef_search = 40;

    RETURN QUERY
    SELECT
        m.id,
        m.turn_text,
        m.metadata,
        -- Cosine similarity (0–1, higher = more similar)
        (1 - (m.embedding <=> query_embedding))::float AS similarity,
        -- Recency score: inverse-time decay (1.0 now → 0.5 at 1 day → ~0 at max_age)
        (1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - m.created_at)) / 86400.0))::float AS recency_score,
        -- Weighted blend of semantic + temporal
        (
            (1 - (m.embedding <=> query_embedding)) * (1.0 - recency_weight) +
            (1.0 / (1.0 + EXTRACT(EPOCH FROM (now() - m.created_at)) / 86400.0)) * recency_weight
        )::float AS final_score,
        -- Age in hours (for debugging / logging)
        (EXTRACT(EPOCH FROM (now() - m.created_at)) / 3600.0)::float AS age_hours
    FROM aura_chroma_backup m
    WHERE m.user_id = p_user_id
      AND m.created_at > (now() - (max_age_days || ' days')::interval)
      AND (1 - (m.embedding <=> query_embedding)) > match_threshold
    ORDER BY final_score DESC
    LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_memories_v2 IS
    'Hybrid memory retrieval: semantic similarity + temporal recency. '
    'recency_weight=0.15 means 85% semantic, 15% recency. '
    'Increase recency_weight for more recent-biased results. '
    'Uses HNSW index (ef_search=40) and user_id+created_at index.';

-- Refresh statistics so the planner knows about new function
ANALYZE aura_chroma_backup;
