import { useEffect, useMemo, useRef, useState } from "react";
import { type Activity, localParts, zonedInstant } from "../engine.js";
import { dayDate, hours, minutesToHhmm } from "../format.js";
import { dateYearInRange, deadlineInRange, deadlineMaxYear } from "../limits.js";
import { type AppTask, newId, nextColor, type Unit } from "../model.js";
import { earliestStartOf, refreshPlan } from "../planning.js";
import { useStore } from "../store.js";
import {
  awakeWeekMinutes,
  habitProblems,
  hoursProblem,
  minimumProblem,
  parseUnit,
  partsProblem,
  typedHours,
} from "../taskForm.js";
import { focusFirstInvalid } from "./fields.js";
import { useModal } from "./modal.js";
import { describeStart, StartAfterField } from "./StartAfterField.js";
import { useToast } from "./Toast.js";

const toLocalInput = (tz: string, t: number) => {
  const p = localParts(tz, t);
  return `${p.date}T${minutesToHhmm(p.minuteOfDay)}`;
};

/** NaN for a cleared or malformed field. */
const fromLocalInput = (tz: string, v: string) => {
  const [date, hhmm] = v.split("T");
  if (!date || !hhmm || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return Number.NaN;
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(tz, date, h * 60 + m);
};

/** What is wrong with a field, read with it (nothing when it is fine). */
function FieldError({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <p className="meta" id={id} role="alert" style={{ color: "var(--critical)" }}>
      {text}
    </p>
  ) : null;
}

const AFTER_DUE = "Tiene que ser antes de la entrega: con esa fecha el plan no le da tiempo.";

export function TaskEditor({
  task,
  onClose,
  onSaved,
}: {
  task?: AppTask;
  onClose: () => void;
  /** Called only when the user saves (not when closing without changes). */
  onSaved?: (task: AppTask) => void;
}) {
  const { data, now, dispatch } = useStore();
  const toast = useToast();
  const tz = data.settings.timezone;
  const [title, setTitle] = useState(task?.title ?? "");
  const [picked, setActivityId] = useState(task?.activityId ?? "");
  const [newActivity, setNewActivity] = useState("");
  const [kind, setKind] = useState<AppTask["kind"]>(task?.kind ?? "deliverable");
  // Rutinas have no parciales or entregas: they are offered for a habit only (or when the
  // task already belongs to one).
  const choices = data.activities.filter(
    (a) => kind === "habit" || a.kind !== "rutina" || a.id === task?.activityId,
  );
  const activityId =
    picked === "new" || choices.some((a) => a.id === picked) ? picked : (choices[0]?.id ?? "new");
  const [deadline, setDeadline] = useState(
    toLocalInput(tz, task?.deadline ?? now + 3 * 86_400_000),
  );
  const [estimate, setEstimate] = useState(String((task?.estimateMinutes ?? 240) / 60));
  const [minimum, setMinimum] = useState(String((task?.minMinutes ?? 120) / 60));
  const [sessions, setSessions] = useState(String(task?.sessionsPerWeek ?? 3));
  const [sessionMin, setSessionMin] = useState(String(task?.sessionMinutes ?? 60));
  const [priority, setPriority] = useState(task?.priority ?? 2);
  const [units, setUnits] = useState<Unit[]>(task?.units ?? []);
  const [isExam, setIsExam] = useState(!!task?.exam);
  const [dayBefore, setDayBefore] = useState(!!task?.dayBeforeOnly);
  const [unitTitle, setUnitTitle] = useState("");
  const [unitError, setUnitError] = useState<string | null>(null);
  const addUnit = () => {
    const parsed = parseUnit(unitTitle);
    if (!parsed) return;
    if ("error" in parsed) {
      setUnitError(parsed.error);
      return;
    }
    setUnits([...units, { id: newId(), title: parsed.title, estimateMinutes: parsed.minutes }]);
    setUnitTitle("");
    setUnitError(null);
  };
  /** Saving was tried: an empty name is said now (not before the first try). */
  const [tried, setTried] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [startAfter, setStartAfter] = useState<AppTask["startAfter"] | null>(task?.startAfter);
  const materiaStart = data.activities.find((a) => a.id === activityId)?.startAfter;
  /** Bumped by a refused save: once the errors are drawn, the focus goes to the first one. */
  const [focusTick, setFocusTick] = useState(0);

  const sheet = useRef<HTMLDivElement>(null);
  const justOpened = useModal(sheet, onClose);
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
  const estimateError = deliverable
    ? (hoursProblem(estimate) ?? partsProblem(estimate, partsMinutes))
    : null;
  const partsHours = units.reduce((n, u) => n + u.estimateMinutes, 0) / 60;
  const minimumError = deliverable
    ? minimumProblem(minimum, Math.max(typedHours(estimate) || 0, partsHours))
    : null;
  const hoursBlocked = !!(estimateError || minimumError);
  const dueNow = deliverable ? fromLocalInput(tz, deadline) : Number.NaN;
  const deadlinePast = Number.isFinite(dueNow) && dueNow <= now;

  // A habit's times and minutes: whole, and what fits in the waking hours of a week.
  const routineAct = data.activities.find((a) => a.id === activityId)?.kind === "rutina";
  const habit =
    kind === "habit"
      ? habitProblems(sessions, sessionMin, awakeWeekMinutes(data.settings.week), routineAct)
      : { times: null, minutes: null };
  const nameMissing = activityId === "new" && !newActivity.trim();

  const save = () => {
    setTried(true);
    const due = kind === "deliverable" ? fromLocalInput(tz, deadline) : undefined;
    const rangeBad =
      due !== undefined && !(dateYearInRange(deadline, now) && deadlineInRange(due, now));
    if (rangeBad) {
      setDeadlineError(`Elegí una fecha entre el 1/1/2000 y el 31/12/${deadlineMaxYear(now)}.`);
    }
    // Every problem is drawn at once; the focus goes to the first one in the form.
    const blockers = [
      startBlocked,
      hoursBlocked,
      !!(habit.times || habit.minutes),
      !title.trim(),
      nameMissing,
      rangeBad,
    ];
    if (blockers.some(Boolean)) {
      setFocusTick((n) => n + 1);
      return;
    }
    let actId = activityId;
    let activity: Activity | undefined;
    if (actId === "new") {
      actId = newId();
      activity = {
        id: actId,
        name: newActivity.trim(),
        color: nextColor(data.activities),
        academic: kind === "deliverable",
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
      };
    }
    const h = (v: string) => Math.max(0, Math.round(Number(v.replace(",", ".")) * 60) || 0);
    const next: AppTask = {
      // Keeps fields the form does not edit (e.g. the calendar event it came from).
      ...task,
      id: task?.id ?? newId(),
      activityId: actId,
      title: title.trim(),
      kind,
      deadline: due,
      estimateMinutes:
        kind === "habit"
          ? Number(sessions) * Number(sessionMin)
          : Math.max(
              h(estimate),
              units.reduce((s, u) => s + u.estimateMinutes, 0),
            ),
      minMinutes: kind === "habit" ? Number(sessions) * Number(sessionMin) : h(minimum),
      sessionsPerWeek: kind === "habit" ? Number(sessions) : undefined,
      sessionMinutes: kind === "habit" ? Number(sessionMin) : undefined,
      priority,
      status: task?.status ?? "active",
      units,
      exam: (kind === "deliverable" && isExam) || undefined,
      startAfter: kind === "deliverable" ? (startAfter ?? undefined) : undefined,
      dayBeforeOnly: (kind === "deliverable" && isExam && dayBefore) || undefined,
    };
    dispatch({ type: "saveTask", task: next, activity });
    onSaved?.(next);
    onClose();
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
          if (!justOpened()) onClose();
        }}
      />
      <div
        ref={sheet}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={task ? "Editar" : "Nueva actividad"}
      >
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
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
            aria-invalid={tried && !title.trim() ? true : undefined}
            aria-describedby={tried && !title.trim() ? "title-error" : undefined}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              // Enter saves, unless it only confirms an IME character.
              if (e.key !== "Enter" || e.nativeEvent.isComposing || e.keyCode === 229) return;
              e.preventDefault();
              save();
            }}
            placeholder={kind === "habit" ? "Leer 30 min" : "Parcial Física I"}
          />
          {tried && !title.trim() && (
            <span
              className="meta"
              id="title-error"
              role="alert"
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
              aria-invalid={tried && nameMissing ? true : undefined}
              aria-describedby={tried && nameMissing ? "activity-error" : undefined}
              onChange={(e) => setNewActivity(e.target.value)}
              placeholder="Física I"
            />
          </label>
        )}
        {activityId === "new" && tried && nameMissing && (
          <FieldError id="activity-error" text="Poné el nombre de la materia" />
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
                onChange={(e) => {
                  setDeadline(e.target.value);
                  setDeadlineError(null);
                }}
              />
            </label>
            {deadlineError && (
              <p className="meta" role="alert">
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
            />
            {startWarning && (
              <p className="meta" role="status">
                {startWarning}
              </p>
            )}
            <label className="check">
              <input
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
              <label className="field" style={{ flex: 1 }}>
                <span>Horas estimadas</span>
                <input
                  inputMode="decimal"
                  value={estimate}
                  aria-invalid={estimateError ? true : undefined}
                  aria-describedby={estimateError ? "estimate-error" : undefined}
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>Mínimo (horas)</span>
                <input
                  inputMode="decimal"
                  value={minimum}
                  aria-invalid={minimumError ? true : undefined}
                  aria-describedby={minimumError ? "minimum-error" : undefined}
                  onChange={(e) => setMinimum(e.target.value)}
                />
              </label>
            </div>
            <FieldError id="estimate-error" text={estimateError} />
            <FieldError id="minimum-error" text={minimumError} />
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
                    ✕
                  </button>
                </div>
              ))}
              <div className="row" style={{ marginTop: 8 }}>
                <input
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
              {unitError && (
                <p
                  className="meta"
                  id="unit-error"
                  role="alert"
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
            <FieldError id="times-error" text={habit.times} />
            <FieldError id="session-error" text={habit.minutes} />
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
              dispatch({ type: "resetDetected", taskId: task.id });
              onClose();
            }}
          >
            Volver a las horas por defecto
          </button>
        )}
        <div className="row">
          {task && (
            <button
              type="button"
              className="btn missed"
              onClick={() => {
                dispatch({ type: "saveTask", task: { ...task, status: "dropped" } });
                toast.show(`${task.title} archivada`, {
                  undo: () =>
                    dispatch({
                      type: "unarchive",
                      taskId: task.id,
                      status: task.status === "done" ? "done" : "active",
                    }),
                });
                onClose();
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
    </>
  );
}
