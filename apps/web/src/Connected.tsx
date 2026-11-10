import type { Session, SupabaseClient } from "@supabase/supabase-js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Loading } from "./components/Loading.js";
import { WeekSkeleton } from "./components/Skeleton.js";
import { FAKE_GOOGLE_REFRESH, fakeProviders } from "./devAuth.js";
import { SPOT_TEXT_MAX } from "./limits.js";
import type { AppData } from "./model.js";
import { errorMessage, isNetworkFailure, reportError } from "./monitoring.js";
import { clearLocal, isOffline, type LocalState, readLocal, writeLocal } from "./offline.js";
import { home } from "./places.js";
import {
  applyWrites,
  connectFakeGoogle,
  diffData,
  isMissingParent,
  loadData,
  SPOTS_PER_CALL,
  type SyncResult,
  signInWithGoogle,
  syncGoogle,
  syncICloud,
  timeSpots,
  type Writes,
  withoutDeleted,
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
  /** `quiet`: a failure that is not the network's is reported but does not take over the screen. */
  flush: (quiet?: boolean) => Promise<boolean>;
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
  // Puts a copy on screen (set by SyncProvider, which sits inside the store).
  const replace = useRef<((d: AppData) => void) | null>(null);

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
        if (!cancelled) setError(errorMessage(e));
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
  const flush = useCallback((quiet = false): Promise<boolean> => {
    if (flushing.current) return flushing.current;
    const run = async () => {
      // Never finish synchronously: `flushing` must be set before it is cleared.
      await Promise.resolve();
      let wrote = false;
      let rebased = false;
      try {
        for (;;) {
          const target = latest.current;
          if (!target) break;
          // Nothing to compare with yet: the database may lack these changes, so this
          // is not a save (and must not release the unsaved hold).
          if (stored.current === null) return false;
          const writes = diffData(stored.current, target);
          if (nothing(writes)) break;
          try {
            await applyWrites(client, writes);
          } catch (e) {
            // Another device deleted a task or subject this copy still writes to: drop
            // them here too and retry once. The baseline stays, so only this device's
            // own pending changes are written; the server's copy just says what is gone,
            // and the next reload brings everything else.
            if (rebased || !isMissingParent(e)) throw e;
            rebased = true;
            const server = owned(await loadData(client));
            const pruned = withoutDeleted(stored.current, server, latest.current ?? target);
            if (pruned === (latest.current ?? target)) throw e;
            latest.current = pruned;
            replace.current?.(pruned);
            continue;
          }
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
          if (!quiet) setError(errorMessage(e));
        }
        return false;
      } finally {
        flushing.current = null;
      }
    };
    // A reload for a new version waits until this lands.
    flushing.current = saving(run());
    return flushing.current;
  }, [client, session, uid, owned]);

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
    const offline = isNetworkFailure(error);
    return (
      <main className="login">
        <h1>{offline ? "Sin conexión" : "Algo falló"}</h1>
        <p>
          {offline
            ? "No pude traer tu calendario. Revisá el internet y reintentá."
            : `No pude cargar tu calendario (${error}). Reintentá; si sigue igual, descartá lo de este dispositivo.`}
        </p>
        <button type="button" className="btn primary" onClick={() => window.location.reload()}>
          Reintentar
        </button>
        <button
          type="button"
          className="btn"
          onClick={async () => {
            // Unsaved changes on this device are lost; the server's copy loads fresh.
            await clearLocal();
            window.location.reload();
          }}
        >
          Descartar lo de este dispositivo y recargar
        </button>
      </main>
    );
  }
  if (local === undefined) return <main className="login" />;
  if (!data) {
    return (
      <main className="login">
        <img src="/icon-192.png" alt="" />
        <Loading kind="sync" />
        <WeekSkeleton />
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
        replace={replace}
        latest={latest}
        changes={changes}
        owned={owned}
      >
        <AutoLocate client={client} flush={flush} />
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
  replace,
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
  replace: React.MutableRefObject<((d: AppData) => void) | null>;
  latest: React.MutableRefObject<AppData | null>;
  changes: React.MutableRefObject<number>;
  owned: (d: AppData) => AppData;
  children: React.ReactNode;
}) {
  const { dispatch } = useStore();
  replace.current = (d) => dispatch({ type: "replace", data: d });

  /** Everything from the server replaces this device's copy (the server re-plans too). */
  const queue = useRef<Promise<void>>(Promise.resolve());
  const reloadOnce = useCallback(async () => {
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
  /**
   * One reload at a time (mount, interval, foreground can overlap): an older merge's
   * writes must never land after a newer one set the baseline. Each call waits for
   * the one before and then runs, so it sees what its caller just changed; a failed
   * one does not stop the next.
   */
  const reload = useCallback((): Promise<void> => {
    const run = queue.current.catch(() => undefined).then(reloadOnce);
    queue.current = run;
    return run;
  }, [reloadOnce]);

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
      // In development with invented providers, "Reconectar" stays in the app.
      reconnectGoogle: fakeProviders
        ? () => void connectFakeGoogle(client, FAKE_GOOGLE_REFRESH).then(() => syncNow())
        : () => void signInWithGoogle(client),
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

/** Answers that mean the server cannot time any address: the inbox asks instead. */
const FINAL = new Set(["server_not_configured", "no_home", "home_not_located", "bad_request"]);
/** After a passing failure (offline, geocoder busy), wait this long before trying again. */
const LOOKUP_COOLDOWN_MS = 60_000;
/** Passing failures before an address is given up and asked about instead. */
const LOOKUP_TRIES = 3;

/**
 * Times upcoming events' addresses from home in the background, a few at a time, so
 * the inbox only asks about the ones that cannot be found. Nothing becomes a place.
 * An address with no answer yet is looked up again (after forgetting it, or with a new
 * home); answers for a home that changed meanwhile are dropped.
 */
function AutoLocate({ client, flush }: { client: SupabaseClient; flush: () => Promise<boolean> }) {
  const { data, unlocated, dispatch } = useStore();
  const at = home(data);
  const homeKey = at ? `${at.id}|${at.address ?? ""}|${at.lat ?? ""},${at.lon ?? ""}` : "";
  const currentHome = useRef(homeKey);
  // Set on commit, so a lookup never compares with a render React threw away.
  useLayoutEffect(() => {
    currentHome.current = homeKey;
  }, [homeKey]);
  const inFlight = useRef(new Set<string>());
  const coolUntil = useRef(new Map<string, number>());
  const failures = useRef(new Map<string, number>());
  // A new home starts every address afresh.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `homeKey` is the trigger.
  useLayoutEffect(() => {
    failures.current.clear();
    coolUntil.current.clear();
  }, [homeKey]);
  const running = useRef(false);
  // Bumped when a lookup ends, so the next batch starts even if nothing else changed.
  const [round, setRound] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` only re-runs the effect.
  useEffect(() => {
    if (running.current) return;
    const now = Date.now();
    const batch = unlocated
      .filter(
        (u) =>
          u.lookup && !inFlight.current.has(u.key) && (coolUntil.current.get(u.key) ?? 0) <= now,
      )
      .slice(0, SPOTS_PER_CALL);
    if (batch.length === 0) return;
    // The server refuses a whole call over one very long address: those are answered
    // here as not found, and the rest still go.
    const refused = batch.filter((u) => u.text.length > SPOT_TEXT_MAX);
    if (refused.length)
      return dispatch({
        type: "spots",
        results: refused.map((u) => ({ text: u.text, minutes: null })),
      });
    const asked = homeKey;
    for (const u of batch) inFlight.current.add(u.key);
    const texts = batch.map((u) => u.text);
    running.current = true;
    /** Waits a while before the next try; only failed lookups count towards giving up. */
    const cool = (lookupFailed: boolean) => {
      // After a few failed lookups the inbox asks instead of "calculating" for ever.
      const exhausted = batch.filter((u) => {
        if (!lookupFailed) return false;
        const n = (failures.current.get(u.key) ?? 0) + 1;
        failures.current.set(u.key, n);
        return n >= LOOKUP_TRIES;
      });
      if (exhausted.length) {
        // That episode is over: if the address is forgotten later, it gets fresh tries.
        for (const u of exhausted) failures.current.delete(u.key);
        dispatch({
          type: "spots",
          results: exhausted.map((u) => ({ text: u.text, minutes: null })),
        });
      }
      for (const u of batch) coolUntil.current.set(u.key, Date.now() + LOOKUP_COOLDOWN_MS);
      setTimeout(() => setRound((r) => r + 1), LOOKUP_COOLDOWN_MS);
    };
    void (async () => {
      try {
        // The server reads the home from the database: a home just saved must be there.
        // A save that did not go through is not the address's fault.
        if (!(await flush())) return cool(false);
        const r = await timeSpots(client, texts);
        // Timed from a home that is no longer this one: ask again for the current one.
        if (currentHome.current !== asked) return;
        if (r.ok && r.spots) {
          for (const u of batch) failures.current.delete(u.key);
          dispatch({ type: "spots", results: r.spots });
        } else if (r.error && FINAL.has(r.error))
          dispatch({ type: "spots", results: texts.map((text) => ({ text, minutes: null })) });
        else cool(true);
      } finally {
        for (const u of batch) inFlight.current.delete(u.key);
        running.current = false;
        setRound((n) => n + 1);
      }
    })();
  }, [unlocated, client, dispatch, flush, homeKey, round]);
  return null;
}
