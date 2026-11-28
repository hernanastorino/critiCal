import { useEffect, useRef, useState } from "react";
import { MINUTE, type PlanBlock } from "../engine.js";
import { dayAndTime, dayMonth, hours, time } from "../format.js";
import { routineWeekText, skipLoss } from "../friendly.js";
import type { CheckIn } from "../model.js";
import { needOf } from "../need.js";
import { isPinned, standingCheckIns } from "../planning.js";
import { useStore } from "../store.js";
import { ConfirmDiscard } from "./ConfirmDiscard.js";
import { EventTrip, PlaceClash } from "./EventTrip.js";
import { Marks } from "./icons.js";
import { useModal } from "./modal.js";
import { useToast } from "./Toast.js";
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
  // Parts ticked or a partial started and not sent: closing asks before dropping them.
  const pending = useRef(new Set<string>());
  const [asking, setAsking] = useState(false);
  const askClose = () => (pending.current.size > 0 ? setAsking(true) : onClose());
  const onPending = (id: string, on: boolean) => {
    if (on) pending.current.add(id);
    else pending.current.delete(id);
  };
  // Back to the block it shows, even if the keyboard left focus on another one.
  const justOpened = useModal(sheet, askClose, true, returnTo, !!returnTo);
  return (
    <>
      {/* For taps; the keyboard and VoiceOver have ✕ and Escape. */}
      <button
        type="button"
        className="scrim dim"
        aria-hidden="true"
        tabIndex={-1}
        onClick={() => {
          if (!justOpened()) askClose();
        }}
      />
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true">
        <button type="button" className="sheet-close" aria-label="Cerrar" onClick={askClose}>
          <Marks.close />
        </button>
        {item.kind === "event" ? (
          <EventDetail item={item} />
        ) : item.run ? (
          <BlockRun run={item.run} onDone={onClose} onUndone={onUndone} onPending={onPending} />
        ) : (
          <CheckInForm
            block={item.block}
            onDone={onClose}
            onUndone={onUndone}
            onPending={onPending}
          />
        )}
      </div>
      {asking && <ConfirmDiscard onKeep={() => setAsking(false)} onDiscard={onClose} />}
    </>
  );
}

/**
 * Blocks drawn as one pill, each with its own actions. A task's details go once, on its first
 * block; the next blocks of the same task show only their hours, large.
 */
function BlockRun({
  run,
  onDone,
  onUndone,
  onPending,
}: {
  run: PlanBlock[];
  onDone: () => void;
  onUndone?: (blockId: string) => void;
  onPending?: (blockId: string, on: boolean) => void;
}) {
  const { data, now, dispatch } = useStore();
  const toast = useToast();
  const answered = new Set(standingCheckIns(data).map((c) => c.blockId));
  // The ones «Soltar» would free one by one: pinned, still ahead and not answered.
  const releasable = run.filter((b) => isPinned(b) && b.start > now && !answered.has(b.id));
  return (
    <>
      <p className="meta">{run.length} bloques seguidos</p>
      {run.map((b, i) => (
        <section
          key={b.id}
          className={i > 0 ? "run-block" : undefined}
          aria-label={`Bloque ${i + 1}`}
        >
          <CheckInForm
            block={b}
            onDone={onDone}
            onUndone={onUndone}
            onPending={onPending}
            hoursOnly={i > 0 && run[i - 1]?.taskId === b.taskId}
          />
        </section>
      ))}
      {releasable.length > 1 && (
        <button
          type="button"
          className="btn run-release"
          style={{ width: "100%" }}
          onClick={() => {
            dispatch({ type: "unpinAll", blockIds: releasable.map((b) => b.id) });
            toast.show(`Soltaste ${releasable.length} bloques · el plan los reacomodó`, {
              undo: () => {
                dispatch({ type: "undoPlan" });
              },
            });
            onDone();
          }}
        >
          Soltar todo
        </button>
      )}
    </>
  );
}

function EventDetail({ item }: { item: Extract<Item, { kind: "event" }> }) {
  const { data } = useStore();
  const tz = data.settings.timezone;
  const e = item.event;
  return (
    <>
      <h2 className="event-title">{e.title}</h2>
      <p className="meta" style={{ overflowWrap: "anywhere" }}>
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
      <PlaceClash event={e} />
      <EventTrip event={e} />
    </>
  );
}

export function CheckInForm({
  block,
  onDone,
  onUndone,
  onPending,
  hoursOnly = false,
}: {
  block: PlanBlock;
  onDone: () => void;
  onUndone?: (blockId: string) => void;
  /** Whether something was picked and not sent (parts ticked, a partial started). */
  onPending?: (blockId: string, on: boolean) => void;
  /** Another block of the task just above: its hours, large, instead of the details. */
  hoursOnly?: boolean;
}) {
  const { data, now, dispatch, routineWeek } = useStore();
  const answer = useCheckIn(onUndone);
  const tz = data.settings.timezone;
  const task = data.tasks.find((t) => t.id === block.taskId);
  const activity = data.activities.find((a) => a.id === block.activityId);
  // The newest answer stands: a correction is a later check-in of the same block.
  const answered = standingCheckIns(data).find((c) => c.blockId === block.id);
  const [correcting, setCorrecting] = useState(false);
  const p = needOf(data, now, block.taskId);
  const routine = routineWeek(block.taskId, block.start);
  const length = (block.end - block.start) / MINUTE;
  const [partial, setPartial] = useState(false);
  const [percent, setPercent] = useState(50);
  const [units, setUnits] = useState<string[]>([]);
  const picked = partial || units.length > 0;
  useEffect(() => {
    onPending?.(block.id, picked);
    return () => onPending?.(block.id, false);
  }, [onPending, block.id, picked]);
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
      {hoursOnly ? (
        <h2
          aria-label={`${task?.title ?? "Bloque"}, ${time(tz, block.start)} a ${time(tz, block.end)}`}
        >
          {time(tz, block.start)} – {time(tz, block.end)}{" "}
          <span className="meta">({hours(length)})</span>
        </h2>
      ) : (
        <>
          <h2>{`${block.review ? "Repaso · " : ""}${task?.title ?? "Bloque"}`}</h2>
          <p className="meta">
            {activity?.name} · {dayAndTime(tz, block.start)} – {time(tz, block.end)} (
            {hours(length)}){task?.deadline && ` · entrega ${dayMonth(tz, task.deadline)}`}
          </p>
        </>
      )}
      {p && !hoursOnly && (
        <p className="meta">
          {routine ? (
            `${routineWeekText(routine)}. `
          ) : (
            <>
              Faltan <b>{hours(p.left)}</b> (mínimo {hours(task?.minMinutes ?? p.minimum)}).{" "}
            </>
          )}
          {block.level === "critical" && (
            <span className="tag critical">Crítico: si lo salteás no llegás al mínimo</span>
          )}
        </p>
      )}

      {answered?.origin === "slept" ? (
        <p className="meta">No hecho · dormías</p>
      ) : answered && !correcting ? (
        <>
          <p className="meta">Ya registrado: {answerText(answered)}</p>
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
          {!hoursOnly && (
            <p className="meta">Bloque planificado. Cuando termine, marcás cómo te fue.</p>
          )}
          {!hoursOnly && task?.deadline && block.level !== "critical" && (
            <p className="meta">{skipLoss(length, dayMonth(tz, task.deadline))}</p>
          )}
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
              Soltar
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
                  <span className="meta" style={{ margin: 0, whiteSpace: "nowrap" }}>
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
                <Marks.done /> Hecho
              </button>
              <button type="button" className="btn" onClick={() => setPartial(true)}>
                <Marks.partial /> Parcial
              </button>
              <button type="button" className="btn missed" onClick={() => send("missed")}>
                <Marks.missed /> No
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}

function answerText(c: CheckIn): string {
  if (c.status === "done") return "hecho ✓";
  if (c.status === "missed") return "no lo hice ✗";
  return `parcial (${hours(c.minutesDone)})`;
}
