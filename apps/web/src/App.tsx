import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Connected } from "./Connected.js";
import { Celebrations } from "./components/Celebrations.js";
import { Inbox } from "./components/Inbox.js";
import { InboxIcon, SiloIcon, WeekIcon } from "./components/icons.js";
import { Settings } from "./components/Settings.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { Week } from "./components/Week.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { localDev } from "./devAuth.js";
import { clearDrafts } from "./drafts.js";
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

const wantsWeeklyPlan = (search: string) => new URLSearchParams(search).get("plan") === "week";

export function Shell({ onReset, onSignOut }: { onReset?: () => void; onSignOut?: () => void }) {
  const { inboxCount } = useStore();
  const [tab, setTab] = useState<Tab>(() => tabFrom(globalThis.location?.search ?? "") ?? "week");
  const [weekly, setWeekly] = useState(() => wantsWeeklyPlan(globalThis.location?.search ?? ""));
  useEffect(() => {
    // A notification tapped while the app is open: the service worker says where to go.
    const onMessage = (e: MessageEvent) => {
      const url = (e.data as { type?: string; url?: string })?.type === "open" ? e.data.url : null;
      if (!url) return;
      const search = new URL(url, "https://x").search;
      const next = tabFrom(search);
      if (next) setTab(next);
      if (wantsWeeklyPlan(search)) setWeekly(true);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);
  /** Ajustes open, on its list (`true`) or on one screen. */
  const [settings, setSettings] = useState<boolean | "week">(false);
  /** A day to open the week on, picked from the inbox. */
  const [day, setDay] = useState<string>();
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "week", label: "Semana", icon: <WeekIcon /> },
    { id: "silos", label: "Silos", icon: <SiloIcon /> },
    { id: "inbox", label: "Bandeja", icon: <InboxIcon /> },
  ];
  return (
    // The one notice area of the app, above the tab bar.
    <ToastProvider>
      <Celebrations />
      <div className="app">
        {tab === "week" && <Week day={day} onSettings={(page) => setSettings(page ?? true)} />}
        {tab === "silos" && <Silos />}
        {tab === "inbox" && (
          <Inbox
            onDay={(date) => {
              setDay(date);
              setTab("week");
            }}
          />
        )}
        <nav className="tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => {
                setTab(t.id);
                setDay(undefined);
              }}
            >
              {t.icon}
              {t.label}
              {t.id === "inbox" && inboxCount > 0 && (
                <span className="badge">
                  <span className="sr-only">, </span>
                  {inboxCount}
                </span>
              )}
            </button>
          ))}
        </nav>
        {settings && (
          <Settings
            initialPage={settings === true ? undefined : settings}
            onClose={() => setSettings(false)}
            onReset={onReset}
            onSignOut={onSignOut}
            onWeeklyPlan={() => {
              setSettings(false);
              setWeekly(true);
            }}
          />
        )}
        {weekly && (
          <WeeklyPlan
            onClose={() => setWeekly(false)}
            onInbox={() => {
              setWeekly(false);
              setTab("inbox");
            }}
          />
        )}
      </div>
    </ToastProvider>
  );
}

/**
 * Development only: signs in with the local test account (supabase/seed.sql). Shown
 * when the app runs with `npm run dev` against the local Supabase, never in a build.
 */
export function DevLogin({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="dev-login"
      aria-label="Cuenta de prueba local"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        void client.auth
          .signInWithPassword({ email: email.trim(), password })
          .then(({ error: e }) => {
            if (e) setError("Email o contraseña incorrectos. Están en supabase/seed.sql.");
          })
          .catch(() => setError("No se pudo llegar al Supabase local. ¿Corre `supabase start`?"))
          .finally(() => setBusy(false));
      }}
    >
      <p className="meta">Solo en desarrollo: cuenta de prueba local</p>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error && (
        <p className="meta" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? "Entrando…" : "Entrar con la cuenta de prueba"}
      </button>
    </form>
  );
}

function Login({
  onDemo,
  onGoogle,
  dev,
}: {
  onDemo: () => void;
  onGoogle?: () => void;
  dev?: ReactNode;
}) {
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
      {dev}
      <a className="meta" href="/privacy.html" target="_blank" rel="noreferrer">
        Política de privacidad
      </a>
    </main>
  );
}

/**
 * Invitation only: an account not on the owner's list sees why, instead of an empty
 * app. Invited accounts never wait for the answer; when it cannot be had (offline),
 * the app opens as usual and the database still keeps others' data out.
 */
export function InviteGate({
  client,
  session,
  onSignOut,
  children,
}: {
  client: SupabaseClient;
  session: Session;
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const [blocked, setBlocked] = useState(false);
  const uid = session.user?.id;
  // Only the latest question's answer counts: an older one arriving late is ignored.
  const latest = useRef(0);
  /** Asks whether this account is invited; returns a cancel for effects. */
  const check = useCallback(() => {
    let cancelled = false;
    const asked = ++latest.current;
    void Promise.resolve()
      .then(() => client.rpc("my_access"))
      .then(({ data, error }) => {
        const invited = (data as { invited?: boolean } | null)?.invited;
        if (cancelled || asked !== latest.current) return;
        if (!error && typeof invited === "boolean") setBlocked(!invited);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  // Asked for each account signed in, and again on coming back to the app: an
  // invitation given or taken away meanwhile shows up.
  useEffect(() => (uid ? check() : undefined), [check, uid]);
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [check]);
  if (!blocked) return <>{children}</>;
  return (
    <main className="login">
      <img src="/icon-192.png" alt="" />
      <h1>critiCal</h1>
      <p>Esta app es por invitación.</p>
      <p className="meta">
        {session.user?.email ? `${session.user.email} no está invitado. ` : ""}Pedile a quien te
        pasó la app que te agregue.
      </p>
      <button type="button" className="btn primary" onClick={() => void check()}>
        Volver a probar
      </button>
      <button type="button" className="btn" onClick={onSignOut}>
        Salir
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
  // Whatever way a session ends, the next account does not see what the last one typed.
  const uid = session?.user?.id;
  const lastUid = useRef(uid);
  useEffect(() => {
    if (lastUid.current !== uid) clearDrafts();
    lastUid.current = uid;
  }, [uid]);
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
    const signOut = () => {
      // Nothing of this account stays on the device.
      // Unsubscribe first, while the session can still delete the device's row.
      // Bounded: a stalled request must not keep the account signed in.
      const unsubscribe = disablePush(client).catch(() => undefined);
      const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
      void Promise.race([unsubscribe, timeout])
        .then(() => clearLocal())
        .then(clearDrafts)
        .then(() => client.auth.signOut());
    };
    return (
      // Another account signing in starts from scratch: nothing of the previous one
      // (its data, its invitation list) stays on screen.
      <InviteGate
        key={session.user?.id ?? "me"}
        client={client}
        session={session}
        onSignOut={signOut}
      >
        <Connected client={client} session={session}>
          <Shell onSignOut={signOut} />
        </Connected>
      </InviteGate>
    );
  }
  if (mode === "login") {
    return (
      <Login
        onDemo={() => remember("demo")}
        onGoogle={client ? () => void signInWithGoogle(client) : undefined}
        dev={client && localDev ? <DevLogin client={client} /> : undefined}
      />
    );
  }
  return (
    <StoreProvider key={key} initial={initial ?? loadDemo} fixedNow={fixedNow}>
      <Shell
        onReset={() => {
          resetDemo();
          clearDrafts();
          setKey(key + 1);
        }}
        onSignOut={() => {
          clearDrafts();
          remember("login");
        }}
      />
    </StoreProvider>
  );
}
