import { useRef, useCallback } from "react";

const CLEAN_CLOSE_CODES = new Set([
  1000, // Normal closure
  1001, // Going away (navigating away — don't fight it)
  4000, // Application-level intentional close
]);

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 8;

export function useReconnectPolicy() {
  const attempts = useRef(0);

  const shouldReconnect = useCallback((closeCode: number): boolean => {
    if (CLEAN_CLOSE_CODES.has(closeCode)) {
      attempts.current = 0;
      return false;
    }
    return attempts.current < MAX_ATTEMPTS;
  }, []);

  const nextDelay = useCallback((): number => {
    const exp = Math.min(BASE_DELAY_MS * 2 ** attempts.current, MAX_DELAY_MS);
    const jitter = exp * 0.2 * (Math.random() * 2 - 1); // ±20% jitter
    attempts.current += 1;
    return exp + jitter;
  }, []);

  const reset = useCallback(() => {
    attempts.current = 0;
  }, []);

  return { shouldReconnect, nextDelay, reset };
}
