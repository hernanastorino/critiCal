import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Connected } from "./Connected.js";
import { Celebrations } from "./components/Celebrations.js";
import { resumeFirstSteps } from "./components/FirstSteps.js";
import { Inbox } from "./components/Inbox.js";
import { InboxIcon, SiloIcon, WeekIcon } from "./components/icons.js";
import { RoyLine } from "./components/Roy.js";
import { type PageId, Settings } from "./components/Settings.js";
import { Silos } from "./components/Silos.js";
import { editorDraft } from "./components/TaskEditor.js";
import { ToastProvider, useToast } from "./components/Toast.js";
import { Week } from "./components/Week.js";
import { WeeklyPlan } from "./components/WeeklyPlan.js";
import { demoKind, isTestDemo, setDemoKind } from "./demoPruebas.js";
import { localDev } from "./devAuth.js";
import { clearDrafts, settingsToRestore } from "./drafts.js";
import { loginProblem } from "./friendly.js";
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

/** Says the demo was reset, and offers to bring back what it had (shown once, on mount). */
function ResetNotice({ undo }: { undo: () => void }) {
  const toast = useToast();
  const said = useRef(false);
  useEffect(() => {
    if (said.current) return;
    said.current = true;
    toast.show("Demo reiniciada", { undo });
  }, [toast, undo]);
  return null;
}

export function Shell({
  onReset,
  onSignOut,
  resetUndo,
}: {
  /** Gets the data as it was, so the reset can be taken back. */
  onReset?: (before: AppData) => void;
  onSignOut?: () => void;
  /** Right after a reset: takes it back. */
  resetUndo?: () => void;
}) {
  const { inboxCount, data } = useStore();
  // A reload brings back the tab whose editor was open with something typed (SPEC §14).
  const [tab, setTab] = useState<Tab>(
    () =>
      tabFrom(globalThis.location?.search ?? "") ??
      (editorDraft("silos") ? "silos" : editorDraft("inbox") ? "inbox" : "week"),
  );
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
  const [settings, setSettings] = useState<boolean | PageId>(
    () => (settingsToRestore() || false) as boolean | PageId,
  );
  /** Planificación semanal was opened from the Ajustes list: closing it goes back there. */
  /** A materia or rutina Ajustes opens on (from the Bandeja). */
  const [settingsActivity, setSettingsActivity] = useState<string>();
  const [weeklyFromSettings, setWeeklyFromSettings] = useState(false);
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
      {resetUndo && <ResetNotice undo={resetUndo} />}
      <div className="app">
        {/* Hidden until the keyboard lands on it (WCAG 2.4.1): the tabs come after the screen. */}
        {/* biome-ignore lint/a11y/useValidAnchor: a skip link; without script it still jumps to #tabs. */}
        <a
          className="skip-link"
          href="#tabs"
          // Safari does not reach a link with Tab unless it says so.
          tabIndex={0}
          onClick={(e) => {
            e.preventDefault();
            document
              .querySelector<HTMLElement>('.tabs button[aria-current="page"], .tabs button')
              ?.focus();
          }}
        >
          Saltar a las pestañas
        </a>
        <main className="main">
          {tab === "week" && <Week day={day} onSettings={(page) => setSettings(page ?? true)} />}
          {tab === "silos" && <Silos />}
          {tab === "inbox" && (
            <Inbox
              onDay={(date) => {
                setDay(date);
                setTab("week");
              }}
              onWeek={() => {
                setDay(undefined);
                setTab("week");
              }}
              onRoutine={(id) => {
                setSettingsActivity(id);
                setSettings("subjects");
              }}
            />
          )}
        </main>
        <nav className="tabs" id="tabs" aria-label="Secciones">
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
            initialActivity={settingsActivity}
            onClose={() => {
              setSettings(false);
              setSettingsActivity(undefined);
            }}
            onReset={onReset && (() => onReset(data))}
            onSignOut={onSignOut}
            onWeeklyPlan={() => {
              setSettings(false);
              setWeekly(true);
              setWeeklyFromSettings(true);
            }}
          />
        )}
        {weekly && (
          <WeeklyPlan
            onClose={() => {
              setWeekly(false);
              if (weeklyFromSettings) setSettings(true);
              setWeeklyFromSettings(false);
            }}
            onInbox={() => {
              setWeekly(false);
              setWeeklyFromSettings(false);
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

/**
 * Starts the demo of the kind asked for. Changing kind starts that demo from its own data
 * (the stored copy belongs to the other one); asking for the one already on keeps its progress.
 */
function startDemo(kind: "ejemplo" | "pruebas") {
  if (demoKind() !== kind) {
    resetDemo();
    setDemoKind(kind);
    if (kind === "pruebas") resumeFirstSteps();
  }
  try {
    globalThis.localStorage?.setItem("critical.mode", "demo");
  } catch {
    // ignore
  }
}

/** `?demo=pruebas` opens the test demo straight away (and leaves the address clean). */
function demoFromUrl(): boolean {
  try {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get("demo") !== "pruebas") return false;
    startDemo("pruebas");
    url.searchParams.delete("demo");
    globalThis.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    return true;
  } catch {
    return false;
  }
}

/** Reads a sign-in error the provider left in the address (query or hash) and cleans it up. */
function signInProblemFromUrl(): string | null {
  try {
    const url = new URL(globalThis.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const found = loginProblem(url.searchParams) ?? loginProblem(hash);
    if (found === null) return null;
    for (const k of ["error", "error_code", "error_description"]) url.searchParams.delete(k);
    globalThis.history.replaceState(null, "", `${url.pathname}${url.search}`);
    return found;
  } catch {
    return null;
  }
}

function Login({
  onDemo,
  onTestDemo,
  onGoogle,
  dev,
  problem,
}: {
  onDemo: () => void;
  onTestDemo: () => void;
  onGoogle?: () => void;
  dev?: ReactNode;
  /** Why the last sign-in did not work (SPEC §18.1): Roy, no blame, and the button is right below. */
  problem?: string | null;
}) {
  return (
    <main className="login">
      <img src="/icon-192.png" alt="" />
      <h1>critiCal</h1>
      <p>Tu calendario que se reacomoda solo y te muestra qué no podés saltearte.</p>
      {problem && (
        <div className="notice warn" role="alert">
          <RoyLine anim="desarmado">{problem}</RoyLine>
        </div>
      )}
      {onGoogle && (
        <button type="button" className="btn primary" onClick={onGoogle}>
          Entrar con Google
        </button>
      )}
      <button type="button" className={`btn${onGoogle ? "" : " primary"}`} onClick={onDemo}>
        Probar con datos de ejemplo
      </button>
      <button type="button" className="btn small" onClick={onTestDemo}>
        Demo de pruebas
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
    if (demoFromUrl()) return "demo";
    try {
      return globalThis.localStorage?.getItem("critical.mode") === "demo" ? "demo" : "login";
    } catch {
      return "login";
    }
  });
  const [key, setKey] = useState(0);
  /** What the address said about a sign-in that failed (an expired link, a refused permission). */
  const [problem] = useState(() => signInProblemFromUrl());
  /** The demo as it was before «Reiniciar demo», while that can still be undone. */
  const [restored, setRestored] = useState<AppData | null>(null);
  const [before, setBefore] = useState<AppData | null>(null);
  const client = initial ? null : supabase;
  const session = useSession(client);
  // Whatever way a session ends, the next account does not see what the last one typed.
  const uid = session?.user?.id;
  const lastUid = useRef(uid);
  useEffect(() => {
    // (Loading the session on a reload is not a change of account: the drafts stay.)
    if (lastUid.current && lastUid.current !== uid) clearDrafts();
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
        .then(async () => {
          // Global revocation needs the network; offline, the device still signs out.
          const { error } = await client.auth.signOut();
          if (error) await client.auth.signOut({ scope: "local" });
        });
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
        onDemo={() => {
          startDemo("ejemplo");
          remember("demo");
        }}
        onTestDemo={() => {
          startDemo("pruebas");
          remember("demo");
        }}
        onGoogle={client ? () => void signInWithGoogle(client) : undefined}
        dev={client && localDev ? <DevLogin client={client} /> : undefined}
        problem={problem}
      />
    );
  }
  return (
    <StoreProvider
      key={key}
      // After undoing a reset the demo starts from the data it had.
      initial={restored ? () => restored : (initial ?? loadDemo)}
      fixedNow={fixedNow}
    >
      <Shell
        onReset={(was) => {
          resetDemo();
          // The test demo's guide starts over with it.
          if (isTestDemo()) resumeFirstSteps();
          clearDrafts();
          setBefore(was);
          setRestored(null);
          setKey(key + 1);
        }}
        resetUndo={
          before
            ? () => {
                clearDrafts();
                setRestored(before);
                setBefore(null);
                setKey(key + 1);
              }
            : undefined
        }
        onSignOut={() => {
          clearDrafts();
          remember("login");
        }}
      />
    </StoreProvider>
  );
}
