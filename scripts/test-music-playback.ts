/**
 * Music Playback Diagnostic Script
 *
 * Tests the playback path in isolation to identify where failures occur.
 * Run with: npx tsx scripts/test-music-playback.ts
 */

import { playbackState } from "../src/music/PlaybackState";
import { musicService } from "../src/music/MusicService";

const API_BASE = "http://localhost:8000";

interface DiagnosticRecord {
  stage: string;
  timestamp: number;
  success: boolean;
  details: string;
  error?: string;
}

const records: DiagnosticRecord[] = [];

function log(stage: string, success: boolean, details: string, error?: string) {
  records.push({
    stage,
    timestamp: Date.now(),
    success,
    details,
    error,
  });
  console.log(`[${success ? "OK" : "FAIL"}] ${stage}: ${details}${error ? ` (${error})` : ""}`);
}

async function testBackendHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (res.ok) {
      const data = await res.json();
      log("BACKEND_HEALTH", true, `Backend is healthy: ${JSON.stringify(data).slice(0, 100)}`);
      return true;
    }
    log("BACKEND_HEALTH", false, `HTTP ${res.status}`);
    return false;
  } catch (e: any) {
    log("BACKEND_HEALTH", false, "Cannot reach backend", e.message);
    return false;
  }
}

async function testYtMusicSearch(query: string): Promise<any> {
  log("SEARCH_START", true, `Query: "${query}"`);
  try {
    const res = await fetch(`${API_BASE}/api/ytmusic/search?query=${encodeURIComponent(query)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.error) {
        log("SEARCH_SUCCESS", false, `Backend error: ${data.message}`);
        return null;
      }
      if (data.youtube_id && data.audio_stream_url) {
        log("SEARCH_SUCCESS", true, `Found: ${data.title} (${data.youtube_id})`);
        return data;
      }
      log("SEARCH_SUCCESS", false, "No playable track returned");
      return null;
    }
    log("SEARCH_SUCCESS", false, `HTTP ${res.status}`);
    return null;
  } catch (e: any) {
    log("SEARCH_SUCCESS", false, "Request failed", e.message);
    return null;
  }
}

async function testMediaUrl(url: string): Promise<boolean> {
  log("URL_VALID", true, `Testing: ${url.substring(0, 80)}...`);
  try {
    // Just check headers, don't download the whole file
    const res = await fetch(url, {
      method: "HEAD",
      mode: "cors",
    });
    if (res.ok || res.status === 206) {
      const contentType = res.headers.get("Content-Type") || "unknown";
      const contentLength = res.headers.get("Content-Length") || "unknown";
      log("URL_VALID", true, `Content-Type: ${contentType}, Content-Length: ${contentLength}`);
      return true;
    }
    log("URL_VALID", false, `HTTP ${res.status}`);
    return false;
  } catch (e: any) {
    log("URL_VALID", false, "CORS or network error", e.message);
    return false;
  }
}

async function testProxy(url: string): Promise<boolean> {
  log("PROXY_START", true, `Testing proxy for: ${url.substring(0, 60)}...`);
  try {
    const proxyUrl = `${API_BASE}/api/ytmusic/proxy?url=${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, {
      method: "HEAD",
      mode: "cors",
    });
    if (res.ok || res.status === 206) {
      const contentType = res.headers.get("Content-Type") || "unknown";
      log("PROXY_SUCCESS", true, `Content-Type: ${contentType}`);
      return true;
    }
    log("PROXY_SUCCESS", false, `HTTP ${res.status}`);
    return false;
  } catch (e: any) {
    log("PROXY_SUCCESS", false, "Proxy failed", e.message);
    return false;
  }
}

async function testAudioElement(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    log("AUDIO_ELEMENT_FOUND", true, "Creating audio element");

    const audio = new Audio();
    audio.crossOrigin = "anonymous";

    const timeout = setTimeout(() => {
      log("AUDIO_TIMEOUT", false, "Audio element timed out");
      audio.src = "";
      resolve(false);
    }, 10000);

    audio.addEventListener("loadedmetadata", () => {
      log("LOADEDMETADATA", true, `Duration: ${audio.duration}s, readyState: ${audio.readyState}`);
    });

    audio.addEventListener("canplay", () => {
      log("CANPLAY", true, `readyState: ${audio.readyState}`);
    });

    audio.addEventListener("error", (e) => {
      const err = (e as any).error;
      log("AUDIO_ERROR", false, `error code: ${err?.code}, message: ${err?.message}`, err?.name);
      clearTimeout(timeout);
      audio.src = "";
      resolve(false);
    });

    audio.addEventListener("play", () => {
      log("PLAYING", true, "Audio element started playing");
    });

    audio.addEventListener("pause", () => {
      if (!audio.ended) {
        log("AUDIO_PAUSE", false, "Audio was paused unexpectedly");
      }
    });

    try {
      audio.src = url;
      audio.load();

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            log("PLAY_RESOLVED", true, "play() succeeded");
            clearTimeout(timeout);
            setTimeout(() => {
              audio.pause();
              audio.src = "";
              resolve(true);
            }, 2000);
          })
          .catch((e: any) => {
            log("PLAY_REJECTED", false, `play() failed: ${e.name}`, e.message);
            clearTimeout(timeout);
            audio.src = "";
            resolve(false);
          });
      }
    } catch (e: any) {
      log("PLAY_EXCEPTION", false, "play() threw exception", e.message);
      clearTimeout(timeout);
      audio.src = "";
      resolve(false);
    }
  });
}

async function runDiagnostics() {
  console.log("\n========================================");
  console.log("MUSIC PLAYBACK DIAGNOSTIC");
  console.log("========================================\n");

  // Test 1: Backend health
  console.log("\n--- STEP 1: Backend Health ---");
  const backendOk = await testBackendHealth();
  if (!backendOk) {
    console.log("\n[CRITICAL] Backend is unreachable. Fix backend first.");
    return;
  }

  // Test 2: Search
  console.log("\n--- STEP 2: YouTube Search ---");
  const searchResult = await testYtMusicSearch("Counting Stars OneRepublic");
  if (!searchResult) {
    console.log("\n[CRITICAL] Search returned no results. Check backend yt-dlp.");
    return;
  }

  // Test 3: URL validation
  console.log("\n--- STEP 3: Direct Media URL ---");
  let mediaUrl = searchResult.audio_stream_url;
  const urlOk = await testMediaUrl(mediaUrl);
  if (!urlOk) {
    console.log("\n[WARN] Direct URL is not accessible. Testing proxy...");
    const proxyOk = await testProxy(mediaUrl);
    if (proxyOk) {
      mediaUrl = `${API_BASE}/api/ytmusic/proxy?url=${encodeURIComponent(mediaUrl)}`;
      console.log("[INFO] Using proxy URL instead");
    }
  }

  // Test 4: Audio element
  console.log("\n--- STEP 4: Audio Element Test ---");
  const audioOk = await testAudioElement(mediaUrl);

  // Summary
  console.log("\n========================================");
  console.log("DIAGNOSTIC SUMMARY");
  console.log("========================================");
  for (const r of records) {
    const status = r.success ? "✓" : "✗";
    console.log(`${status} [${new Date(r.timestamp).toISOString()}] ${r.stage}: ${r.details}`);
  }

  console.log("\n--- PLAYBACK PATH STATUS ---");
  const criticalStages = [
    "BACKEND_HEALTH",
    "SEARCH_SUCCESS",
    "URL_VALID",
    "PROXY_SUCCESS",
    "CANPLAY",
    "PLAY_RESOLVED",
  ];
  for (const stage of criticalStages) {
    const record = records.find((r) => r.stage === stage);
    if (record) {
      console.log(`${record.success ? "✓" : "✗"} ${stage}`);
    }
  }
}

runDiagnostics().catch(console.error);
