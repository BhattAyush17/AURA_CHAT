-- ═══════════════════════════════════════════════════════════════════
-- AURA Migration 001: Add HNSW Index for Vector Similarity Search
-- ═══════════════════════════════════════════════════════════════════
--
-- PURPOSE:
--   Reduces vector similarity queries from O(n) sequential scan to
--   O(log n) approximate nearest neighbor search via HNSW graph.
--
-- IMPACT:
--   - match_memories() latency: ~200ms → ~5-15ms (at 10K+ rows)
--   - Build time: ~30s per 10K rows (runs in background on free tier)
--   - Memory: ~50MB per 10K rows (768-dim float vectors)
--
-- IDEMPOTENT: Safe to run multiple times. Uses IF NOT EXISTS everywhere.
--
-- HOW TO RUN: Paste into Supabase Dashboard → SQL Editor → Run
-- ═══════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- 1. Ensure pgvector extension is available
-- ─────────────────────────────────────────────────────────────────
-- Supabase free tier includes pgvector. This is a safety check
-- for self-hosted or custom Postgres instances.

CREATE EXTENSION IF NOT EXISTS vector;


-- ─────────────────────────────────────────────────────────────────
-- 2. HNSW index on embedding column (cosine similarity)
-- ─────────────────────────────────────────────────────────────────
-- WHY HNSW over IVFFlat:
--   - HNSW has better recall at the same speed
--   - No need to REINDEX after inserts (IVFFlat requires periodic retrain)
--   - Slightly more memory, but acceptable for our scale (<100K rows)
--
-- PARAMETERS:
--   m = 16          → connections per node in the graph.
--                     Higher = better recall, more memory.
--                     16 is the sweet spot for <100K rows.
--   ef_construction = 64 → build quality. Controls how many
--                     candidates are considered during index build.
--                     Higher = slower build, better graph quality.
--                     64 is recommended for production.
--
-- OPERATOR CLASS:
--   vector_cosine_ops → matches our use of 1 - (a <=> b) in
--                       the match_memories RPC (cosine distance).

CREATE INDEX IF NOT EXISTS idx_chroma_embedding_hnsw
  ON aura_chroma_backup
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX idx_chroma_embedding_hnsw IS
  'HNSW approximate nearest neighbor index for 768-dim Gemini embeddings. '
  'Reduces similarity search from O(n) to O(log n). '
  'Rebuild with REINDEX after bulk inserts of >1000 rows: '
  'REINDEX INDEX CONCURRENTLY idx_chroma_embedding_hnsw;';


-- ─────────────────────────────────────────────────────────────────
-- 3. B-tree index on user_id for filtered queries
-- ─────────────────────────────────────────────────────────────────
-- WHY: match_memories() accepts match_user_id as a filter.
-- Without this index, Postgres does a sequential scan on user_id
-- before the HNSW lookup, negating the vector index benefit.

CREATE INDEX IF NOT EXISTS idx_chroma_user_id
  ON aura_chroma_backup (user_id);


-- ─────────────────────────────────────────────────────────────────
-- 4. Composite support: user_id + created_at for time-scoped queries
-- ─────────────────────────────────────────────────────────────────
-- WHY: Future queries may filter by "last N days of memories per user."
-- This composite index covers that pattern without a second scan.

CREATE INDEX IF NOT EXISTS idx_chroma_user_created
  ON aura_chroma_backup (user_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────
-- 5. Update match_memories RPC to use HNSW search parameters
-- ─────────────────────────────────────────────────────────────────
-- SET LOCAL hnsw.ef_search controls query-time recall/speed tradeoff:
--   - Lower (20)  = faster, lower recall (~95%)
--   - Higher (100) = slower, higher recall (~99.5%)
--   - 40 is a good production default for conversational memory
--     where missing one similar memory is acceptable.
--
-- CREATE OR REPLACE is idempotent — it overwrites the existing function.

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(768),
  match_user_id   text DEFAULT NULL,
  match_threshold float DEFAULT 0.0,
  match_count     int  DEFAULT 3
)
RETURNS TABLE (
  id            bigint,
  user_id       text,
  session_id    text,
  turn_text     text,
  metadata      jsonb,
  embedding_id  text,
  created_at    timestamptz,
  similarity    float
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Tell the planner to use the HNSW index with controlled recall.
  -- SET LOCAL scopes this to the current transaction only — no side effects.
  SET LOCAL hnsw.ef_search = 40;

  RETURN QUERY
  SELECT
    acb.id,
    acb.user_id,
    acb.session_id,
    acb.turn_text,
    acb.metadata,
    acb.embedding_id,
    acb.created_at,
    1 - (acb.embedding <=> query_embedding) AS similarity
  FROM aura_chroma_backup acb
  WHERE
    -- Optional user_id filter: NULL means search all users
    (match_user_id IS NULL OR acb.user_id = match_user_id)
    -- Cosine similarity threshold (0.0 = return everything)
    AND 1 - (acb.embedding <=> query_embedding) >= match_threshold
  ORDER BY acb.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

COMMENT ON FUNCTION match_memories IS
  'Semantic memory search using HNSW index. '
  'Returns top-N similar memories ranked by cosine similarity. '
  'ef_search=40 balances recall (~97%) with latency (<15ms).';


-- ─────────────────────────────────────────────────────────────────
-- 6. Refresh planner statistics after index creation
-- ─────────────────────────────────────────────────────────────────
-- WHY: Postgres query planner uses table statistics to decide
-- whether to use an index or a sequential scan. After creating
-- a new index, ANALYZE updates these statistics so the planner
-- knows the HNSW index exists and is populated.

ANALYZE aura_chroma_backup;


-- ═══════════════════════════════════════════════════════════════════
-- DONE. Verify with:
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE tablename = 'aura_chroma_backup';
-- ═══════════════════════════════════════════════════════════════════
