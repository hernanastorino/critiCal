import { useEffect, useRef, useState } from "react";
import { useDraft } from "../drafts.js";
import type { Activity } from "../engine.js";
import { hhmmToMinutes, minutesToHhmm } from "../format.js";
import { nextColor, PALETTE } from "../model.js";
import { DEFAULT_BREAK_MINUTES, DEFAULT_STUDY_MINUTES } from "../planning.js";
import { type RemovedActivity, removedWith, useStore } from "../store.js";
import { sameName, studyOf, subjectsOf } from "../subjects.js";
import { clampMinutes, Field, toHours, Unsaved } from "./fields.js";
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
      form.from && form.to
        ? { start: hhmmToMinutes(form.from), end: hhmmToMinutes(form.to) }
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
    max: String(maxSession),
    min: String(minBlock),
    study: String(clampMinutes(form.study, 5, 240) ?? activity.studyMinutes ?? form.study),
    rest: String(clampMinutes(form.rest, 0, 120) ?? activity.breakMinutes ?? form.rest),
  };
}

/** Per-subject colour and study rules. */
export function ActivitySettings() {
  const { data, dispatch } = useStore();
  const toast = useToast();
  /**
   * What was deleted while the notice is up: several in a row share one «Deshacer»,
   * so none is lost because the next notice replaced its own.
   */
  const recent = useRef<{ removed: RemovedActivity; at: number }[]>([]);
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
    recent.current = [...recent.current.filter((r) => at - r.at < UNDO_MS), { removed, at }];
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
    !studies || weekly.trim() === "" || (Number.isFinite(hours) && hours >= 0 && hours <= 168);
  // Two «Nadar» would be told apart by nothing (adding one is refused the same way).
  const repeated = data.activities.some((a) => a.id !== activity.id && sameName(a.name, form.name));
  const maxSession = clampMinutes(form.max, 30, 480) ?? activity.maxSessionMinutes;
  const minBlock = clampMinutes(form.min, 30, 480) ?? activity.minBlockMinutes;
  // A minimum block longer than a session could never be planned, nor a window that ends
  // before it starts. Each message sits right under the fields it is about.
  const blockProblem =
    minBlock > maxSession ? "El bloque mínimo no puede ser más largo que la sesión máxima." : null;
  const windowProblem =
    form.from && form.to && hhmmToMinutes(form.from) >= hhmmToMinutes(form.to)
      ? "«Prefiero desde» tiene que ser antes de «hasta»."
      : null;
  const nameProblem = repeated ? "Ya hay una materia o rutina con ese nombre." : null;
  const problem = nameProblem ?? blockProblem ?? windowProblem;
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
          <span className="meta" style={{ margin: 0 }}>
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
              maxLength={60}
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
              invalid={!!blockProblem}
              errorId={`${key}-block-error`}
              value={form.max}
              onChange={(e) => setForm({ ...form, max: e.target.value })}
            />
            <Field
              label="Bloque mínimo (min)"
              invalid={!!blockProblem}
              errorId={`${key}-block-error`}
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
              invalid={!!windowProblem}
              errorId={`${key}-window-error`}
              value={form.from}
              onChange={(e) => setForm({ ...form, from: e.target.value })}
            />
            <Field
              label="hasta"
              type="time"
              invalid={!!windowProblem}
              errorId={`${key}-window-error`}
              value={form.to}
              onChange={(e) => setForm({ ...form, to: e.target.value })}
            />
          </div>
          <Problem id={`${key}-block-error`} text={blockProblem} />
          <Problem id={`${key}-window-error`} text={windowProblem} />
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
            disabled={!hoursOk || !!problem || startAfter === null}
            onClick={() => {
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

/** A form error, right under its fields; empty when there is none. */
function Problem({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <p id={id} className="meta" role="alert" style={{ color: "var(--critical)" }}>
      {text}
    </p>
  ) : null;
}
