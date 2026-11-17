import { useState } from "react";
import { DEFAULTS } from "../calendars.js";
import { useDraft } from "../drafts.js";
import type { DaySettings, Meal, MealKind } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import type { AppTask, DetectedKind, Effort } from "../model.js";
import { MEAL_NAMES, mealsOf } from "../planning.js";
import { useStore } from "../store.js";
import { sameName, validRoutine } from "../subjects.js";
import { clampMinutes, Field, fromHours, isFigure, toHours, Unsaved } from "./fields.js";
import { Section } from "./Section.js";
import { TaskDetail } from "./TaskDetail.js";
import { TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";

const DAYS = ["D", "L", "M", "M", "J", "V", "S"];
/** For VoiceOver: two «M» would read alike. */
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

/** Fixed weekly routine: wake/bed, morning, meals and when study time ends, per weekday. */
export function WeekSettings() {
  const { data, dispatch } = useStore();
  const [{ days, form, held }, setDraft, saved, dirty] = useDraft("week", () => ({
    days: [1, 2, 3, 4, 5],
    form: formOf(data.settings.week[1] as DaySettings),
    // What was typed for days no longer selected, kept until saved.
    held: {} as Record<number, ReturnType<typeof formOf>>,
  }));
  const setForm = (f: typeof form) => setDraft({ days, form: f, held });
  const toast = useToast();

  const pick = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length === 0) return;
    setDraft(switchDays({ days, form, held }, next, data.settings.week));
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
  };

  const [failure, setFailure] = useState<{
    message: string | null;
    /** The field a minutes error is about, so its input says it is invalid. */
    field: string | null;
    /** The form it was found in: any change to the form (or the days) clears it. */
    form: typeof form;
  } | null>(null);
  const setError = (message: string | null) =>
    setFailure(message ? { message, field: null, form } : null);
  const current = failure?.form === form ? failure : null;
  const error = current?.message ?? null;
  const badField = current?.field ?? null;
  const save = () => {
    const meal = (kind: MealKind, at: string, minutes: string): Meal => ({
      kind,
      start: hhmmToMinutes(at),
      // At most 4 h: a 99999-minute breakfast would not even fit a backup.
      end: hhmmToMinutes(at) + (clampMinutes(minutes, 0, 240) ?? 0),
    });
    // A figure out of range would be corrected without a word (−20 → 0, 999 → 240).
    const badMinutes = (
      [
        ["Arreglarse, traslado (min)", form.morning],
        ["Dura (min), desayuno", form.breakfastMin],
        ["Dura (min), almuerzo", form.lunchMin],
        ["Dura (min), merienda", form.snackMin],
        ["Dura (min), cena", form.dinnerMin],
      ] as const
    ).find(([, v]) => {
      if (v.trim() === "") return false;
      // The figure as typed, not rounded: «240,4» is out of range too.
      if (!isFigure(v)) return true;
      const n = Number(v.replace(",", "."));
      return !Number.isFinite(n) || n < 0 || n > 240;
    });
    if (badMinutes) {
      setFailure({
        message: `«${badMinutes[0]}» tiene que ser un número de minutos entre 0 y 240.`,
        field: badMinutes[0],
        form,
      });
      return;
    }
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
    saved({
      days,
      // The days just saved no longer wait for anything.
      held: Object.fromEntries(Object.entries(held).filter(([d]) => !days.includes(Number(d)))),
      form: {
        ...form,
        morning: String(day.morningMinutes),
        breakfastMin: shown(meals.find((m) => m.kind === "desayuno")),
        lunchMin: shown(meals.find((m) => m.kind === "almuerzo")),
        snackMin: shown(meals.find((m) => m.kind === "merienda")),
        dinnerMin: shown(meals.find((m) => m.kind === "cena")),
      },
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
        <Field
          label="Arreglarse, traslado (min)"
          value={form.morning}
          onChange={set("morning")}
          invalid={badField === "Arreglarse, traslado (min)"}
        />
        <Field label="Desayuno" type="time" value={form.breakfast} onChange={set("breakfast")} />
        <Field
          label="Dura (min)"
          name="Dura (min), desayuno"
          value={form.breakfastMin}
          onChange={set("breakfastMin")}
          invalid={badField === "Dura (min), desayuno"}
        />
        <Field label="Almuerzo" type="time" value={form.lunch} onChange={set("lunch")} />
        <Field
          label="Dura (min)"
          name="Dura (min), almuerzo"
          value={form.lunchMin}
          onChange={set("lunchMin")}
          invalid={badField === "Dura (min), almuerzo"}
        />
        <Field label="Merienda" type="time" value={form.snack} onChange={set("snack")} />
        <Field
          label="Dura (min)"
          name="Dura (min), merienda"
          value={form.snackMin}
          onChange={set("snackMin")}
          invalid={badField === "Dura (min), merienda"}
        />
        <Field label="Cena" type="time" value={form.dinner} onChange={set("dinner")} />
        <Field
          label="Dura (min)"
          name="Dura (min), cena"
          value={form.dinnerMin}
          onChange={set("dinnerMin")}
          invalid={badField === "Dura (min), cena"}
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
      {dirty && <Unsaved />}
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
        <p id="week-error" className="meta" role="alert" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </Section>
  );
}

type WeekForm = ReturnType<typeof formOf>;
interface WeekDraft {
  days: number[];
  form: WeekForm;
  held: Record<number, WeekForm>;
}

/**
 * Moves to another selection of days without losing what was typed: the form of a day
 * left behind is held (only if it differs from what is saved) and comes back with it. The
 * days that stay selected keep sharing the form.
 */
export function switchDays(draft: WeekDraft, next: number[], week: DaySettings[]): WeekDraft {
  const held = { ...draft.held };
  for (const d of draft.days.filter((x) => !next.includes(x))) {
    if (JSON.stringify(draft.form) === JSON.stringify(formOf(week[d] as DaySettings)))
      delete held[d];
    else held[d] = draft.form;
  }
  const first = next[0] as number;
  const stays = next.some((d) => draft.days.includes(d));
  const form = stays ? draft.form : (held[first] ?? formOf(week[first] as DaySettings));
  return { days: next, held, form };
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

/** The rule fields as typed, and the first one that is not a valid value (nothing is fixed silently). */
function ruleProblem(form: {
  maxActivities: string;
  margin: string;
  warn: string;
}): { field: keyof typeof form; message: string } | null {
  const whole = (v: string, min: number, max: number) =>
    /^\s*\d+\s*$/.test(v) && Number(v) >= min && Number(v) <= max;
  if (!whole(form.maxActivities, 1, 10))
    return {
      field: "maxActivities",
      message: "Las materias por día son un número entero de 1 a 10.",
    };
  if (!whole(form.margin, 0, 240))
    return { field: "margin", message: "El margen son minutos enteros, de 0 a 240." };
  if (!isFigure(form.warn) || Number(form.warn.replace(",", ".")) > 168)
    return {
      field: "warn",
      message: "El aviso va de 0 a 168 horas, solo cifras (se aceptan decimales).",
    };
  return null;
}

export function RuleSettings() {
  const { data, dispatch } = useStore();
  const s = data.settings;
  const [form, setForm, saved, dirty] = useDraft("rules", () => ({
    maxActivities: String(s.maxActivitiesPerDay),
    margin: String(s.travelMarginMinutes),
    warn: toHours(s.warnSlackMinutes),
  }));
  const toast = useToast();
  const [problem, setProblem] = useState<ReturnType<typeof ruleProblem>>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
    setProblem(null);
  };
  const save = () => {
    // Plain figures in range only: «2.5», «1e2» or «0,5» are refused, not guessed.
    const bad = ruleProblem(form);
    setProblem(bad);
    if (bad) return;
    const max = Number(form.maxActivities);
    const margin = Number(form.margin);
    const warn = fromHours(form.warn);
    dispatch({
      type: "settings",
      settings: {
        ...s,
        maxActivitiesPerDay: max,
        travelMarginMinutes: margin,
        warnSlackMinutes: warn,
      },
    });
    saved({ maxActivities: String(max), margin: String(margin), warn: toHours(warn) });
    toast.show("Reglas guardadas");
  };
  const field = (k: keyof typeof form, label: string) => (
    <Field
      label={label}
      value={form[k]}
      onChange={set(k)}
      invalid={problem?.field === k}
      errorId="rules-error"
    />
  );
  return (
    <Section>
      <div className="grid2">
        {field("maxActivities", "Máximo de materias por día")}
        {field("margin", "Margen antes de cada evento (min)")}
        {field("warn", "Avisar cuando el margen baja de (h)")}
      </div>
      {problem && (
        <p id="rules-error" className="meta" role="alert" style={{ color: "var(--critical)" }}>
          {problem.message}
        </p>
      )}
      {dirty && <Unsaved />}
      <button type="button" className="btn primary" style={{ width: "100%" }} onClick={save}>
        Guardar reglas
      </button>
      <p className="meta">
        De 1 a 10 materias por día, margen de hasta 240 min y aviso de hasta 168 h.
      </p>
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
  const [form, setForm, saved, dirty] = useDraft("detected", () =>
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
      {dirty && <Unsaved />}
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
          saved(
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

/** Routines like the gym: the plan places them N times a week; never a materia. */
export function Routines() {
  const { data, dispatch } = useStore();
  const routines = data.activities.filter((a) => a.kind === "rutina");
  const [draft, setDraft, drafted, dirty] = useDraft("routines", () => ({
    name: "",
    times: "3",
    minutes: "60",
  }));
  const { name, times, minutes } = draft;
  const setName = (v: string) => setDraft({ ...draft, name: v });
  const setTimes = (v: string) => setDraft({ ...draft, times: v });
  const setMinutes = (v: string) => setDraft({ ...draft, minutes: v });
  const habitOf = (id: string) =>
    data.tasks.find((t) => t.activityId === id && t.kind === "habit" && t.status === "active");
  const [detail, setDetail] = useState<AppTask | null>(null);
  // Two «Nadar» would be told apart by nothing.
  const repeated = data.activities.some((a) => sameName(a.name, name));
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
      {dirty && <Unsaved />}
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
          drafted({ ...draft, name: "" });
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

export { ActivitySettings } from "./Subjects.js";
export { isFigure };
