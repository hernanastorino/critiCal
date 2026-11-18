import { useRef, useState } from "react";
import { DEFAULTS } from "../calendars.js";
import { useDraft } from "../drafts.js";
import { localParts, zonedInstant } from "../engine.js";
import { dayDate } from "../format.js";
import { holidaysBetween } from "../holidays.js";
import { dateError, deadlineMaxYear, isBlank, TITLE_MAX } from "../limits.js";
import { type AppTask, newId, nextColor } from "../model.js";
import { useStore } from "../store.js";
import { hasClasses, sameName, subjectsOf } from "../subjects.js";
import { focusFirstInvalid, isFigure, Problem } from "./fields.js";
import { Section, useSectionOpen } from "./Section.js";
import { useToast } from "./Toast.js";

/** Inicio de cuatrimestre: dates, holidays in between, subjects and exams in one go. */
export function Semester() {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  const semester = data.preferences?.semester;
  const [start, setStart, startSaved] = useDraft("semester:start", () => semester?.start ?? today);
  const [end, setEnd, endSaved] = useDraft("semester:end", () => semester?.end ?? "");
  const [subject, setSubject, , subjectDirty] = useDraft("semester:subject", () => "");
  const [weekly, setWeekly, , weeklyDirty] = useDraft("semester:weekly", () => "");
  const [typedExam, setExam, examSaved, examDirty] = useDraft("semester:exam", () => ({
    activityId: "",
    title: "Parcial",
    date: "",
  }));
  const toast = useToast();
  // The calendar's titles are only worked out once its screen is on view.
  const open = useSectionOpen();
  // Dates are saved with their button; the rest is typed for a button below.
  const unsaved =
    start !== (semester?.start ?? today) ||
    end !== (semester?.end ?? "") ||
    subjectDirty ||
    weeklyDirty ||
    examDirty;
  const holidaysOn = data.preferences?.holidaysOff !== false;
  const subjects = subjectsOf(data);
  // A kept draft may name a materia that is gone since.
  const exam = subjects.some((a) => a.id === typedExam.activityId)
    ? typedExam
    : { ...typedExam, activityId: "" };
  // Both dates are needed: an empty start would mean "from year 0".
  /** A date the browser holds but cannot read (31/02): its value is empty, though typed. */
  const [unreal, setUnreal] = useState({ start: false, end: false });
  const noDate = "Esa fecha no existe.";
  const startProblem = unreal.start ? noDate : dateError(start, now);
  const endProblem = unreal.end ? noDate : dateError(end, now);
  const examProblem = dateError(exam.date, now);
  const holidays =
    start && end && end >= start && !startProblem && !endProblem ? holidaysBetween(start, end) : [];

  const prefs = (patch: Partial<NonNullable<typeof data.preferences>>) =>
    dispatch({ type: "preferences", preferences: { ...data.preferences, ...patch } });

  const repeated = data.activities.some((a) => sameName(a.name, subject));
  const subjectField = useRef<HTMLInputElement>(null);
  // Blank means no weekly silo; otherwise a figure of at most a whole week (as in Materias).
  const hoursNum = Number(weekly.replace(",", "."));
  const hoursOk = weekly.trim() === "" || (isFigure(weekly) && hoursNum >= 0 && hoursNum <= 168);
  const backwards = !!start && !!end && end < start;
  const addSubject = (e: React.MouseEvent<HTMLButtonElement>) => {
    const name = subject.trim().replace(/\s+/g, " ");
    if (!hoursOk) {
      focusFirstInvalid(e.currentTarget.parentElement);
      return;
    }
    if (isBlank(name) || repeated) return;
    const activity = {
      id: newId(),
      name,
      color: nextColor(data.activities),
      academic: true,
      kind: "materia" as const,
      maxSessionMinutes: 120,
      minBlockMinutes: 60,
    };
    const hoursPerWeek = Number(weekly.replace(",", "."));
    if (hoursPerWeek > 0) {
      // A weekly minimum is a weekly silo of one-hour sessions.
      const task: AppTask = {
        id: newId(),
        activityId: activity.id,
        title: `Estudio ${name}`,
        study: true,
        kind: "habit",
        estimateMinutes: 0,
        minMinutes: Math.round(hoursPerWeek * 60),
        sessionsPerWeek: Math.ceil(hoursPerWeek),
        sessionMinutes: 60,
        priority: 2,
        status: "active",
        units: [],
      };
      dispatch({ type: "saveTask", task, activity });
    } else {
      dispatch({ type: "saveActivity", activity });
    }
    setSubject("");
    setWeekly("");
    toast.show(`${name} agregada`);
    // The button may be gone from under the keyboard: it goes back to the name field.
    subjectField.current?.focus();
  };

  const addExam = () => {
    if (!exam.activityId || !exam.date || examProblem) return;
    const d = DEFAULTS.parcial;
    const task: AppTask = {
      id: newId(),
      activityId: exam.activityId,
      title: exam.title.trim() || "Parcial",
      kind: "deliverable",
      // A parcial, examen or prueba gets spaced review; an entrega does not.
      exam: /\b(parcial|examen|prueba|final)\b/i.test(exam.title || "Parcial") || undefined,
      deadline: zonedInstant(tz, exam.date, 8 * 60),
      estimateMinutes: d.estimate,
      minMinutes: d.min,
      priority: d.priority,
      status: "active",
      units: [],
    };
    dispatch({ type: "saveTask", task });
    examSaved({ ...exam, date: "" });
    toast.show(`${task.title} agregado`);
  };

  return (
    <Section>
      {open && (
        <>
          <div className="row fields">
            <label className="field" style={{ flex: 1 }}>
              <span>Empieza</span>
              <input
                type="date"
                value={start}
                min="2000-01-01"
                max={`${deadlineMaxYear(now)}-12-31`}
                aria-invalid={startProblem ? true : undefined}
                aria-describedby={startProblem ? "semester-start-error" : undefined}
                onChange={(e) => {
                  setStart(e.target.value);
                  setUnreal((u) => ({ ...u, start: e.target.validity.badInput }));
                }}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Termina</span>
              <input
                type="date"
                value={end}
                min="2000-01-01"
                max={`${deadlineMaxYear(now)}-12-31`}
                aria-invalid={backwards || endProblem ? true : undefined}
                aria-describedby={
                  endProblem
                    ? "semester-end-date-error"
                    : backwards
                      ? "semester-end-error"
                      : undefined
                }
                onChange={(e) => {
                  setEnd(e.target.value);
                  setUnreal((u) => ({ ...u, end: e.target.validity.badInput }));
                }}
              />
            </label>
          </div>
          <Problem id="semester-start-error" text={startProblem} />
          <Problem id="semester-end-date-error" text={endProblem} />
          <Problem
            id="semester-end-error"
            text={backwards ? "«Termina» no puede ser anterior a «Empieza»." : null}
          />
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            disabled={!start || !end}
            aria-disabled={backwards || startProblem || endProblem ? true : undefined}
            onClick={(e) => {
              if (backwards || startProblem || endProblem) {
                focusFirstInvalid(e.currentTarget.parentElement);
                return;
              }
              prefs({ semester: { start, end } });
              startSaved(start);
              endSaved(end);
              toast.show("Fechas guardadas");
            }}
          >
            Guardar fechas
          </button>

          <label className="check">
            <input
              type="checkbox"
              checked={holidaysOn}
              onChange={(e) => prefs({ holidaysOff: e.target.checked ? undefined : false })}
            />
            <span>Los feriados se planifican como domingo</span>
          </label>
          {holidays.length > 0 && (
            <p className="meta">
              Feriados:{" "}
              {holidays
                .map((h) => `${dayDate(tz, zonedInstant(tz, h.date, 720))} ${h.name}`)
                .join(" · ")}
            </p>
          )}

          <div className="title" style={{ marginTop: 12 }}>
            Materias
          </div>
          <p className="meta">
            {subjects.map((a) => a.name).join(", ") || "Todavía ninguna."}
            {hasClasses(data)
              ? " Las clases nuevas de tu calendario de clases aparecen en la Bandeja."
              : " Marcá tu calendario de clases como «Clases (materias)» en Calendarios para sumarlas solas."}
          </p>
          <div className="row fields">
            <label className="field" style={{ flex: 2 }}>
              <span>Materia</span>
              <input
                ref={subjectField}
                value={subject}
                maxLength={60}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Física II"
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Estudio semanal (h)</span>
              <input
                inputMode="decimal"
                value={weekly}
                aria-invalid={hoursOk ? undefined : true}
                aria-describedby={hoursOk ? undefined : "semester-hours-error"}
                onChange={(e) => setWeekly(e.target.value)}
              />
            </label>
          </div>
          <Problem
            id="semester-hours-error"
            text={hoursOk ? null : "El estudio semanal va de 0 a 168 h."}
          />
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            disabled={isBlank(subject) || repeated}
            aria-disabled={hoursOk ? undefined : true}
            onClick={addSubject}
          >
            Agregar materia
          </button>
          <Problem
            id="semester-name-error"
            text={repeated && subject.trim() ? "Ya hay una materia o rutina con ese nombre." : null}
          />
          {unsaved && (
            <p className="meta" style={{ margin: "6px 0 0" }}>
              Cambios sin guardar
            </p>
          )}

          {subjects.length > 0 && (
            <>
              <div className="title" style={{ marginTop: 12 }}>
                Parciales y entregas
              </div>
              <div className="row fields wraps">
                <label className="field" style={{ flex: 1 }}>
                  <span>De la materia</span>
                  <select
                    value={exam.activityId}
                    onChange={(e) => setExam({ ...exam, activityId: e.target.value })}
                  >
                    <option value="">Elegí…</option>
                    {subjects.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>Qué</span>
                  <input
                    value={exam.title}
                    maxLength={TITLE_MAX}
                    onChange={(e) => setExam({ ...exam, title: e.target.value })}
                  />
                </label>
                <label className="field wide-narrow">
                  <span>Fecha</span>
                  <input
                    type="date"
                    value={exam.date}
                    min="2000-01-01"
                    max={`${deadlineMaxYear(now)}-12-31`}
                    aria-invalid={examProblem ? true : undefined}
                    aria-describedby={examProblem ? "semester-exam-error" : undefined}
                    onChange={(e) => setExam({ ...exam, date: e.target.value })}
                  />
                </label>
              </div>
              <Problem id="semester-exam-error" text={examProblem} />
              <button
                type="button"
                className="btn"
                style={{ width: "100%" }}
                disabled={!exam.activityId || !exam.date || !!examProblem}
                onClick={addExam}
              >
                Agregar
              </button>
            </>
          )}
        </>
      )}
    </Section>
  );
}
