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
import { reportError } from "./monitoring.js";
import { isOffline, type LocalState, readLocal, writeLocal } from "./offline.js";
import {
  applyWrites,
  diffData,
  loadData,
  type SyncResult,
  signInWithGoogle,
  syncGoogle,
  syncICloud,
  type Writes,
} from "./remote.js";
import { StoreProvider, useStore } from "./store.js";
import { hold, saving } from "./updates.js";

const SYNC_EVERY_MS = 5 * 60_000;
/** While offline, try writing again this often (and whenever the browser says it is online). */
const RETRY_MS = 30_000;

export interface SyncStatus {
  google?: SyncResult & { at: number };
  icloud?: SyncResult & { at: number };
  busy: boolean;
  /** Changes made on this device that are not in the database yet. */
  pending?: boolean;
  offline?: boolean;
}

interface SyncApi {
  client: SupabaseClient;
  status: SyncStatus;
  syncNow: () => Promise<void>;
  /** Writes pending changes now; false if they could not be written (offline). */
  flush: () => Promise<boolean>;
  reconnectGoogle: () => void;
  connectICloud: (appleId: string, appPassword: string) => Promise<SyncResult>;
  disconnectICloud: () => Promise<void>;
}

const SyncContext = createContext<SyncApi | null>(null);

/** Sync controls for the signed-in app; null in demo mode. */
export const useSync = () => useContext(SyncContext);

const nothing = (w: Writes) => !w.upserts.length && !w.inserts.length && !w.deletes.length;

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
  const uid = session.user?.id ?? "me";
  // The owner seeds the ids of imported tasks; the session always knows it, even for
  // an old local copy or before the user has a settings row.
  const owned = useCallback(
    (d: AppData): AppData => (session.user?.id && !d.owner ? { ...d, owner: session.user.id } : d),
    [session],
  );
  // Read through a ref: a new session object must not re-read the local copy.
  const ownedRef = useRef(owned);
  ownedRef.current = owned;
  // undefined while this device's copy is read (a few milliseconds).
  const [local, setLocal] = useState<LocalState | null | undefined>(undefined);
  const [data, setData] = useState<AppData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>({ busy: false });
  // What the database holds as far as this device knows. Diffing against it (not the
  // previous screen state) also removes blocks the server re-planned meanwhile, and
  // whatever could not be written offline is simply still in the difference.
  const stored = useRef<AppData | null>(null);
  const latest = useRef<AppData | null>(null);
  // Counts local changes, so a server copy loaded meanwhile is known to be stale.
  const changes = useRef(0);

  const pullCalendars = useCallback(async () => {
    setStatus((s) => ({ ...s, busy: true }));
    const [google, icloud] = await Promise.all([syncGoogle(client, session), syncICloud(client)]);
    const at = Date.now();
    setStatus((s) => ({ ...s, google: { ...google, at }, icloud: { ...icloud, at }, busy: false }));
  }, [client, session]);

  useEffect(() => {
    let cancelled = false;
    readLocal(uid).then((found) => {
      if (cancelled) return;
      if (found) {
        const data = ownedRef.current(found.data);
        stored.current = found.stored;
        latest.current = data;
        setData(data);
        // Usable right away; SyncProvider refreshes it in the background.
        setStatus((s) => ({ ...s, busy: true }));
      }
      setLocal(found);
    });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  useEffect(() => {
    // With a local copy the app is already usable; SyncProvider refreshes it.
    if (local !== null) return;
    let cancelled = false;
    (async () => {
      try {
        // First sync stores the Google refresh token and imports events.
        await pullCalendars();
        const loaded = owned(await loadData(client));
        stored.current = loaded;
        latest.current = loaded;
        void writeLocal(uid, { data: loaded, stored: loaded });
        if (!cancelled) setData(loaded);
      } catch (e) {
        reportError(e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, pullCalendars, local, uid, owned]);

  // One flush at a time, so parents always land before children.
  const flushing = useRef<Promise<boolean> | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Writes what is pending; true once the database has everything this device has. */
  const flush = useCallback((): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const run = async () => {
      // Never finish synchronously: `flushing` must be set before it is cleared.
      await Promise.resolve();
      let wrote = false;
      try {
        for (;;) {
          const target = latest.current;
          if (!target) break;
          // Nothing to compare with yet: the database may lack these changes, so this
          // is not a save (and must not release the unsaved hold).
          if (stored.current === null) return false;
          const writes = diffData(stored.current, target);
          if (nothing(writes)) break;
          await applyWrites(client, writes);
          stored.current = target;
          wrote = true;
          void writeLocal(uid, { data: latest.current ?? target, stored: target });
        }
        setStatus((s) => (s.pending || s.offline ? { ...s, pending: false, offline: false } : s));
        hold("unsaved", false);
        if (wrote) {
          // Mirror the new plan into Google once the burst of edits settles.
          clearTimeout(pushTimer.current);
          pushTimer.current = setTimeout(() => void syncGoogle(client, session), 5000);
        }
        return true;
      } catch (e) {
        if (isOffline(e)) setStatus((s) => ({ ...s, pending: true, offline: true }));
        else {
          reportError(e);
          setError(e instanceof Error ? e.message : String(e));
        }
        return false;
      } finally {
        flushing.current = null;
      }
    };
    // A reload for a new version waits until this lands.
    flushing.current = saving(run());
    return flushing.current;
  }, [client, session, uid]);

  const onChange = useCallback(
    (_prev: AppData, next: AppData) => {
      changes.current++;
      latest.current = next;
      // Held from the start, so no reload for a new version slips in before the saves
      // report; stored nowhere, it stays held until a later save succeeds.
      hold("unsaved", true);
      const local = writeLocal(uid, { data: next, stored: stored.current });
      setStatus((s) => (s.pending ? s : { ...s, pending: true }));
      const remote = flush();
      void Promise.all([local, remote]).then(([l, r]) => {
        if (latest.current === next && (l || r)) hold("unsaved", false);
      });
    },
    [flush, uid],
  );

  useEffect(() => {
    if (!status.offline) return;
    const retry = () => void flush();
    const id = setInterval(retry, RETRY_MS);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", retry);
    };
  }, [status.offline, flush]);

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
  if (local === undefined) return <main className="login" />;
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
        refreshOnMount={local !== null}
        flush={flush}
        stored={stored}
        latest={latest}
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
  flush,
  stored,
  latest,
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
  flush: () => Promise<boolean>;
  stored: React.MutableRefObject<AppData | null>;
  latest: React.MutableRefObject<AppData | null>;
  changes: React.MutableRefObject<number>;
  owned: (d: AppData) => AppData;
  children: React.ReactNode;
}) {
  const { dispatch } = useStore();

  /** Everything from the server replaces this device's copy (the server re-plans too). */
  const reload = useCallback(async () => {
    // Read before waiting: an edit made while queued writes finish must count too.
    const before = changes.current;
    await flush();
    if (!latest.current) return;
    // A device copy without its baseline (a damaged cache): what it lacks may have been
    // added elsewhere, so nothing is deleted. Its own records are written over the
    // database, and the merged result becomes both the copy and its baseline.
    if (stored.current === null) {
      try {
        const server = owned(await loadData(client));
        await applyWrites(client, { ...diffData(server, latest.current), deletes: [] });
        const merged = owned(await loadData(client));
        // An edit made meanwhile is not in `merged`: try again on the next sync.
        if (changes.current !== before) return;
        stored.current = merged;
        latest.current = merged;
        dispatch({ type: "replace", data: merged });
        setStatus((s) => (s.pending || s.offline ? { ...s, pending: false, offline: false } : s));
        hold("unsaved", false);
      } catch (e) {
        // Offline: the retry below tries the merge again; anything else is reported.
        if (isOffline(e)) setStatus((s) => ({ ...s, pending: true, offline: true }));
        else reportError(e);
      }
      return;
    }
    // Changes still waiting (offline) must not be overwritten by the server's copy.
    if (!nothing(diffData(stored.current, latest.current))) return;
    const fresh = owned(await loadData(client));
    // An edit made while loading is not in `fresh`: keep it; the next sync reloads.
    if (changes.current !== before) return;
    stored.current = fresh;
    dispatch({ type: "replace", data: fresh });
  }, [client, dispatch, flush, stored, latest, changes, owned, setStatus]);

  // A merge without baseline that failed offline is retried here: `flush` cannot do
  // it (it never writes without a baseline).
  useEffect(() => {
    if (!status.offline || stored.current !== null) return;
    const retry = () => void reload().catch(reportError);
    const id = setInterval(retry, RETRY_MS);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(id);
      window.removeEventListener("online", retry);
    };
  }, [status.offline, reload, stored]);

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
      client,
      status,
      syncNow,
      flush,
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
    [status, syncNow, flush, client, setStatus, reload],
  );

  return <SyncContext.Provider value={api}>{children}</SyncContext.Provider>;
}
