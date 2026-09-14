/**
 * Node preload: polyfill browser globals and Vite's import.meta.env
 * before any application module loads.
 *
 * Usage: npx tsx --import ./scripts/node-preload.ts scripts/certify-cognition.ts
 */

// Vite's import.meta.env
(import.meta as any).env ??= {};

// Browser globals
(globalThis as any).window ??= globalThis;
(globalThis as any).localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  length: 0,
  key: () => null,
};
(globalThis as any).performance ??= { now: () => Date.now() };
(globalThis as any).navigator ??= { userAgent: "node-certify" };
