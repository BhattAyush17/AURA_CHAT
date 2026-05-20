import { EmotionalState } from "./gemini-prompt";

const DB = "aura_cache";
const STORE = "layers";

async function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveLayer2(state: EmotionalState, layer: string) {
  try {
    const tx = (await db()).transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ layer, state, ts: Date.now() }, "layer2");
  } catch {}
}

export async function loadLayer2(): Promise<{ layer: string; state: EmotionalState } | null> {
  try {
    return await new Promise((res) => {
      db().then((d) => {
        const r = d.transaction(STORE).objectStore(STORE).get("layer2");
        r.onsuccess = () => res(r.result ?? null);
        r.onerror = () => res(null);
      });
    });
  } catch {
    return null;
  }
}
