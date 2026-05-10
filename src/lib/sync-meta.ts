/**
 * Sync Metadata - Non-sensitive cloud hints
 * This stores only a timestamp and a flag — never a key or URL.
 * Its only job is to tell the UI whether a cloud copy exists so
 * the user can make an informed decision about entering Supabase creds.
 */

export interface SyncMeta {
  updatedAt: number;
  hasCloudCopy: boolean;
}

const META_KEY = (userId: string) => `aura_sync_meta_${userId}`;

export function saveSyncMeta(userId: string, meta: SyncMeta): void {
  localStorage.setItem(META_KEY(userId), JSON.stringify(meta));
}

export function loadSyncMeta(userId: string): SyncMeta | null {
  const raw = localStorage.getItem(META_KEY(userId));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function hasLocalSeedOnly(userId: string): boolean {
  const seed = localStorage.getItem(`aura_seed_${userId}`);
  const meta = loadSyncMeta(userId);
  return !!seed && !meta?.hasCloudCopy;
}

export function dismissMemoryWarning(userId: string): void {
  localStorage.setItem(`aura_memory_warning_dismissed_${userId}`, "1");
}

export function isMemoryWarningDismissed(userId: string): boolean {
  return localStorage.getItem(`aura_memory_warning_dismissed_${userId}`) === "1";
}
