import { useEffect, useRef, useState } from "react";
import { DEFAULTS } from "../calendars.js";
import { useDraft } from "../drafts.js";
import type { DaySettings, Meal, MealKind } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import type { AppTask, DetectedKind, Effort } from "../model.js";
import { mealsOf } from "../planning.js";
import { describeHours } from "../routineHours.js";
import { useStore } from "../store.js";
import { detectedProblem, detectedToReset, sessionShown } from "../taskForm.js";
import { clockText, type WeekProblem, weekProblems } from "../weekForm.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import {
  clampMinutes,
  Field,
  fromHours,
  isFigure,
  Problem,
  toHours,
  Unsaved,
  useFocusInvalid,
} from "./fields.js";
import { emptyRoutineDraft, RoutineForm, useRoutineDraft } from "./RoutineForm.js";
import { Section } from "./Section.js";
import { useScreenEscape } from "./settingsHistory.js";
import { TaskDetail } from "./TaskDetail.js";
import { editorDraft, TaskEditor } from "./TaskEditor.js";
import { useToast } from "./Toast.js";
import { PLAN_KEYS, useUndoable } from "./useUndoable.js";

const DAYS = ["D", "L", "M", "M", "J", "V", "S"];
/** For VoiceOver: two «M» would read alike. */
/** Three letters, so «mar mié» is not «M M»: the button says which days without the screen reader. */
const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
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

  // Tapping the last chosen day off is refused out loud: the button would still name it.
  const [lastDay, setLastDay] = useState(false);
  const pick = (d: number) => {
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
    if (next.length === 0) {
      setLastDay(true);
      return;
    }
    setLastDay(false);
    setDraft(switchDays({ days, form, held }, next, data.settings.week));
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value });
  };

  // Every problem found by a save, each under its own field; any change to the form clears them.
  const [failure, setFailure] = useState<{ problems: WeekProblem[]; form: typeof form } | null>(
    null,
  );
  const problems = failure?.form === form ? failure.problems : [];
  const isBad = (name: string) => problems.some((p) => p.fields.includes(name));
  // A message sits under the row of the first field it is about.
  const msgFor = (...names: string[]) =>
    problems
      .filter((p) => names.some((n) => n === p.fields[0]))
      .map((p) => (
        <p
          key={p.message}
          id={p === problems[0] ? "week-error" : undefined}
          className="meta field-help-wide"
          role="alert"
          style={{ color: "var(--critical)" }}
        >
          {p.message}
        </p>
      ));
  const save = () => {
    const found = weekProblems(form);
    if (found.length > 0) {
      setFailure({ problems: found, form });
      return;
    }
    const wake = hhmmToMinutes(form.wake);
    const bed = hhmmToMinutes(form.bed);
    // Going to bed after midnight: what comes after midnight belongs to the same day
    // (dinner at 00:45 is 24:45, not this morning).
    const late = (m: number) => (bed < wake && m < wake ? m + 1440 : m);
    const meal = (kind: MealKind, at: string, minutes: string): Meal => ({
      kind,
      start: hhmmToMinutes(at),
      // At most 4 h: a 99999-minute breakfast would not even fit a backup.
      end: hhmmToMinutes(at) + (clampMinutes(minutes, 0, 240) ?? 0),
    });
    const meals = [
      meal("desayuno", form.breakfast, form.breakfastMin),
      meal("almuerzo", form.lunch, form.lunchMin),
      meal("merienda", form.snack, form.snackMin),
      meal("cena", form.dinner, form.dinnerMin),
    ].filter((m) => m.end > m.start);
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

  // Enter in a field saves, like the button (and goes through it: same focus, same errors).
  const saveButton = useRef<HTMLButtonElement>(null);
  const saveOnEnter = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (!(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    saveButton.current?.click();
  };

  return (
    <Section>
      <div className="day-chips">
        {ORDER.map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days.includes(d)}
            aria-label={DAY_NAMES[d]}
            aria-describedby={lastDay && days.includes(d) ? "week-last-day" : undefined}
            className={`chip${days.includes(d) ? " on" : ""}`}
            onClick={() => pick(d)}
          >
            {DAYS[d]}
          </button>
        ))}
      </div>
      {lastDay && (
        <p id="week-last-day" className="meta" role="status">
          Tiene que quedar al menos un día elegido.
        </p>
      )}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Enter in a field only bubbles up to the save button */}
      <div className="grid2" onKeyDown={saveOnEnter}>
        <Field
          label="Me levanto"
          type="time"
          value={form.wake}
          onChange={set("wake")}
          invalid={isBad("Me levanto")}
        />
        <Field
          label="Arreglarse, traslado (min)"
          value={form.morning}
          onChange={set("morning")}
          invalid={isBad("Arreglarse, traslado (min)")}
        />
        {msgFor("Me levanto", "Arreglarse, traslado (min)")}
        <Field
          label="Desayuno"
          type="time"
          value={form.breakfast}
          onChange={set("breakfast")}
          invalid={isBad("Desayuno")}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), desayuno"
          value={form.breakfastMin}
          onChange={set("breakfastMin")}
          invalid={isBad("Dura (min), desayuno")}
        />
        {msgFor("Desayuno", "Dura (min), desayuno")}
        <Field
          label="Almuerzo"
          type="time"
          value={form.lunch}
          onChange={set("lunch")}
          invalid={isBad("Almuerzo")}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), almuerzo"
          value={form.lunchMin}
          onChange={set("lunchMin")}
          invalid={isBad("Dura (min), almuerzo")}
        />
        {msgFor("Almuerzo", "Dura (min), almuerzo")}
        <Field
          label="Merienda"
          type="time"
          value={form.snack}
          onChange={set("snack")}
          invalid={isBad("Merienda")}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), merienda"
          value={form.snackMin}
          onChange={set("snackMin")}
          invalid={isBad("Dura (min), merienda")}
        />
        {msgFor("Merienda", "Dura (min), merienda")}
        <Field
          label="Cena"
          type="time"
          value={form.dinner}
          onChange={set("dinner")}
          invalid={isBad("Cena")}
        />
        <Field
          label="Dura (min)"
          name="Dura (min), cena"
          value={form.dinnerMin}
          onChange={set("dinnerMin")}
          invalid={isBad("Dura (min), cena")}
        />
        {msgFor("Cena", "Dura (min), cena")}
        <Field
          label="Nada de estudio desde"
          type="time"
          value={form.freeFrom}
          onChange={set("freeFrom")}
          invalid={isBad("Nada de estudio desde")}
        />
        <Field
          label="Me acuesto"
          type="time"
          value={form.bed}
          onChange={set("bed")}
          invalid={isBad("Me acuesto")}
        />
        {msgFor("Nada de estudio desde", "Me acuesto")}
      </div>
      <Unsaved show={dirty} />
      <button
        ref={saveButton}
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
        {`Guardar para ${days.length === 7 ? "todos los días" : days.map((d) => DAYS_SHORT[d]).join(" ")}`}
      </button>
    </Section>
  );
}

type WeekForm = ReturnType<typeof formOf>;
interface WeekDraft {
  days: number[];
  form: WeekForm;
  held: Record<number, WeekForm>;
}

/** What each day left behind keeps waiting (only what was typed and differs from what is saved). */
function heldAfterLeaving(draft: WeekDraft, next: number[], week: DaySettings[], shown: boolean) {
  const held = { ...draft.held };
  for (const d of draft.days.filter((x) => !next.includes(x))) {
    const same = JSON.stringify(draft.form) === JSON.stringify(formOf(week[d] as DaySettings));
    if (shown || same) delete held[d];
    else held[d] = draft.form;
  }
  return held;
}

/**
 * Moves to another selection of days without losing what was typed: the form of a day
 * left behind is held (only if it differs from what is saved) and comes back with it. With
 * nothing typed the form shows the values of the day just added (or, removing one, of the
 * first that stays); what was typed is shared by the days that stay. Keys keep the draft's
 * order: it is compared as text with what it started as.
 */
export function switchDays(draft: WeekDraft, next: number[], week: DaySettings[]): WeekDraft {
  const now = JSON.stringify(draft.form);
  // Nothing typed: the form only shows the values of one of the selected days.
  const shown = draft.days.some((d) => JSON.stringify(formOf(week[d] as DaySettings)) === now);
  const held = heldAfterLeaving(draft, next, week, shown);
  const added = next.filter((d) => !draft.days.includes(d));
  // Typed and kept for the days that stay: the added one takes it (its own values are replaced on save).
  if (!shown && next.some((d) => draft.days.includes(d))) {
    for (const d of added) delete held[d];
    return { days: next, form: draft.form, held };
  }
  const target = (shown ? added.at(0) : undefined) ?? (next[0] as number);
  const form = held[target] ?? formOf(week[target] as DaySettings);
  delete held[target];
  return { days: next, form, held };
}

export function formOf(d: DaySettings) {
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
      <Unsaved show={dirty} />
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
      <Unsaved show={dirty} />
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

/** Routines like the gym: the plan places them N times a week; never a materia. */
/** `openId`: a routine (its activity) whose sheet opens at once. */
export function Routines({ openId }: { openId?: string }) {
  const { data, now } = useStore();
  const routines = data.activities.filter((a) => a.kind === "rutina");
  const state = useRoutineDraft("routines");
  const dirty = state[3];
  // The list of routines and the form of a new one are two views of the same sheet; a draft
  // waiting from before (a reload) opens straight on the form.
  const [creating, setCreating] = useState(dirty);
  const [leaving, setLeaving] = useState(false);
  const createButton = useRef<HTMLButtonElement>(null);
  const habitOf = (id: string) =>
    data.tasks.find((t) => t.activityId === id && t.kind === "habit" && t.status === "active");
  const skipped = (t: AppTask) => (t.skipUntil ?? 0) > now;
  const [detail, setDetail] = useState<AppTask | null>(
    () => (openId ? habitOf(openId) : null) ?? null,
  );
  const [editing, setEditing] = useState<AppTask | null>(() => {
    const d = editorDraft("preferences");
    return (d && data.tasks.find((t) => t.id === d.taskId)) || null;
  });
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
  // Escape on the form goes back to the list, asking first when it is half filled.
  useScreenEscape(creating ? leave : null);
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
            aria-label={`${r.name}, ${h.sessionsPerWeek} por semana de ${sessionShown(h.sessionMinutes ?? 0, data.settings.slotMinutes)}${h.paused ? ", pausada" : skipped(h) ? ", salteada esta semana" : ""}: editar, pausar o eliminar`}
            onClick={() => setDetail(h)}
          >
            <span className="swatch" style={{ background: r.color }} />
            {/* A long description wraps; the name never shrinks to a letter per line. */}
            <span style={{ flex: 1, minWidth: "35%" }}>{r.name}</span>
            <span className="meta" style={{ margin: 0 }}>
              {h.paused ? "pausada · " : skipped(h) ? "salteada · " : ""}
              {h.sessionsPerWeek}× {sessionShown(h.sessionMinutes ?? 0, data.settings.slotMinutes)}
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
  return (
    <Section>
      {creating ? (
        <RoutineForm state={state} onBack={leave} onAdded={() => setCreating(false)} />
      ) : (
        list
      )}
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
            state[2](emptyRoutineDraft());
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
