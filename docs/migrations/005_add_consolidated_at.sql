-- ============================================================
-- Memory Consolidation: add `consolidated_at` soft-delete column
-- Target: aura_chroma_backup (the pgvector memory table used by
-- backend.memory.sync / chroma and the consolidator).
-- NOTE: 'aura_storage' is a separate key-value table and is NOT
-- involved in consolidation.
-- Canonical numbered migration; supersedes add_memory_consolidation.sql.
-- Idempotent: safe to re-run (ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- 1. Soft-delete marker used by the consolidator:
--    NULL      → raw turn, eligible for consolidation
--    timestamptz → already merged into an episode summary
ALTER TABLE aura_chroma_backup
    ADD COLUMN IF NOT EXISTS consolidated_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Index: fast lookup of un-consolidated turns per user (used by cron +
--    consolidator._fetch_old_memories)
CREATE INDEX IF NOT EXISTS idx_acb_consolidation
    ON aura_chroma_backup (user_id, created_at)
    WHERE consolidated_at IS NULL;

-- 3. Index: periodic purge query — rows soft-deleted > 30 days ago
CREATE INDEX IF NOT EXISTS idx_acb_purge
    ON aura_chroma_backup (consolidated_at)
    WHERE consolidated_at IS NOT NULL;