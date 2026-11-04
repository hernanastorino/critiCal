import { useState } from "react";
import { type Activity, localParts, zonedInstant } from "../engine.js";
import { minutesToHhmm } from "../format.js";
import { type AppTask, newId, nextColor, type Unit } from "../model.js";
import { useStore } from "../store.js";

const toLocalInput = (tz: string, t: number) => {
  const p = localParts(tz, t);
  return `${p.date}T${minutesToHhmm(p.minuteOfDay)}`;
};

const fromLocalInput = (tz: string, v: string) => {
  const [date, hhmm] = v.split("T") as [string, string];
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
  const [unitTitle, setUnitTitle] = useState("");

  const save = () => {
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
      deadline: kind === "deliverable" ? fromLocalInput(tz, deadline) : undefined,
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
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
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
              <span>Partes (opcional: lo que falta se mide por partes hechas)</span>
              {units.map((u) => (
                <div key={u.id} className="check">
                  <span style={{ flex: 1, textDecoration: u.doneAt ? "line-through" : undefined }}>
                    {u.title}
                  </span>
                  <span>{u.estimateMinutes} min</span>
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
            style={{ width: "100%", marginBottom: 8 }}
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
