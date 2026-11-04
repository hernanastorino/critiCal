// This device's copy of the app state, in IndexedDB: the app opens and keeps working
// without a connection, and changes made offline are written when it comes back.
import type { AppData } from "./model.js";
import { saving } from "./updates.js";

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
        // Settled by the transaction, not the request: a write is on disk only once it commits.
        const tx = d.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error);
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      }),
  );
}

const key = (uid: string) => `state.v2.${uid}`;

const LISTS = [
  "activities",
  "tasks",
  "events",
  "checkIns",
  "overrides",
  "plan",
  "proposals",
] as const;

/** Something an older or broken version wrote is treated as no copy at all. */
function isData(d: unknown): d is AppData {
  const x = d as Record<string, unknown> | null;
  return !!x && typeof x === "object" && !!x.settings && LISTS.every((k) => Array.isArray(x[k]));
}

function valid(state: unknown): LocalState | null {
  const s = state as Partial<LocalState> | null;
  if (!s || !isData(s.data)) return null;
  return { data: s.data, stored: isData(s.stored) ? s.stored : null };
}
const legacyKey = (uid: string) => `critical.cache.v1.${uid}`;

export async function readLocal(uid: string): Promise<LocalState | null> {
  try {
    const found = valid(await run<unknown>("readonly", (s) => s.get(key(uid))));
    if (found) return found;
  } catch {
    // No IndexedDB (private mode, old browser): fall through to the legacy copy.
  }
  try {
    // Earlier versions kept the screen state in localStorage, already written.
    const raw = globalThis.localStorage?.getItem(legacyKey(uid));
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    return isData(data) ? { data, stored: data } : null;
  } catch {
    return null;
  }
}

/** Stores this device's copy; false if storage refused it (full or blocked). */
export function writeLocal(uid: string, state: LocalState): Promise<boolean> {
  return saving(
    (async () => {
      try {
        await run("readwrite", (s) => s.put(state, key(uid)));
      } catch {
        // The next open just waits for the network.
        return false;
      }
      try {
        globalThis.localStorage?.removeItem(legacyKey(uid));
      } catch {
        // Stored all the same; the old copy is cleared on a later write.
      }
      return true;
    })(),
  );
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
  try {
    // The localStorage copy of earlier versions, in case IndexedDB never took over.
    const ls = globalThis.localStorage;
    for (let i = (ls?.length ?? 0) - 1; i >= 0; i--) {
      const k = ls?.key(i);
      if (k?.startsWith("critical.cache.v1.")) ls?.removeItem(k);
    }
  } catch {
    // Storage blocked: nothing was kept there either.
  }
}

/** Failures that mean "no connection right now", not a bug. */
export function isOffline(e: unknown): boolean {
  if (globalThis.navigator?.onLine === false) return true;
  const msg = e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e);
  return /failed to fetch|load failed|networkerror|network request failed/i.test(msg);
}
