/**
 * STT Stress Test — Standalone speech recognition stress tester.
 *
 * Runs N consecutive start/stop cycles on a FRESH SpeechRecognition
 * instance (never touches the production instance) and reports
 * success/failure rates.
 *
 * @module
 */

export interface StressTestResult {
  attempts: number;
  success: number;
  failures: number;
  failureReasons: string[];
  durationMs: number;
  avgCycleMs: number;
}

/**
 * Run a speech recognition stress test with the given number of cycles.
 * Uses a completely independent SpeechRecognition instance.
 */
export async function runSttStressTest(cycles: number = 30): Promise<StressTestResult> {
  const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

  if (!SR) {
    return {
      attempts: 0,
      success: 0,
      failures: 1,
      failureReasons: ["SpeechRecognition API not available"],
      durationMs: 0,
      avgCycleMs: 0,
    };
  }

  const result: StressTestResult = {
    attempts: cycles,
    success: 0,
    failures: 0,
    failureReasons: [],
    durationMs: 0,
    avgCycleMs: 0,
  };

  const overallStart = performance.now();

  for (let i = 0; i < cycles; i++) {
    try {
      await runSingleCycle(SR, i);
      result.success++;
    } catch (err: any) {
      result.failures++;
      result.failureReasons.push(`Cycle ${i + 1}: ${err?.message || String(err)}`);
    }
    // Small delay between cycles to avoid hammering the API
    await sleep(50);
  }

  result.durationMs = Math.round(performance.now() - overallStart);
  result.avgCycleMs = result.attempts > 0 ? Math.round(result.durationMs / result.attempts) : 0;

  return result;
}

function runSingleCycle(SR: any, index: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { recognition.abort(); } catch { /* safe */ }
      reject(new Error(`Timeout on cycle ${index + 1}`));
    }, 3000);

    const recognition = new SR();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      // Successfully started — now stop it
      setTimeout(() => {
        try { recognition.stop(); } catch { /* safe */ }
      }, 100);
    };

    recognition.onend = () => {
      clearTimeout(timeout);
      resolve();
    };

    recognition.onerror = (event: any) => {
      clearTimeout(timeout);
      // "aborted" and "no-speech" are expected during rapid start/stop
      if (event?.error === "aborted" || event?.error === "no-speech") {
        resolve();
      } else {
        reject(new Error(event?.error || "Unknown STT error"));
      }
    };

    try {
      recognition.start();
    } catch (err: any) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
