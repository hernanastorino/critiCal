import { useState } from "react";
import { dayAndTime, dayDate, hours } from "../format";
import type { AppTask } from "../model";
import { endOfWeek, progress } from "../planning";
import { type RecurrenceChange, useStore } from "../store";
import { ActionSheet } from "./ActionSheet";

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
  const [ask, setAsk] = useState<"off" | "delete" | null>(null);
  const live = data.tasks.find((t) => t.id === task.id) ?? task;
  const repeat = (change: RecurrenceChange) => {
    dispatch({ type: "recurrence", taskId: task.id, change });
    setAsk(null);
    if (change !== "resume") onClose();
  };
  const offState = live.paused
    ? "Pausado hasta que lo reactives."
    : (live.skipUntil ?? 0) > now
      ? `Salteado esta semana · vuelve el ${dayDate(tz, live.skipUntil as number)}.`
      : null;
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

        {(task.kind === "habit" || offState) && (
          <div className="repeat">
            <div className="section-title">Se repite cada semana</div>
            {offState && <p className="state">{offState}</p>}
            <div className="row">
              {offState ? (
                <button type="button" className="btn" onClick={() => repeat("resume")}>
                  Reactivar
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => setAsk("off")}>
                  Desactivar…
                </button>
              )}
              <button type="button" className="btn danger" onClick={() => setAsk("delete")}>
                Eliminar…
              </button>
            </div>
          </div>
        )}
      </div>
      {ask === "off" && (
        <ActionSheet
          title={`Desactivar ${task.title}`}
          message="Las semanas anteriores no cambian."
          onCancel={() => setAsk(null)}
          options={[
            {
              label: "Solo esta semana",
              detail: `Vuelve el ${dayDate(tz, endOfWeek(tz, now))}`,
              onPick: () => repeat("skipWeek"),
            },
            {
              label: "Hasta que lo reactive",
              detail: "Lo podés volver a prender desde este silo",
              onPick: () => repeat("pause"),
            },
          ]}
        />
      )}
      {ask === "delete" && (
        <ActionSheet
          title={`Eliminar ${task.title}`}
          message="Es un silo que se repite cada semana."
          onCancel={() => setAsk(null)}
          options={[
            {
              label: "Eliminar de hoy en adelante",
              detail: "Las semanas anteriores quedan en tu historial",
              danger: true,
              onPick: () => repeat("endFromToday"),
            },
            {
              label: "Eliminar todo",
              detail: "También borra lo registrado en semanas anteriores",
              danger: true,
              onPick: () => repeat("deleteAll"),
            },
          ]}
        />
      )}
    </>
  );
}
