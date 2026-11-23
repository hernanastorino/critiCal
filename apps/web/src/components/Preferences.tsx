import { useEffect, useRef, useState } from "react";
import { DEFAULTS } from "../calendars.js";
import { awakeProblem } from "../dayLength.js";
import { useDraft } from "../drafts.js";
import type { DaySettings, Meal, MealKind } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm, parseClock } from "../format.js";
import { isBlank, stripBidi } from "../limits.js";
import type { AppTask, DetectedKind, Effort } from "../model.js";
import { MEAL_NAMES, mealsOf } from "../planning.js";
import { describeHours, emptyHoursForm, type HoursForm, readHours } from "../routineHours.js";
import { useStore } from "../store.js";
import { sameName, validRoutine } from "../subjects.js";
import { detectedProblem, detectedToReset } from "../taskForm.js";
import { clockText, weekMinutesProblem } from "../weekForm.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import {
  clampMinutes,
  describedBy,
  Field,
  focusFirstInvalid,
  fromHours,
  Help,
  isFigure,
  isWhole,
  Problem,
  toHours,
  Unsaved,
  useFocusInvalid,
} from "./fields.js";
import { hoursSummary, RoutineHours } from "./RoutineHours.js";
import { Section } from "./Section.js";
import { TaskDetail } from "./TaskDetail.js";
import { editorDraft, TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";
import { PLAN_KEYS, useUndoable } from "./useUndoable.js";

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
  const askFocus = useFocusInvalid();

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
    field: string | string[] | null;
    /** The form it was found in: any change to the form (or the days) clears it. */
    form: typeof form;
  } | null>(null);
  const setError = (message: string | null) =>
    setFailure(message ? { message, field: null, form } : null);
  const current = failure?.form === form ? failure : null;
  const error = current?.message ?? null;
  const badField = current?.field ?? null;
  const isBad = (name: string) =>
    Array.isArray(badField) ? badField.includes(name) : badField === name;
  const save = () => {
    const meal = (kind: MealKind, at: string, minutes: string): Meal => ({
      kind,
      start: hhmmToMinutes(at),
      // At most 4 h: a 99999-minute breakfast would not even fit a backup.
      end: hhmmToMinutes(at) + (clampMinutes(minutes, 0, 240) ?? 0),
    });
    const badMinutes = weekMinutesProblem(form);
    if (badMinutes) {
      setFailure({ ...badMinutes, form });
      return;
    }
    // A time that is not one (a blank or impossible hour) would be read as midnight.
    const badTime = (
      [
        ["Me levanto", form.wake, "1"],
        ["Me acuesto", form.bed, "1"],
        ["Nada de estudio desde", form.freeFrom, "1"],
        ["Desayuno", form.breakfast, form.breakfastMin],
        ["Almuerzo", form.lunch, form.lunchMin],
        ["Merienda", form.snack, form.snackMin],
        ["Cena", form.dinner, form.dinnerMin],
      ] as const
    ).find(([, v, minutes]) => Number(minutes) > 0 && parseClock(v) === null);
    if (badTime) {
      setFailure({ message: "Hora inválida.", field: badTime[0], form });
      return;
    }
    const wake = hhmmToMinutes(form.wake);
    const bed = hhmmToMinutes(form.bed);
    if (wake === bed) {
      setError("Me levanto y me acuesto no pueden ser a la misma hora.");
      return;
    }
    // Going to bed after midnight: what comes after midnight belongs to the same day
    // (dinner at 00:45 is 24:45, not this morning).
    const late = (m: number) => (bed < wake && m < wake ? m + 1440 : m);
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
    // Between waking up and going to bed (after midnight, the gap is the hours of sleep).
    const free = hhmmToMinutes(form.freeFrom);
    if (bed < wake ? free > bed && free < wake : free < wake) {
      setFailure({
        message: `«Nada de estudio desde» (${form.freeFrom}) cae antes de que te levantes (${form.wake}).`,
        field: "Nada de estudio desde",
        form,
      });
      return;
    }
    // Breakfast, lunch, snack and dinner in that order (the later one never before).
    const inOrder = meals.map((m) => ({ ...m, at: m.start < wake ? m.start + 1440 : m.start }));
    const early = inOrder.find((m, i) => i > 0 && m.at < (inOrder[i - 1] as { at: number }).at);
    if (early?.kind) {
      const before = inOrder[inOrder.indexOf(early) - 1];
      setFailure({
        message: `${MEAL_NAMES[early.kind]} (${minutesToHhmm(early.start)}) no puede ir antes que ${before?.kind ? MEAL_NAMES[before.kind].toLowerCase() : "la comida anterior"} (${minutesToHhmm(before?.start ?? 0)}): las comidas van en orden, de desayuno a cena.`,
        field: (
          {
            desayuno: "Desayuno",
            almuerzo: "Almuerzo",
            merienda: "Merienda",
            cena: "Cena",
          } as const
        )[early.kind],
        form,
      });
      return;
    }
    // The same day «Hoy» and a backup take: awake 4 to 22 h (said after what is about the
    // meals and the free time, which fall asleep first in a day that is not one).
    const tooLong = awakeProblem(form.wake, form.bed);
    if (tooLong) {
      setFailure({ message: tooLong, field: ["Me levanto", "Me acuesto"], form });
      return;
    }
    setError(null);
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
        // Times typed as «7» or «7:5» are shown as saved.
        wake: clockText(form.wake),
        bed: clockText(form.bed),
        freeFrom: clockText(form.freeFrom),
        breakfast: clockText(form.breakfast),
        lunch: clockText(form.lunch),
        snack: clockText(form.snack),
        dinner: clockText(form.dinner),
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
        <Field
          label="Me levanto"
          type="time"
          value={form.wake}
          onChange={set("wake")}
          invalid={isBad("Me levanto")}
        />
        <Field
          label="Arreglarse, traslado (min)"
          help="Desde que te levantás hasta que podés empezar a estudiar."
          value={form.morning}
          onChange={set("morning")}
          invalid={badField === "Arreglarse, traslado (min)"}
        />
        <Field
          label="Desayuno"
          type="time"
          value={form.breakfast}
          onChange={set("breakfast")}
          invalid={badField === "Desayuno"}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), desayuno"
          value={form.breakfastMin}
          onChange={set("breakfastMin")}
          invalid={badField === "Dura (min), desayuno"}
        />
        <Field
          label="Almuerzo"
          type="time"
          value={form.lunch}
          onChange={set("lunch")}
          invalid={badField === "Almuerzo"}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), almuerzo"
          value={form.lunchMin}
          onChange={set("lunchMin")}
          invalid={badField === "Dura (min), almuerzo"}
        />
        <Field
          label="Merienda"
          type="time"
          value={form.snack}
          onChange={set("snack")}
          invalid={badField === "Merienda"}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), merienda"
          value={form.snackMin}
          onChange={set("snackMin")}
          invalid={badField === "Dura (min), merienda"}
        />
        <Field
          label="Cena"
          type="time"
          value={form.dinner}
          onChange={set("dinner")}
          invalid={badField === "Cena"}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), cena"
          value={form.dinnerMin}
          onChange={set("dinnerMin")}
          invalid={badField === "Dura (min), cena"}
        />
        <Field
          label="Nada de estudio desde"
          help="Después de esta hora no se planifica estudio."
          type="time"
          value={form.freeFrom}
          onChange={set("freeFrom")}
          invalid={badField === "Nada de estudio desde"}
        />
        <Field
          label="Me acuesto"
          type="time"
          value={form.bed}
          onChange={set("bed")}
          invalid={isBad("Me acuesto")}
        />
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
        bloque fijado cae a esa hora, la comida se corre sola al hueco más cercano, hasta 1 h 30
        antes o después; si no hay ninguno, queda a su hora encima de lo que haya y la Bandeja
        avisa. Con duración 0 no hay esa comida (la merienda viene en 0).
      </p>
      {dirty && <Unsaved />}
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%" }}
        // «Guardar para L M M J V» reads as loose letters: VoiceOver gets the day names.
        aria-label={`Guardar para ${days.length === 7 ? "todos los días" : days.map((d) => DAY_NAMES[d]).join(", ")}`}
        onClick={(e) => {
          save();
          askFocus(e.currentTarget);
        }}
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
  const askFocus = useFocusInvalid();
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
  const field = (k: keyof typeof form, label: string, help: string) => (
    <Field
      label={label}
      help={help}
      value={form[k]}
      onChange={set(k)}
      invalid={problem?.field === k}
      errorId="rules-error"
    />
  );
  return (
    <Section>
      <div className="grid2">
        {field(
          "maxActivities",
          "Máximo de materias por día",
          "Cuántas materias distintas entran en un mismo día.",
        )}
        {field(
          "margin",
          "Margen antes de cada evento (min)",
          "Se suma al traslado para llegar con tiempo.",
        )}
        {field(
          "warn",
          "Avisar cuando el margen baja de (h)",
          "El margen es el tiempo que te sobra para cumplir una entrega.",
        )}
      </div>
      {problem && (
        <p id="rules-error" className="meta" role="alert" style={{ color: "var(--critical)" }}>
          {problem.message}
        </p>
      )}
      {dirty && <Unsaved />}
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%" }}
        onClick={(e) => {
          save();
          askFocus(e.currentTarget);
        }}
      >
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
  const toast = useToast();
  const answer = useUndoable();
  const ask = useFocusInvalid();
  const problems = Object.fromEntries(
    KINDS.map(({ kind }) => [
      kind,
      detectedProblem(form[kind]?.estimate ?? "0", form[kind]?.min ?? "0"),
    ]),
  );
  const save = (button: HTMLElement) => {
    if (KINDS.some(({ kind }) => problems[kind])) {
      ask(button);
      return;
    }
    const importDefaults = Object.fromEntries(
      KINDS.map(({ kind }) => [
        kind,
        {
          estimate: fromHours(form[kind]?.estimate ?? "0"),
          min: fromHours(form[kind]?.min ?? "0"),
          priority: current(kind).priority,
        },
      ]),
    );
    dispatch({ type: "preferences", preferences: { ...data.preferences, importDefaults } });
    saved(form);
    toast.show("Horas guardadas");
  };
  const resetDetected = () => {
    const n = detectedToReset(data);
    if (n === 0) {
      dispatch({ type: "resetDetected" });
      toast.show("No hay nada detectado para cambiar");
      return;
    }
    answer(
      `${n} ${n === 1 ? "tarea detectada vuelve" : "tareas detectadas vuelven"} a estas horas`,
      { type: "resetDetected" },
      PLAN_KEYS,
      { tasks: data.tasks.filter((t) => t.sourceEventId) },
    );
  };
  return (
    <Section>
      <p className="meta">
        Cuánto le planifico a cada evento nuevo de tus calendarios hasta que lo ajustes.
      </p>
      {KINDS.map(({ kind, label }) => {
        const problem = problems[kind];
        const set = (key: "estimate" | "min", value: string) =>
          setForm({ ...form, [kind]: { ...form[kind], [key]: value } as never });
        return (
          <div key={kind}>
            <div className="grid3">
              <span className="grid3-label">{label}</span>
              <label className="field">
                <span>Horas</span>
                <input
                  inputMode="decimal"
                  aria-label={`Horas de ${label}`}
                  value={form[kind]?.estimate}
                  aria-invalid={problem?.field === "estimate" ? true : undefined}
                  aria-describedby={problem?.field === "estimate" ? `detected-${kind}` : undefined}
                  onChange={(e) => set("estimate", e.target.value)}
                />
              </label>
              <label className="field">
                <span>Mínimo</span>
                <input
                  inputMode="decimal"
                  aria-label={`Mínimo de ${label}`}
                  value={form[kind]?.min}
                  aria-invalid={problem?.field === "min" ? true : undefined}
                  aria-describedby={problem?.field === "min" ? `detected-${kind}` : undefined}
                  onChange={(e) => set("min", e.target.value)}
                />
              </label>
            </div>
            <Problem id={`detected-${kind}`} text={problem?.text ?? null} />
          </div>
        );
      })}
      {dirty && <Unsaved />}
      <button
        type="button"
        className="btn primary"
        style={{ width: "100%" }}
        onClick={(e) => save(e.currentTarget)}
      >
        Guardar horas
      </button>
      <button
        type="button"
        className="btn"
        style={{ width: "100%", marginTop: 8 }}
        onClick={resetDetected}
      >
        Volver todo lo detectado a estas horas
      </button>
    </Section>
  );
}

/** What is wrong with the times a week and the minutes of a routine, each in its own field. */
function routineProblems(times: string, minutes: string) {
  // «3.5» is not rounded to 4 behind the back: whole numbers only.
  const t = isWhole(times) ? Number(times) : Number.NaN;
  const m = isWhole(minutes) ? Number(minutes) : Number.NaN;
  const timesBad = !Number.isFinite(t) || t < 1 || t > 14;
  const minutesBad = !Number.isFinite(m) || m < 1 || m > 360;
  const decimals = (v: string) => isFigure(v) && !isWhole(v);
  return {
    times: decimals(times)
      ? "Las veces por semana: solo números enteros, de 1 a 14."
      : timesBad
        ? "Las veces por semana van de 1 a 14."
        : !minutesBad && !validRoutine(t, m)
          ? "Eso suma más de 40 h por semana."
          : null,
    minutes: decimals(minutes)
      ? "Los minutos por sesión: solo números enteros, de 1 a 360."
      : minutesBad
        ? "Los minutos por sesión van de 1 a 360."
        : null,
  };
}

/** Routines like the gym: the plan places them N times a week; never a materia. */
export function Routines() {
  const { data, dispatch } = useStore();
  const routines = data.activities.filter((a) => a.kind === "rutina");
  const [draft, setDraft, drafted, dirty] = useDraft("routines", () => ({
    name: "",
    times: "3",
    minutes: "60",
    hours: emptyHoursForm(),
  }));
  const { name, times, minutes, hours } = draft;
  // The list of routines and the form of a new one are two views of the same sheet; a draft
  // waiting from before (a reload) opens straight on the form.
  const [creating, setCreating] = useState(dirty);
  const [leaving, setLeaving] = useState(false);
  const createButton = useRef<HTMLButtonElement>(null);
  const setName = (v: string) => setDraft({ ...draft, name: v });
  const setTimes = (v: string) => setDraft({ ...draft, times: v });
  const setMinutes = (v: string) => setDraft({ ...draft, minutes: v });
  const setHours = (v: HoursForm) => setDraft({ ...draft, hours: v });
  const habitOf = (id: string) =>
    data.tasks.find((t) => t.activityId === id && t.kind === "habit" && t.status === "active");
  const [detail, setDetail] = useState<AppTask | null>(null);
  // Two «Nadar» would be told apart by nothing.
  const repeated = data.activities.some((a) => sameName(a.name, name));
  const [editing, setEditing] = useState<AppTask | null>(() => {
    const d = editorDraft("preferences");
    return (d && data.tasks.find((t) => t.id === d.taskId)) || null;
  });
  const problem = routineProblems(times, minutes);
  // A franja shorter than the session is said once the session is a valid figure.
  const read = readHours(
    hours,
    problem.minutes ? undefined : Number(minutes),
    data.settings.slotMinutes,
  );
  const bad = !!(problem.times || problem.minutes || read.problems.length);
  const nameField = useRef<HTMLInputElement>(null);
  // Nothing readable in the name (spaces, zero-width characters): said when typed or tried.
  const [nameTried, setNameTried] = useState(false);
  const blank = isBlank(name) && (name !== "" || nameTried);
  const askFocus = useFocusInvalid();
  // The button and Enter in any field do the same: a wrong field is said, not added.
  const add = (form: Element | null) => {
    if (isBlank(name)) {
      setNameTried(true);
      askFocus(form?.querySelector(".fields") ?? null);
      return;
    }
    if (repeated) return;
    if (bad) {
      focusFirstInvalid(form);
      return;
    }
    dispatch({
      type: "saveRoutine",
      name,
      sessionsPerWeek: Math.round(Number(times)),
      sessionMinutes: Math.round(Number(minutes)),
      validHours: read.hours,
    });
    // Back to the defaults: the next routine does not inherit this one's figures.
    drafted({ name: "", times: "3", minutes: "60", hours: emptyHoursForm() });
    // Back to the list, where the new routine now is.
    setCreating(false);
  };
  // Back on the list (saved or left), the keyboard lands on the button that opened the form.
  const wasCreating = useRef(creating);
  useEffect(() => {
    if (wasCreating.current && !creating) createButton.current?.focus();
    wasCreating.current = creating;
  }, [creating]);
  const leave = () => {
    if (dirty) setLeaving(true);
    else setCreating(false);
  };
  const onEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    add(e.currentTarget.closest(".fields")?.parentElement ?? null);
  };
  const list = (
    <>
      <p className="meta">
        Cosas como el gimnasio: sin parciales ni entregas, el plan les busca lugar las veces que
        digas por semana.
      </p>
      {!routines.some((r) => habitOf(r.id)) && (
        <p className="meta" id="routines-empty">
          Todavía no tenés rutinas. Creá la primera con el botón de abajo.
        </p>
      )}
      {routines.map((r) => {
        const h = habitOf(r.id);
        // A routine whose silo was deleted is gone from here too.
        if (!h) return null;
        return (
          <button
            key={r.id}
            type="button"
            data-task={h.id}
            className="check routine-row"
            aria-label={`${r.name}, ${h.sessionsPerWeek} por semana de ${h.sessionMinutes} min${h.paused ? ", pausada" : ""}: editar, pausar o eliminar`}
            onClick={() => setDetail(h)}
          >
            <span className="swatch" style={{ background: r.color }} />
            {/* A long description wraps; the name never shrinks to a letter per line. */}
            <span style={{ flex: 1, minWidth: "35%" }}>{r.name}</span>
            <span className="meta" style={{ margin: 0 }}>
              {h.paused ? "pausada · " : ""}
              {h.sessionsPerWeek}× {h.sessionMinutes} min
              {r.validHours ? ` · ${describeHours(r.validHours)}` : ""}
            </span>
          </button>
        );
      })}
      <button
        ref={createButton}
        type="button"
        className="btn"
        style={{ width: "100%" }}
        onClick={() => setCreating(true)}
      >
        Crear rutina nueva
      </button>
    </>
  );
  const form = (
    <>
      <button type="button" className="settings-back" onClick={leave}>
        ‹ Rutinas
      </button>
      <h3>Rutina nueva</h3>
      <div className="row fields top wrap-big">
        <label className="field name-wide" style={{ flex: 2 }}>
          <span>Rutina</span>
          <input
            ref={nameField}
            value={name}
            maxLength={60}
            aria-invalid={blank || (repeated && name.trim()) ? true : undefined}
            aria-describedby={
              blank
                ? "routine-blank-error"
                : repeated && name.trim()
                  ? "routine-name-error"
                  : undefined
            }
            onChange={(e) => {
              // Direction-changing characters never show in the field (see `stripBidi`).
              setName(stripBidi(e.target.value));
              setNameTried(false);
            }}
            onKeyDown={onEnter}
            placeholder="Gimnasio"
          />
        </label>
        <div style={{ flex: 1 }}>
          <label className="field">
            <span>Veces/sem.</span>
            <input
              inputMode="numeric"
              value={times}
              aria-invalid={problem.times ? true : undefined}
              aria-describedby={describedBy(
                problem.times ? "routine-times-error" : undefined,
                "routine-times-help",
              )}
              onKeyDown={onEnter}
              onChange={(e) => setTimes(e.target.value)}
            />
          </label>
          <Help id="routine-times-help" text="Cuántas veces por semana la hacés." />
        </div>
        <div style={{ flex: 1 }}>
          <label className="field">
            <span>Minutos</span>
            <input
              inputMode="numeric"
              value={minutes}
              aria-invalid={problem.minutes ? true : undefined}
              aria-describedby={describedBy(
                problem.minutes ? "routine-minutes-error" : undefined,
                "routine-minutes-help",
              )}
              onKeyDown={onEnter}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <Help id="routine-minutes-help" text="Lo que dura cada vez." />
        </div>
      </div>
      <RoutineHours
        form={hours}
        onChange={setHours}
        problems={read.problems}
        errorId="routine-hours-error"
        onEnter={onEnter}
      />
      <Problem id="routine-hours-error" text={hoursSummary(read.problems)} />
      <Problem id="routine-blank-error" text={blank ? "Poné un nombre." : null} />
      <Problem id="routine-times-error" text={problem.times} />
      <Problem id="routine-minutes-error" text={problem.minutes} />
      {dirty && <Unsaved />}
      <button
        type="button"
        className="btn"
        style={{ width: "100%" }}
        disabled={repeated}
        aria-disabled={bad ? true : undefined}
        onClick={(e) => add(e.currentTarget.parentElement)}
      >
        Agregar rutina
      </button>
      <Problem
        id="routine-name-error"
        text={repeated && name.trim() ? "Ya hay una materia o rutina con ese nombre." : null}
      />
    </>
  );
  return (
    <Section>
      {creating ? form : list}
      {detail && (
        <TaskDetail
          task={detail}
          onClose={() => setDetail(null)}
          onGone={() => createButton.current?.focus()}
          onEdit={() => {
            setEditing(detail);
            setDetail(null);
          }}
        />
      )}
      {editing && (
        <TaskEditor origin="preferences" task={editing} onClose={() => setEditing(null)} />
      )}
      {leaving && (
        <ConfirmDiscard
          onKeep={() => setLeaving(false)}
          onDiscard={() => {
            drafted({ name: "", times: "3", minutes: "60", hours: emptyHoursForm() });
            setLeaving(false);
            setCreating(false);
          }}
        />
      )}
    </Section>
  );
}

export { ActivitySettings } from "./Subjects.js";
export { isFigure };
