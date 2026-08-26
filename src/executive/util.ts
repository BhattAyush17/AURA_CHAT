/** Shared numeric helpers for the Executive modules. */

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
