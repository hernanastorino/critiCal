import { useState } from "react";
import { DEFAULTS } from "../calendars.js";
import type { Activity, DaySettings, Meal, MealKind } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import { type AppTask, type DetectedKind, type Effort, nextColor, PALETTE } from "../model.js";
import { DEFAULT_BREAK_MINUTES, DEFAULT_STUDY_MINUTES, MEAL_NAMES, mealsOf } from "../planning.js";
import { useStore } from "../store.js";
import { studyOf, subjectsOf, validRoutine } from "../subjects.js";
import { Section } from "./Section.js";
import { StartAfterField } from "./StartAfterField.js";
import { TaskDetail } from "./TaskDetail.js";
import { TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";

const DAYS = ["D", "L", "M", "M", "J", "V", "S"];
/** For VoiceOver: two «M» would read alike. */
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

// Two decimals: every whole minute survives a save (105 min → 1.75 h → 105).
/** A whole number of minutes within [min, max] from a field, or undefined if not one. */
/** A plain non-negative figure as typed in a form («2», «1,5»): no letters, signs or exponents. */
export const isFigure = (v: string) => /^\s*\d+(?:[.,]\d+)?\s*$/.test(v);

// «3,5» reads as 3.5; «0x10» or «1e2» are not figures.
const clampMinutes = (v: string, min: number, max: number) => {
  if (!isFigure(v)) return undefined;
  const n = Math.round(Number(v.replace(",", ".")));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

const toHours = (m: number) => String(Math.round((m / 60) * 100) / 100);
const fromHours = (v: string) => Math.max(0, Math.round(Number(v.replace(",", ".")) * 60) || 0);

/** Fixed weekly routine: wake/bed, morning, meals and when study time ends, per weekday. */
export function WeekSettings() {
  const { data, dispatch } = useStore();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const first = data.settings.week[days[0] ?? 1] as DaySettings;
  const [form, setForm] = useState(() => formOf(first));
  const toast = useToast();

  const pick = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length === 0) return;
    setDays(next);
    setForm(formOf(data.settings.week[next[0] as number] as DaySettings));
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setError(null);
  };

  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const meal = (kind: MealKind, at: string, minutes: string): Meal => ({
      kind,
      start: hhmmToMinutes(at),
      // At most 4 h: a 99999-minute breakfast would not even fit a backup.
      end: hhmmToMinutes(at) + (clampMinutes(minutes, 0, 240) ?? 0),
    });
    const wake = hhmmToMinutes(form.wake);
    const bed = hhmmToMinutes(form.bed);
    if (wake === bed) {
      setError("Me levanto y me acuesto no pueden ser a la misma hora.");
      return;
    }
    const meals = [
      meal("desayuno", form.breakfast, form.breakfastMin),
      meal("almuerzo", form.lunch, form.lunchMin),
      meal("merienda", form.snack, form.snackMin),
      meal("cena", form.dinner, form.dinnerMin),
    ].filter((m) => m.end > m.start);
    // A meal while asleep (breakfast 07:30 when getting up at 23:00) would vanish silently.
    // The whole meal, not just its start: a 2 h dinner at 22:45 with bed at 23:00 does not fit.
    const bedEnd = wake < bed ? bed : bed + 1440;
    const fits = (m: Meal) => {
      const start = m.start < wake ? m.start + 1440 : m.start;
      return start >= wake && start + (m.end - m.start) <= bedEnd;
    };
    const asleep = meals.find((m) => !fits(m));
    if (asleep) {
      setError(
        `${asleep.kind ? MEAL_NAMES[asleep.kind] : "Una comida"} a las ${minutesToHhmm(asleep.start)} cae, o termina, cuando estás dormido (de ${form.bed} a ${form.wake}). Cambiá la hora, acortala o poné duración 0.`,
      );
      return;
    }
    setError(null);
    // Going to bed after midnight: what comes after midnight belongs to the same day
    // (dinner at 00:45 is 24:45, not this morning).
    const late = (m: number) => (bed < wake && m < wake ? m + 1440 : m);
    const day: DaySettings = {
      wake,
      morningMinutes: clampMinutes(form.morning, 0, 240) ?? 0,
      bed,
      meals: meals.map((m) => ({
        ...m,
        start: late(m.start),
        end: late(m.start) + (m.end - m.start),
      })),
      freeFrom: late(hhmmToMinutes(form.freeFrom)),
    };
    const week = data.settings.week.map((d, i) => (days.includes(i) ? day : d));
    dispatch({ type: "settings", settings: { ...data.settings, week } });
    // Show what was saved (a negative morning becomes 0, a 999-minute lunch 240).
    const shown = (m?: Meal) => (m ? String(m.end - m.start) : "0");
    setForm({
      ...form,
      morning: String(day.morningMinutes),
      breakfastMin: shown(meals.find((m) => m.kind === "desayuno")),
      lunchMin: shown(meals.find((m) => m.kind === "almuerzo")),
      snackMin: shown(meals.find((m) => m.kind === "merienda")),
      dinnerMin: shown(meals.find((m) => m.kind === "cena")),
    });
    toast.show("Mi semana guardada");
  };

  return (
    <Section>
      <p className="meta">
        Lo que casi nunca cambia. Para un día puntual usá «Hoy» arriba. Elegí los días y editá:
      </p>
      <div className="day-chips">
        {ORDER.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days.includes(d)}
            aria-label={DAY_NAMES[d]}
            className={`chip${days.includes(d) ? " on" : ""}`}
            onClick={() => pick(d)}
          >
            {DAYS[d]}
          </button>
        ))}
      </div>
      <div className="grid2">
        <Field label="Me levanto" type="time" value={form.wake} onChange={set("wake")} />
        <Field label="Arreglarse, traslado (min)" value={form.morning} onChange={set("morning")} />
        <Field label="Desayuno" type="time" value={form.breakfast} onChange={set("breakfast")} />
        <Field
          label="Dura (min)"
          name="Duración de desayuno (min)"
          value={form.breakfastMin}
          onChange={set("breakfastMin")}
        />
        <Field label="Almuerzo" type="time" value={form.lunch} onChange={set("lunch")} />
        <Field
          label="Dura (min)"
          name="Duración de almuerzo (min)"
          value={form.lunchMin}
          onChange={set("lunchMin")}
        />
        <Field label="Merienda" type="time" value={form.snack} onChange={set("snack")} />
        <Field
          label="Dura (min)"
          name="Duración de merienda (min)"
          value={form.snackMin}
          onChange={set("snackMin")}
        />
        <Field label="Cena" type="time" value={form.dinner} onChange={set("dinner")} />
        <Field
          label="Dura (min)"
          name="Duración de cena (min)"
          value={form.dinnerMin}
          onChange={set("dinnerMin")}
        />
        <Field
          label="Nada de estudio desde"
          type="time"
          value={form.freeFrom}
          onChange={set("freeFrom")}
        />
        <Field label="Me acuesto" type="time" value={form.bed} onChange={set("bed")} />
      </div>
      <p className="meta">
        No se planifica nada antes de{" "}
        {minutesToHhmm(hhmmToMinutes(form.wake) + (clampMinutes(form.morning, 0, 240) ?? 0))}
        {[form.breakfastMin, form.lunchMin, form.snackMin, form.dinnerMin].some(
          (m) => Number(m) > 0,
        )
          ? ""
          : " (sin comidas cargadas)"}
        .
      </p>
      <p className="meta">
        Siempre hay lugar para comer y nunca va estudio encima de una comida. Si un evento fijo o un
        bloque 📌 cae a esa hora, la comida se corre sola al hueco más cercano, hasta 1 h 30 antes o
        después; si no hay ninguno, queda a su hora encima de lo que haya y la Bandeja avisa. Con
        duración 0 no hay esa comida (la merienda viene en 0).
      </p>
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%" }}
        // «Guardar para L M M J V» reads as loose letters: VoiceOver gets the day names.
        aria-label={`Guardar para ${days.length === 7 ? "todos los días" : days.map((d) => DAY_NAMES[d]).join(", ")}`}
        onClick={save}
      >
        {`Guardar para ${days.length === 7 ? "todos los días" : days.map((d) => DAYS[d]).join(" ")}`}
      </button>
      {error && (
        <p className="meta" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </Section>
  );
}

function formOf(d: DaySettings) {
  const meals = mealsOf(d);
  const [breakfast, lunch, snack, dinner] = (
    ["desayuno", "almuerzo", "merienda", "cena"] as const
  ).map((k) => meals.find((m) => m.kind === k));
  return {
    wake: minutesToHhmm(d.wake),
    morning: String(d.morningMinutes ?? 0),
    breakfast: minutesToHhmm(breakfast?.start ?? d.wake),
    breakfastMin: String(breakfast ? breakfast.end - breakfast.start : 0),
    lunch: minutesToHhmm(lunch?.start ?? 780),
    lunchMin: String(lunch ? lunch.end - lunch.start : 0),
    snack: minutesToHhmm(snack?.start ?? 1050),
    snackMin: String(snack ? snack.end - snack.start : 0),
    dinner: minutesToHhmm(dinner?.start ?? 1260),
    dinnerMin: String(dinner ? dinner.end - dinner.start : 0),
    freeFrom: minutesToHhmm(d.freeFrom),
    bed: minutesToHhmm(d.bed),
  };
}

function Field({
  label,
  name,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  /** What a screen reader says when several fields share the same visible label. */
  name?: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
        aria-label={name}
        inputMode={type === "text" ? "decimal" : undefined}
        value={value}
        onChange={onChange}
      />
    </label>
  );
}

/** Planning rules that apply to every day. */
export function RuleSettings() {
  const { data, dispatch } = useStore();
  const s = data.settings;
  const [form, setForm] = useState({
    maxActivities: String(s.maxActivitiesPerDay),
    margin: String(s.travelMarginMinutes),
    warn: toHours(s.warnSlackMinutes),
  });
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setError(null);
  };
  const save = () => {
    // Plain figures only: «-5abc» or «1e308» are refused, not guessed.
    if (![form.maxActivities, form.margin, form.warn].every(isFigure)) {
      setError("Revisá los números: solo cifras, sin letras ni signos.");
      return;
    }
    const max = clampMinutes(form.maxActivities, 1, 10) ?? 1;
    const margin = clampMinutes(form.margin, 0, 240) ?? 0;
    const warn = Math.min(168 * 60, fromHours(form.warn));
    dispatch({
      type: "settings",
      settings: {
        ...s,
        maxActivitiesPerDay: max,
        travelMarginMinutes: margin,
        warnSlackMinutes: warn,
      },
    });
    // Show what was saved: «0» becomes 1, «999» becomes 10.
    setForm({ maxActivities: String(max), margin: String(margin), warn: toHours(warn) });
    toast.show("Reglas guardadas");
  };
  return (
    <Section>
      <div className="grid2">
        <Field
          label="Máximo de materias por día"
          value={form.maxActivities}
          onChange={set("maxActivities")}
        />
        <Field
          label="Margen antes de cada evento (min)"
          value={form.margin}
          onChange={set("margin")}
        />
        <Field
          label="Avisar cuando el margen baja de (h)"
          value={form.warn}
          onChange={set("warn")}
        />
      </div>
      <button type="button" className="btn primary" style={{ width: "100%" }} onClick={save}>
        Guardar reglas
      </button>
      <p className="meta">
        De 1 a 10 materias por día, margen de hasta 240 min y aviso de hasta 168 h.
      </p>
      {error && (
        <p className="meta" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </Section>
  );
}

const KINDS: { kind: DetectedKind; label: string }[] = [
  { kind: "parcial", label: "Parcial / examen" },
  { kind: "entrega", label: "Entrega" },
  { kind: "presentacion", label: "Presentación / defensa" },
];

/** Default effort for tasks created from calendar events. */
export function DetectedDefaults() {
  const { data, dispatch } = useStore();
  const current = (k: DetectedKind): Effort => data.preferences?.importDefaults?.[k] ?? DEFAULTS[k];
  const [form, setForm] = useState(() =>
    Object.fromEntries(
      KINDS.map(({ kind }) => [
        kind,
        { estimate: toHours(current(kind).estimate), min: toHours(current(kind).min) },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  return (
    <Section>
      <p className="meta">
        Cuánto le planifico a cada evento nuevo de tus calendarios hasta que lo ajustes.
      </p>
      {KINDS.map(({ kind, label }) => (
        <div key={kind} className="grid3">
          <span className="grid3-label">{label}</span>
          <label className="field">
            <span>Horas</span>
            <input
              inputMode="decimal"
              aria-label={`Horas de ${label}`}
              value={form[kind]?.estimate}
              onChange={(e) => {
                setForm({ ...form, [kind]: { ...form[kind], estimate: e.target.value } as never });
              }}
            />
          </label>
          <label className="field">
            <span>Mínimo</span>
            <input
              inputMode="decimal"
              aria-label={`Mínimo de ${label}`}
              value={form[kind]?.min}
              onChange={(e) => {
                setForm({ ...form, [kind]: { ...form[kind], min: e.target.value } as never });
              }}
            />
          </label>
        </div>
      ))}
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%" }}
        onClick={() => {
          const typed = KINDS.flatMap(({ kind }) => [
            form[kind]?.estimate ?? "0",
            form[kind]?.min ?? "0",
          ]);
          if (!typed.every(isFigure)) {
            setError("Revisá las horas: solo cifras, sin letras ni signos.");
            return;
          }
          setError(null);
          const importDefaults = Object.fromEntries(
            KINDS.map(({ kind }) => {
              // At most 200 h: more would not even fit a backup.
              const estimate = Math.min(200 * 60, fromHours(form[kind]?.estimate ?? "0"));
              return [
                kind,
                {
                  estimate,
                  min: Math.min(estimate, fromHours(form[kind]?.min ?? "0")),
                  priority: current(kind).priority,
                },
              ];
            }),
          );
          dispatch({ type: "preferences", preferences: { ...data.preferences, importDefaults } });
          // Show what was saved: 2000 h becomes 200, a minimum above the hours becomes them.
          setForm(
            Object.fromEntries(
              KINDS.map(({ kind }) => [
                kind,
                {
                  estimate: toHours(importDefaults[kind]?.estimate ?? 0),
                  min: toHours(importDefaults[kind]?.min ?? 0),
                },
              ]),
            ),
          );
          toast.show("Horas guardadas");
        }}
      >
        Guardar horas
      </button>
      {error && (
        <p className="meta" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
      <button
        type="button"
        className="btn"
        style={{ width: "100%", marginTop: 8 }}
        onClick={() => dispatch({ type: "resetDetected" })}
      >
        Volver todo lo detectado a estas horas
      </button>
    </Section>
  );
}

/** Per-subject colour and study rules. */
export function ActivitySettings() {
  const { data } = useStore();
  return (
    <Section>
      <p className="meta">Cada una tiene su color en la semana y en los silos.</p>
      {data.activities.map((a) => (
        <ActivityRow key={a.id} activity={a} />
      ))}
    </Section>
  );
}

function ActivityRow({ activity }: { activity: Activity }) {
  const { data, now, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [startAfter, setStartAfter] = useState<Activity["startAfter"] | null>(activity.startAfter);
  const [form, setForm] = useState({
    name: activity.name,
    color: activity.color,
    academic: activity.academic,
    max: String(activity.maxSessionMinutes),
    min: String(activity.minBlockMinutes),
    from: activity.preferred ? minutesToHhmm(activity.preferred.start) : "",
    to: activity.preferred ? minutesToHhmm(activity.preferred.end) : "",
    study: String(activity.studyMinutes ?? DEFAULT_STUDY_MINUTES),
    rest: String(activity.breakMinutes ?? (activity.academic ? DEFAULT_BREAK_MINUTES : 0)),
  });
  const taken = new Set(
    data.activities.filter((a) => a.id !== activity.id).map((a) => a.color.toLowerCase()),
  );
  // A materia's weekly study is its weekly silo, if it has one.
  const study = studyOf(data, activity);
  const studyHours = study ? toHours(study.minMinutes) : "";
  const [weekly, setWeekly] = useState(studyHours);
  const studies = subjectsOf(data).some((a) => a.id === activity.id);
  const hours = Number(weekly.replace(",", "."));
  // Blank means none; at most a whole week.
  const hoursOk =
    !studies || weekly.trim() === "" || (Number.isFinite(hours) && hours >= 0 && hours <= 168);
  const maxSession = clampMinutes(form.max, 30, 480) ?? activity.maxSessionMinutes;
  const minBlock = clampMinutes(form.min, 30, 480) ?? activity.minBlockMinutes;
  // A minimum block longer than a session could never be planned, nor a window that ends
  // before it starts.
  const problem =
    minBlock > maxSession
      ? "El bloque mínimo no puede ser más largo que la sesión máxima."
      : form.from && form.to && hhmmToMinutes(form.from) >= hhmmToMinutes(form.to)
        ? "«Prefiero desde» tiene que ser antes de «hasta»."
        : null;
  return (
    <div className="activity-row">
      <button
        type="button"
        className="activity-head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="swatch" style={{ background: activity.color }} />
        {activity.name}
        {activity.kind && (
          <span className="meta" style={{ margin: 0 }}>
            {" "}
            · {activity.kind}
          </span>
        )}
        <span className="meta" style={{ margin: 0, marginLeft: "auto" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div>
          <label className="field">
            <span>Nombre</span>
            <input
              aria-label="Nombre de la materia"
              maxLength={60}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <fieldset className="swatches" aria-label="Color">
            {PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={form.color === c}
                // Another subject's colour would be silently reassigned on save.
                disabled={taken.has(c.toLowerCase())}
                aria-label={`Color ${c}${taken.has(c.toLowerCase()) ? " (ya usado)" : ""}`}
                className={`swatch big${form.color === c ? " on" : ""}${taken.has(c.toLowerCase()) ? " taken" : ""}`}
                style={{ background: c }}
                onClick={() => setForm({ ...form, color: c })}
              />
            ))}
          </fieldset>
          <div className="grid2">
            <Field
              label="Sesión máxima (min)"
              value={form.max}
              onChange={(e) => setForm({ ...form, max: e.target.value })}
            />
            <Field
              label="Bloque mínimo (min)"
              value={form.min}
              onChange={(e) => setForm({ ...form, min: e.target.value })}
            />
            <Field
              label="Estudio antes del descanso (min)"
              value={form.study}
              onChange={(e) => setForm({ ...form, study: e.target.value })}
            />
            <Field
              label="Descanso (min, 0 = sin)"
              value={form.rest}
              onChange={(e) => setForm({ ...form, rest: e.target.value })}
            />
            <Field
              label="Prefiero desde"
              type="time"
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
            <Field
              label="hasta"
              type="time"
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </div>
          {studies && (
            <Field
              label="Estudio semanal (h), además de las evaluaciones"
              value={weekly}
              onChange={(e) => setWeekly(e.target.value)}
            />
          )}
          {activity.kind !== "rutina" && (
            <>
              <StartAfterField
                label="Sus entregas y parciales, puedo empezarlos"
                value={startAfter}
                onChange={setStartAfter}
                tz={data.settings.timezone}
                now={now}
              />
              <p className="meta">
                Vale para todas sus tareas, salvo las que digan otra cosa. Antes de eso el plan no
                les da tiempo.
              </p>
            </>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={form.academic}
              onChange={(e) => setForm({ ...form, academic: e.target.checked })}
            />
            Es estudio (respeta «nada de estudio desde»)
          </label>
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%", marginTop: 10 }}
            disabled={!hoursOk || !!problem || startAfter === null}
            onClick={() => {
              dispatch({
                type: "saveActivity",
                activity: {
                  ...activity,
                  name: form.name.trim() || activity.name,
                  // Another form may have taken this colour meanwhile.
                  color: taken.has(form.color.toLowerCase())
                    ? nextColor(data.activities.filter((a) => a.id !== activity.id))
                    : form.color,
                  academic: form.academic,
                  maxSessionMinutes: maxSession,
                  minBlockMinutes: minBlock,
                  // Breaks live inside the block: a 50 + 10 hour plans 50 minutes of study.
                  studyMinutes: clampMinutes(form.study, 5, 240) ?? activity.studyMinutes,
                  breakMinutes: clampMinutes(form.rest, 0, 120) ?? activity.breakMinutes,
                  preferred:
                    form.from && form.to
                      ? { start: hhmmToMinutes(form.from), end: hhmmToMinutes(form.to) }
                      : undefined,
                  startAfter: activity.kind === "rutina" ? undefined : (startAfter ?? undefined),
                },
              });
              if (studies && weekly !== studyHours)
                dispatch({
                  type: "weeklyStudy",
                  activityId: activity.id,
                  minutes: Math.round(hours * 60),
                });
              // Reopened, it shows what was saved (20 and 25 minutes become 30 and 30, 999 of study 240).
              setForm({
                ...form,
                max: String(maxSession),
                min: String(minBlock),
                study: String(
                  clampMinutes(form.study, 5, 240) ?? activity.studyMinutes ?? form.study,
                ),
                rest: String(clampMinutes(form.rest, 0, 120) ?? activity.breakMinutes ?? form.rest),
              });
              setOpen(false);
            }}
          >
            Guardar {form.name}
          </button>
          {(problem || !hoursOk) && (
            <p className="meta" role="alert" style={{ color: "var(--critical)" }}>
              {problem ?? "El estudio semanal va de 0 a 168 h."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Routines like the gym: the plan places them N times a week; never a materia. */
export function Routines() {
  const { data, dispatch } = useStore();
  const routines = data.activities.filter((a) => a.kind === "rutina");
  const [name, setName] = useState("");
  const [times, setTimes] = useState("3");
  const [minutes, setMinutes] = useState("60");
  const habitOf = (id: string) =>
    data.tasks.find((t) => t.activityId === id && t.kind === "habit" && t.status === "active");
  const [detail, setDetail] = useState<AppTask | null>(null);
  // Two «Nadar» would be told apart by nothing.
  const repeated = data.activities.some(
    (a) => a.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  const [editing, setEditing] = useState<AppTask | null>(null);
  return (
    <Section>
      <p className="meta">
        Cosas como el gimnasio: sin parciales ni entregas, el plan les busca lugar las veces que
        digas por semana.
      </p>
      {routines.map((r) => {
        const h = habitOf(r.id);
        // A routine whose silo was deleted is gone from here too.
        if (!h) return null;
        return (
          <button
            key={r.id}
            type="button"
            className="check routine-row"
            aria-label={`${r.name}, ${h.sessionsPerWeek} por semana de ${h.sessionMinutes} min${h.paused ? ", pausada" : ""}: editar, pausar o eliminar`}
            onClick={() => setDetail(h)}
          >
            <span className="swatch" style={{ background: r.color }} />
            <span style={{ flex: 1 }}>{r.name}</span>
            <span className="meta" style={{ margin: 0 }}>
              {h.paused ? "pausada · " : ""}
              {h.sessionsPerWeek}× {h.sessionMinutes} min
            </span>
          </button>
        );
      })}
      {detail && (
        <TaskDetail
          task={detail}
          onClose={() => setDetail(null)}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
        />
      )}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
      <div className="row fields">
        <label className="field" style={{ flex: 2 }}>
          <span>Rutina</span>
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Gimnasio"
          />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Veces/sem.</span>
          <input inputMode="numeric" value={times} onChange={(e) => setTimes(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          <span>Minutos</span>
          <input inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
        </label>
      </div>
      <button
        type="button"
        className="btn"
        style={{ width: "100%" }}
        disabled={!name.trim() || repeated || !validRoutine(Number(times), Number(minutes))}
        onClick={() => {
          dispatch({
            type: "saveRoutine",
            name,
            sessionsPerWeek: Math.round(Number(times)),
            sessionMinutes: Math.round(Number(minutes)),
          });
          setName("");
        }}
      >
        Agregar rutina
      </button>
      {repeated && name.trim() && (
        <p className="meta">Ya hay una materia o rutina con ese nombre.</p>
      )}
    </Section>
  );
}
