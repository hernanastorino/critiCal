import { useState } from "react";
import { type Activity, localParts, zonedInstant } from "../engine.js";
import { minutesToHhmm } from "../format.js";
import { deadlineInRange, deadlineMaxYear } from "../limits.js";
import { type AppTask, newId, nextColor, type Unit } from "../model.js";
import { useStore } from "../store.js";

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
  const tz = data.settings.timezone;
  const [title, setTitle] = useState(task?.title ?? "");
  const [activityId, setActivityId] = useState(task?.activityId ?? data.activities[0]?.id ?? "new");
  const [newActivity, setNewActivity] = useState("");
  const [kind, setKind] = useState<AppTask["kind"]>(task?.kind ?? "deliverable");
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
  const [deadlineError, setDeadlineError] = useState<string | null>(null);

  const save = () => {
    const due = kind === "deliverable" ? fromLocalInput(tz, deadline) : undefined;
    if (due !== undefined && !deadlineInRange(due, now)) {
      setDeadlineError(`Elegí una fecha entre el 1/1/2000 y el 31/12/${deadlineMaxYear(now)}.`);
      return;
    }
    let actId = activityId;
    let activity: Activity | undefined;
    if (actId === "new") {
      if (!newActivity.trim()) return;
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
      title: title.trim() || "Sin título",
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
      dayBeforeOnly: (kind === "deliverable" && isExam && dayBefore) || undefined,
    };
    dispatch({ type: "saveTask", task: next, activity });
    onSaved?.(next);
    onClose();
  };

  return (
    <>
      <button type="button" className="scrim dim" aria-label="Cerrar" onClick={onClose} />
      <div
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
            className={`btn small${kind === "deliverable" ? " primary" : ""}`}
            onClick={() => setKind("deliverable")}
          >
            Entrega / parcial
          </button>
          <button
            type="button"
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
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Parcial Física I"
          />
        </label>
        <label className="field">
          <span>Materia o actividad</span>
          <select value={activityId} onChange={(e) => setActivityId(e.target.value)}>
            {data.activities.map((a) => (
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
              onChange={(e) => setNewActivity(e.target.value)}
              placeholder="Física I"
            />
          </label>
        )}
        {kind === "deliverable" ? (
          <>
            <label className="field">
              <span>Fecha límite</span>
              <input
                type="datetime-local"
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
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>Mínimo (horas)</span>
                <input
                  inputMode="decimal"
                  value={minimum}
                  onChange={(e) => setMinimum(e.target.value)}
                />
              </label>
            </div>
            <div className="field">
              <span>
                Partes (opcional: lo que falta se mide por partes hechas). Con peso, si no llegás se
                pueden dejar afuera las que menos pesan.
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
                  value={unitTitle}
                  onChange={(e) => setUnitTitle(e.target.value)}
                  placeholder="Práctico 5 (60)"
                />
                <button
                  type="button"
                  className="btn small"
                  onClick={() => {
                    const m = unitTitle.match(/^(.*?)\s*\((\d+)\)\s*$/);
                    if (!unitTitle.trim()) return;
                    setUnits([
                      ...units,
                      {
                        id: newId(),
                        title: (m?.[1] ?? unitTitle).trim(),
                        estimateMinutes: Number(m?.[2] ?? 60),
                      },
                    ]);
                    setUnitTitle("");
                  }}
                >
                  Agregar
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>Veces por semana</span>
              <input
                inputMode="numeric"
                value={sessions}
                onChange={(e) => setSessions(e.target.value)}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>Minutos por vez</span>
              <input
                inputMode="numeric"
                value={sessionMin}
                onChange={(e) => setSessionMin(e.target.value)}
              />
            </label>
          </div>
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
                onClose();
              }}
            >
              Archivar
            </button>
          )}
          <button type="button" className="btn primary" onClick={save}>
            Guardar
          </button>
        </div>
      </div>
    </>
  );
}
