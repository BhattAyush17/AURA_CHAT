"""
AURA Embedding Provider — Multi-tier embedding pipeline.

Priority chain:
  1. Gemini embedding-001 (768-dim) — if GEMINI_API_KEY set
  2. Cohere embed-multilingual-v3.0 (truncated to 768-dim via MRL) — if COHERE_API_KEY set
  3. Local FastEmbed BGE-base (768-dim) — if fastembed installed
  4. None — callers fall back to FTS keyword search

All providers output exactly 768-dim vectors for pgvector compatibility.
"""

import os
import asyncio
from backend.infrastructure.logging import get_logger

log = get_logger("embedding_provider")

VECTOR_DIM = 768


class EmbeddingProvider:
    """Singleton embedding provider with automatic fallback chain."""

    def __init__(self):
        self._active = None       # 'gemini' | 'cohere' | 'fastembed' | None
        self._gemini_client = None
        self._cohere_key = None
        self._fastembed_model = None
        self._httpx_client = None

    @property
    def provider_name(self) -> str:
        return self._active or "none"

    @property
    def is_available(self) -> bool:
        return self._active is not None

    async def initialize(self) -> str:
        """Try each provider in priority order. Returns active provider name."""

        # ── 1. Gemini ────────────────────────────────────────────
        gemini_key = os.environ.get("GEMINI_API_KEY", "")
        if gemini_key:
            try:
                from google import genai
                self._gemini_client = genai.Client(api_key=gemini_key)
                self._active = "gemini"
                log.info("embedding_provider_ready", provider="gemini", dim=VECTOR_DIM)
                return "gemini"
            except Exception as e:
                log.warning("gemini_embed_init_failed", error=str(e))

        # ── 2. Cohere (free tier, multilingual) ──────────────────
        cohere_key = os.environ.get("COHERE_API_KEY", "")
        if cohere_key:
            try:
                import httpx
                self._cohere_key = cohere_key
                self._httpx_client = httpx.AsyncClient(timeout=10.0)
                self._active = "cohere"
                log.info("embedding_provider_ready", provider="cohere", dim=VECTOR_DIM)
                return "cohere"
            except Exception as e:
                log.warning("cohere_embed_init_failed", error=str(e))

        # ── 3. FastEmbed (local, optional install) ───────────────
        try:
            from fastembed import TextEmbedding
            # Lazy initialization: just check imports and set active, don't instantiate model yet
            self._active = "fastembed"
            log.info("embedding_provider_ready", provider="fastembed (lazy)", dim=VECTOR_DIM)
            return "fastembed"
        except ImportError:
            log.info("fastembed_not_installed", hint="pip install fastembed")
        except Exception as e:
            log.warning("fastembed_init_failed", error=str(e))

        # ── 4. No provider — FTS fallback ────────────────────────
        self._active = None
        log.info("no_embedding_provider", fallback="fts_keyword_search")
        return "none"

    async def embed(self, text: str) -> list:
        """Embed text into a 768-dim float vector. Returns [] on failure."""
        if not text.strip() or not self._active:
            return []
        try:
            if self._active == "gemini":
                return await self._embed_gemini(text)
            elif self._active == "cohere":
                return await self._embed_cohere(text)
            elif self._active == "fastembed":
                return await self._embed_fastembed(text)
        except Exception as e:
            log.warning("embed_failed", provider=self._active, error=str(e))
        return []

    # ── Provider implementations ─────────────────────────────────

    async def _embed_gemini(self, text: str) -> list:
        def _call():
            resp = self._gemini_client.models.embed_content(
                model="gemini-embedding-001",
                contents=[text],
                config={"output_dimensionality": VECTOR_DIM},
            )
            return list(resp.embeddings[0].values)
        return await asyncio.to_thread(_call)

    async def _embed_cohere(self, text: str) -> list:
        """Cohere embed-multilingual-v3.0 → 1024-dim, truncated to 768 via MRL."""
        resp = await self._httpx_client.post(
            "https://api.cohere.com/v1/embed",
            headers={
                "Authorization": f"Bearer {self._cohere_key}",
                "Content-Type": "application/json",
            },
            json={
                "texts": [text],
                "model": "embed-multilingual-v3.0",
                "input_type": "search_document",
                "truncate": "END",
            },
        )
        resp.raise_for_status()
        emb = resp.json()["embeddings"][0]
        return emb[:VECTOR_DIM]  # MRL truncation — valid for Cohere v3

    async def _embed_fastembed(self, text: str) -> list:
        if self._fastembed_model is None:
            from fastembed import TextEmbedding
            self._fastembed_model = TextEmbedding(
                model_name="BAAI/bge-base-en-v1.5",
                max_length=512,
            )

        def _call():
            embeddings = list(self._fastembed_model.embed([text]))
            return embeddings[0].tolist()[:VECTOR_DIM]
        return await asyncio.to_thread(_call)

    async def close(self):
        if self._httpx_client:
            await self._httpx_client.aclose()


# Module-level singleton
embedding_provider = EmbeddingProvider()
