"""
CLI runner for memory consolidation.

Usage:
    python run_consolidation.py --user-id <UID>   # single user
    python run_consolidation.py --all             # all users with old memories
    python run_consolidation.py --all --dry-run   # preview only, no writes

Exit codes: 0 = success, 1 = partial errors, 2 = fatal error.
"""

import argparse
import asyncio
import os
import sys

from supabase import create_client
from google import genai
from google.genai import types

# Add project root to path when running from docs/scripts/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from memory_consolidator import MemoryConsolidator
from logging_config import get_logger

log = get_logger("run_consolidation")


# ---------------------------------------------------------------------------
# Embedding function (matches memory_sync.py implementation)
# ---------------------------------------------------------------------------

async def gemini_embed(text: str) -> list[float]:
    """Async wrapper around Gemini embedding-001 (768-dim)."""
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    def _call() -> list[float]:
        result = client.models.embed_content(
            model="gemini-embedding-001",
            contents=[text],
            config=types.EmbedContentConfig(output_dimensionality=768),
        )
        return list(result.embeddings[0].values)

    return await asyncio.to_thread(_call)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_clients():
    supabase = create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )
    return supabase


def _fetch_all_user_ids(supabase) -> list[str]:
    """Return distinct user IDs that have consolidatable memories."""
    from datetime import datetime, timedelta

    cutoff = (datetime.utcnow() - timedelta(days=7)).isoformat()
    result = (
        supabase
        .table("aura_chroma_backup")
        .select("user_id")
        .is_("consolidated_at", "null")
        .lt("created_at", cutoff)
        .execute()
    )
    rows = result.data or []
    return list({r["user_id"] for r in rows if r.get("user_id")})


def _print_stats(stats: dict, dry_run: bool) -> None:
    prefix = "[DRY RUN] " if dry_run else ""
    print(
        f"{prefix}user={stats['user_id']} | "
        f"episodes_created={stats['episodes_created']} | "
        f"turns_consolidated={stats['turns_consolidated']} | "
        f"errors={stats['errors']}"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> int:
    parser = argparse.ArgumentParser(description="AURA memory consolidation runner")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--user-id", help="Consolidate a single user")
    group.add_argument("--all", action="store_true", help="Consolidate all eligible users")
    parser.add_argument("--purge", action="store_true", help="Permanently delete consolidated memories > 30 days old")
    parser.add_argument("--dry-run", action="store_true", help="Preview only — no writes")
    args = parser.parse_args()

    try:
        supabase = _build_clients()
    except KeyError as exc:
        print(f"[ERROR] Missing environment variable: {exc}", file=sys.stderr)
        return 2

    consolidator = MemoryConsolidator(supabase_client=supabase, embedding_fn=gemini_embed)

    user_ids = [args.user_id] if args.user_id else _fetch_all_user_ids(supabase)

    if not user_ids:
        print("No eligible users found.")
        return 0

    total_errors = 0
    for uid in user_ids:
        stats = await consolidator.consolidate_user(uid, dry_run=args.dry_run)
        _print_stats(stats, dry_run=args.dry_run)
        total_errors += stats.get("errors", 0)

    if args.purge and not args.dry_run:
        print("Purging memories older than 30 days...")
        purged = await consolidator.purge_old_memories(days=30)
        print(f"Purged {purged} old memories.")

    return 1 if total_errors else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
