// This device's copy of the app state, in IndexedDB: the app opens and keeps working
// without a connection, and changes made offline are written when it comes back.
import type { AppData } from "./model.js";

export interface LocalState {
  /** What the screen shows, including changes not yet written. */
  data: AppData;
  /** What the database holds as far as this device knows; null before the first load. */
  stored: AppData | null;
}

const DB = "critical";
const STORE = "state";

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => {
      // Another tab (or signing out) wants to upgrade or delete the database: let it.
      req.result.onversionchange = () => {
        req.result.close();
        opening = null;
      };
      resolve(req.result);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const key = (uid: string) => `state.v2.${uid}`;
const legacyKey = (uid: string) => `critical.cache.v1.${uid}`;

export async function readLocal(uid: string): Promise<LocalState | null> {
  try {
    const found = await run<LocalState | undefined>("readonly", (s) => s.get(key(uid)));
    if (found) return found;
  } catch {
    // No IndexedDB (private mode, old browser): fall through to the legacy copy.
  }
  try {
    // Earlier versions kept the screen state in localStorage, already written.
    const raw = globalThis.localStorage?.getItem(legacyKey(uid));
    if (!raw) return null;
    const data = JSON.parse(raw) as AppData;
    return { data, stored: data };
  } catch {
    return null;
  }
}

export async function writeLocal(uid: string, state: LocalState): Promise<void> {
  try {
    await run("readwrite", (s) => s.put(state, key(uid)));
    globalThis.localStorage?.removeItem(legacyKey(uid));
  } catch {
    // Storage full or blocked: the next open just waits for the network.
  }
}

/** Forgets everything stored on this device (signing out, tests). */
export async function clearLocal(): Promise<void> {
  const open = opening;
  opening = null;
  try {
    (await open)?.close();
  } catch {
    // Never opened.
  }
  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Failures that mean "no connection right now", not a bug. */
export function isOffline(e: unknown): boolean {
  if (globalThis.navigator?.onLine === false) return true;
  const msg = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
  return /failed to fetch|load failed|networkerror|network request failed/i.test(msg);
}
