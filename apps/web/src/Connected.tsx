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
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ busy: false });

  const pullCalendars = useCallback(async () => {
    setStatus((s) => ({ ...s, busy: true }));
    const [google, icloud] = await Promise.all([syncGoogle(client, session), syncICloud(client)]);
    const at = Date.now();
    setStatus({ google: { ...google, at }, icloud: { ...icloud, at }, busy: false });
  }, [client, session]);

  useEffect(() => {
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
  }, [client, pullCalendars]);

  // Writes run one at a time so parents always land before children.
  const queue = useRef(Promise.resolve());
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const onChange = useCallback(
    (prev: AppData, next: AppData) => {
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
  children,
}: {
  client: SupabaseClient;
  status: SyncStatus;
  pullCalendars: () => Promise<void>;
  setStatus: React.Dispatch<React.SetStateAction<SyncStatus>>;
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
