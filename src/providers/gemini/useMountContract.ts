import { useCallback, useEffect, useRef } from "react";

export function useMountContract() {
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const isMounted = useCallback(() => mounted.current, []);

  /**
   * Wraps any callback so it self-terminates after unmount.
   * Prevents state updates on unmounted components and avoids
   * accessing stale or nullified references.
   */
  const guardCallback = useCallback(<T extends (...args: any[]) => any>(fn: T): T => {
    return ((...args: Parameters<T>) => {
      if (!mounted.current) return;
      return fn(...args);
    }) as T;
  }, []);

  return { isMounted, guardCallback };
}
