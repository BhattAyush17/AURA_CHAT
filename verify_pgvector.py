import asyncio, os
from supabase import create_client
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"]
)

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

TEST_USER = "test_user_aura_verify"

async def run():
    embed_result = client.models.embed_content(
        model="gemini-embedding-001",
        contents=["AURA verification test memory"],
        config=types.EmbedContentConfig(output_dimensionality=768)
    )
    emb = list(embed_result.embeddings[0].values)
    print("EMBED ok dims=", len(emb))

    supabase.table("aura_chroma_backup").insert({
        "user_id": TEST_USER,
        "session_id": "verify_001",
        "turn_text": "AURA verification test memory",
        "metadata": {"test": True},
        "embedding_id": "verify_001",
        "embedding": emb
    }).execute()
    print("STORE ok")

    r = supabase.rpc("match_memories", {
        "query_embedding": emb,
        "match_user_id": TEST_USER,
        "match_threshold": 0.5,
        "match_count": 1
    }).execute()
    assert len(r.data) > 0
    print("SEARCH ok similarity=", r.data[0]["similarity"])

    supabase.table("aura_chroma_backup").delete().eq("user_id", TEST_USER).execute()
    print("CLEANUP ok")
    print("ALL CHECKS PASSED - pgvector verified - ChromaDB can be deleted")

asyncio.run(run())
