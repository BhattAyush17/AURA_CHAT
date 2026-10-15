// Acoustic activity must invalidate initiative before a final transcript exists.
const listeners = new Set<() => void>();
export function reportAutonomyUserActivity(): void {
  listeners.forEach((listener) => listener());
}
export function subscribeAutonomyUserActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
