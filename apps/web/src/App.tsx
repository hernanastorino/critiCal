import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { type ReactNode, useEffect, useState } from "react";
import { Connected } from "./Connected";
import { Inbox } from "./components/Inbox";
import { InboxIcon, SiloIcon, WeekIcon } from "./components/icons";
import { Settings } from "./components/Settings";
import { Silos } from "./components/Silos";
import { Week } from "./components/Week";
import type { AppData } from "./model";
import { signInWithGoogle, supabase } from "./remote";
import { loadDemo, resetDemo, StoreProvider, useStore } from "./store";

type Tab = "week" | "silos" | "inbox";

export function Shell({ onReset, onSignOut }: { onReset?: () => void; onSignOut?: () => void }) {
  const { inboxCount } = useStore();
  const [tab, setTab] = useState<Tab>("week");
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
        <Shell onSignOut={() => void client.auth.signOut()} />
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
