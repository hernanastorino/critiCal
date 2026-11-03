import { useState } from "react";
import { dayAndTime, hours } from "../format";
import type { AppTask } from "../model";
import { progress } from "../planning";
import { useStore } from "../store";

/** Silo detail: what is left and a quick "this is how far I got" log. */
export function TaskDetail({
  task,
  onEdit,
  onClose,
}: {
  task: AppTask;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const p = progress(data, now).find((x) => x.task.id === task.id);
  const [minutes, setMinutes] = useState("");
  const [topics, setTopics] = useState("");
  const [topicsDone, setTopicsDone] = useState("");
  const [units, setUnits] = useState<string[]>([]);
  const pending = task.units.filter((u) => !u.doneAt);
  const done = task.units.length - pending.length;

  return (
    <>
      <button type="button" className="scrim dim" aria-label="Cerrar" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={task.title}>
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>
        <h2>{task.title}</h2>
        <p className="meta">
          {p && `Faltan ${hours(p.remainingMinutes)} (mínimo ${hours(p.minRemainingMinutes)})`}
          {task.deadline && ` · ${dayAndTime(tz, task.deadline)}`}
        </p>

        <div className="section-title" style={{ marginTop: 4 }}>
          Registrar avance
        </div>
        <label className="field">
          <span>Le dediqué (minutos)</span>
          <input
            inputMode="numeric"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            placeholder="40"
          />
        </label>
        {task.units.length > 0 ? (
          <div className="field">
            <span>
              Partes hechas ({done} de {task.units.length})
            </span>
            {pending.map((u) => (
              <label key={u.id} className="check">
                <input
                  type="checkbox"
                  checked={units.includes(u.id)}
                  onChange={(e) =>
                    setUnits(e.target.checked ? [...units, u.id] : units.filter((x) => x !== u.id))
                  }
                />
                {u.title}
              </label>
            ))}
          </div>
        ) : (
          <div className="grid2">
            <label className="field">
              <span>Temas en total</span>
              <input
                inputMode="numeric"
                value={topics}
                onChange={(e) => setTopics(e.target.value)}
                placeholder="10"
              />
            </label>
            <label className="field">
              <span>Llevo hechos</span>
              <input
                inputMode="numeric"
                value={topicsDone}
                onChange={(e) => setTopicsDone(e.target.value)}
                placeholder="6"
              />
            </label>
          </div>
        )}
        <div className="row">
          <button type="button" className="btn" onClick={onEdit}>
            Editar
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              const total = Math.max(0, Math.round(Number(topics) || 0));
              dispatch({
                type: "logProgress",
                taskId: task.id,
                minutes: Number(minutes) || 0,
                unitIds: units,
                topics: total || undefined,
                topicsDone: Math.min(total, Math.max(0, Math.round(Number(topicsDone) || 0))),
              });
              onClose();
            }}
          >
            Guardar avance
          </button>
        </div>
      </div>
    </>
  );
}
