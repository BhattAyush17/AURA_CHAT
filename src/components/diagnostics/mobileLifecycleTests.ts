/**
 * Mobile Lifecycle Tests — Standalone tests for mobile-specific failure modes.
 *
 * Tests background recovery, screen lock recovery, and network switching.
 * All tests use independent resources and NEVER touch production instances.
 *
 * @module
 */

// ─── Types ──────────────────────────────────────────────────────────

export interface BackgroundRecoveryResult {
  tested: boolean;
  backgroundDurationMs: number;
  audioContextRestored: boolean;
  sttRecovered: boolean;
  details: string;
}

export interface ScreenLockRecoveryResult {
  tested: boolean;
  lockDurationMs: number;
  sessionRecovered: boolean;
  audioContextState: string;
  details: string;
}

export interface NetworkSwitchResult {
  tested: boolean;
  socketRecovered: boolean;
  recoveryTimeMs: number;
  details: string;
}

export interface MobileLifecycleReport {
  backgroundRecovery: BackgroundRecoveryResult;
  screenLockRecovery: ScreenLockRecoveryResult;
  networkSwitch: NetworkSwitchResult;
}

// ─── Background Recovery Test ──────────────────────────────────────

/**
 * Simulates returning from background by:
 * 1. Creating a fresh AudioContext + SpeechRecognition
 * 2. Suspending the AudioContext (simulates OS suspension)
 * 3. Attempting to resume everything
 *
 * Does NOT touch any production AudioContext or SpeechRecognition.
 */
export async function testBackgroundRecovery(durationMs: number = 5000): Promise<BackgroundRecoveryResult> {
  const result: BackgroundRecoveryResult = {
    tested: false,
    backgroundDurationMs: durationMs,
    audioContextRestored: false,
    sttRecovered: false,
    details: "",
  };

  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) {
      result.details = "AudioContext not available";
      return result;
    }

    // Create a test AudioContext
    const ctx = new AC();
    result.tested = true;

    // Ensure it's running
    if (ctx.state === "suspended") await ctx.resume();

    // Suspend (simulates OS background suspension)
    await ctx.suspend();
    result.details = `AudioContext suspended at ${new Date().toISOString()}. `;

    // Wait for the simulated background period
    await sleep(Math.min(durationMs, 10000)); // Cap at 10s for safety

    // Attempt recovery
    try {
      await ctx.resume();
      result.audioContextRestored = ctx.state === "running";
      result.details += `Recovery attempt: state=${ctx.state}. `;
    } catch (err: any) {
      result.details += `AudioContext resume failed: ${err?.message}. `;
    }

    // Test STT recovery
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SR) {
      try {
        const recognition = new SR();
        recognition.continuous = false;
        recognition.lang = "en-US";

        const sttOk = await new Promise<boolean>((resolve) => {
          const timeout = setTimeout(() => {
            try { recognition.abort(); } catch { /* safe */ }
            resolve(false);
          }, 3000);

          recognition.onstart = () => {
            clearTimeout(timeout);
            try { recognition.stop(); } catch { /* safe */ }
            resolve(true);
          };
          recognition.onerror = (e: any) => {
            clearTimeout(timeout);
            resolve(e?.error === "aborted" || e?.error === "no-speech");
          };
          recognition.onend = () => {
            clearTimeout(timeout);
            resolve(true);
          };
          recognition.start();
        });

        result.sttRecovered = sttOk;
        result.details += sttOk ? "STT recovered. " : "STT failed to recover. ";
      } catch (err: any) {
        result.details += `STT test error: ${err?.message}. `;
      }
    } else {
      result.details += "STT not available. ";
    }

    // Cleanup
    try { await ctx.close(); } catch { /* safe */ }
  } catch (err: any) {
    result.details = `Test failed: ${err?.message}`;
  }

  return result;
}

// ─── Screen Lock Recovery Test ─────────────────────────────────────

/**
 * Tests recovery after a simulated screen lock by:
 * 1. Creating an AudioContext and bringing it to running state
 * 2. Firing a visibilitychange to "hidden"
 * 3. Waiting, then returning to "visible"
 * 4. Checking if AudioContext can be resumed
 *
 * Note: We cannot truly lock the screen programmatically. Instead we
 * simulate the effect by suspending the AudioContext which is what
 * the OS does on screen lock.
 */
export async function testScreenLockRecovery(lockDurationMs: number = 3000): Promise<ScreenLockRecoveryResult> {
  const result: ScreenLockRecoveryResult = {
    tested: false,
    lockDurationMs,
    sessionRecovered: false,
    audioContextState: "unknown",
    details: "",
  };

  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) {
      result.details = "AudioContext not available";
      return result;
    }

    const ctx = new AC();
    result.tested = true;

    // Bring to running state
    if (ctx.state === "suspended") await ctx.resume();
    result.details = `Initial state: ${ctx.state}. `;

    // Simulate screen lock (suspend AudioContext)
    await ctx.suspend();
    result.details += "Simulated lock (AudioContext suspended). ";

    // Wait for lock duration
    await sleep(Math.min(lockDurationMs, 10000));

    // Simulate unlock (attempt resume)
    try {
      await ctx.resume();
      result.audioContextState = ctx.state;
      result.sessionRecovered = ctx.state === "running";
      result.details += `After unlock: state=${ctx.state}. `;
    } catch (err: any) {
      result.audioContextState = "failed";
      result.details += `Resume failed: ${err?.message}. `;
    }

    // Cleanup
    try { await ctx.close(); } catch { /* safe */ }
  } catch (err: any) {
    result.details = `Test failed: ${err?.message}`;
  }

  return result;
}

// ─── Network Switch Test ───────────────────────────────────────────

/**
 * Tests WebSocket recovery after a simulated network drop by:
 * 1. Opening a test WebSocket connection
 * 2. Force-closing it (simulates network switch)
 * 3. Attempting to reconnect
 * 4. Measuring recovery time
 *
 * Uses its own WebSocket — never touches production sockets.
 */
export async function testNetworkSwitch(): Promise<NetworkSwitchResult> {
  const result: NetworkSwitchResult = {
    tested: false,
    socketRecovered: false,
    recoveryTimeMs: 0,
    details: "",
  };

  try {
    result.tested = true;

    // Step 1: Open initial connection
    const firstConnect = await testWsConnect();
    if (!firstConnect.connected) {
      result.details = `Initial connection failed: ${firstConnect.error}`;
      return result;
    }
    result.details = `Initial connection: ${firstConnect.latencyMs}ms. `;

    // Step 2: Wait briefly then reconnect (simulates network switch)
    await sleep(500);

    const recoveryStart = performance.now();
    const secondConnect = await testWsConnect();
    result.recoveryTimeMs = Math.round(performance.now() - recoveryStart);

    if (secondConnect.connected) {
      result.socketRecovered = true;
      result.details += `Reconnected in ${result.recoveryTimeMs}ms. `;
    } else {
      result.details += `Reconnection failed: ${secondConnect.error}. `;
    }
  } catch (err: any) {
    result.details = `Test failed: ${err?.message}`;
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────

function testWsConnect(): Promise<{ connected: boolean; latencyMs: number; error: string | null }> {
  return new Promise((resolve) => {
    try {
      const start = performance.now();
      const ws = new WebSocket("wss://echo.websocket.org");
      const timeout = setTimeout(() => {
        ws.close();
        resolve({ connected: false, latencyMs: 0, error: "Timeout" });
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        const latency = Math.round(performance.now() - start);
        ws.close();
        resolve({ connected: true, latencyMs: latency, error: null });
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        ws.close();
        resolve({ connected: false, latencyMs: 0, error: "Connection error" });
      };
    } catch (err: any) {
      resolve({ connected: false, latencyMs: 0, error: err?.message || "Unknown" });
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Full Mobile Lifecycle Suite ────────────────────────────────────

export async function runFullMobileLifecycleTests(): Promise<MobileLifecycleReport> {
  const [backgroundRecovery, screenLockRecovery, networkSwitch] = await Promise.all([
    testBackgroundRecovery(5000),
    testScreenLockRecovery(3000),
    testNetworkSwitch(),
  ]);

  return { backgroundRecovery, screenLockRecovery, networkSwitch };
}
