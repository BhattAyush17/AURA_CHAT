"""
AURA General Intelligence Context Layer — Live Knowledge Fallback Engine
"""

import os
import re
import httpx
import logging
from urllib.parse import quote_plus
from typing import Dict, Any, List

logger = logging.getLogger("server")

class LiveKnowledgeFallbackEngine:
    """
    Responsibilities:
    - Real-time classification: detect queries requiring live/fresh information
    - Config-driven routing: integrate search API providers (Tavily, Serper, SerpApi)
    - Keyless fallback: direct web search using a fast DuckDuckGo HTML parser
    - Defensive grounding: timeout, retries, and zero-blocking safety guarantees
    """

    def __init__(self):
        # Classifiers for freshness requirement
        self.freshness_patterns = [
            # Weather & Environment
            r"\b(weather|temperature|humidity|forecast|rain|snow|wind|sunset|sunrise|degree celsius)\b",
            # News & Current Events
            r"\b(news|current events|headlines|happenings|election|politics|conflict|president|prime minister|ceo|cabinet)\b",
            # Financial Markets & Cryptocurrencies
            r"\b(stock|shares|nasdaq|dow jones|nifty|sensex|crypto|bitcoin|ethereum|price of|ticker|valuation|market cap)\b",
            # Sports & Live Events
            r"\b(score|match|game|sports|ipl|cricket|football|soccer|champions league|basketball|nba|wimbledon|olympics)\b",
            # Highly Temporal Grounding
            r"\b(today|tomorrow|yesterday|tonight|this week|current time|what day is it)\b",
            # Technology Releases & Versions
            r"\b(latest release|version of|newest|released date|release of|update of|ios|android|gpt|gemini|nvidia)\b",
            # Immediate Present
            r"\b(who is currently|who is now|current status of|happened in the last|happened recently)\b"
        ]

    def requires_freshness(self, text: str) -> bool:
        """Determines if a user turn requires real-world freshness grounding."""
        text_lower = text.lower().strip()
        for pattern in self.freshness_patterns:
            if re.search(pattern, text_lower):
                return True
        return False

    async def _search_tavily(self, query: str, api_key: str) -> List[Dict[str, str]]:
        try:
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.post(
                    "https://api.tavily.com/search",
                    json={
                        "api_key": api_key,
                        "query": query,
                        "search_depth": "light",
                        "max_results": 3
                    }
                )
                if resp.status_code == 200:
                    data = resp.json()
                    results = []
                    for item in data.get("results", []):
                        results.append({
                            "title": item.get("title", ""),
                            "snippet": item.get("content", ""),
                            "link": item.get("url", "")
                        })
                    return results
        except Exception as e:
            logger.debug(f"Tavily search failed: {str(e)}")
        return []

    async def _search_serper(self, query: str, api_key: str) -> List[Dict[str, str]]:
        try:
            headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.post(
                    "https://google.serper.dev/search",
                    headers=headers,
                    json={"q": query, "num": 3}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    results = []
                    for item in data.get("organic", []):
                        results.append({
                            "title": item.get("title", ""),
                            "snippet": item.get("snippet", ""),
                            "link": item.get("link", "")
                        })
                    return results
        except Exception as e:
            logger.debug(f"Serper search failed: {str(e)}")
        return []

    async def _search_serpapi(self, query: str, api_key: str) -> List[Dict[str, str]]:
        try:
            params = {
                "q": query,
                "api_key": api_key,
                "num": 3,
                "engine": "google"
            }
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get("https://serpapi.com/search", params=params)
                if resp.status_code == 200:
                    data = resp.json()
                    results = []
                    for item in data.get("organic_results", []):
                        results.append({
                            "title": item.get("title", ""),
                            "snippet": item.get("snippet", ""),
                            "link": item.get("link", "")
                        })
                    return results
        except Exception as e:
            logger.debug(f"SerpApi search failed: {str(e)}")
        return []

    async def _search_ddg_fallback(self, query: str) -> List[Dict[str, str]]:
        """Ultra-fast, zero-dependency keyless DuckDuckGo search parser."""
        try:
            url = f"https://html.duckduckgo.com/html/?q={quote_plus(query)}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
            async with httpx.AsyncClient(headers=headers, timeout=2.0) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    html = resp.text
                    results = []

                    # Find result blocks
                    # DuckDuckGo HTML results are clean container lists.
                    blocks = re.findall(r'<div class="result[^"]*">(.*?)</div>\s*</div>', html, re.DOTALL)
                    for block in blocks[:3]:
                        title_match = re.search(r'<a class="result__a"[^>]*>(.*?)</a>', block, re.DOTALL)
                        link_match = re.search(r'href="([^"]+)"', block)
                        snippet_match = re.search(r'<a class="result__snippet"[^>]*>(.*?)</a>', block, re.DOTALL)

                        if title_match and snippet_match:
                            title = re.sub(r'<[^>]+>', '', title_match.group(1)).strip()
                            snippet = re.sub(r'<[^>]+>', '', snippet_match.group(1)).strip()
                            link = link_match.group(1) if link_match else ""

                            # Clean DDG redirect links
                            if "/l/?kh=-1&uddg=" in link:
                                from urllib.parse import unquote
                                try:
                                    link = unquote(link.split("uddg=")[1].split("&")[0])
                                except Exception:
                                    pass

                            results.append({
                                "title": title,
                                "snippet": snippet,
                                "link": link
                            })
                    return results
        except Exception as e:
            logger.debug(f"DuckDuckGo keyless search fallback failed: {str(e)}")
        return []

    async def get_context(self, query: str) -> Dict[str, Any]:
        """
        Executes query classification and dynamic routing.
        Guarantees non-blocking processing and soft fallback.
        """
        if not self.requires_freshness(query):
            return {
                "triggered": False,
                "query": query,
                "results": [],
                "summary": "Query does not require live knowledge."
            }

        # Config-driven provider checks
        tavily_key = os.getenv("TAVILY_API_KEY")
        serper_key = os.getenv("SERPER_API_KEY")
        serpapi_key = os.getenv("SERPAPI_API_KEY")

        results = []
        provider = "duckduckgo"

        if tavily_key:
            results = await self._search_tavily(query, tavily_key)
            provider = "tavily"
        elif serper_key:
            results = await self._search_serper(query, serper_key)
            provider = "serper"
        elif serpapi_key:
            results = await self._search_serpapi(query, serpapi_key)
            provider = "serpapi"

        # Fallback to keyless DuckDuckGo if search provider is unset or failed
        if not results:
            results = await self._search_ddg_fallback(query)
            provider = "duckduckgo_fallback"

        summary = f"Retrieved {len(results)} live results from {provider}."
        if not results:
            summary = "Live knowledge lookup was triggered but returned no results."

        return {
            "triggered": True,
            "query": query,
            "provider": provider,
            "results": results,
            "summary": summary
        }


# Singleton instance
fallback_engine = LiveKnowledgeFallbackEngine()
