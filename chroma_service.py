import asyncio
from datetime import datetime


class ChromaBackgroundService:
    def __init__(self):
        self.client = None
        self.collection = None
        self.is_ready = False

    async def initialize(self, supabase_client=None, rebuild_user_id=None):
        try:
            import chromadb
            self.client = chromadb.PersistentClient(
                path="./chroma_behavior_db"
            )
            self.collection = self.client.get_or_create_collection(
                name="aura_memories",
                metadata={"hnsw:space": "cosine"}
            )
            # Warm up with dummy query
            try:
                self.collection.query(
                    query_texts=["warmup"],
                    n_results=1
                )
            except Exception:
                pass

            # Rebuild from Supabase if index is empty
            if (
                self.collection.count() == 0
                and supabase_client
                and rebuild_user_id
            ):
                await self.rebuild_from_supabase(
                    supabase_client, rebuild_user_id
                )

            self.is_ready = True
            print("[AURA] ChromaDB warm and ready")
        except Exception as e:
            print(f"[AURA] ChromaDB unavailable: {e}")
            self.is_ready = False

    async def query(self, text: str, n: int = 3) -> list:
        if not self.is_ready:
            return []
        try:
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                lambda: self.collection.query(
                    query_texts=[text],
                    n_results=n
                )
            )
            docs = results.get("documents", [[]])[0]
            metas = results.get("metadatas", [[]])[0]
            return [
                {"text": d, "metadata": m}
                for d, m in zip(docs, metas)
            ]
        except Exception:
            return []

    async def store_memory(
        self,
        session_id: str,
        text: str,
        metadata: dict,
        embedding_id: str
    ):
        if not self.is_ready:
            return
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self.collection.upsert(
                    documents=[text],
                    metadatas=[metadata],
                    ids=[embedding_id]
                )
            )
        except Exception:
            pass

    async def rebuild_from_supabase(
        self, supabase_client, user_id: str
    ):
        try:
            records = supabase_client\
                .table("aura_chroma_backup")\
                .select("*")\
                .eq("user_id", user_id)\
                .execute()
            if not records.data:
                return
            for record in records.data:
                await self.store_memory(
                    session_id=record["session_id"],
                    text=record["turn_text"],
                    metadata=record["metadata"],
                    embedding_id=record["embedding_id"]
                )
            print(
                f"[AURA] Rebuilt ChromaDB from "
                f"{len(records.data)} Supabase records"
            )
        except Exception as e:
            print(f"[AURA] ChromaDB rebuild failed: {e}")


chroma_service = ChromaBackgroundService()
