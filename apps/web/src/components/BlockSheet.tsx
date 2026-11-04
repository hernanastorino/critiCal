import { useState } from "react";
import { MINUTE, type PlanBlock } from "../engine.js";
import { dayAndTime, dayMonth, hours, time } from "../format.js";
import { isPinned, progress } from "../planning.js";
import { useStore } from "../store.js";
import type { Item } from "./Week.js";

export function BlockSheet({ item, onClose }: { item: Item; onClose: () => void }) {
  return (
    <>
      <button type="button" className="scrim dim" aria-label="Cerrar" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>
        {item.kind === "event" ? (
          <EventDetail item={item} />
        ) : (
          <CheckInForm block={item.block} onDone={onClose} />
        )}
      </div>
    </>
  );
}

function EventDetail({ item }: { item: Extract<Item, { kind: "event" }> }) {
  const { data } = useStore();
  const tz = data.settings.timezone;
  const e = item.event;
  return (
    <>
      <h2>{e.title}</h2>
      <p className="meta">
        {dayAndTime(tz, e.start)} – {time(tz, e.end)}
        {e.location ? ` · ${e.location}` : ""}
        {!e.busy && " · no bloquea tiempo"}
      </p>
      {e.link ? (
        <a
          className="btn primary"
          href={e.link}
          target="_blank"
          rel="noreferrer"
          style={{ display: "block" }}
        >
          Abrir en {e.source === "icloud" ? "iCloud" : "Google Calendar"}
        </a>
      ) : (
        <p className="meta">Evento fijo de tu calendario: la app planifica alrededor.</p>
      )}
    </>
  );
}

export function CheckInForm({ block, onDone }: { block: PlanBlock; onDone: () => void }) {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const task = data.tasks.find((t) => t.id === block.taskId);
  const activity = data.activities.find((a) => a.id === block.activityId);
  const answered = data.checkIns.find((c) => c.blockId === block.id);
  const p = progress(data, now).find((x) => x.task.id === block.taskId);
  const length = (block.end - block.start) / MINUTE;
  const [partial, setPartial] = useState(false);
  const [percent, setPercent] = useState(50);
  const [units, setUnits] = useState<string[]>([]);
  const pendingUnits = task?.units.filter((u) => !u.doneAt) ?? [];

  const send = (status: "done" | "missed" | "partial") => {
    if (!task) return;
    const minutesDone =
      status === "done" ? length : status === "partial" ? Math.round((length * percent) / 100) : 0;
    dispatch({
      type: "checkIn",
      checkIn: {
        blockId: block.id,
        taskId: task.id,
        status,
        minutesDone,
        unitIds: status === "missed" ? [] : units,
      },
    });
    onDone();
  };

  return (
    <>
      <h2>{task?.title ?? "Bloque"}</h2>
      <p className="meta">
        {activity?.name} · {dayAndTime(tz, block.start)} – {time(tz, block.end)} ({hours(length)})
        {task?.deadline && ` · entrega ${dayMonth(tz, task.deadline)}`}
      </p>
      {p && (
        <p className="meta">
          Faltan <b>{hours(p.remainingMinutes)}</b> (mínimo {hours(p.minRemainingMinutes)}).{" "}
          {block.level === "critical" && (
            <span className="tag critical">Crítico: si lo salteás no llegás al mínimo</span>
          )}
        </p>
      )}

      {answered ? (
        <p className="meta">
          Ya registrado:{" "}
          {answered.status === "done"
            ? "hecho ✓"
            : answered.status === "missed"
              ? "no lo hice ✗"
              : `parcial (${hours(answered.minutesDone)})`}
        </p>
      ) : block.start > now ? (
        <>
          <p className="meta">Bloque planificado. Cuando termine, marcás cómo te fue.</p>
          {isPinned(block) && (
            <button
              type="button"
              className="btn"
              style={{ width: "100%" }}
              onClick={() => {
                dispatch({ type: "unpin", blockId: block.id });
                onDone();
              }}
            >
              Soltar (que el plan decida dónde va)
            </button>
          )}
        </>
      ) : (
        <>
          {pendingUnits.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="section-title" style={{ margin: "4px 0" }}>
                ¿Qué llegaste a hacer?
              </div>
              {pendingUnits.map((u) => (
                <label key={u.id} className="check">
                  <input
                    type="checkbox"
                    checked={units.includes(u.id)}
                    onChange={(e) =>
                      setUnits(
                        e.target.checked ? [...units, u.id] : units.filter((x) => x !== u.id),
                      )
                    }
                  />
                  {u.title}{" "}
                  <span className="meta" style={{ margin: 0 }}>
                    {hours(u.estimateMinutes)}
                  </span>
                </label>
              ))}
            </div>
          )}
          {partial ? (
            <>
              <label className="field">
                <span>¿Cuánto del bloque usaste? {percent} %</span>
                <input
                  type="range"
                  min={10}
                  max={90}
                  step={10}
                  value={percent}
                  onChange={(e) => setPercent(Number(e.target.value))}
                />
              </label>
              <div className="row">
                <button type="button" className="btn" onClick={() => setPartial(false)}>
                  Volver
                </button>
                <button type="button" className="btn primary" onClick={() => send("partial")}>
                  Guardar parcial
                </button>
              </div>
            </>
          ) : (
            <div className="row">
              <button type="button" className="btn done" onClick={() => send("done")}>
                ✓ Hecho
              </button>
              <button type="button" className="btn" onClick={() => setPartial(true)}>
                ◐ Parcial
              </button>
              <button type="button" className="btn missed" onClick={() => send("missed")}>
                ✗ No
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
