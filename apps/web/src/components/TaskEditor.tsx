import { useEffect, useId, useMemo, useRef, useState } from "react";
import { readSheetDraft, writeSheetDraft } from "../drafts.js";
import { type Activity, localParts, zonedInstant } from "../engine.js";
import { clipName, dayDate, hours, isHhmm, minutesToHhmm } from "../format.js";
import { learnedHours, learnedNote } from "../learnedDefaults.js";
import {
  dateYearInRange,
  deadlineInRange,
  deadlineMaxYear,
  isBlank,
  isRealDate,
  NAME_MAX,
  TITLE_MAX,
} from "../limits.js";
import { type AppTask, newId, nextColor, type Unit } from "../model.js";
import { earliestStartOf, refreshPlan } from "../planning.js";
import { formOfHours, type HoursForm, readHours } from "../routineHours.js";
import { useStore } from "../store.js";
import { sameName } from "../subjects.js";
import {
  awakeWeekMinutes,
  estimateProblem,
  habitProblems,
  minimumProblem,
  parseUnit,
  partsProblem,
  partsSummary,
  typedHours,
} from "../taskForm.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import { focusFirstInvalid } from "./fields.js";
import { Marks } from "./icons.js";
import { useModal } from "./modal.js";
import { hoursSummary, RoutineHours } from "./RoutineHours.js";
import { describeStart, StartAfterField } from "./StartAfterField.js";
import { useToast } from "./Toast.js";
import { PLAN_KEYS, useUndoable } from "./useUndoable.js";

const toLocalInput = (tz: string, t: number) => {
  const p = localParts(tz, t);
  return `${p.date}T${minutesToHhmm(p.minuteOfDay)}`;
};

/** The date and time of a field that is not a real one (2026-02-30, 24:00): never reinterpreted. */
const unrealLocalInput = (v: string) => {
  if (!v) return false;
  const [date, hhmm] = v.split("T");
  return !isRealDate(date) || !isHhmm(hhmm ?? "");
};

/** NaN for a cleared, malformed or impossible field. */
const fromLocalInput = (tz: string, v: string) => {
  const [date, hhmm] = v.split("T");
  if (!date || !hhmm || unrealLocalInput(v)) return Number.NaN;
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(tz, date, h * 60 + m);
};

/** What is wrong with a field, read with it (nothing when it is fine). */
function FieldError({
  id,
  text,
  role,
}: {
  id: string;
  text: string | null;
  /** Only when it is the one error: with several, a summary is the one announcement. */
  role?: "alert";
}) {
  return text ? (
    <p className="meta" id={id} role={role} style={{ color: "var(--critical)" }}>
      {text}
    </p>
  ) : null;
}

const AFTER_DUE = "Tiene que ser antes de la entrega: con esa fecha el plan no le da tiempo.";

/** What the editor holds, as kept in a draft (nothing sensitive: titles, hours, dates). */
interface EditorForm {
  title: string;
  picked: string;
  newActivity: string;
  kind: AppTask["kind"];
  deadline: string;
  estimate: string;
  minimum: string;
  sessions: string;
  sessionMin: string;
  priority: number;
  units: Unit[];
  isExam: boolean;
  dayBefore: boolean;
  unitTitle: string;
  /** `null` is «Ya», `"typing"` a number still being typed (not valid yet). */
  startAfter: AppTask["startAfter"] | "typing" | null;
  hoursForm: HoursForm;
}

/** A draft kept for an editor, and what it was opened from (so a reload reopens it). */
export interface EditorDraft {
  origin: string;
  /** The task being edited, `null` for a new one. */
  taskId: string | null;
  form: EditorForm;
}

/** The editor to bring back after a reload: the draft kept, when it is of this screen. */
export function editorDraft(origin: string): EditorDraft | null {
  const d = readSheetDraft<EditorDraft>("editor");
  return d && d.origin === origin ? d : null;
}

export function TaskEditor({
  task,
  origin = "silos",
  onClose,
  onSaved,
}: {
  task?: AppTask;
  /** Which screen opened it: where a reload brings it back. */
  origin?: "silos" | "inbox" | "preferences";
  onClose: () => void;
  /** Called only when the user saves (not when closing without changes). */
  onSaved?: (task: AppTask) => void;
}) {
  const { data, now, dispatch } = useStore();
  const examId = useId();
  const estimateId = useId();
  const minimumId = useId();
  const toast = useToast();
  const answer = useUndoable();
  const tz = data.settings.timezone;
  // A new delivery starts from the hours of the earlier ones (SPEC §18.1); the fixed ones
  // stand without history.
  const firstActivity = data.activities.find((a) => a.kind !== "rutina")?.id;
  const startLearned = task ? null : learnedHours(data.tasks, false, firstActivity);
  // What the form is when untouched, and what it was left as (a draft of this same task).
  const base = useRef<EditorForm>({
    title: task?.title ?? "",
    picked: task?.activityId ?? "",
    newActivity: "",
    kind: task?.kind ?? "deliverable",
    deadline: toLocalInput(tz, task?.deadline ?? now + 3 * 86_400_000),
    estimate: String((task?.estimateMinutes ?? startLearned?.estimateMinutes ?? 240) / 60),
    minimum: String((task?.minMinutes ?? startLearned?.minMinutes ?? 120) / 60),
    sessions: String(task?.sessionsPerWeek ?? 3),
    sessionMin: String(task?.sessionMinutes ?? 60),
    priority: task?.priority ?? 2,
    units: task?.units ?? [],
    isExam: !!task?.exam,
    dayBefore: !!task?.dayBeforeOnly,
    unitTitle: "",
    startAfter: task?.startAfter ?? null,
    hoursForm: formOfHours(data.activities.find((a) => a.id === task?.activityId)?.validHours),
  }).current;
  const kept = useRef<EditorForm | null>(
    (() => {
      const d = readSheetDraft<EditorDraft>("editor");
      return d && d.origin === origin && d.taskId === (task?.id ?? null) ? d.form : null;
    })(),
  ).current;
  const start = { ...base, ...kept };
  const [title, setTitle] = useState(start.title);
  const [picked, setActivityId] = useState(start.picked);
  const [newActivity, setNewActivity] = useState(start.newActivity);
  const [kind, setKind] = useState<AppTask["kind"]>(start.kind);
  // Rutinas have no parciales or entregas: they are offered for a habit only (or when the
  // task already belongs to one).
  const choices = data.activities.filter(
    (a) => kind === "habit" || a.kind !== "rutina" || a.id === task?.activityId,
  );
  const activityId =
    picked === "new" || choices.some((a) => a.id === picked) ? picked : (choices[0]?.id ?? "new");
  const [deadline, setDeadline] = useState(start.deadline);
  const [estimate, setEstimateTyped] = useState(start.estimate);
  const [minimum, setMinimumTyped] = useState(start.minimum);
  // Once the user touches the hours (or a draft brings them back) they are theirs.
  const hoursTouched = useRef(!!task || !!kept);
  /** Hours typed in this session of the form: empty ones from a draft are not scolded before. */
  const [hoursEdited, setHoursEdited] = useState(false);
  const setEstimate = (v: string) => {
    hoursTouched.current = true;
    setHoursEdited(true);
    setEstimateTyped(v);
  };
  const setMinimum = (v: string) => {
    hoursTouched.current = true;
    setHoursEdited(true);
    setMinimumTyped(v);
  };
  const [sessions, setSessions] = useState(start.sessions);
  const [sessionMin, setSessionMin] = useState(start.sessionMin);
  const [priority, setPriority] = useState(start.priority);
  const [units, setUnits] = useState<Unit[]>(start.units);
  const [isExam, setIsExam] = useState(start.isExam);
  const [dayBefore, setDayBefore] = useState(start.dayBefore);
  const [unitTitle, setUnitTitle] = useState(start.unitTitle);
  const [hoursForm, setHoursForm] = useState<HoursForm>(start.hoursForm);
  const [unitError, setUnitError] = useState<string | null>(null);
  const unitInput = useRef<HTMLInputElement>(null);
  const addUnit = () => {
    const parsed = parseUnit(unitTitle);
    if (!parsed) return;
    if ("error" in parsed) {
      setUnitError(parsed.error);
      // The tap left the focus on the button: it goes to the field that has the error.
      unitInput.current?.focus();
      return;
    }
    setUnits([...units, { id: newId(), title: parsed.title, estimateMinutes: parsed.minutes }]);
    setUnitTitle("");
    setUnitError(null);
  };
  /** Saving was tried: an empty name is said now (not before the first try). */
  const [tried, setTried] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  /** The browser holds a date it cannot read (31/02, 24:00): its value is empty, but typed. */
  const [deadlineUnreal, setDeadlineUnreal] = useState(false);
  // `undefined` is «Ya» and `null` a number still being typed.
  const [startAfter, setStartAfter] = useState<AppTask["startAfter"] | null>(
    kept
      ? kept.startAfter === "typing"
        ? null
        : (kept.startAfter ?? undefined)
      : task?.startAfter,
  );
  const learned =
    task || kind !== "deliverable"
      ? null
      : learnedHours(data.tasks, isExam, activityId === "new" ? undefined : activityId);
  const learnedKey = learned ? `${learned.estimateMinutes}/${learned.minMinutes}` : "fixed";
  // Changing the materia or «Es un parcial» re-proposes the hours, until they are typed.
  // With both hours erased there is nothing of theirs to keep: it proposes again.
  const hoursErased = useRef(false);
  hoursErased.current = !estimate.trim() && !minimum.trim();
  const proposeKey = `${learnedKey}|${isExam}|${activityId}`;
  const proposedBefore = useRef<string | null>(null);
  useEffect(() => {
    // Not when it opens (a draft with empty hours stays as it was), only on a change.
    const first = proposedBefore.current === null;
    proposedBefore.current = proposeKey;
    if (first || (hoursTouched.current && !hoursErased.current) || kind !== "deliverable") return;
    const [e, m] = learnedKey === "fixed" ? [240, 120] : learnedKey.split("/").map(Number);
    setEstimateTyped(String((e as number) / 60));
    setMinimumTyped(String((m as number) / 60));
  }, [learnedKey, kind, proposeKey]);
  const materiaStart = data.activities.find((a) => a.id === activityId)?.startAfter;
  /** Bumped by a refused save: once the errors are drawn, the focus goes to the first one. */
  const [focusTick, setFocusTick] = useState(0);

  const sheet = useRef<HTMLDivElement>(null);
  // Ids made once per form: a second tap on «Guardar» before the sheet is gone saves
  // the same task over itself instead of adding another one.
  const freshIds = useRef({ task: newId(), activity: newId() });
  // Closing with something typed asks first; with nothing changed it just closes.
  const [asking, setAsking] = useState(false);
  const form: EditorForm = {
    title,
    picked,
    newActivity,
    kind,
    deadline,
    estimate,
    minimum,
    sessions,
    sessionMin,
    priority,
    units,
    isExam,
    dayBefore,
    unitTitle,
    startAfter: startAfter === null ? "typing" : (startAfter ?? null),
    hoursForm,
  };
  const formKey = JSON.stringify(form);
  const dirty = formKey !== JSON.stringify(base);
  // The draft follows what is typed (a reload brings it back) and goes when it is saved
  // or discarded.
  useEffect(() => {
    writeSheetDraft(
      "editor",
      dirty
        ? ({ origin, taskId: task?.id ?? null, form: JSON.parse(formKey) } satisfies EditorDraft)
        : null,
    );
  }, [formKey, dirty, origin, task?.id]);
  /** Closed for good: saved, archived or discarded. */
  const done = () => {
    writeSheetDraft("editor", null);
    onClose();
  };
  const askClose = () => (dirty ? setAsking(true) : done());
  const justOpened = useModal(sheet, askClose);
  useEffect(() => {
    if (focusTick) focusFirstInvalid(sheet.current);
  }, [focusTick]);

  // §18.7: with a late start the minimum may no longer fit; say so before saving (the
  // inbox then offers the options of §5.6). Checked on the plan as it would be.
  const startWarning = useMemo(() => {
    // (null: a number still being typed; the field says what is wrong.)
    if (kind !== "deliverable" || startAfter === null) return null;
    const due = fromLocalInput(tz, deadline);
    if (!Number.isFinite(due)) return null;
    const hrs = (v: string) => Math.max(0, Math.round(Number(v.replace(",", ".")) * 60) || 0);
    const trial: AppTask = {
      ...(task ?? {
        id: "nueva",
        activityId,
        title: title || "Nueva",
        kind,
        priority,
        status: "active" as const,
        units,
      }),
      deadline: due,
      // As save computes it: units can raise the estimate.
      estimateMinutes: Math.max(
        hrs(estimate),
        units.reduce((s, u) => s + u.estimateMinutes, 0),
      ),
      minMinutes: hrs(minimum),
      activityId,
      startAfter,
    };
    // Its own rule or, without one, its materia's.
    const from = earliestStartOf(data, trial);
    if (from === undefined) return null;
    if (from !== undefined && from >= due) return AFTER_DUE;
    const next = { ...data, tasks: [...data.tasks.filter((t) => t.id !== trial.id), trial] };
    const status = refreshPlan(next, now).result.status.find((s) => s.taskId === trial.id);
    return status && status.minDeficit > 0
      ? `Empezando ${from !== undefined ? `el ${dayDate(tz, from)}` : "así"} no llegás al mínimo: faltarían ${hours(status.minDeficit)}. Se guarda igual y la Bandeja te da opciones.`
      : null;
  }, [
    kind,
    startAfter,
    deadline,
    estimate,
    minimum,
    task,
    activityId,
    title,
    priority,
    units,
    data,
    now,
    tz,
  ]);

  // §18.7: the start must be before the deadline; a number not valid yet is not «Ya».
  const startBlocked =
    kind === "deliverable" && (startAfter === null || startWarning === AFTER_DUE);

  // Hours that are not figures, or a minimum above the estimate, are said, never fixed.
  const deliverable = kind === "deliverable";
  const partsMinutes = units.reduce((n, u) => n + u.estimateMinutes, 0);
  const estimateError = deliverable ? estimateProblem(estimate, partsMinutes) : null;
  const partsHours = units.reduce((n, u) => n + u.estimateMinutes, 0) / 60;
  // With hours that are not a figure there is nothing to compare the minimum to: only the
  // first problem is said («１２» is not a figure, and does not make the minimum «mayor»).
  const minimumError = deliverable
    ? minimumProblem(
        minimum,
        Number.isNaN(typedHours(estimate))
          ? Number.POSITIVE_INFINITY
          : Math.max(typedHours(estimate), partsHours),
      )
    : null;
  const hoursBlocked = !!(estimateError || minimumError);
  // Empty hours from a restored draft are said once typed or saving is tried, not on opening.
  const hoursQuiet = !hoursEdited && !tried;
  const estimateShown = hoursQuiet && !estimate.trim() ? null : estimateError;
  const minimumShown = hoursQuiet && !minimum.trim() ? null : minimumError;
  const dueNow = deliverable ? fromLocalInput(tz, deadline) : Number.NaN;
  const deadlinePast = Number.isFinite(dueNow) && dueNow <= now;

  // A habit's times and minutes: whole, and what fits in the waking hours of a week.
  const routineAct = data.activities.find((a) => a.id === activityId)?.kind === "rutina";
  const habit =
    kind === "habit"
      ? habitProblems(sessions, sessionMin, awakeWeekMinutes(data.settings.week), routineAct)
      : { times: null, minutes: null };
  // A routine's valid hours are edited with its habit (not for a new one: Rutinas has them).
  const ownRoutine = data.activities.find(
    (a) => a.id === task?.activityId && a.kind === "rutina" && a.id === activityId,
  );
  const hoursRead =
    ownRoutine && kind === "habit"
      ? readHours(
          hoursForm,
          habit.minutes ? undefined : Number(sessionMin),
          data.settings.slotMinutes,
        )
      : { hours: undefined, problems: [] };
  const nameMissing = activityId === "new" && isBlank(newActivity);
  // One error is announced by its own text; several, by one summary (not one alert each).
  const shown = [
    tried && isBlank(title),
    activityId === "new" && tried && nameMissing,
    !!deadlineError,
    !!estimateShown,
    !!minimumShown,
    !!unitError,
    !!habit.times,
    !!habit.minutes,
    hoursRead.problems.length > 0,
    deliverable && startAfter === null,
    startWarning === AFTER_DUE,
  ].filter(Boolean).length;
  const alertRole = shown === 1 ? ("alert" as const) : undefined;

  const save = () => {
    setTried(true);
    // A part typed but not added is not lost: it is added now, or its error is said.
    const pending = parseUnit(unitTitle);
    const pendingError = pending && "error" in pending ? pending.error : null;
    if (pendingError) setUnitError(pendingError);
    const extra: Unit | undefined =
      pending && !("error" in pending)
        ? { id: newId(), title: pending.title, estimateMinutes: pending.minutes }
        : undefined;
    const allUnits = extra ? [...units, extra] : units;
    const allMinutes = allUnits.reduce((n, u) => n + u.estimateMinutes, 0);
    // With it the parts may add up to more than the hours typed: shown in the list.
    const extraBad = !!extra && kind === "deliverable" && !!partsProblem(estimate, allMinutes);
    if (extraBad && extra) {
      setUnits(allUnits);
      setUnitTitle("");
    }
    const due = kind === "deliverable" ? fromLocalInput(tz, deadline) : undefined;
    const rangeBad =
      due !== undefined && !(dateYearInRange(deadline, now) && deadlineInRange(due, now));
    if (rangeBad) {
      setDeadlineError(
        deadlineUnreal || unrealLocalInput(deadline)
          ? "Esa fecha no existe."
          : `Elegí una fecha entre el 1/1/2000 y el 31/12/${deadlineMaxYear(now)}.`,
      );
    }
    // Every problem is drawn at once; the focus goes to the first one in the form.
    const blockers = [
      startBlocked,
      hoursBlocked,
      !!(habit.times || habit.minutes),
      hoursRead.problems.length > 0,
      isBlank(title),
      nameMissing,
      rangeBad,
      !!pendingError,
      extraBad,
    ];
    if (blockers.some(Boolean)) {
      setFocusTick((n) => n + 1);
      return;
    }
    let actId = activityId;
    let activity: Activity | undefined;
    // «cálculo ii» when «Cálculo II» exists: that materia is used, never lost to a duplicate.
    const sameNamed =
      actId === "new" ? data.activities.find((a) => sameName(a.name, newActivity)) : undefined;
    if (sameNamed) {
      actId = sameNamed.id;
    } else if (actId === "new") {
      actId = freshIds.current.activity;
      activity = {
        id: actId,
        name: newActivity.trim(),
        color: nextColor(data.activities),
        academic: kind === "deliverable",
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      };
    }
    if (ownRoutine && kind === "habit") {
      activity = { ...ownRoutine, validHours: hoursRead.hours };
    }
    const h = (v: string) => Math.max(0, Math.round(Number(v.replace(",", ".")) * 60) || 0);
    const next: AppTask = {
      // Keeps fields the form does not edit (e.g. the calendar event it came from).
      ...task,
      id: task?.id ?? freshIds.current.task,
      activityId: actId,
      title: title.trim(),
      kind,
      deadline: due,
      estimateMinutes:
        kind === "habit"
          ? Number(sessions) * Number(sessionMin)
          : Math.max(h(estimate), allMinutes),
      minMinutes: kind === "habit" ? Number(sessions) * Number(sessionMin) : h(minimum),
      sessionsPerWeek: kind === "habit" ? Number(sessions) : undefined,
      sessionMinutes: kind === "habit" ? Number(sessionMin) : undefined,
      priority,
      status: task?.status ?? "active",
      units: allUnits,
      exam: (kind === "deliverable" && isExam) || undefined,
      startAfter: kind === "deliverable" ? (startAfter ?? undefined) : undefined,
      dayBeforeOnly: (kind === "deliverable" && isExam && dayBefore) || undefined,
    };
    dispatch({ type: "saveTask", task: next, activity });
    // Saved as asked, but said: a deadline already over gets no time in the plan.
    if (due !== undefined && due <= now) {
      toast.show(
        `«${clipName(next.title)}» quedó con la fecha ya vencida: el plan no le reserva tiempo.`,
      );
    }
    onSaved?.(next);
    done();
  };

  return (
    <>
      {/* For taps; the keyboard and VoiceOver have ✕ and Escape. */}
      <button
        type="button"
        className="scrim dim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) askClose();
        }}
      />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={task ? "Editar" : "Nueva actividad"}
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={askClose}>
          <Marks.close />
        </button>
        <h2>{task ? "Editar" : "Nueva"}</h2>
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            type="button"
            aria-pressed={kind === "deliverable"}
            className={`btn small${kind === "deliverable" ? " primary" : ""}`}
            onClick={() => setKind("deliverable")}
          >
            Entrega / parcial
          </button>
          <button
            type="button"
            aria-pressed={kind === "habit"}
            className={`btn small${kind === "habit" ? " primary" : ""}`}
            onClick={() => setKind("habit")}
          >
            Hábito semanal
          </button>
        </div>
        <label className="field">
          <span>Nombre</span>
          <input
            value={title}
            maxLength={TITLE_MAX}
            aria-invalid={tried && isBlank(title) ? true : undefined}
            aria-describedby={tried && isBlank(title) ? "title-error" : undefined}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // Enter saves, unless it only confirms an IME character.
              if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              save();
            }}
            placeholder={kind === "habit" ? "Leer 30 min" : "Parcial Física I"}
          />
          {tried && isBlank(title) && (
            <span
              className="meta"
              id="title-error"
              role={alertRole}
              style={{ margin: 0, color: "var(--critical)" }}
            >
              Poné un nombre
            </span>
          )}
        </label>
        <label className="field">
          <span>Materia o actividad</span>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            {choices.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="new">+ Nueva…</option>
          </select>
        </label>
        {activityId === "new" && (
          <label className="field">
            <span>Nombre de la materia</span>
            <input
              value={newActivity}
              maxLength={NAME_MAX}
              aria-invalid={tried && nameMissing ? true : undefined}
              aria-describedby={tried && nameMissing ? "activity-error" : undefined}
              onChange={(e) => setNewActivity(e.target.value)}
              placeholder="Física I"
            />
          </label>
        )}
        {activityId === "new" && tried && nameMissing && (
          <FieldError id="activity-error" text="Poné el nombre de la materia" role={alertRole} />
        )}
        {kind === "deliverable" ? (
          <>
            <label className="field">
              <span>Fecha límite</span>
              <input
                type="datetime-local"
                aria-label="Fecha límite"
                value={deadline}
                min="2000-01-01T00:00"
                max={`${deadlineMaxYear(now)}-12-31T23:59`}
                aria-invalid={deadlineError ? true : undefined}
                aria-describedby={deadlineError ? "deadline-error" : undefined}
                onChange={(e) => {
                  const v = e.target.value;
                  setDeadline(v);
                  setDeadlineUnreal(e.target.validity.badInput);
                  // A year past the last one is said now, not only when saving (the layout
                  // would jump under the finger then). Earlier years pass while it is typed.
                  const year = Number(/^(\d{4,6})-/.exec(v)?.[1]);
                  setDeadlineError(
                    year > deadlineMaxYear(now)
                      ? `Elegí una fecha entre el 1/1/2000 y el 31/12/${deadlineMaxYear(now)}.`
                      : null,
                  );
                }}
              />
            </label>
            {deadlineError && (
              <p className="meta" id="deadline-error" role={alertRole}>
                {deadlineError}
              </p>
            )}
            {deadlinePast && !deadlineError && (
              <p className="meta" role="status">
                Esa fecha ya pasó: la entrega queda vencida y el plan no le reserva tiempo. Se puede
                guardar igual.
              </p>
            )}
            <StartAfterField
              value={startAfter}
              onChange={setStartAfter}
              tz={tz}
              now={now}
              inherited={materiaStart ? describeStart(materiaStart, tz) : undefined}
              invalid={startWarning === AFTER_DUE}
              describedBy="start-error"
              summary={shown > 1}
            />
            {startWarning === AFTER_DUE && (
              <p
                className="meta"
                id="start-error"
                role={alertRole}
                style={{ color: "var(--critical)" }}
              >
                {startWarning}
              </p>
            )}
            {startWarning && startWarning !== AFTER_DUE && (
              <p className="meta" role="status">
                {startWarning}
              </p>
            )}
            <label className="check" htmlFor={examId}>
              <input
                id={examId}
                type="checkbox"
                checked={isExam}
                onChange={(e) => setIsExam(e.target.checked)}
              />
              <span>Es un parcial: repaso espaciado (una semana, tres días y un día antes)</span>
            </label>
            {isExam && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={dayBefore}
                  onChange={(e) => setDayBefore(e.target.checked)}
                />
                <span>El día anterior, solo esta materia</span>
              </label>
            )}
            <div className="row">
              <label className="field" style={{ flex: 1 }} htmlFor={estimateId}>
                <span>Horas estimadas</span>
                <input
                  id={estimateId}
                  inputMode="decimal"
                  value={estimate}
                  aria-invalid={estimateShown ? true : undefined}
                  aria-describedby={estimateShown ? "estimate-error" : undefined}
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </label>
              <label className="field" style={{ flex: 1 }} htmlFor={minimumId}>
                <span>Mínimo (horas)</span>
                <input
                  id={minimumId}
                  inputMode="decimal"
                  value={minimum}
                  aria-invalid={minimumShown ? true : undefined}
                  aria-describedby={minimumShown ? "minimum-error" : undefined}
                  onChange={(e) => setMinimum(e.target.value)}
                />
              </label>
            </div>
            {learned && !hoursTouched.current && (
              <p className="meta" style={{ margin: 0 }}>
                {learnedNote(learned, isExam)}
              </p>
            )}
            <FieldError id="estimate-error" text={estimateShown} role={alertRole} />
            <FieldError id="minimum-error" text={minimumShown} role={alertRole} />
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
              <legend style={{ padding: 0 }}>Partes (opcional)</legend>
              <span className="meta" style={{ margin: 0 }}>
                Lo que falta se mide por partes hechas. Con peso, si no llegás se pueden dejar
                afuera las que menos pesan.
              </span>
              {units.map((u) => (
                <div key={u.id} className="check">
                  <span style={{ flex: 1, textDecoration: u.doneAt ? "line-through" : undefined }}>
                    {u.title}
                  </span>
                  <span>{u.estimateMinutes} min</span>
                  <input
                    inputMode="numeric"
                    aria-label={`Peso de ${u.title} en el examen (%)`}
                    placeholder="peso %"
                    style={{ width: 64 }}
                    value={u.weight ?? ""}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      const weight =
                        e.target.value.trim() === "" || !Number.isFinite(n)
                          ? undefined
                          : Math.min(100, Math.max(0, n));
                      setUnits(units.map((x) => (x.id === u.id ? { ...x, weight } : x)));
                    }}
                  />
                  {u.skipped && <span className="meta">afuera</span>}
                  <button
                    type="button"
                    aria-label={`Quitar ${u.title}`}
                    onClick={() => setUnits(units.filter((x) => x.id !== u.id))}
                  >
                    <Marks.close />
                  </button>
                </div>
              ))}
              <div className="row" style={{ marginTop: 8 }}>
                <input
                  ref={unitInput}
                  aria-label="Nueva parte: nombre y minutos entre paréntesis"
                  value={unitTitle}
                  aria-invalid={unitError ? true : undefined}
                  aria-describedby={unitError ? "unit-error" : undefined}
                  onChange={(e) => {
                    setUnitTitle(e.target.value);
                    setUnitError(null);
                  }}
                  onKeyDown={(e) => {
                    // Enter that confirms an IME character is not «add».
                    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
                    e.preventDefault();
                    addUnit();
                  }}
                  placeholder="Práctico 5 (60)"
                />
                <button type="button" className="btn small" onClick={addUnit}>
                  Agregar
                </button>
              </div>
              {partsSummary(estimate, partsMinutes) && (
                <p className="meta" id="parts-sum" role="status" style={{ margin: "8px 0 0" }}>
                  {partsSummary(estimate, partsMinutes)}
                </p>
              )}
              {unitError && (
                <p
                  className="meta"
                  id="unit-error"
                  role={alertRole}
                  style={{ color: "var(--critical)" }}
                >
                  {unitError}
                </p>
              )}
            </fieldset>
          </>
        ) : (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>Veces por semana</span>
              <input
                inputMode="numeric"
                value={sessions}
                aria-invalid={habit.times ? true : undefined}
                aria-describedby={habit.times ? "times-error" : undefined}
                onChange={(e) => setSessions(e.target.value)}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Minutos por vez</span>
              <input
                inputMode="numeric"
                value={sessionMin}
                aria-invalid={habit.minutes ? true : undefined}
                aria-describedby={habit.minutes ? "session-error" : undefined}
                onChange={(e) => setSessionMin(e.target.value)}
              />
            </label>
          </div>
        )}
        {kind === "habit" && (
          <>
            <FieldError id="times-error" text={habit.times} role={alertRole} />
            <FieldError id="session-error" text={habit.minutes} role={alertRole} />
          </>
        )}
        {ownRoutine && kind === "habit" && (
          <>
            <RoutineHours
              form={hoursForm}
              onChange={setHoursForm}
              problems={hoursRead.problems}
              errorId="hours-error"
            />
            <FieldError id="hours-error" text={hoursSummary(hoursRead.problems)} role={alertRole} />
          </>
        )}
        <label className="field">
          <span>Prioridad</span>
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={1}>Baja (se recorta primero)</option>
            <option value={2}>Media</option>
            <option value={3}>Alta</option>
          </select>
        </label>
        {task?.sourceEventId && (
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            onClick={() => {
              answer(
                "Vuelve a las horas por defecto",
                { type: "resetDetected", taskId: task.id },
                PLAN_KEYS,
                {
                  tasks: [data.tasks.find((t) => t.id === task.id) ?? task],
                },
              );
              done();
            }}
          >
            Volver a las horas por defecto
          </button>
        )}
        {shown > 1 && (
          <p className="meta" role="alert" style={{ color: "var(--critical)" }}>
            Hay {shown} campos para corregir: están marcados arriba.
          </p>
        )}
        <div className="row">
          {task && (
            <button
              type="button"
              className="btn missed"
              onClick={() => {
                dispatch({ type: "saveTask", task: { ...task, status: "dropped" } });
                toast.show(`${clipName(task.title)} archivada`, {
                  full: `${task.title} archivada`,
                  undo: () =>
                    dispatch({
                      type: "unarchive",
                      taskId: task.id,
                      status: task.status === "done" ? "done" : "active",
                    }),
                });
                done();
              }}
            >
              Archivar
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            aria-disabled={startBlocked || hoursBlocked ? true : undefined}
            onClick={save}
          >
            Guardar
          </button>
        </div>
      </div>
      {asking && <ConfirmDiscard onDiscard={done} onKeep={() => setAsking(false)} />}
    </>
  );
}
