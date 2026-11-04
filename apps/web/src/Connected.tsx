import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppData } from "./model.js";
import {
  applyWrites,
  diffData,
  loadData,
  type SyncResult,
  signInWithGoogle,
  syncGoogle,
  syncICloud,
} from "./remote.js";
import { StoreProvider, useStore } from "./store.js";

const SYNC_EVERY_MS = 5 * 60_000;

/** Last known state on this device, so the app opens instantly. */
const cacheKey = (session: Session) => `critical.cache.v1.${session.user?.id ?? "me"}`;

export function readCache(session: Session): AppData | null {
  try {
    const raw = globalThis.localStorage?.getItem(cacheKey(session));
    return raw ? (JSON.parse(raw) as AppData) : null;
  } catch {
    return null;
  }
}

function writeCache(session: Session, data: AppData): void {
  try {
    globalThis.localStorage?.setItem(cacheKey(session), JSON.stringify(data));
  } catch {
    // Storage full or blocked: the next open just waits for the network.
  }
}

export interface SyncStatus {
  google?: SyncResult & { at: number };
  icloud?: SyncResult & { at: number };
  busy: boolean;
}

interface SyncApi {
  status: SyncStatus;
  syncNow: () => Promise<void>;
  reconnectGoogle: () => void;
  connectICloud: (appleId: string, appPassword: string) => Promise<SyncResult>;
  disconnectICloud: () => Promise<void>;
}

const SyncContext = createContext<SyncApi | null>(null);

/** Sync controls for the signed-in app; null in demo mode. */
export const useSync = () => useContext(SyncContext);

/** Signed-in app: loads from Supabase, writes every change back, syncs calendars. */
export function Connected({
  client,
  session,
  children,
}: {
  client: SupabaseClient;
  session: Session;
  children: React.ReactNode;
}) {
  // The owner seeds the ids of imported tasks; the session always knows it, even for
  // an old cached copy or before the user has a settings row.
  const owned = useCallback(
    (d: AppData): AppData => (session.user?.id && !d.owner ? { ...d, owner: session.user.id } : d),
    [session],
  );
  const [cached] = useState(() => {
    const d = readCache(session);
    return d && owned(d);
  });
  const [data, setData] = useState<AppData | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ busy: !!cached });

  const pullCalendars = useCallback(async () => {
    setStatus((s) => ({ ...s, busy: true }));
    const [google, icloud] = await Promise.all([syncGoogle(client, session), syncICloud(client)]);
    const at = Date.now();
    setStatus({ google: { ...google, at }, icloud: { ...icloud, at }, busy: false });
  }, [client, session]);

  useEffect(() => {
    // With a cached state the app is already usable; SyncProvider refreshes it.
    if (cached) return;
    let cancelled = false;
    (async () => {
      try {
        // First sync stores the Google refresh token and imports events.
        await pullCalendars();
        const loaded = owned(await loadData(client));
        stored.current = loaded;
        if (!cancelled) setData(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, pullCalendars, cached, owned]);

  // Writes run one at a time so parents always land before children.
  const queue = useRef(Promise.resolve());
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // What the database holds as far as this device knows. Diffing against it (not the
  // previous screen state) also removes blocks the server re-planned meanwhile.
  const stored = useRef<AppData | null>(cached);
  // Counts local changes, so a server copy loaded meanwhile is known to be stale.
  const changes = useRef(0);
  const onChange = useCallback(
    (prev: AppData, next: AppData) => {
      changes.current++;
      writeCache(session, next);
      const writes = diffData(stored.current ?? prev, next);
      stored.current = next;
      if (!writes.upserts.length && !writes.inserts.length && !writes.deletes.length) return;
      queue.current = queue.current
        .then(() => applyWrites(client, writes))
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
      clearTimeout(pushTimer.current);
      pushTimer.current = setTimeout(() => {
        queue.current = queue.current.then(() => syncGoogle(client, session).then(() => undefined));
      }, 5000);
    },
    [client, session],
  );

  if (error) {
    return (
      <main className="login">
        <h1>Algo falló</h1>
        <p>{error}</p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reintentar
        </button>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="login">
        <img src="/icon-192.png" alt="" />
        <p>Sincronizando tu calendario…</p>
      </main>
    );
  }
  return (
    <StoreProvider initial={() => data} persist={false} onChange={onChange}>
      <SyncProvider
        client={client}
        status={status}
        pullCalendars={pullCalendars}
        setStatus={setStatus}
        refreshOnMount={!!cached}
        writes={queue}
        stored={stored}
        changes={changes}
        owned={owned}
      >
        {children}
      </SyncProvider>
    </StoreProvider>
  );
}

/** Re-pulls calendars every few minutes, when the app returns to the foreground, or on demand. */
function SyncProvider({
  client,
  status,
  pullCalendars,
  setStatus,
  refreshOnMount,
  writes,
  stored,
  changes,
  owned,
  children,
}: {
  client: SupabaseClient;
  status: SyncStatus;
  pullCalendars: () => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<SyncStatus>>;
  /** Opened from the device cache: pull everything fresh right away. */
  refreshOnMount: boolean;
  writes: React.MutableRefObject<Promise<void>>;
  stored: React.MutableRefObject<AppData | null>;
  changes: React.MutableRefObject<number>;
  owned: (d: AppData) => AppData;
  children: React.ReactNode;
}) {
  const { dispatch } = useStore();

  /** Everything from the server replaces this device's copy (the server re-plans too). */
  const reload = useCallback(async () => {
    // Read before waiting: an edit made while queued writes finish must count too.
    const before = changes.current;
    await writes.current;
    const fresh = owned(await loadData(client));
    // An edit made while loading is not in `fresh`: keep it; the next sync reloads.
    if (changes.current !== before) return;
    stored.current = fresh;
    dispatch({ type: "replace", data: fresh });
  }, [client, dispatch, writes, stored, changes, owned]);

  const syncNow = useCallback(async () => {
    try {
      await pullCalendars();
      await reload();
    } catch (e) {
      console.warn("sync", e);
    }
  }, [pullCalendars, reload]);

  const started = useRef(false);
  useEffect(() => {
    if (!refreshOnMount || started.current) return;
    started.current = true;
    (async () => {
      try {
        await pullCalendars();
        // Other devices and the server may have changed it.
        await reload();
      } catch (e) {
        console.warn("refresh", e);
        setStatus((s) => ({ ...s, busy: false }));
      }
    })();
  }, [refreshOnMount, pullCalendars, reload, setStatus]);

  useEffect(() => {
    const id = setInterval(syncNow, SYNC_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncNow]);

  const api = useMemo<SyncApi>(
    () => ({
      status,
      syncNow,
      reconnectGoogle: () => void signInWithGoogle(client),
      connectICloud: async (appleId, appPassword) => {
        setStatus((s) => ({ ...s, busy: true }));
        const r = await syncICloud(client, { action: "connect", appleId, appPassword });
        setStatus((s) => ({ ...s, icloud: { ...r, at: Date.now() }, busy: false }));
        if (r.connected) await reload();
        return r;
      },
      disconnectICloud: async () => {
        const r = await syncICloud(client, { action: "disconnect" });
        setStatus((s) => ({ ...s, icloud: { ...r, at: Date.now() } }));
        await reload();
      },
    }),
    [status, syncNow, client, setStatus, reload],
  );

  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>;
}
