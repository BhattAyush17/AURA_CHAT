# AURA Database Migrations

## How to Run

1. Open **Supabase Dashboard** → **SQL Editor**
2. Paste the contents of the migration file
3. Click **Run**
4. Verify success with the query at the bottom of each file

Run migrations **in order** by number prefix (001, 002, ...).

---

## Migrations

| File                     | Purpose                                                          | Estimated Runtime             |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------- |
| `001_add_hnsw_index.sql` | HNSW vector index + user_id index + updated `match_memories` RPC | 10-60s depending on row count |

---

## Index Tuning Reference

### HNSW Parameters

| Parameter         | Set Where                | Current Value | Effect                                                                      |
| ----------------- | ------------------------ | ------------- | --------------------------------------------------------------------------- |
| `m`               | Index creation (`WITH`)  | 16            | Connections per graph node. Higher = better recall, more RAM. Range: 4–64.  |
| `ef_construction` | Index creation (`WITH`)  | 64            | Build-time quality. Higher = slower build, better graph. Range: 16–256.     |
| `ef_search`       | Query-time (`SET LOCAL`) | 40            | Search recall control. Higher = slower query, higher recall. Range: 10–200. |

### When to Rebuild the Index

Rebuild with:

```sql
REINDEX INDEX CONCURRENTLY idx_chroma_embedding_hnsw;
ANALYZE aura_chroma_backup;
```

Rebuild **after**:

- Bulk inserting >1,000 rows (e.g., importing conversation history)
- Deleting >30% of the table (graph becomes sparse)
- Changing `m` or `ef_construction` parameters

`CONCURRENTLY` allows reads during rebuild — **no downtime**.

### Performance Expectations

| Row Count | Without HNSW | With HNSW | Recall |
| --------- | ------------ | --------- | ------ |
| 1,000     | ~20ms        | ~3ms      | ~99%   |
| 10,000    | ~200ms       | ~8ms      | ~97%   |
| 100,000   | ~2s          | ~15ms     | ~95%   |

> Recall = % of true nearest neighbors found. At ef_search=40, recall is ~97% for typical AURA workloads. For exact results, remove the HNSW index and Postgres falls back to sequential scan.

### Supabase Free Tier Limits

- **Max rows**: Effectively unlimited (500MB storage)
- **pgvector**: Included by default
- **HNSW build**: Runs on shared compute — may take up to 60s for 10K rows
- **Memory**: Each 768-dim vector ≈ 3KB. 10K rows ≈ 30MB of vector data + ~50MB index
