import { useEffect, useState } from "react";
import { useDraft } from "../drafts.js";
import type { Activity } from "../engine.js";
import { minutesToHhmm, parseClock } from "../format.js";
import { isBlank, NAME_MAX } from "../limits.js";
import { nextColor, PALETTE } from "../model.js";
import { DEFAULT_BREAK_MINUTES, DEFAULT_STUDY_MINUTES } from "../planning.js";
import { type RemovedActivity, removedWith, useStore } from "../store.js";
import { sameName, studyOf, subjectsOf } from "../subjects.js";
import {
  clampMinutes,
  Field,
  focusFirstInvalid,
  isFigure,
  isWhole,
  Problem,
  toHours,
  Unsaved,
} from "./fields.js";
import { Section } from "./Section.js";
import { StartAfterField } from "./StartAfterField.js";
import { UNDO_MS, useToast } from "./Toast.js";

/** What the materia form holds, as typed. */
interface ActivityForm {
  name: string;
  academic: boolean;
  study: string;
  rest: string;
  from: string;
  to: string;
}

/** Why minutes typed in the form are not valid (a figure within the range), or null. */
function minutesProblem(v: string, lo: number, hi: number, what: string): string | null {
  // «60,5» is not rounded to 61 behind the back: whole minutes only.
  if (isFigure(v) && !isWhole(v)) return `${what}: solo números enteros, de ${lo} a ${hi} min.`;
  const n = isWhole(v) ? Number(v) : Number.NaN;
  return n >= lo && n <= hi ? null : `${what} va de ${lo} a ${hi} min.`;
}

/** What is wrong with each number of the materia form (nothing is fixed behind the back). */
function numberProblems(form: { max: string; min: string; study: string; rest: string }) {
  return {
    max: minutesProblem(form.max, 30, 480, "La sesión máxima"),
    min: minutesProblem(form.min, 30, 480, "El bloque mínimo"),
    study: minutesProblem(form.study, 5, 240, "El estudio antes del descanso"),
    rest: minutesProblem(form.rest, 0, 120, "El descanso"),
  };
}

/** The materia as saved from its form (colour and «puedo empezar» are set by the caller). */
function savedActivity(
  activity: Activity,
  form: ActivityForm,
  maxSession: number,
  minBlock: number,
): Activity {
  return {
    ...activity,
    name: form.name.trim() || activity.name,
    academic: form.academic,
    maxSessionMinutes: maxSession,
    minBlockMinutes: minBlock,
    // Breaks live inside the block: a 50 + 10 hour plans 50 minutes of study.
    studyMinutes: clampMinutes(form.study, 5, 240) ?? activity.studyMinutes,
    breakMinutes: clampMinutes(form.rest, 0, 120) ?? activity.breakMinutes,
    preferred:
      form.from.trim() && form.to.trim()
        ? { start: parseClock(form.from) ?? 0, end: windowEnd(form.from, form.to) ?? 0 }
        : undefined,
  };
}

/**
 * The form as it reads after saving: what was really stored (20 and 25 minutes become
 * 30 and 30, 999 of study 240).
 */
function savedForm<F extends ActivityForm>(
  activity: Activity,
  form: F,
  maxSession: number,
  minBlock: number,
): F {
  return {
    ...form,
    // «24:00» is stored as midnight and shown as a time field can hold it.
    to:
      form.from.trim() && form.to.trim()
        ? minutesToHhmm(windowEnd(form.from, form.to) ?? 0)
        : form.to,
    max: String(maxSession),
    min: String(minBlock),
    study: String(clampMinutes(form.study, 5, 240) ?? activity.studyMinutes ?? form.study),
    rest: String(clampMinutes(form.rest, 0, 120) ?? activity.breakMinutes ?? form.rest),
  };
}

/**
 * What was deleted while the notice is up: several in a row share one «Deshacer», so none
 * is lost because the next notice replaced its own. Kept outside the component: closing
 * and reopening Ajustes in between must not forget them.
 */
const recent: { current: { removed: RemovedActivity; at: number }[] } = { current: [] };

/**
 * Where the window ends, in minutes: «hasta» may be midnight, written «24:00» or «00:00»
 * after a start (the model keeps 1440 for it), and is otherwise read like any time.
 */
function windowEnd(from: string, to: string): number | null {
  if (/^\s*24(?::0{1,2})?\s*$/.test(to)) return 1440;
  const end = parseClock(to);
  const start = parseClock(from);
  return end === 0 && start !== null && start > 0 ? 1440 : end;
}

/**
 * The «Prefiero desde / hasta» window is two real times (read like everywhere: «7» is
 * 07:00), the first before the second, and both or none. `from` and `to` say which field
 * the error is about.
 */
function windowError(
  from: string,
  to: string,
): { message: string; from: boolean; to: boolean } | null {
  const [hasFrom, hasTo] = [from.trim() !== "", to.trim() !== ""];
  const badFrom = hasFrom && parseClock(from) === null;
  const badTo = hasTo && windowEnd(from, to) === null;
  if (badFrom || badTo) return { message: "Hora inválida.", from: badFrom, to: badTo };
  // One field alone would be dropped on saving without a word.
  if (hasFrom !== hasTo) {
    return hasFrom
      ? { message: "Poné también hasta qué hora.", from: false, to: true }
      : { message: "Poné también desde qué hora.", from: true, to: false };
  }
  const [a, b] = [parseClock(from), windowEnd(from, to)];
  return a !== null && b !== null && a >= b
    ? { message: "«Prefiero desde» tiene que ser antes de «hasta».", from: true, to: true }
    : null;
}

/** A name that says something, and that no other materia or rutina has. */
function nameError(name: string, repeated: boolean): string | null {
  if (isBlank(name)) return "Poné un nombre.";
  return repeated ? "Ya hay una materia o rutina con ese nombre." : null;
}

/** Per-subject colour and study rules. */
export function ActivitySettings() {
  const { data, dispatch } = useStore();
  const toast = useToast();
  /** Where focus goes once a row is gone: the next (or previous) row, else the empty note. */
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => {
    if (!focusId) return;
    const target =
      focusId === "empty"
        ? document.getElementById("subjects-empty")
        : document.querySelector<HTMLElement>(`[data-activity-head="${focusId}"]`);
    target?.focus();
    setFocusId(null);
  }, [focusId]);
  const remove = (activity: Activity) => {
    const removed = removedWith(data, activity.id);
    if (!removed) return;
    const at0 = data.activities.findIndex((a) => a.id === activity.id);
    const near = data.activities[at0 + 1] ?? data.activities[at0 - 1];
    setFocusId(near ? near.id : "empty");
    const at = Date.now();
    // Only the ones still gone: a different demo or one already back is not part of this.
    const stillGone = (r: { removed: RemovedActivity; at: number }) =>
      at - r.at < UNDO_MS && !data.activities.some((a) => a.id === r.removed.activity.id);
    recent.current = [...recent.current.filter(stillGone), { removed, at }];
    dispatch({ type: "deleteActivity", activityId: activity.id });
    const all = recent.current.map((r) => r.removed);
    const silos = removed.tasks.length;
    toast.show(
      all.length > 1
        ? `${all.length} eliminadas: ${all.map((r) => r.activity.name).join(", ")}`
        : `${activity.name} eliminada${silos ? `, con ${silos === 1 ? "su silo" : `sus ${silos} silos`}` : ""}`,
      {
        undo: () => {
          recent.current = [];
          // The last deleted goes back first, so each lands where it was.
          for (const r of [...all].reverse()) dispatch({ type: "restoreActivity", removed: r });
          // The row that came back (the one just deleted) takes the focus the delete moved.
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>(`[data-activity-head="${CSS.escape(activity.id)}"]`)
              ?.focus(),
          );
        },
      },
    );
  };
  return (
    <Section>
      <p className="meta">Cada una tiene su color en la semana y en los silos.</p>
      {data.activities.length === 0 && (
        <p className="meta" id="subjects-empty" tabIndex={-1}>
          No tenés materias ni rutinas. Las materias se crean en «Inicio de cuatrimestre» y las
          rutinas en «Rutinas».
        </p>
      )}
      {data.activities.map((a) => (
        <ActivityRow key={a.id} activity={a} onRemove={() => remove(a)} />
      ))}
    </Section>
  );
}

function ActivityRow({ activity, onRemove }: { activity: Activity; onRemove: () => void }) {
  const { data, now, dispatch } = useStore();
  const key = `activity:${activity.id}`;
  const [startAfter, setStartAfter, startSaved, startDirty] = useDraft<
    Activity["startAfter"] | null
  >(`${key}:start`, () => activity.startAfter);
  const [form, setForm, formSaved, formDirty] = useDraft(key, () => ({
    name: activity.name,
    color: activity.color,
    academic: activity.academic,
    max: String(activity.maxSessionMinutes),
    min: String(activity.minBlockMinutes),
    from: activity.preferred ? minutesToHhmm(activity.preferred.start) : "",
    to: activity.preferred ? minutesToHhmm(activity.preferred.end) : "",
    study: String(activity.studyMinutes ?? DEFAULT_STUDY_MINUTES),
    rest: String(activity.breakMinutes ?? (activity.academic ? DEFAULT_BREAK_MINUTES : 0)),
  }));
  const taken = new Set(
    data.activities.filter((a) => a.id !== activity.id).map((a) => a.color.toLowerCase()),
  );
  // A materia's weekly study is its weekly silo, if it has one.
  const study = studyOf(data, activity);
  const studyHours = study ? toHours(study.minMinutes) : "";
  const [weekly, setWeekly, weeklySaved, weeklyDirty] = useDraft(`${key}:weekly`, () => studyHours);
  const dirty = formDirty || weeklyDirty || startDirty;
  // A draft waiting there opens the row on it.
  const [open, setOpen] = useState(dirty);
  const studies = subjectsOf(data).some((a) => a.id === activity.id);
  const hours = Number(weekly.replace(",", "."));
  // Blank means none; at most a whole week.
  const hoursOk =
    !studies || weekly.trim() === "" || (isFigure(weekly) && hours >= 0 && hours <= 168);
  // Two «Nadar» would be told apart by nothing (adding one is refused the same way).
  const repeated = data.activities.some((a) => a.id !== activity.id && sameName(a.name, form.name));
  const maxSession = clampMinutes(form.max, 30, 480) ?? activity.maxSessionMinutes;
  const minBlock = clampMinutes(form.min, 30, 480) ?? activity.minBlockMinutes;
  // A minimum block longer than a session could never be planned, nor a window that ends
  // before it starts. Each message sits right under the fields it is about.
  const numbers = numberProblems(form);
  const blockProblem =
    !numbers.max && !numbers.min && minBlock > maxSession
      ? "El bloque mínimo no puede ser más largo que la sesión máxima."
      : null;
  const windowProblem = windowError(form.from, form.to);
  const nameProblem = nameError(form.name, repeated);
  const numberProblem = numbers.max ?? numbers.min ?? numbers.study ?? numbers.rest;
  const problem = nameProblem ?? numberProblem ?? blockProblem ?? windowProblem?.message;
  const saved = activity.name;
  // A long name would wrap the button onto two lines.
  const named = saved.length > 24 ? "" : ` ${saved}`;
  return (
    <div className="activity-row">
      <button
        type="button"
        className="activity-head"
        data-activity-head={activity.id}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="swatch" style={{ background: activity.color }} />
        {activity.name}
        {activity.kind && (
          <span className="meta" style={{ margin: 0, whiteSpace: "nowrap" }}>
            {" "}
            · {activity.kind}
          </span>
        )}
        <span className="meta" aria-hidden="true" style={{ margin: 0, marginLeft: "auto" }}>
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && (
        <div>
          <label className="field">
            <span>Nombre</span>
            <input
              aria-label="Nombre de la materia"
              maxLength={NAME_MAX}
              value={form.name}
              aria-invalid={nameProblem ? true : undefined}
              aria-describedby={nameProblem ? `${key}-name-error` : undefined}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <Problem id={`${key}-name-error`} text={nameProblem} />
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
              invalid={!!(numbers.max || blockProblem)}
              errorId={numbers.max ? `${key}-max-error` : `${key}-block-error`}
              value={form.max}
              onChange={(e) => setForm({ ...form, max: e.target.value })}
            />
            <Field
              label="Bloque mínimo (min)"
              invalid={!!(numbers.min || blockProblem)}
              errorId={numbers.min ? `${key}-min-error` : `${key}-block-error`}
              value={form.min}
              onChange={(e) => setForm({ ...form, min: e.target.value })}
            />
            <Field
              label="Estudio antes del descanso (min)"
              invalid={!!numbers.study}
              errorId={`${key}-study-error`}
              value={form.study}
              onChange={(e) => setForm({ ...form, study: e.target.value })}
            />
            <Field
              label="Descanso (min, 0 = sin)"
              invalid={!!numbers.rest}
              errorId={`${key}-rest-error`}
              value={form.rest}
              onChange={(e) => setForm({ ...form, rest: e.target.value })}
            />
            <Field
              label="Prefiero desde"
              type="time"
              invalid={!!windowProblem?.from}
              errorId={`${key}-window-error`}
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
            <Field
              label="hasta"
              type="time"
              invalid={!!windowProblem?.to}
              errorId={`${key}-window-error`}
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </div>
          <Problem id={`${key}-max-error`} text={numbers.max} />
          <Problem id={`${key}-min-error`} text={numbers.min} />
          <Problem id={`${key}-study-error`} text={numbers.study} />
          <Problem id={`${key}-rest-error`} text={numbers.rest} />
          <Problem id={`${key}-block-error`} text={blockProblem} />
          <Problem id={`${key}-window-error`} text={windowProblem?.message ?? null} />
          {studies && (
            <Field
              label="Estudio semanal (h), además de las evaluaciones"
              invalid={!hoursOk}
              errorId={`${key}-hours-error`}
              value={weekly}
              onChange={(e) => setWeekly(e.target.value)}
            />
          )}
          <Problem
            id={`${key}-hours-error`}
            text={hoursOk ? null : "El estudio semanal va de 0 a 168 h."}
          />
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
          {dirty && <Unsaved />}
          <button
            type="button"
            className="btn primary"
            style={{ width: "100%", marginTop: 10 }}
            aria-disabled={!hoursOk || problem || startAfter === null ? true : undefined}
            onClick={(e) => {
              if (!hoursOk || problem || startAfter === null) {
                focusFirstInvalid(e.currentTarget.parentElement);
                return;
              }
              dispatch({
                type: "saveActivity",
                activity: {
                  ...savedActivity(activity, form, maxSession, minBlock),
                  // Another form may have taken this colour meanwhile.
                  color: taken.has(form.color.toLowerCase())
                    ? nextColor(data.activities.filter((a) => a.id !== activity.id))
                    : form.color,
                  startAfter: activity.kind === "rutina" ? undefined : (startAfter ?? undefined),
                },
              });
              if (studies && weekly !== studyHours)
                dispatch({
                  type: "weeklyStudy",
                  activityId: activity.id,
                  minutes: Math.round(hours * 60),
                });
              // Reopened, it shows what was saved.
              startSaved(startAfter ?? undefined);
              weeklySaved(weekly);
              formSaved(savedForm(activity, form, maxSession, minBlock));
              setOpen(false);
            }}
          >
            Guardar{named}
          </button>
          <button
            type="button"
            className="btn danger"
            style={{ width: "100%" }}
            onClick={() => {
              // What was being typed for it goes too.
              startSaved(activity.startAfter);
              weeklySaved(studyHours);
              onRemove();
            }}
          >
            Eliminar{named}
          </button>
        </div>
      )}
    </div>
  );
}
