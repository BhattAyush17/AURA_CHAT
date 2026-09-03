"""C1 verification — memory router registration and the live retrieval chain.

Audit finding (docs/reports/2026-09-02-memory-architecture-audit.md, C1):
`app` was rebound to a second FastAPI() after the cron + memory routers had
already been attached to the first one, so /api/memory/model/{user_id} and
/api/memory/consolidate were never mounted on the served application. The
frontend gateway could not distinguish the resulting 404 from "no memories".

This harness walks the full chain the audit asks for:

    main.py -> app instance -> memory_router registered -> memory API
    -> Supabase -> retrieved memories -> ranking/budget -> cognitive context

It seeds ONE scoped row into aura_storage (user_id/key both prefixed
`verify_c1_`), reads it back through the mounted route using the real Supabase
client, then deletes it. Cleanup runs in a finally block.

Run:  venv/bin/python -m backend.verify_c1
"""

import asyncio
import time
import uuid

passed = 0
failed = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global passed, failed
    if cond:
        passed += 1
        print(f"PASS  {name}")
    else:
        failed += 1
        print(f"FAIL  {name}" + (f" — {detail}" if detail else ""))


def section(title: str) -> None:
    print(f"\n── {title} ──")


async def main() -> None:
    # ── Stage 1: main.py -> app instance ────────────────────────────
    section("main.py -> FastAPI app instance")

    import backend.api.main as main_mod
    from backend.api.main import app

    check("a single FastAPI instance is exported", app is main_mod.app)
    check(
        "CORSMiddleware registered exactly once",
        [m.cls.__name__ for m in app.user_middleware].count("CORSMiddleware") == 1,
        f"stack={[m.cls.__name__ for m in app.user_middleware]}",
    )

    # ── Stage 2: memory_router registered on the served app ─────────
    section("app instance -> memory_router registered")

    paths = {getattr(r, "path", None) for r in app.routes}
    check("/api/memory/model/{user_id} is mounted", "/api/memory/model/{user_id}" in paths)
    check("/api/memory/consolidate is mounted", "/api/memory/consolidate" in paths)
    check("/api/cron/consolidate is mounted", "/api/cron/consolidate" in paths)

    # ── Stage 3: the routers must see the client created at startup ─
    section("memory API -> Supabase client visibility")

    import backend.api.cron as cron_mod
    import backend.api.memory_endpoints as me

    sentinel = f"SENTINEL_{uuid.uuid4().hex[:8]}"
    main_mod.supabase = sentinel
    check(
        "memory_endpoints resolves the client at call time",
        me.get_supabase() == sentinel,
        f"saw {me.get_supabase()!r}",
    )
    check(
        "cron resolves the client at call time",
        cron_mod.get_supabase() == sentinel,
        f"saw {cron_mod.get_supabase()!r}",
    )
    main_mod.supabase = None

    # Semantic ranking depends on this import; it used to point at
    # backend.memory.chroma, which has no such symbol.
    try:
        from backend.core.thought_field.identity.IdentityEvolution import cosine_similarity

        ok = abs(cosine_similarity([1.0, 0.0], [1.0, 0.0]) - 1.0) < 1e-9
        check("cosine_similarity imports and computes", ok)
    except Exception as e:  # pragma: no cover
        check("cosine_similarity imports and computes", False, f"{type(e).__name__}: {e}")

    # ── Stage 4: real Supabase round-trip through the mounted route ─
    section("Supabase -> retrieved memories -> ranking/budget")

    if not (main_mod.SUPABASE_URL and main_mod.SUPABASE_KEY):
        check("Supabase credentials present", False, "SUPABASE_URL / key not loaded")
        return

    client = await main_mod.async_create_client(main_mod.SUPABASE_URL, main_mod.SUPABASE_KEY)
    main_mod.supabase = client

    probe_user = f"verify_c1_{int(time.time())}"
    probe_key = f"user_model_{probe_user}"

    # A UserModel whose stable facts are deliberately distinguishable: one
    # matches the query, one does not. Ranking must prefer the former.
    now = time.time()

    def fact(topic: str, content: str, confidence: float) -> dict:
        return {
            "topic": topic,
            "content": content,
            "evidence": {
                "confidence": confidence,
                "recency": 1.0,
                "source": "explicit_statement",
                "supporting_observations": [],
                "first_observed": now,
                "last_reinforced": now,
            },
        }

    seeded_model = {
        "user_id": probe_user,
        "identity": {
            "stable_facts": [
                fact("music", "User plays the sitar every morning", 1.0),
                fact("food", "User dislikes raw onions", 1.0),
            ],
            "preferences": [fact("language", "Prefers Hinglish over pure English", 1.0)],
            "interests": [],
            "goals": [fact("career", "Wants to ship AURA to production", 1.0)],
        },
        "communication": {
            "languages": ["hinglish"],
            "code_switching": 0.6,
            "tone": "warm",
            "verbosity": "balanced",
            "register": "ACQUAINTING",
        },
        "current_state": {
            "topic": "sitar practice",
            "goal": "book a music teacher",
            "emotional_state": "curious",
            "engagement": 0.8,
            "activity": None,
            "last_updated": now,
        },
        "recent_context": {
            "active_topics": ["music"],
            "recent_events": [],
            "unresolved_items": [
                {
                    "topic": "music",
                    "content": "find a sitar teacher nearby",
                    "status": "ACTIVE",
                    "created_at": now,
                    "updated_at": now,
                }
            ],
        },
        "relationship": {"familiarity": 0.4, "rapport": 0.5, "interaction_history": 12},
        "recent_changes": [],
        "metadata": {
            "processed_consolidations": [],
            "created_at": now,
            "updated_at": now,
        },
    }

    try:
        # Seed through the route's own writer so the write path is covered too.
        # `_save_user_model` swallows its exceptions, so the read-back below is
        # what actually proves the row landed.
        from backend.core.thought_field.identity.UserModel import UserModel

        await me._save_user_model(UserModel.from_dict(seeded_model))
        print(f"      seeded aura_storage row via _save_user_model: {probe_user}")

        stored = await client.table("aura_storage").select("key").eq("user_id", probe_user).execute()
        check(
            "_save_user_model persisted a row (timestamptz + on_conflict correct)",
            len(stored.data) == 1,
            f"rows={len(stored.data)}",
        )

        # Saving twice must update in place, not raise on the UNIQUE index.
        await me._save_user_model(UserModel.from_dict(seeded_model))
        stored2 = await client.table("aura_storage").select("key").eq("user_id", probe_user).execute()
        check(
            "repeat save stays idempotent (one row, no 23505)",
            len(stored2.data) == 1,
            f"rows={len(stored2.data)}",
        )

        # Read it back the way the route does — through the real client.
        fetched = await me._fetch_user_model(probe_user)
        check(
            "route's _fetch_user_model returns the seeded model from Supabase",
            fetched.user_id == probe_user
            and any("sitar" in f.content for f in fetched.identity.stable_facts),
            f"user_id={fetched.user_id} facts={[f.content for f in fetched.identity.stable_facts]}",
        )

        # Full handler: ranking + 1600-char budget packing.
        unranked = await me._get_user_model(probe_user, "")
        check(
            "handler returns results for the seeded user",
            unranked["status"] == "success" and len(unranked["results"]) > 0,
            f"results={len(unranked['results'])}",
        )
        check(
            "results carry tier metadata the frontend splits on",
            all("tier" in r["metadata"] for r in unranked["results"]),
        )
        check(
            "stable tier present (frontend maps these to userIdentity.stableFacts)",
            any(r["metadata"]["tier"] == "stable" for r in unranked["results"]),
            f"tiers={[r['metadata']['tier'] for r in unranked['results']]}",
        )
        check(
            "current tier present (frontend maps these to memory.retrieved)",
            any(r["metadata"]["tier"] == "current" for r in unranked["results"]),
        )
        check(
            "budget respected (<= 1600 chars of content)",
            sum(len(r["content"]) for r in unranked["results"]) <= 1600,
            f"chars={sum(len(r['content']) for r in unranked['results'])}",
        )
        check(
            "mental model synthesized for the cognitive context",
            isinstance(unranked["mental_model"], str) and len(unranked["mental_model"]) > 0,
        )

        # Semantic ranking: a sitar query must outrank the onion fact.
        from backend.infrastructure.embedding_provider import embedding_provider

        provider = await embedding_provider.initialize()
        print(f"      embedding provider: {provider}")

        ranked = await me._get_user_model(probe_user, "who teaches sitar around here?")
        by_content = {r["content"]: r["similarity"] for r in ranked["results"]}
        sitar = next((s for c, s in by_content.items() if "sitar" in c), None)
        onion = next((s for c, s in by_content.items() if "onions" in c), None)
        if provider == "none":
            check(
                "semantic ranking exercised",
                False,
                "no embedding provider available — ranking fell back to base_score",
            )
        else:
            check(
                "query-relevant fact outranks an unrelated fact",
                sitar is not None and onion is not None and sitar > onion,
                f"sitar={sitar} onion={onion}",
            )

        # ── Stage 5: the mounted HTTP route, end to end ─────────────
        section("HTTP route -> AURA cognitive context")

        # ASGITransport drives the app inside THIS event loop. TestClient spins
        # up its own loop, which would strand the Supabase client's asyncio
        # primitives ("bound to a different event loop") — an artifact of the
        # harness, not of production, where startup_event creates the client in
        # the same loop that serves requests.
        import httpx

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            resp = await http.get(
                f"/api/memory/model/{probe_user}",
                params={"query": "who teaches sitar around here?"},
                headers={"Origin": "http://localhost:3000"},
            )

        check("route responds 200 (not 404)", resp.status_code == 200, f"status={resp.status_code}")
        body = resp.json()
        check(
            "HTTP response carries the seeded memory",
            any("sitar" in r["content"] for r in body.get("results", [])),
            f"results={[r['content'] for r in body.get('results', [])]}",
        )
        check(
            "single Access-Control-Allow-Origin header",
            len(resp.headers.get_list("access-control-allow-origin")) == 1,
            f"headers={resp.headers.get_list('access-control-allow-origin')}",
        )

        # The frontend gateway reads `results`; MemoryGateway.retrieveMemories
        # splits on metadata.tier === "stable" (src/lib/memory-gateway.ts:181,
        # src/runtime/RuntimeManager.ts:162).
        results = body.get("results", [])
        stable = [r for r in results if r["metadata"]["tier"] == "stable"]
        non_stable = [r for r in results if r["metadata"]["tier"] != "stable"]
        check(
            "response splits into stableFacts + retrieved as the runtime expects",
            len(stable) > 0 and len(non_stable) > 0,
            f"stable={len(stable)} other={len(non_stable)}",
        )

        # /health gates the whole path: MemoryGateway.initialize() only selects
        # supabase mode when checks.supabase.ok is true (memory-gateway.ts:54).
        # If this is false the frontend never calls the route we just fixed.
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
            health = await http.get("/health")
        hbody = health.json() if health.status_code == 200 else {}
        check(
            "/health reports checks.supabase.ok — gateway will select supabase mode",
            hbody.get("checks", {}).get("supabase", {}).get("ok") is True,
            f"status={health.status_code} supabase={hbody.get('checks', {}).get('supabase')}",
        )

    finally:
        try:
            await client.table("aura_storage").delete().eq("user_id", probe_user).execute()
            print(f"      cleaned up aura_storage row: {probe_user}")
        except Exception as e:
            print(f"      CLEANUP FAILED for {probe_user}: {e}")

    # ── Stage 6: the pgvector leg ───────────────────────────────────
    section("pgvector RPC + vector round-trip")

    zero = [0.0] * 768
    rpc_state = {}
    for rpc, args in [
        (
            "match_memories_v2",
            {
                "query_embedding": zero,
                "p_user_id": probe_user,
                "match_threshold": 0.99,
                "match_count": 1,
                "recency_weight": 0.15,
                "max_age_days": 365,
            },
        ),
        (
            "match_memories",
            {
                "query_embedding": zero,
                "match_user_id": probe_user,
                "match_threshold": 0.99,
                "match_count": 1,
            },
        ),
        ("match_memories_fts", {"query_text": "x", "p_user_id": probe_user, "match_count": 1}),
    ]:
        try:
            r = await client.rpc(rpc, args).execute()
            rpc_state[rpc] = "PRESENT"
            print(f"      {rpc}: PRESENT ({len(r.data)} rows)")
        except Exception as e:
            msg = str(e)
            absent = "could not find the function" in msg.lower()
            rpc_state[rpc] = "ABSENT" if absent else "ERROR"
            print(f"      {rpc}: {'ABSENT' if absent else msg[:90]}")

    check(
        "at least one vector RPC is callable",
        "PRESENT" in rpc_state.values(),
        f"state={rpc_state}",
    )

    # A real embedding written to aura_chroma_backup must come back through the
    # RPC that exists. This proves the vector column, the index and the scoring
    # function are wired, independent of which RPC version is deployed.
    vec_user = f"verify_c1_vec_{int(time.time())}"
    try:
        from backend.infrastructure.embedding_provider import embedding_provider

        emb = await embedding_provider.embed("I have been learning sitar for three years")
        check("embedding provider returns a 768-dim vector", len(emb) == 768, f"dims={len(emb)}")

        if len(emb) == 768:
            await client.table("aura_chroma_backup").insert(
                {
                    "user_id": vec_user,
                    "session_id": "verify_c1",
                    "turn_text": "I have been learning sitar for three years",
                    "metadata": {"verify_c1": True},
                    "embedding_id": f"{vec_user}_1",
                    "embedding": emb,
                }
            ).execute()

            if rpc_state.get("match_memories") == "PRESENT":
                hit = await client.rpc(
                    "match_memories",
                    {
                        "query_embedding": emb,
                        "match_user_id": vec_user,
                        "match_threshold": 0.5,
                        "match_count": 3,
                    },
                ).execute()
                check(
                    "pgvector RPC returns the seeded memory",
                    len(hit.data) > 0,
                    f"rows={len(hit.data)}",
                )
                if hit.data:
                    row = hit.data[0]
                    check(
                        "RPC row exposes text under a key chroma.py reads",
                        bool(row.get("content") or row.get("turn_text")),
                        f"keys={sorted(row.keys())}",
                    )
                    check(
                        "self-similarity is ~1.0",
                        row.get("similarity", 0) > 0.99,
                        f"similarity={row.get('similarity')}",
                    )
    finally:
        try:
            await client.table("aura_chroma_backup").delete().eq("user_id", vec_user).execute()
            print(f"      cleaned up aura_chroma_backup rows: {vec_user}")
        except Exception as e:
            print(f"      CLEANUP FAILED for {vec_user}: {e}")

    print(f"\n{passed} passed, {failed} failed")
    raise SystemExit(1 if failed else 0)


if __name__ == "__main__":
    asyncio.run(main())
