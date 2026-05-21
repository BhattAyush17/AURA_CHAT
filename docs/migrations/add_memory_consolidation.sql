-- ============================================================
-- Memory Consolidation: Schema Migration
-- Apply to Supabase SQL editor or via supabase db push
-- ============================================================

-- 1. Add consolidated_at column for soft-delete tracking
ALTER TABLE aura_chroma_backup
    ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Index: fast lookup of un-consolidated turns per user (used by consolidator)
CREATE INDEX IF NOT EXISTS idx_acb_consolidation
    ON aura_chroma_backup (user_id, created_at)
    WHERE consolidated_at IS NULL;

-- 3. Index: periodic purge query — find rows soft-deleted > 30 days ago
CREATE INDEX IF NOT EXISTS idx_acb_purge
    ON aura_chroma_backup (consolidated_at)
    WHERE consolidated_at IS NOT NULL;

-- ============================================================
-- Optional: purge rows consolidated more than 30 days ago
-- Run manually or via pg_cron daily job.
-- ============================================================
-- DELETE FROM aura_chroma_backup
-- WHERE consolidated_at IS NOT NULL
--   AND consolidated_at < NOW() - INTERVAL '30 days';

-- ============================================================
-- Verify match_memories_v2 works with both memory types.
-- The function filters by user_id and embedding similarity;
-- 'type' is stored in metadata — no RPC changes needed.
-- Both 'turn' rows (turn_text = raw) and
-- 'consolidated_episode' rows (turn_text = summary)
-- are returned transparently by the existing RPC.
-- ============================================================
