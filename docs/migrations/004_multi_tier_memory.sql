-- Vector column must be 768 dims for FastEmbed compatibility
ALTER TABLE aura_chroma_backup 
ADD COLUMN IF NOT EXISTS embedding vector(768);

-- HNSW index for fast cosine search
CREATE INDEX IF NOT EXISTS idx_embedding_hnsw 
ON aura_chroma_backup 
USING hnsw (embedding vector_cosine_ops)
WITH (m=16, ef_construction=64);

-- FTS index for keyword fallback
CREATE INDEX IF NOT EXISTS idx_content_fts 
ON aura_chroma_backup 
USING gin(to_tsvector('english', turn_text));

-- RPC function for vector search
CREATE OR REPLACE FUNCTION match_memories_v2(
  query_embedding vector(768),
  match_threshold float DEFAULT 0.72,
  match_count int DEFAULT 5,
  filter_user_id text DEFAULT NULL
)
RETURNS TABLE(id bigint, content text, metadata jsonb, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT aura_chroma_backup.id, aura_chroma_backup.turn_text as content, aura_chroma_backup.metadata,
    1 - (aura_chroma_backup.embedding <=> query_embedding) as similarity
  FROM aura_chroma_backup
  WHERE (filter_user_id IS NULL OR aura_chroma_backup.metadata->>'user_id' = filter_user_id)
    AND 1 - (aura_chroma_backup.embedding <=> query_embedding) > match_threshold
  ORDER BY aura_chroma_backup.embedding <=> query_embedding
  LIMIT match_count;
END; $$;
