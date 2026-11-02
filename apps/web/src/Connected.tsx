import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppData } from "./model";
import { applyWrites, diffData, loadData, syncGoogle } from "./remote";
import { StoreProvider, useStore } from "./store";

const SYNC_EVERY_MS = 5 * 60_000;

/** Signed-in app: loads from Supabase, writes every change back, syncs Google. */
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // First sync stores the Google refresh token and imports events.
        await syncGoogle(client, session).catch((e) => console.warn("google sync", e));
        const loaded = await loadData(client);
        if (!cancelled) setData(loaded);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, session]);

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
        queue.current = queue.current
          .then(() => syncGoogle(client, session).then(() => undefined))
          .catch(() => undefined);
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
      <PeriodicSync client={client} session={session} />
      {children}
    </StoreProvider>
  );
}

/** Pulls calendar changes every few minutes and when the app comes back to the foreground. */
function PeriodicSync({ client, session }: { client: SupabaseClient; session: Session }) {
  const { data, dispatch } = useStore();
  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    const run = async () => {
      try {
        await syncGoogle(client, session);
        const fresh = await loadData(client);
        dispatch({ type: "replace", data: { ...latest.current, events: fresh.events } });
      } catch (e) {
        console.warn("sync", e);
      }
    };
    const id = setInterval(run, SYNC_EVERY_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, session, dispatch]);
  return null;
}
