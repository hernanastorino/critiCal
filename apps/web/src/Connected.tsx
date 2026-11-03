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
import type { AppData } from "./model";
import {
  applyWrites,
  diffData,
  loadData,
  type SyncResult,
  signInWithGoogle,
  syncGoogle,
  syncICloud,
} from "./remote";
import { StoreProvider, useStore } from "./store";

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
  const [cached] = useState(() => readCache(session));
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
        const loaded = await loadData(client);
        if (!cancelled) setData(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, pullCalendars, cached]);

  // Writes run one at a time so parents always land before children.
  const queue = useRef(Promise.resolve());
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChange = useCallback(
    (prev: AppData, next: AppData) => {
      writeCache(session, next);
      const writes = diffData(prev, next);
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
  children,
}: {
  client: SupabaseClient;
  status: SyncStatus;
  pullCalendars: () => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<SyncStatus>>;
  /** Opened from the device cache: pull everything fresh right away. */
  refreshOnMount: boolean;
  writes: React.MutableRefObject<Promise<void>>;
  children: React.ReactNode;
}) {
  const { data, dispatch } = useStore();
  const latest = useRef(data);
  latest.current = data;

  const reload = useCallback(async () => {
    const fresh = await loadData(client);
    dispatch({
      type: "replace",
      data: { ...latest.current, events: fresh.events, calendars: fresh.calendars },
    });
  }, [client, dispatch]);

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
        await writes.current;
        // Everything from the server replaces the cached copy (other devices may have changed it).
        dispatch({ type: "replace", data: await loadData(client) });
      } catch (e) {
        console.warn("refresh", e);
        setStatus((s) => ({ ...s, busy: false }));
      }
    })();
  }, [refreshOnMount, pullCalendars, writes, client, dispatch, setStatus]);

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
