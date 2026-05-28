import React, { useState, useEffect } from 'react';
import { ENDPOINTS } from '@/config/api';
import { getCredential } from '@/lib/credentials';

export function RedisManager() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStats = async () => {
    setLoading(true);
    setError('');
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Redis-Url": getCredential("redis_url") || (import.meta.env.VITE_REDIS_URL as string) || "",
        "X-Gemini-Key": getCredential("aura_gemini_api_key") || (import.meta.env.VITE_GEMINI_API_KEY as string) || "",
        "X-OpenRouter-Key": getCredential("openrouter_api_key") || (import.meta.env.VITE_OPENROUTER_API_KEY as string) || "",
        "X-Cohere-Key": getCredential("cohere_api_key") || (import.meta.env.VITE_COHERE_API_KEY as string) || "",
        "X-Pinecone-Key": getCredential("pinecone_api_key") || (import.meta.env.VITE_PINECONE_API_KEY as string) || "",
      };

      const baseUrl = ENDPOINTS.analyze.replace('/api/analyze', '');
      const res = await fetch(`${baseUrl}/api/redis/stats`, { headers });
      if (!res.ok) throw new Error('Failed to fetch Redis stats');
      const data = await res.json();
      setStats(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const headers: Record<string, string> = {
        "X-Redis-Url": getCredential("redis_url") || (import.meta.env.VITE_REDIS_URL as string) || "",
        "X-Gemini-Key": getCredential("aura_gemini_api_key") || (import.meta.env.VITE_GEMINI_API_KEY as string) || "",
        "X-OpenRouter-Key": getCredential("openrouter_api_key") || (import.meta.env.VITE_OPENROUTER_API_KEY as string) || "",
        "X-Cohere-Key": getCredential("cohere_api_key") || (import.meta.env.VITE_COHERE_API_KEY as string) || "",
        "X-Pinecone-Key": getCredential("pinecone_api_key") || (import.meta.env.VITE_PINECONE_API_KEY as string) || "",
      };
      const baseUrl = ENDPOINTS.analyze.replace('/api/analyze', '');
      const res = await fetch(`${baseUrl}/api/redis/session/${sessionId}`, { 
        method: 'DELETE',
        headers 
      });
      if (res.ok) fetchStats();
    } catch (err) {
      console.error(err);
    }
  };

  const clearStream = async () => {
    try {
      const headers: Record<string, string> = {
        "X-Redis-Url": getCredential("redis_url") || (import.meta.env.VITE_REDIS_URL as string) || "",
        "X-Gemini-Key": getCredential("aura_gemini_api_key") || (import.meta.env.VITE_GEMINI_API_KEY as string) || "",
        "X-OpenRouter-Key": getCredential("openrouter_api_key") || (import.meta.env.VITE_OPENROUTER_API_KEY as string) || "",
        "X-Cohere-Key": getCredential("cohere_api_key") || (import.meta.env.VITE_COHERE_API_KEY as string) || "",
        "X-Pinecone-Key": getCredential("pinecone_api_key") || (import.meta.env.VITE_PINECONE_API_KEY as string) || "",
      };
      const baseUrl = ENDPOINTS.analyze.replace('/api/analyze', '');
      const res = await fetch(`${baseUrl}/api/redis/stream`, { 
        method: 'DELETE',
        headers 
      });
      if (res.ok) fetchStats();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  return (
    <div className="w-full space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
          ⚡ Redis Overview
        </h3>
        <button 
          onClick={fetchStats} 
          disabled={loading} 
          className="px-3 py-1 bg-muted hover:bg-muted/80 text-foreground border border-border rounded text-xs font-medium transition disabled:opacity-50"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="text-red-500 text-xs bg-red-500/10 p-2 rounded border border-red-500/20">{error}</div>}

      {loading && !stats ? (
        <div className="p-4 text-muted-foreground text-xs text-center animate-pulse bg-background border border-border rounded-lg">Connecting to Redis Backend...</div>
      ) : !stats ? (
        <div className="text-muted-foreground text-xs p-4 bg-background border border-border rounded-lg text-center">
          Failed to load Redis statistics. Ensure your backend is running.
        </div>
      ) : !stats.available ? (
        <div className="text-muted-foreground text-xs p-4 bg-background border border-border rounded-lg text-center">
          {stats.message || "Redis is currently unavailable. Check your credentials or network."}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-background p-3 rounded-lg border border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Memory Used</div>
              <div className="text-lg font-bold text-foreground mt-1">{stats.memory_used}</div>
            </div>
            <div className="bg-background p-3 rounded-lg border border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Commands</div>
              <div className="text-lg font-bold text-foreground mt-1">{stats.total_commands}</div>
            </div>
            <div className="bg-background p-3 rounded-lg border border-border">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Active Sessions</div>
              <div className="text-lg font-bold text-foreground mt-1">{stats.active_sessions?.length || 0}</div>
            </div>
          </div>

          <div className="bg-background p-4 rounded-lg border border-border">
            <div className="flex justify-between items-center mb-3">
              <h4 className="font-semibold text-sm text-foreground">Transcript Stream</h4>
              <span className="text-[10px] bg-foreground text-background px-2 py-0.5 rounded-full font-bold">
                {stats.stream_length} events
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3 leading-relaxed">
              Stores raw audio transcripts and conversation events across all active sessions. Unbounded streams consume memory.
            </p>
            <button 
              onClick={clearStream}
              className="w-full px-4 py-2 bg-background hover:bg-muted text-foreground border border-border rounded transition-colors text-xs font-medium"
            >
              Clear Entire Stream
            </button>
          </div>

          <div className="bg-background p-4 rounded-lg border border-border">
            <h4 className="font-semibold text-sm text-foreground mb-3">Active Cached Sessions</h4>
            {stats.active_sessions?.length === 0 ? (
              <div className="text-xs text-muted-foreground text-center py-4 border border-dashed border-border/50 rounded">No active sessions in cache.</div>
            ) : (
              <ul className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-1">
                {stats.active_sessions?.map((session: any) => (
                  <li key={session.id} className="flex justify-between items-center bg-muted/30 p-2.5 rounded border border-border/50">
                    <div>
                      <div className="font-mono text-[11px] text-foreground">{session.id.split('__')[0]}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-foreground animate-pulse"></span>
                        Expires in {session.ttl}s
                      </div>
                    </div>
                    <button 
                      onClick={() => deleteSession(session.id)}
                      className="text-xs text-foreground hover:bg-foreground hover:text-background px-3 py-1 border border-border rounded transition-colors"
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
