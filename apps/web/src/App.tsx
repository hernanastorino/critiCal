import { type ReactNode, useState } from "react";
import { Inbox } from "./components/Inbox";
import { InboxIcon, SiloIcon, WeekIcon } from "./components/icons";
import { Settings } from "./components/Settings";
import { Silos } from "./components/Silos";
import { Week } from "./components/Week";
import type { AppData } from "./model";
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

function Login({ onDemo }: { onDemo: () => void }) {
  return (
    <main className="login">
      <img src="/icon-192.png" alt="" />
      <h1>critiCal</h1>
      <p>Tu calendario que se reacomoda solo y te muestra qué no podés saltearte.</p>
      <button type="button" className="btn primary" onClick={onDemo}>
        Probar con datos de ejemplo
      </button>
      <p style={{ fontSize: 13 }}>Conectar Google Calendar llega en la próxima versión.</p>
    </main>
  );
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
  const remember = (m: "login" | "demo") => {
    try {
      globalThis.localStorage?.setItem("critical.mode", m);
    } catch {
      // ignore
    }
    setMode(m);
  };

  if (mode === "login") return <Login onDemo={() => remember("demo")} />;
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
