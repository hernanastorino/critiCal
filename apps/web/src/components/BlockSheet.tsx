import { useRef, useState } from "react";
import { MINUTE, type PlanBlock } from "../engine.js";
import { dayAndTime, dayMonth, hours, time } from "../format.js";
import { isPinned, progress, standingCheckIns } from "../planning.js";
import { useStore } from "../store.js";
import { useModal } from "./modal.js";
import { useCheckIn } from "./useCheckIn.js";
import type { Item } from "./Week.js";

export function BlockSheet({
  item,
  onClose,
  onUndone,
  returnTo,
}: {
  item: Item;
  onClose: () => void;
  /** After «Deshacer» of an answer given here: whoever lists the block puts it back. */
  onUndone?: (blockId: string) => void;
  /** Where focus goes on closing when what opened it is gone. */
  returnTo?: () => HTMLElement | null;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  // Back to the block it shows, even if the keyboard left focus on another one.
  const justOpened = useModal(sheet, onClose, true, returnTo, !!returnTo);
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
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true">
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={onClose}>
          ✕
        </button>
        {item.kind === "event" ? (
          <EventDetail item={item} />
        ) : item.run ? (
          <BlockRun run={item.run} onDone={onClose} onUndone={onUndone} />
        ) : (
          <CheckInForm block={item.block} onDone={onClose} onUndone={onUndone} />
        )}
      </div>
    </>
  );
}

/** Blocks drawn as one pill: each with its own details and actions. */
function BlockRun({
  run,
  onDone,
  onUndone,
}: {
  run: PlanBlock[];
  onDone: () => void;
  onUndone?: (blockId: string) => void;
}) {
  return (
    <>
      <p className="meta">{run.length} bloques seguidos</p>
      {run.map((b, i) => (
        <section
          key={b.id}
          className={i > 0 ? "run-block" : undefined}
          aria-label={`Bloque ${i + 1}`}
        >
          <CheckInForm block={b} onDone={onDone} onUndone={onUndone} />
        </section>
      ))}
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
        <p className="meta">
          {e.busy
            ? "Evento fijo de tu calendario: la app planifica alrededor."
            : "No ocupa tiempo: el plan puede poner estudio encima."}
        </p>
      )}
    </>
  );
}

export function CheckInForm({
  block,
  onDone,
  onUndone,
}: {
  block: PlanBlock;
  onDone: () => void;
  onUndone?: (blockId: string) => void;
}) {
  const { data, now, dispatch } = useStore();
  const answer = useCheckIn(onUndone);
  const tz = data.settings.timezone;
  const task = data.tasks.find((t) => t.id === block.taskId);
  const activity = data.activities.find((a) => a.id === block.activityId);
  // The newest answer stands: a correction is a later check-in of the same block.
  const answered = standingCheckIns(data).find((c) => c.blockId === block.id);
  const [correcting, setCorrecting] = useState(false);
  const p = progress(data, now).find((x) => x.task.id === block.taskId);
  const length = (block.end - block.start) / MINUTE;
  const [partial, setPartial] = useState(false);
  const [percent, setPercent] = useState(50);
  const [units, setUnits] = useState<string[]>([]);
  // Correcting offers what the standing record declares even though it is done, and starts
  // with it ticked: changing the answer does not drop the parts by omission.
  const declared = answered?.unitIds ?? [];
  const pendingUnits = task?.units.filter((u) => !u.doneAt || declared.includes(u.id)) ?? [];

  const send = (status: "done" | "missed" | "partial") => {
    if (!task) return;
    answer(block, status, {
      minutesDone: Math.round((length * percent) / 100),
      unitIds: units,
    });
    setCorrecting(false);
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

      {answered && !correcting ? (
        <>
          <p className="meta">
            Ya registrado:{" "}
            {answered.status === "done"
              ? "hecho ✓"
              : answered.status === "missed"
                ? "no lo hice ✗"
                : `parcial (${hours(answered.minutesDone)})`}
          </p>
          {/* The log only grows: a correction is a new answer, the old one stays in it. */}
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            onClick={() => {
              setUnits(declared);
              setCorrecting(true);
            }}
          >
            Corregir
          </button>
        </>
      ) : !answered && block.start > now ? (
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
