import { useState } from "react";
import { DEFAULTS } from "../calendars.js";
import type { Activity, DaySettings, Meal, MealKind } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import { type DetectedKind, type Effort, nextColor, PALETTE } from "../model.js";
import { DEFAULT_BREAK_MINUTES, DEFAULT_STUDY_MINUTES, mealsOf } from "../planning.js";
import { useStore } from "../store.js";
import { studyOf, subjectsOf, validRoutine } from "../subjects.js";
import { Section } from "./Section.js";

const DAYS = ["D", "L", "M", "M", "J", "V", "S"];
/** For VoiceOver: two «M» would read alike. */
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

// Two decimals: every whole minute survives a save (105 min → 1.75 h → 105).
/** A whole number of minutes within [min, max] from a field, or undefined if not one. */
const clampMinutes = (v: string, min: number, max: number) => {
  const n = Math.round(Number(v));
  return v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : undefined;
};

const toHours = (m: number) => String(Math.round((m / 60) * 100) / 100);
const fromHours = (v: string) => Math.max(0, Math.round(Number(v.replace(",", ".")) * 60) || 0);

/** Fixed weekly routine: wake/bed, morning, meals and when study time ends, per weekday. */
export function WeekSettings() {
  const { data, dispatch } = useStore();
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const first = data.settings.week[days[0] ?? 1] as DaySettings;
  const [form, setForm] = useState(() => formOf(first));
  const [saved, setSaved] = useState(false);

  const pick = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length === 0) return;
    setDays(next);
    setForm(formOf(data.settings.week[next[0] as number] as DaySettings));
    setSaved(false);
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
  };

  const save = () => {
    const meal = (kind: MealKind, at: string, minutes: string): Meal => ({
      kind,
      start: hhmmToMinutes(at),
      end: hhmmToMinutes(at) + Math.max(0, Number(minutes) || 0),
    });
    const meals = [
      meal("desayuno", form.breakfast, form.breakfastMin),
      meal("almuerzo", form.lunch, form.lunchMin),
      meal("cena", form.dinner, form.dinnerMin),
    ].filter((m) => m.end > m.start);
    const day: DaySettings = {
      wake: hhmmToMinutes(form.wake),
      morningMinutes: Math.max(0, Number(form.morning) || 0),
      bed: hhmmToMinutes(form.bed),
      meals,
      freeFrom: hhmmToMinutes(form.freeFrom),
    };
    const week = data.settings.week.map((d, i) => (days.includes(i) ? day : d));
    dispatch({ type: "settings", settings: { ...data.settings, week } });
    // Show what was saved (a negative morning becomes 0).
    setForm({ ...form, morning: String(day.morningMinutes) });
    setSaved(true);
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
        <Field label="Dura (min)" value={form.breakfastMin} onChange={set("breakfastMin")} />
        <Field label="Almuerzo" type="time" value={form.lunch} onChange={set("lunch")} />
        <Field label="Dura (min)" value={form.lunchMin} onChange={set("lunchMin")} />
        <Field label="Cena" type="time" value={form.dinner} onChange={set("dinner")} />
        <Field label="Dura (min)" value={form.dinnerMin} onChange={set("dinnerMin")} />
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
        {minutesToHhmm(hhmmToMinutes(form.wake) + (Number(form.morning) || 0))}
        {[form.breakfastMin, form.lunchMin, form.dinnerMin].some((m) => Number(m) > 0)
          ? ""
          : " (sin comidas cargadas)"}
        .
      </p>
      <p className="meta">
        Nunca va estudio encima de una comida. Si un evento fijo o un bloque 📌 cae a esa hora, la
        comida se corre sola al hueco más cercano, hasta 1 h 30 antes o después. Con duración 0 no
        hay esa comida.
      </p>
      <button type="button" className="btn primary" style={{ width: "100%" }} onClick={save}>
        {saved
          ? "Guardado ✓"
          : `Guardar para ${days.length === 7 ? "todos los días" : days.map((d) => DAYS[d]).join(" ")}`}
      </button>
    </Section>
  );
}

function formOf(d: DaySettings) {
  const meals = mealsOf(d);
  const [breakfast, lunch, dinner] = (["desayuno", "almuerzo", "cena"] as const).map((k) =>
    meals.find((m) => m.kind === k),
  );
  return {
    wake: minutesToHhmm(d.wake),
    morning: String(d.morningMinutes ?? 0),
    breakfast: minutesToHhmm(breakfast?.start ?? d.wake),
    breakfastMin: String(breakfast ? breakfast.end - breakfast.start : 0),
    lunch: minutesToHhmm(lunch?.start ?? 780),
    lunchMin: String(lunch ? lunch.end - lunch.start : 0),
    dinner: minutesToHhmm(dinner?.start ?? 1260),
    dinnerMin: String(dinner ? dinner.end - dinner.start : 0),
    freeFrom: minutesToHhmm(d.freeFrom),
    bed: minutesToHhmm(d.bed),
  };
}

function Field({
  label,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={type}
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
  const [saved, setSaved] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setSaved(false);
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
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%" }}
        onClick={() => {
          dispatch({
            type: "settings",
            settings: {
              ...s,
              maxActivitiesPerDay: Math.max(1, Number(form.maxActivities) || 1),
              travelMarginMinutes: Math.max(0, Number(form.margin) || 0),
              warnSlackMinutes: fromHours(form.warn),
            },
          });
          setSaved(true);
        }}
      >
        {saved ? "Guardado ✓" : "Guardar reglas"}
      </button>
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
  const [saved, setSaved] = useState(false);
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
                setSaved(false);
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
                setSaved(false);
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
          const importDefaults = Object.fromEntries(
            KINDS.map(({ kind }) => {
              const estimate = fromHours(form[kind]?.estimate ?? "0");
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
          setSaved(true);
        }}
      >
        {saved ? "Guardado ✓" : "Guardar"}
      </button>
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
  const { data, dispatch } = useStore();
  const [open, setOpen] = useState(false);
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
            disabled={!hoursOk}
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
                  maxSessionMinutes: Math.max(30, Number(form.max) || activity.maxSessionMinutes),
                  minBlockMinutes: Math.max(30, Number(form.min) || activity.minBlockMinutes),
                  // Breaks live inside the block: a 50 + 10 hour plans 50 minutes of study.
                  studyMinutes: clampMinutes(form.study, 5, 240) ?? activity.studyMinutes,
                  breakMinutes: clampMinutes(form.rest, 0, 120) ?? activity.breakMinutes,
                  preferred:
                    form.from && form.to
                      ? { start: hhmmToMinutes(form.from), end: hhmmToMinutes(form.to) }
                      : undefined,
                },
              });
              if (studies && weekly !== studyHours)
                dispatch({
                  type: "weeklyStudy",
                  activityId: activity.id,
                  minutes: Math.round(hours * 60),
                });
              setOpen(false);
            }}
          >
            Guardar {form.name}
          </button>
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
  return (
    <Section>
      <p className="meta">
        Cosas como el gimnasio: sin parciales ni entregas, el plan les busca lugar las veces que
        digas por semana.
      </p>
      {routines.map((r) => {
        const h = habitOf(r.id);
        return (
          <div key={r.id} className="check">
            <span className="swatch" style={{ background: r.color }} />
            <span style={{ flex: 1 }}>{r.name}</span>
            {h && (
              <span className="meta" style={{ margin: 0 }}>
                {h.sessionsPerWeek}× {h.sessionMinutes} min
              </span>
            )}
          </div>
        );
      })}
      <div className="row fields">
        <label className="field" style={{ flex: 2 }}>
          <span>Rutina</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Gimnasio" />
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
        disabled={!name.trim() || !validRoutine(Number(times), Number(minutes))}
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
    </Section>
  );
}
