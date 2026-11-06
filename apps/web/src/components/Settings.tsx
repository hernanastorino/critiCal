import { type ReactNode, useEffect, useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { localParts } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import { holidaysBetween } from "../holidays.js";
import { home } from "../places.js";
import type { SyncResult } from "../remote.js";
import { useStore } from "../store.js";
import { Account } from "./Account.js";
import { Backup } from "./Backup.js";
import { Calendars, describe, healthy } from "./Calendars.js";
import { GeminiKey } from "./GeminiKey.js";
import { Invites } from "./Invites.js";
import { ChevronLeft, ChevronRight, SettingsIcons as I, SearchIcon } from "./icons.js";
import { useModal } from "./modal.js";
import { Notifications } from "./Notifications.js";
import { Places } from "./Places.js";
import {
  ActivitySettings,
  DetectedDefaults,
  Routines,
  RuleSettings,
  WeekSettings,
} from "./Preferences.js";
import { SectionOpen } from "./Section.js";
import { Semester } from "./Semester.js";
import { SyllabusImport } from "./SyllabusImport.js";
import { WidgetSetup } from "./WidgetSetup.js";

export type PageId =
  | "semester"
  | "syllabus"
  | "week"
  | "subjects"
  | "routines"
  | "rules"
  | "detected"
  | "places"
  | "calendars"
  | "notifications"
  | "widget"
  | "ai"
  | "invites"
  | "backup"
  | "account";

interface Page {
  id: PageId;
  title: string;
  icon: () => ReactNode;
  /** What it is set to, shown at the right of its row. */
  value?: string;
  danger?: boolean;
  content: ReactNode;
}

/**
 * What each screen holds, so a search for a field finds its section ("almuerzo" →
 * Mi semana). Matched without accents or case, as written in the forms.
 */
const KEYWORDS: Record<PageId, string> = {
  semester: "cuatrimestre semestre fechas empieza termina feriados clases materias parcial examen",
  syllabus: "programa pdf ia gemini temas unidades evaluaciones",
  week: "semana dias levanto me acuesto dormir desayuno almuerzo cena comida arreglarse traslado estudio horario",
  subjects: "materias color sesion descanso bloque minimo estudio semanal prefiero horario",
  routines: "rutinas gimnasio habito veces por semana",
  rules: "reglas maximo materias por dia margen evento aviso",
  detected: "horas detectado parcial entrega presentacion defensa examen minimo",
  places: "lugares casa facultad trabajo direccion traslados minutos auto",
  calendars:
    "calendarios google icloud sincronizar reconectar apple contrasena tipo ocupado ignorar",
  notifications: "notificaciones avisos recordatorio push minutos antes resumen",
  widget: "widget scriptable silos pantalla de inicio script",
  ai: "ia gemini clave google ai studio",
  invites: "invitaciones invitar email amigos acceso",
  backup: "respaldo exportar importar json copia",
  account: "cuenta borrar eliminar revocar",
};

const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/** Errors «Reconectar Google» fixes; others are looked at in Calendarios. */
const reconnects = (r: SyncResult) =>
  r.reason === "invalid_grant" ||
  r.error === "no_refresh_token" ||
  r.error === "token_refresh_failed";

interface Notice {
  key: string;
  title: string;
  text: string;
  action: string;
  run: (from: HTMLElement) => void;
}

/** Only what asks for something: nothing shows while all is well. */
function Notices({ onOpen }: { onOpen: (id: PageId, from?: HTMLElement) => void }) {
  const sync = useSync();
  const { data } = useStore();
  const tz = data.settings.timezone;
  const notices: Notice[] = [];
  const google = sync?.status.google;
  if (sync && google && !healthy(google)) {
    notices.push({
      key: "google",
      title: "Google Calendar no se sincroniza",
      text: describe(google, tz),
      ...(reconnects(google)
        ? { action: "Reconectar Google", run: sync.reconnectGoogle }
        : { action: "Ver Calendarios", run: (from) => onOpen("calendars", from) }),
    });
  }
  const icloud = sync?.status.icloud;
  if (icloud && !healthy(icloud)) {
    notices.push({
      key: "icloud",
      title: "iCloud no se sincroniza",
      text: describe(icloud, tz),
      action: "Ver Calendarios",
      run: (from) => onOpen("calendars", from),
    });
  }
  if (!home(data)) {
    notices.push({
      key: "home",
      title: "Falta tu casa",
      text: "Sin tu casa guardada no se calculan los traslados.",
      action: "Agregar casa",
      run: (from) => onOpen("places", from),
    });
  }
  if (notices.length === 0) return null;
  return (
    <section className="notices" aria-label="Avisos">
      {notices.map((n) => (
        <div key={n.key} className={`notice ${n.key === "home" ? "warn" : "critical"}`}>
          <div className="notice-title">
            <I.warn />
            {n.title}
          </div>
          <p>{n.text}</p>
          <button type="button" className="btn small" onClick={(e) => n.run(e.currentTarget)}>
            {n.action}
          </button>
        </div>
      ))}
    </section>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  danger,
  onClick,
  rowRef,
}: {
  icon: () => ReactNode;
  label: string;
  value?: string;
  danger?: boolean;
  onClick: () => void;
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      className={`settings-row${danger ? " danger" : ""}`}
      // VoiceOver reads «Calendarios, Google ✓», not the two run together.
      aria-label={value ? `${label}, ${value}` : undefined}
      onClick={onClick}
    >
      <span className="settings-icon">
        <Icon />
      </span>
      <span className="settings-label">{label}</span>
      {value && <span className="settings-value">{value}</span>}
      <ChevronRight />
    </button>
  );
}

/** Whether this account owns the app (it alone sees Invitaciones). */
function useOwner(): boolean {
  const client = useSync()?.client;
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void Promise.resolve()
      .then(() => client.rpc("is_owner"))
      .then(({ data }) => {
        if (!cancelled) setOwner(data === true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client]);
  return owner;
}

export function Settings({
  onClose,
  onReset,
  onSignOut,
  onWeeklyPlan,
  initialPage,
}: {
  /** A screen to open on, e.g. «Mi semana» from a meal. */
  initialPage?: PageId;
  onClose: () => void;
  onReset?: () => void;
  onSignOut?: () => void;
  onWeeklyPlan?: () => void;
}) {
  const { data, now, dispatch } = useStore();
  const sync = useSync();
  const owner = useOwner();
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  const override = data.overrides.find((o) => o.date === today);
  // Same routine the planner uses: holidays are Sundays unless turned off.
  const holiday =
    data.preferences?.holidaysOff !== false && holidaysBetween(today, today).length > 0;
  const base =
    data.settings.week[override?.asWeekday ?? (holiday ? 0 : localParts(tz, now).weekday)];
  const defaultWake = minutesToHhmm(override?.wake ?? base?.wake ?? 480);
  const defaultBed = minutesToHhmm(override?.bed ?? base?.bed ?? 0);
  // Untouched fields follow the routine (e.g. holidays switched on or off here).
  const [wakeEdit, setWake] = useState<string | null>(null);
  const [bedEdit, setBed] = useState<string | null>(null);
  const wake = wakeEdit ?? defaultWake;
  const bed = bedEdit ?? defaultBed;

  const sheet = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PageId | null>(initialPage ?? null);
  const [query, setQuery] = useState("");
  const back = useRef<HTMLButtonElement>(null);
  const rows = useRef(new Map<PageId, HTMLButtonElement>());
  /** Where the list was scrolled when a screen opened, to come back to it. */
  const listScroll = useRef(0);
  // Opened straight on a screen (a meal's «Mi semana»): Back still lands on its row.
  const opened = useRef<PageId | null>(initialPage ?? null);

  /**
   * What was tapped to open a screen (a notice's button; rows are found by id), to
   * focus it again. Passed in: Safari does not focus a button that is tapped.
   */
  const trigger = useRef<HTMLElement | null>(null);
  const open = (id: PageId, from?: HTMLElement) => {
    trigger.current = from ?? null;
    listScroll.current = sheet.current?.scrollTop ?? 0;
    opened.current = id;
    setPage(id);
  };
  const close = () => setPage(null);
  // A real modal (inert behind, Escape anywhere, focus back to the gear on closing).
  const justOpened = useModal(
    sheet,
    () => (page ? close() : onClose()),
    !initialPage,
    () => document.querySelector<HTMLElement>('button[aria-label="Ajustes"]'),
  );

  // Focus follows the screen: «Ajustes» on a section, its row again on the way back.
  useEffect(() => {
    if (page) {
      if (sheet.current) sheet.current.scrollTop = 0;
      back.current?.focus({ preventScroll: true });
      return;
    }
    const id = opened.current;
    if (!id) return;
    opened.current = null;
    if (sheet.current) sheet.current.scrollTop = listScroll.current;
    const target = trigger.current?.isConnected ? trigger.current : rows.current.get(id);
    trigger.current = null;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "nearest" });
  }, [page]);

  const routines = data.activities.filter((a) => a.kind === "rutina").length;
  const google = sync?.status.google;
  const icloud = sync?.status.icloud;
  const calendarsValue = sync
    ? [
        google?.connected ? "Google ✓" : google && !healthy(google) ? "Google: revisar" : "",
        icloud?.connected ? "iCloud ✓" : icloud && !healthy(icloud) ? "iCloud: revisar" : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : undefined;
  const weekDay = data.settings.week[localParts(tz, now).weekday];

  const groups: { label: string; pages: (Page | false)[] }[] = [
    {
      label: "Planificar",
      pages: [
        { id: "semester", title: "Inicio de cuatrimestre", icon: I.flag, content: <Semester /> },
        !!sync && {
          id: "syllabus",
          title: "Cargar programa con IA",
          icon: I.doc,
          content: <SyllabusImport />,
        },
      ],
    },
    {
      label: "Mi tiempo",
      pages: [
        {
          id: "week",
          title: "Mi semana",
          icon: I.clock,
          value: weekDay ? `${minutesToHhmm(weekDay.wake)} – ${minutesToHhmm(weekDay.bed)}` : "",
          content: <WeekSettings />,
        },
        {
          id: "subjects",
          title: "Materias",
          icon: I.book,
          value: String(data.activities.length - routines),
          content: <ActivitySettings />,
        },
        {
          id: "routines",
          title: "Rutinas",
          icon: I.repeat,
          value: String(routines),
          content: <Routines />,
        },
        { id: "rules", title: "Reglas", icon: I.rules, content: <RuleSettings /> },
        {
          id: "detected",
          title: "Horas para lo detectado",
          icon: I.radar,
          content: <DetectedDefaults />,
        },
      ],
    },
    {
      label: "Lugares",
      pages: [
        {
          id: "places",
          title: "Lugares y traslados",
          icon: I.pin,
          value: String(data.places?.length ?? 0),
          content: <Places />,
        },
      ],
    },
    {
      label: "Conexiones",
      pages: [
        !!sync && {
          id: "calendars",
          title: "Calendarios",
          icon: I.link,
          value: calendarsValue,
          content: <Calendars />,
        },
        {
          id: "notifications",
          title: "Notificaciones",
          icon: I.bell,
          content: <Notifications />,
        },
        !!sync && {
          id: "widget",
          title: "Widget de silos",
          icon: I.grid,
          content: <WidgetSetup />,
        },
        !!sync && { id: "ai", title: "Tu IA (Gemini)", icon: I.spark, content: <GeminiKey /> },
      ],
    },
    {
      label: "Cuenta",
      pages: [
        owner && { id: "invites", title: "Invitaciones", icon: I.users, content: <Invites /> },
        { id: "backup", title: "Respaldo", icon: I.box, content: <Backup /> },
      ],
    },
  ];
  const pages = groups.flatMap((g) => g.pages.filter((p): p is Page => !!p));
  const account: Page | null = sync
    ? {
        id: "account",
        title: "Revocar todo y borrar la cuenta",
        icon: I.trash,
        danger: true,
        content: <Account onDeleted={onSignOut} />,
      }
    : null;
  const all = account ? [...pages, account] : pages;
  const current = all.find((p) => p.id === page);
  const words = fold(query).split(/\s+/).filter(Boolean);
  /** With a search typed, the matching screens instead of the groups. */
  const found = words.length
    ? all.filter((p) => {
        const text = fold(`${p.title} ${KEYWORDS[p.id]}`);
        return words.every((w) => text.includes(w));
      })
    : null;
  const rowRef = (id: PageId) => (el: HTMLButtonElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  return (
    <>
      {/* Tapping outside closes; for the keyboard and VoiceOver there is ✕ and Escape. */}
      <button
        type="button"
        className="scrim dim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          // The second tap of a double tap on the gear lands here: not a close.
          if (!justOpened()) onClose();
        }}
      />
      <div
        ref={sheet}
        className="sheet settings"
        role="dialog"
        aria-modal="true"
        aria-label={current ? current.title : "Ajustes"}
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>

        <div className="settings-list" hidden={!!page} inert={!!page}>
          <h2 tabIndex={-1}>Ajustes</h2>
          <label className="settings-search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar: almuerzo, margen, iCloud…"
              aria-label="Buscar un ajuste"
            />
          </label>
          {found ? (
            <section aria-label="Resultados">
              <button type="button" className="btn small" onClick={() => setQuery("")}>
                Limpiar búsqueda
              </button>
              {found.length ? (
                <div className="settings-group">
                  {found.map((p) => (
                    <Row
                      key={p.id}
                      icon={p.icon}
                      label={p.title}
                      value={p.value}
                      danger={p.danger}
                      onClick={() => open(p.id)}
                      rowRef={rowRef(p.id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <p>No hay ningún ajuste con «{query.trim()}».</p>
                  <button type="button" className="btn" onClick={() => setQuery("")}>
                    Ver todos los ajustes
                  </button>
                </div>
              )}
            </section>
          ) : (
            <>
              <Notices onOpen={open} />

              <div className="card today">
                <h3>
                  <I.sun /> Hoy
                </h3>
                <p className="meta">
                  Si te levantaste o te vas a acostar a otra hora, el día se reacomoda.
                </p>
                <div className="row">
                  <label className="field" style={{ flex: 1 }}>
                    <span>Me levanté a las</span>
                    <input type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    <span>Me acuesto a las</span>
                    <input type="time" value={bed} onChange={(e) => setBed(e.target.value)} />
                  </label>
                </div>
                <button
                  type="button"
                  className="btn primary"
                  style={{ width: "100%" }}
                  onClick={() => {
                    dispatch({
                      type: "override",
                      // Keep whatever else today's override says (its routine).
                      override: {
                        ...override,
                        date: today,
                        wake: hhmmToMinutes(wake),
                        bed: hhmmToMinutes(bed),
                      },
                    });
                    onClose();
                  }}
                >
                  Reacomodar hoy
                </button>
              </div>

              {groups.map((g) => {
                const shown = g.pages.filter((p): p is Page => !!p);
                const weekly = g.label === "Planificar" && onWeeklyPlan;
                if (!shown.length && !weekly) return null;
                return (
                  <section key={g.label} aria-label={g.label}>
                    <div className="section-title">{g.label}</div>
                    <div className="settings-group">
                      {weekly && (
                        <Row icon={I.plan} label="Planificación semanal" onClick={onWeeklyPlan} />
                      )}
                      {shown.map((p) => (
                        <Row
                          key={p.id}
                          icon={p.icon}
                          label={p.title}
                          value={p.value}
                          onClick={() => open(p.id)}
                          rowRef={rowRef(p.id)}
                        />
                      ))}
                      {g.label === "Cuenta" && (
                        <a
                          className="settings-row"
                          aria-label="Política de privacidad (se abre en otra pestaña)"
                          href="/privacy.html"
                          target="_blank"
                          rel="noreferrer"
                        >
                          <span className="settings-icon">
                            <I.shield />
                          </span>
                          <span className="settings-label">Política de privacidad</span>
                          <ChevronRight />
                        </a>
                      )}
                      {g.label === "Cuenta" && onReset && (
                        <Row icon={I.repeat} label="Reiniciar demo" onClick={onReset} />
                      )}
                      {g.label === "Cuenta" && onSignOut && (
                        <Row icon={I.out} label="Salir" onClick={onSignOut} />
                      )}
                    </div>
                  </section>
                );
              })}

              {account && (
                <div className="settings-group">
                  <Row
                    icon={account.icon}
                    label={account.title}
                    danger
                    onClick={() => open(account.id)}
                    rowRef={rowRef(account.id)}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Every section stays mounted, so a half-filled form survives going back. */}
        {all.map((p) => (
          <div key={p.id} className="settings-page" hidden={page !== p.id} inert={page !== p.id}>
            <button
              ref={page === p.id ? back : undefined}
              type="button"
              className="settings-back"
              aria-label="Volver a Ajustes"
              onClick={close}
            >
              <ChevronLeft /> Ajustes
            </button>
            <h2>{p.title}</h2>
            <SectionOpen.Provider value={page === p.id}>{p.content}</SectionOpen.Provider>
          </div>
        ))}
      </div>
    </>
  );
}
