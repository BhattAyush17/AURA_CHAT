CREATE TABLE aura_storage (
  user_id    TEXT NOT NULL,
  key        TEXT NOT NULL,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX idx_aura_storage_user_key ON aura_storage(user_id, key);

ALTER TABLE aura_storage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_own" ON aura_storage FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "write_own" ON aura_storage FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "update_own" ON aura_storage FOR UPDATE USING (auth.uid()::text = user_id);
