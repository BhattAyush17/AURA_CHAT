#!/usr/bin/env python3
"""
Live Supabase Database Health Probe
Hard Rules:
1. No silent fallbacks: Fail loudly and throw if connection fails or expected schema is missing.
2. Surface contradictions: Report exact schema mismatches.
"""

import os
import sys
from pathlib import Path
from dotenv import load_dotenv

def main():
    print("==================================================")
    print("AURA LIVE SUPABASE DATABASE HEALTH PROBE")
    print("==================================================")

    # 1. Environment Loading
    repo_root = Path(__file__).resolve().parent.parent
    env_local = repo_root / ".env.local"
    env_file = repo_root / ".env"

    if env_local.exists():
        load_dotenv(env_local)
        print(f"[ENV] Loaded {env_local}")
    if env_file.exists():
        load_dotenv(env_file)
        print(f"[ENV] Loaded {env_file}")

    supabase_url = os.getenv("SUPABASE_URL")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url:
        raise RuntimeError("FATAL: SUPABASE_URL environment variable is missing!")
    if not service_role_key:
        raise RuntimeError("FATAL: SUPABASE_SERVICE_ROLE_KEY environment variable is missing!")

    print(f"[AUTH] Target URL: {supabase_url}")
    print(f"[AUTH] Service Role Key: {service_role_key[:8]}...{service_role_key[-6:]}")

    # 2. Client Initialization
    try:
        from supabase import create_client
        client = create_client(supabase_url, service_role_key)
    except Exception as exc:
        raise RuntimeError(f"FATAL: Failed to initialize Supabase client: {exc}") from exc

    results = {
        "tables": {},
        "consolidated_at_exists": False,
        "embedding_status": {},
    }

    # 3. Table Existence Checks
    expected_tables = ["aura_chroma_backup", "aura_storage", "aura_seeds"]
    print("\n--- TABLE VERIFICATION ---")
    for tbl in expected_tables:
        try:
            res = client.table(tbl).select("*", count="exact").limit(1).execute()
            row_count = res.count if res.count is not None else len(res.data)
            sample_cols = list(res.data[0].keys()) if res.data else []
            results["tables"][tbl] = {
                "exists": True,
                "row_count": row_count,
                "columns": sample_cols,
            }
            print(f"[PASS] Table '{tbl}': EXISTS (total rows: {row_count})")
            if sample_cols:
                print(f"       Columns: {', '.join(sample_cols)}")
            else:
                print("       Columns: (empty table)")
        except Exception as exc:
            results["tables"][tbl] = {"exists": False, "error": str(exc)}
            print(f"[FAIL] Table '{tbl}': MISSING OR INACCESSIBLE -> {exc}")
            raise RuntimeError(f"Table verification failed for '{tbl}': {exc}") from exc

    # 4. Column Verification: consolidated_at on aura_chroma_backup
    print("\n--- COLUMN VERIFICATION: aura_chroma_backup.consolidated_at ---")
    try:
        col_res = client.table("aura_chroma_backup").select("consolidated_at").limit(1).execute()
        results["consolidated_at_exists"] = True
        print("[PASS] Column 'consolidated_at' on 'aura_chroma_backup': EXISTS (PostgREST schema verified)")
    except Exception as exc:
        results["consolidated_at_exists"] = False
        print(f"[FAIL] Column 'consolidated_at' MISSING on 'aura_chroma_backup': {exc}")
        raise RuntimeError(f"Schema contradiction: 'consolidated_at' missing on aura_chroma_backup: {exc}") from exc

    # 5. Embedding Vector Inspection (LIMIT 5)
    print("\n--- EMBEDDING STATUS PROBE: aura_chroma_backup (LIMIT 5) ---")
    try:
        sample_res = (
            client.table("aura_chroma_backup")
            .select("id, session_id, embedding, consolidated_at, created_at")
            .limit(5)
            .execute()
        )
        sample_rows = sample_res.data or []
        null_count = 0
        vector_count = 0
        details = []

        for idx, r in enumerate(sample_rows):
            emb = r.get("embedding")
            is_null = emb is None
            if is_null:
                null_count += 1
                emb_info = "NULL"
            else:
                vector_count += 1
                dim = len(emb) if isinstance(emb, (list, tuple)) else "unknown"
                emb_info = f"Vector (dim={dim})"

            details.append({
                "index": idx,
                "id": r.get("id"),
                "session_id": r.get("session_id"),
                "embedding": emb_info,
                "consolidated_at": r.get("consolidated_at"),
            })
            print(f"  Row [{idx}] ID: {r.get('id')} | Embedding: {emb_info} | consolidated_at: {r.get('consolidated_at')}")

        # Overall counts for aura_chroma_backup
        total_rows = results["tables"]["aura_chroma_backup"]["row_count"]
        null_res = client.table("aura_chroma_backup").select("id", count="exact").is_("embedding", "null").execute()
        total_null = null_res.count if null_res.count is not None else -1
        valid_res = client.table("aura_chroma_backup").select("id", count="exact").not_.is_("embedding", "null").execute()
        total_valid = valid_res.count if valid_res.count is not None else -1

        results["embedding_status"] = {
            "sample_limit": len(sample_rows),
            "sample_null_count": null_count,
            "sample_vector_count": vector_count,
            "total_rows": total_rows,
            "total_null_embeddings": total_null,
            "total_valid_embeddings": total_valid,
            "details": details,
        }

        print(f"\n[SUMMARY] Sampled {len(sample_rows)} rows: {null_count} NULL, {vector_count} valid vectors.")
        print(f"[SUMMARY] Across all {total_rows} rows: {total_null} NULL ({total_null/total_rows*100:.1f}%), {total_valid} valid vectors ({total_valid/total_rows*100:.1f}%).")

    except Exception as exc:
        raise RuntimeError(f"FATAL: Failed to query embeddings on aura_chroma_backup: {exc}") from exc

    # 6. Markdown Checklist Output
    print("\n==================================================")
    print("HEALTH PROBE CHECKLIST RESULT")
    print("==================================================")

    acb_exists = results["tables"].get("aura_chroma_backup", {}).get("exists", False)
    ast_exists = results["tables"].get("aura_storage", {}).get("exists", False)
    ase_exists = results["tables"].get("aura_seeds", {}).get("exists", False)
    col_exists = results["consolidated_at_exists"]

    emb_stats = results["embedding_status"]
    is_sample_all_null = emb_stats["sample_vector_count"] == 0 and emb_stats["sample_null_count"] > 0

    print(f"- [{'x' if acb_exists else ' '}] Table `aura_chroma_backup` exists ({results['tables']['aura_chroma_backup']['row_count']} rows)")
    print(f"- [{'x' if ast_exists else ' '}] Table `aura_storage` exists ({results['tables']['aura_storage']['row_count']} rows)")
    print(f"- [{'x' if ase_exists else ' '}] Table `aura_seeds` exists ({results['tables']['aura_seeds']['row_count']} rows)")
    print(f"- [{'x' if col_exists else ' '}] Column `consolidated_at` on `aura_chroma_backup` exists")
    if is_sample_all_null:
        print(f"- [x] Embeddings in `aura_chroma_backup` (LIMIT 5): ALL NULL ({emb_stats['sample_null_count']}/5 sampled rows are NULL; {emb_stats['total_null_embeddings']}/{emb_stats['total_rows']} across entire table)")
    else:
        print(f"- [x] Embeddings in `aura_chroma_backup` (LIMIT 5): {emb_stats['sample_vector_count']} valid, {emb_stats['sample_null_count']} NULL")
    print("==================================================")

if __name__ == "__main__":
    main()
