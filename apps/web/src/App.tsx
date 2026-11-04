import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState } from "react";
import { Connected } from "./Connected.js";
import { Inbox } from "./components/Inbox.js";
import { InboxIcon, SiloIcon, WeekIcon } from "./components/icons.js";
import { Settings } from "./components/Settings.js";
import { Silos } from "./components/Silos.js";
import { Week } from "./components/Week.js";
import type { AppData } from "./model.js";
import { clearLocal } from "./offline.js";
import { disablePush } from "./push.js";
import { signInWithGoogle, supabase } from "./remote.js";
import { loadDemo, resetDemo, StoreProvider, useStore } from "./store.js";

type Tab = "week" | "silos" | "inbox";

const TABS: readonly Tab[] = ["week", "silos", "inbox"];

/** `?tab=inbox` (from a notification) opens that tab. */
function tabFrom(search: string): Tab | null {
  const t = new URLSearchParams(search).get("tab");
  return TABS.includes(t as Tab) ? (t as Tab) : null;
}

export function Shell({ onReset, onSignOut }: { onReset?: () => void; onSignOut?: () => void }) {
  const { inboxCount } = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFrom(globalThis.location?.search ?? "") ?? "week");
  useEffect(() => {
    // A notification tapped while the app is open: the service worker says where to go.
    const onMessage = (e: MessageEvent) => {
      const url = (e.data as { type?: string; url?: string })?.type === "open" ? e.data.url : null;
      const next = url ? tabFrom(new URL(url, "https://x").search) : null;
      if (next) setTab(next);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  const [settings, setSettings] = useState(false);
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "week", label: "Semana", icon: <WeekIcon /> },
    { id: "silos", label: "Silos", icon: <SiloIcon /> },
    { id: "inbox", label: "Bandeja", icon: <InboxIcon /> },
  ];
  return (
    <div className="app">
      {tab === "week" && <Week onSettings={() => setSettings(true)} />}
      {tab === "silos" && <Silos />}
      {tab === "inbox" && <Inbox />}
      <nav className="tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.icon}
            {t.label}
            {t.id === "inbox" && inboxCount > 0 && <span className="badge">{inboxCount}</span>}
          </button>
        ))}
      </nav>
      {settings && (
        <Settings onClose={() => setSettings(false)} onReset={onReset} onSignOut={onSignOut} />
      )}
    </div>
  );
}

function Login({ onDemo, onGoogle }: { onDemo: () => void; onGoogle?: () => void }) {
  return (
    <main className="login">
      <img src="/icon-192.png" alt="" />
      <h1>critiCal</h1>
      <p>Tu calendario que se reacomoda solo y te muestra qué no podés saltearte.</p>
      {onGoogle && (
        <button type="button" className="btn primary" onClick={onGoogle}>
          Entrar con Google
        </button>
      )}
      <button type="button" className={`btn${onGoogle ? "" : " primary"}`} onClick={onDemo}>
        Probar con datos de ejemplo
      </button>
    </main>
  );
}

/** Signed-in mode when Supabase is configured and there is a session. */
function useSession(client: SupabaseClient | null): Session | null | undefined {
  const [session, setSession] = useState<Session | null | undefined>(client ? undefined : null);
  useEffect(() => {
    if (!client) return;
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = client.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [client]);
  return session;
}

export function App({
  fixedNow,
  initial,
}: {
  fixedNow?: number;
  initial?: (now: number) => AppData;
} = {}) {
  const [mode, setMode] = useState<"login" | "demo">(() => {
    try {
      return globalThis.localStorage?.getItem("critical.mode") === "demo" ? "demo" : "login";
    } catch {
      return "login";
    }
  });
  const [key, setKey] = useState(0);
  const client = initial ? null : supabase;
  const session = useSession(client);
  const remember = (m: "login" | "demo") => {
    try {
      globalThis.localStorage?.setItem("critical.mode", m);
    } catch {
      // ignore
    }
    setMode(m);
  };

  if (client && session === undefined) return <main className="login" />;
  if (client && session) {
    return (
      <Connected client={client} session={session}>
        <Shell
          onSignOut={() => {
            // Nothing of this account stays on the device.
            // Unsubscribe first, while the session can still delete the device's row.
            // Bounded: a stalled request must not keep the account signed in.
            const unsubscribe = disablePush(client).catch(() => undefined);
            const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
            void Promise.race([unsubscribe, timeout])
              .then(() => clearLocal())
              .then(() => client.auth.signOut());
          }}
        />
      </Connected>
    );
  }
  if (mode === "login") {
    return (
      <Login
        onDemo={() => remember("demo")}
        onGoogle={client ? () => void signInWithGoogle(client) : undefined}
      />
    );
  }
  return (
    <StoreProvider key={key} initial={initial ?? loadDemo} fixedNow={fixedNow}>
      <Shell
        onReset={() => {
          resetDemo();
          setKey(key + 1);
        }}
        onSignOut={() => remember("login")}
      />
    </StoreProvider>
  );
}
