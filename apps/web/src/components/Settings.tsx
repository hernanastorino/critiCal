import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useSync } from "../Connected.js";
import { normalize } from "../calendars.js";
import { awakeProblem } from "../dayLength.js";
import { clearSettingsDrafts, hasSettingsDrafts, rememberSettingsPage } from "../drafts.js";
import { localParts } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm, parseClock } from "../format.js";
import { holidaysBetween } from "../holidays.js";
import { home } from "../places.js";
import { mealsOf } from "../planning.js";
import type { SyncResult } from "../remote.js";
import { useStore } from "../store.js";
import { Account } from "./Account.js";
import { Backup } from "./Backup.js";
import { Calendars, describe, healthy } from "./Calendars.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import { resumeFirstSteps } from "./FirstSteps.js";
import { Problem, useFocusInvalid } from "./fields.js";
import { GeminiKey } from "./GeminiKey.js";
import { Invites } from "./Invites.js";
import { ChevronLeft, ChevronRight, SettingsIcons as I, Marks, SearchIcon } from "./icons.js";
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
import { Roy } from "./Roy.js";
import { SectionOpen } from "./Section.js";
import { Semester } from "./Semester.js";
import { SyllabusImport } from "./SyllabusImport.js";
import { useSettingsHistory } from "./settingsHistory.js";
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
 * What each screen holds, in the words it is written with, so a search for a field finds its
 * screen («almuerzo» → Mi semana). Compared without accents or case. Add the words of a
 * new field here.
 */
const KEYWORDS: Record<PageId, string> = {
  semester: "cuatrimestre semestre fechas empieza termina feriados domingo clases parcial examen",
  syllabus: "programa pdf ia gemini temas unidades evaluaciones horas de preparacion",
  week: "semana dias levanto me acuesto dormir desayuno almuerzo cena comida arreglarse estudio horario",
  subjects: "materias color alias sesion descanso bloque minimo estudio semanal horas",
  routines: "rutinas gimnasio habito veces por semana minutos",
  rules: "reglas maximo materias por dia margen evento aviso",
  detected: "horas detectado parcial entrega presentacion defensa examen minimo",
  places:
    "lugares casa facultad trabajo direccion alias traslados tiempos minutos auto omnibus bus rutas habituales",
  calendars:
    "calendarios google icloud apple sincronizar reconectar id contrasena especifica de app ocupado",
  notifications: "notificaciones avisos recordatorio push hora planificacion semanal domingo",
  widget: "widget scriptable silos pantalla de inicio script",
  ai: "ia gemini clave google ai studio",
  invites: "invitaciones invitar email amigos acceso",
  backup: "respaldo exportar importar json copia",
  account: "cuenta borrar eliminar revocar datos plan calendario",
};

/** The rows of Ajustes that are not screens, by the same kind of words. */
const EXTRA_WORDS = {
  weekly: "planificacion semanal plan armar la semana",
  privacy: "politica de privacidad datos legal",
  steps: "primeros pasos guia tutorial empezar",
  reset: "reiniciar demo borrar datos de ejemplo",
  out: "salir cerrar sesion",
};

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
  const house = home(data);
  if (!house) {
    notices.push({
      key: "home",
      title: "Falta tu casa",
      text: "Sin tu casa guardada no se calculan los traslados.",
      action: "Agregar casa",
      run: (from) => onOpen("places", from),
    });
  } else if (!house.address?.trim() && house.lat === undefined) {
    // A home without an address is no start for any trip either.
    notices.push({
      key: "home",
      title: "Tu casa no tiene dirección",
      text: "Sin la dirección de tu casa no se calculan los traslados.",
      action: "Agregar dirección",
      run: (from) => onOpen("places", from),
    });
  }
  if (notices.length === 0) return null;
  return (
    <section className="notices" aria-label="Avisos">
      {notices.map((n) => (
        <div key={n.key} className={`notice ${n.key === "home" ? "warn" : "critical"}`}>
          {n.key !== "home" && (
            <div className="notice-mascot">
              <Roy anim="desarmado" size={132} maxWidth={190} />
            </div>
          )}
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

/** What a screen reader hears after each keystroke in the search. */
const matches = (n: number) =>
  n === 0 ? "Ningún ajuste coincide" : n === 1 ? "1 ajuste coincide" : `${n} ajustes coinciden`;

/** The search's answer: the matching rows, or that there are none. */
function Results({
  rows,
  query,
  onClear,
}: {
  rows: ReactNode[];
  query: string;
  onClear: () => void;
}) {
  return (
    <section aria-label="Resultados">
      {rows.length ? (
        <div className="settings-group">{rows}</div>
      ) : (
        <p className="meta">No hay ningún ajuste con «{query.trim()}».</p>
      )}
      <button type="button" className="btn small" onClick={onClear}>
        {rows.length ? "Limpiar búsqueda" : "Ver todos los ajustes"}
      </button>
    </section>
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
  // Signing out wipes this device's copy: save what is pending first, and if that is not
  // possible (offline), say so before it is lost.
  const leaving = useRef(false);
  const leave = async () => {
    // A second tap while the save is awaited would open a second confirmation.
    if (!onSignOut || leaving.current) return;
    leaving.current = true;
    // Bounded: a stalled request must not keep the account from signing out.
    const saved = sync
      ? await Promise.race([
          sync.flush(true),
          new Promise<boolean>((r) => setTimeout(r, 3000, false)),
        ])
      : true;
    if (!saved) {
      const ok = window.confirm(
        "Hay cambios que todavía no se guardaron (sin internet). Si salís ahora, se pierden. ¿Salir igual?",
      );
      if (!ok) {
        leaving.current = false;
        return;
      }
    }
    // Whatever save is still running must not write this device's copy after it is wiped.
    sync?.seal();
    onSignOut();
  };
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
  // Shown once «Reacomodar hoy» is refused; typing in either field clears it.
  const [dayError, setDayError] = useState<string | null>(null);
  const focusInvalid = useFocusInvalid();

  const sheet = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PageId | null>(initialPage ?? null);
  const [query, setQuery] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const replanned = useRef(false);
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
  const toList = () => setPage(null);
  // Leaving Ajustes with something typed and unsaved asks first (SPEC §14); a reload
  // brings back the screen that was open (the drafts are kept in sessionStorage).
  const [asking, setAsking] = useState(false);
  const askClose = () => (hasSettingsDrafts() ? setAsking(true) : onClose());
  useEffect(() => {
    rememberSettingsPage(page);
  }, [page]);
  const popScreen = useSettingsHistory(page, toList, onClose);
  const close = () => {
    popScreen();
    toList();
  };
  // A real modal (inert behind, Escape anywhere, focus back to the gear on closing).
  const justOpened = useModal(
    sheet,
    () => (page ? close() : askClose()),
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
  // Every field «Mi semana» edits, not only wake and bed: meals and the rest count too.
  // Normalized: a day without `morningMinutes` is the same as one with 0, and meals as the planner reads them.
  // Field by field, in a fixed order (key order in the data must not matter).
  const routineKey = (d: (typeof data.settings.week)[number]) =>
    JSON.stringify([
      d.wake,
      d.morningMinutes ?? 0,
      d.bed,
      d.freeFrom,
      [...mealsOf(d)]
        .sort((a, b) => a.start - b.start || (a.kind ?? "").localeCompare(b.kind ?? ""))
        .map((m) => [m.kind ?? "", m.start, m.end]),
    ]);
  const sameRoutine = data.settings.week.every(
    (d) => routineKey(d) === routineKey(data.settings.week[0] as typeof d),
  );

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
          // One schedule when the days agree; else it says they differ, not today's alone.
          value: sameRoutine
            ? weekDay
              ? `${minutesToHhmm(weekDay.wake)} – ${minutesToHhmm(weekDay.bed)}`
              : ""
            : "Varía",
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
  const rowRef = (id: PageId) => (el: HTMLButtonElement | null) => {
    if (el) rows.current.set(id, el);
    else rows.current.delete(id);
  };

  const pageRow = (p: Page) => (
    <Row
      key={p.id}
      icon={p.icon}
      label={p.title}
      value={p.value}
      danger={p.danger}
      onClick={() => open(p.id)}
      rowRef={rowRef(p.id)}
    />
  );
  // The rows that are not screens, once each: the groups and the search show the same ones.
  const weeklyRow = onWeeklyPlan && (
    <Row key="weekly" icon={I.plan} label="Planificación semanal" onClick={onWeeklyPlan} />
  );
  const privacyRow = (
    <a
      key="privacy"
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
  );
  const stepsRow = sync && (
    <Row
      key="steps"
      icon={I.flag}
      label="Primeros pasos"
      onClick={() => {
        // The guide comes back on the week (SPEC §14).
        resumeFirstSteps(data.owner);
        onClose();
      }}
    />
  );
  const resetRow = onReset && (
    <Row key="reset" icon={I.repeat} label="Reiniciar demo" onClick={onReset} />
  );
  const outRow = onSignOut && <Row key="out" icon={I.out} label="Salir" onClick={leave} />;

  /** Everything the search can reach, in the order of the list. */
  const searchable: { key: string; words: string; row: ReactNode }[] = [
    ...groups.flatMap((g) => [
      ...(g.label === "Planificar" && weeklyRow
        ? [{ key: "weekly", words: `Planificación semanal ${EXTRA_WORDS.weekly}`, row: weeklyRow }]
        : []),
      ...g.pages
        .filter((p): p is Page => !!p)
        .map((p) => ({ key: p.id, words: `${p.title} ${KEYWORDS[p.id]}`, row: pageRow(p) })),
      ...(g.label === "Cuenta"
        ? [
            {
              key: "privacy",
              words: `Política de privacidad ${EXTRA_WORDS.privacy}`,
              row: privacyRow,
            },
            ...(stepsRow
              ? [{ key: "steps", words: `Primeros pasos ${EXTRA_WORDS.steps}`, row: stepsRow }]
              : []),
            ...(resetRow
              ? [{ key: "reset", words: `Reiniciar demo ${EXTRA_WORDS.reset}`, row: resetRow }]
              : []),
            ...(outRow ? [{ key: "out", words: `Salir ${EXTRA_WORDS.out}`, row: outRow }] : []),
          ]
        : []),
    ]),
    ...(account
      ? [
          {
            key: account.id,
            words: `${account.title} ${KEYWORDS[account.id]}`,
            row: pageRow(account),
          },
        ]
      : []),
  ];
  // Every word typed must start a word of the entry (so «dia» finds días but not «media»).
  const terms = normalize(query).split(" ").filter(Boolean);
  const found = terms.length
    ? searchable.filter((e) => {
        const words = normalize(e.words).split(" ");
        return terms.every((t) => words.some((w) => w.startsWith(t)));
      })
    : null;
  const clearSearch = () => {
    setQuery("");
    searchBox.current?.focus({ preventScroll: true });
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
          if (!justOpened()) askClose();
        }}
      />
      <div
        ref={sheet}
        className="sheet settings"
        role="dialog"
        aria-modal="true"
        aria-label={current ? current.title : "Ajustes"}
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={askClose}>
          <Marks.close />
        </button>

        <div className="settings-list" hidden={!!page} inert={!!page}>
          <h2 tabIndex={-1}>Ajustes</h2>
          {/* biome-ignore lint/a11y/useSemanticElements: <search> is not a landmark before iOS 17 */}
          <div role="search" className="settings-search">
            <SearchIcon />
            <input
              ref={searchBox}
              type="search"
              aria-label="Buscar un ajuste"
              aria-describedby={resultsId}
              placeholder="Buscar: almuerzo, margen, iCloud…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <p id={resultsId} className="sr-only" aria-live="polite">
            {found ? matches(found.length) : ""}
          </p>
          {found ? (
            <Results rows={found.map((e) => e.row)} query={query} onClear={clearSearch} />
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
                    <input
                      type="time"
                      value={wake}
                      aria-invalid={dayError ? true : undefined}
                      aria-describedby={dayError ? "day-error" : undefined}
                      onChange={(e) => {
                        setWake(e.target.value);
                        setDayError(null);
                      }}
                    />
                  </label>
                  <label className="field" style={{ flex: 1 }}>
                    <span>Me acuesto a las</span>
                    <input
                      type="time"
                      value={bed}
                      aria-invalid={dayError ? true : undefined}
                      aria-describedby={dayError ? "day-error" : undefined}
                      onChange={(e) => {
                        setBed(e.target.value);
                        setDayError(null);
                      }}
                    />
                  </label>
                </div>
                <Problem id="day-error" text={dayError} />
                <button
                  type="button"
                  className="btn primary"
                  style={{ width: "100%" }}
                  onClick={(e) => {
                    // A wake-up typed here is today's: it cannot be later than now (a night
                    // shift is set up in «Mi semana»). The untouched routine time is not checked.
                    const woke = parseClock(wake);
                    const future =
                      wake !== defaultWake &&
                      woke !== null &&
                      woke > localParts(tz, now).minuteOfDay
                        ? `Todavía no son las ${wake}.`
                        : null;
                    const problem = future ?? awakeProblem(wake, bed);
                    if (problem) {
                      setDayError(problem);
                      // The fields are marked once drawn: the first one gets the focus then.
                      focusInvalid(e.currentTarget);
                      return;
                    }
                    // A double tap would apply it twice (two «Deshacer» for one change).
                    if (replanned.current) return;
                    replanned.current = true;
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
                const weekly = g.label === "Planificar" && weeklyRow;
                if (!shown.length && !weekly) return null;
                return (
                  <section key={g.label} aria-label={g.label}>
                    <div className="section-title">{g.label}</div>
                    <div className="settings-group">
                      {weekly}
                      {shown.map(pageRow)}
                      {g.label === "Cuenta" && (
                        <>
                          {privacyRow}
                          {stepsRow}
                          {resetRow}
                          {outRow}
                        </>
                      )}
                    </div>
                  </section>
                );
              })}

              {account && <div className="settings-group">{pageRow(account)}</div>}
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
      {asking && (
        <ConfirmDiscard
          onDiscard={() => {
            clearSettingsDrafts();
            onClose();
          }}
          onKeep={() => setAsking(false)}
        />
      )}
    </>
  );
}
