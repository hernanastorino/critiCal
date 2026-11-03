import { localParts, MINUTE, type PlanBlock, zonedInstant } from "@critical/engine";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { visibleEvents } from "../calendars";
import { dropTarget, nearestFree } from "../drag";
import { dayAndTime, dayMonth, hours, time, weekdayShort } from "../format";
import type { AppEvent } from "../model";
import { isPinned, pinId, progress, weekDates } from "../planning";
import { useStore } from "../store";
import { BlockSheet } from "./BlockSheet";
import { SyncDot } from "./Calendars";
import { ChevronLeft, ChevronRight, CriticalIcon, EditIcon, GearIcon, ReplanIcon } from "./icons";

export type Item =
  | { kind: "block"; id: string; start: number; end: number; block: PlanBlock }
  | { kind: "event"; id: string; start: number; end: number; event: AppEvent };

interface Bubble {
  item: Item;
  x: number;
  y: number;
}

const DAY_MS = 86_400_000;
/** Hold this long on a block to start dragging it outside edit mode. */
const LONG_PRESS_MS = 400;

interface Drag {
  id: string;
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Finger offset from the block's top edge. */
  grab: number;
  minutes: number;
  /** False while a long-press is still deciding between a drag and a scroll. */
  active: boolean;
  /** Where the block would land if dropped now. */
  target?: { date: string; minute: number } | null;
}

/** Minute of day as the axis writes it: "14" on the hour, "14:30" otherwise. */
const clock = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return m % 60 === 0 ? `${h}` : `${h}:${String(m % 60).padStart(2, "0")}`;
};

export function Week({ onSettings }: { onSettings: () => void }) {
  const { data, now, result, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [offset, setOffset] = useState(0);
  const [replanning, setReplanning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** When the last long-press drag ended; the click right after it is not a tap. */
  const droppedAt = useRef(0);
  const weekRef = useRef<HTMLDivElement>(null);

  // iOS scrolls on touchmove unless told not to; a live drag owns the finger.
  useEffect(() => {
    const el = weekRef.current;
    const hold = (e: TouchEvent) => {
      if (dragRef.current?.active) e.preventDefault();
    };
    el?.addEventListener("touchmove", hold, { passive: false });
    return () => {
      el?.removeEventListener("touchmove", hold);
      clearTimeout(pressTimer.current);
    };
  }, []);
  const [toast, setToast] = useState<string | null>(null);
  const [critical, setCritical] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [open, setOpen] = useState<Item | null>(null);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2500);
  };

  const ref = now + offset * 7 * DAY_MS;
  const dates = weekDates(tz, ref);
  const today = localParts(tz, now).date;

  // Visible span: earliest wake to latest bedtime of the week.
  const startMin = Math.min(...data.settings.week.map((d) => d.wake));
  const endMin = Math.max(
    ...data.settings.week.map((d) => (d.bed <= d.wake ? d.bed + 1440 : d.bed)),
  );
  const span = endMin - startMin;

  const items = useMemo(() => {
    const all: Item[] = [
      ...visibleEvents(data)
        .filter((e) => !e.allDay)
        .map((e) => ({ kind: "event" as const, id: e.id, start: e.start, end: e.end, event: e })),
      ...data.plan.map((b) => ({
        kind: "block" as const,
        id: b.id,
        start: b.start,
        end: b.end,
        block: b,
      })),
    ];
    return all;
  }, [data]);

  const colorOf = (b: PlanBlock) =>
    data.activities.find((a) => a.id === b.activityId)?.color ?? "#888";
  const anyCritical = data.plan.some((b) => b.level === "critical" && b.end > now);
  const short = result.status.filter((s) => s.minDeficit > 0);
  const titleOfTask = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? "una tarea";

  const position = (date: string, item: { start: number; end: number }): CSSProperties | null => {
    const top = zonedInstant(tz, date, startMin);
    const bottom = zonedInstant(tz, date, endMin);
    const s = Math.max(item.start, top);
    const e = Math.min(item.end, bottom);
    if (e <= s) return null;
    return {
      top: `${((s - top) / (bottom - top)) * 100}%`,
      height: `${((e - s) / (bottom - top)) * 100}%`,
    };
  };

  const hourMarks = [9, 12, 15, 18, 21].filter((h) => h * 60 > startMin && h * 60 < endMin);
  // While dragging: the landing start and end, in red on the hour axis.
  const dragMarks =
    drag?.active && drag.target ? [drag.target.minute, drag.target.minute + drag.minutes] : [];
  const draggedBlock = drag ? data.plan.find((b) => b.id === drag.id) : undefined;

  /** Snapped landing slot under the finger, moved off fixed events and other pins. */
  const landing = (x: number, y: number, minutes: number, blockId: string) => {
    const slot = data.settings.slotMinutes;
    const spot = dropTarget(
      [...document.querySelectorAll<HTMLElement>("[data-date]")].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          date: el.dataset.date as string,
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        };
      }),
      x,
      y,
      startMin,
      endMin,
      minutes,
      slot,
    );
    if (!spot) return null;
    const midnight = zonedInstant(tz, spot.date, 0);
    const toMinute = (t: number) => (t - midnight) / MINUTE;
    const busy = [
      ...items.filter((i) => i.kind === "event" && i.event.busy),
      ...(data.pins ?? []).filter((p) => p.id !== blockId),
    ].map((i) => ({ start: toMinute(i.start), end: toMinute(i.end) }));
    const earliest = Math.max(startMin, Math.floor(toMinute(now) / slot) * slot + slot);
    const minute = nearestFree(spot.minute, minutes, busy, slot, earliest, endMin);
    return minute === null ? null : { date: spot.date, minute };
  };

  const drop = (blockId: string, d: Drag, x: number, y: number) => {
    const target = landing(x, y - d.grab, d.minutes, blockId);
    if (target) {
      dispatch({ type: "pin", blockId, start: zonedInstant(tz, target.date, target.minute) });
    }
  };

  return (
    <div className="week-wrap">
      <div className="header">
        <button
          type="button"
          className="icon-btn"
          aria-label="Semana anterior"
          onClick={() => setOffset(offset - 1)}
        >
          <ChevronLeft />
        </button>
        <h1 className={`range${offset === 0 ? " current" : ""}`}>
          {dayMonth(tz, zonedInstant(tz, dates[0] as string, 720))} –{" "}
          {dayMonth(tz, zonedInstant(tz, dates[6] as string, 720))}
        </h1>
        <button
          type="button"
          className="icon-btn"
          aria-label="Semana siguiente"
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRight />
        </button>
        <button
          type="button"
          className={`icon-btn${editing ? " active" : ""}`}
          aria-label="Modo edición"
          aria-pressed={editing}
          onClick={() => {
            setEditing(!editing);
            setBubble(null);
          }}
        >
          <EditIcon />
        </button>
        <button
          type="button"
          className={`icon-btn replan${replanning ? " spinning" : ""}`}
          aria-label="Reacomodar semana"
          onClick={() => {
            setReplanning(true);
            dispatch({ type: "replanWeek" });
            setTimeout(() => {
              setReplanning(false);
              flash(`Semana reacomodada · ${time(tz, Date.now())}`);
            }, 600);
          }}
        >
          <ReplanIcon />
        </button>
        <SyncDot onClick={onSettings} />
        <button type="button" className="icon-btn" aria-label="Ajustes" onClick={onSettings}>
          <GearIcon />
        </button>
      </div>

      {editing && (
        <div className="edit-banner" role="status">
          Arrastrá los bloques a donde quieras. Quedan fijados y el resto se reacomoda.
          <button type="button" className="btn small" onClick={() => setEditing(false)}>
            Listo
          </button>
        </div>
      )}
      <div
        ref={weekRef}
        className={`week${critical ? " critical-mode" : ""}${editing ? " editing" : ""}${drag?.active ? " dragging-on" : ""}`}
        data-testid="week"
      >
        <div />
        {dates.map((d) => {
          const noon = zonedInstant(tz, d, 720);
          return (
            <div key={d} className={`day-head${d === today ? " today" : ""}`}>
              {weekdayShort(tz, noon)}
              <b>{Number(d.slice(8))}</b>
            </div>
          );
        })}
        <div className="hours" aria-hidden>
          {hourMarks.map((h) => (
            <span
              key={h}
              className={dragMarks.includes(h * 60) ? "hot" : undefined}
              style={{ top: `${((h * 60 - startMin) / span) * 100}%` }}
            >
              {h}
            </span>
          ))}
          {dragMarks
            .filter((m) => !hourMarks.includes(m / 60))
            .map((m) => (
              <span
                key={`drag-${m}`}
                className="hot"
                style={{ top: `${((m - startMin) / span) * 100}%` }}
              >
                {clock(m)}
              </span>
            ))}
        </div>
        {dates.map((d) => (
          <div key={d} className="day" data-date={d}>
            {items.map((item) => {
              const style = position(d, item);
              if (!style) return null;
              const past = item.end <= now;
              if (item.kind === "event") {
                return (
                  <button
                    key={`${d}-${item.id}`}
                    type="button"
                    aria-label={`${item.event.title}, ${time(tz, item.start)}`}
                    className={`pill fixed${item.event.busy ? "" : " free"}${past ? " past" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                    style={style}
                    onClick={(e) => setBubble({ item, x: e.clientX, y: e.clientY })}
                  />
                );
              }
              const b = item.block;
              const future = item.start > now;
              const movable = editing && future;
              const dragged = drag?.id === b.id;
              const lifted = dragged && drag.active;
              return (
                <button
                  key={`${d}-${item.id}`}
                  type="button"
                  data-level={b.level}
                  aria-label={`${titleOf(b)}, ${time(tz, item.start)}${isPinned(b) ? ", fijado" : ""}`}
                  className={`pill planned ${b.level ?? "ok"}${past ? " past" : ""}${isPinned(b) ? " pinned" : ""}${movable ? " movable" : ""}${lifted ? " dragging" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                  style={{ ...style, ["--c" as string]: colorOf(b) }}
                  onPointerDown={
                    future
                      ? (e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const press: Drag = {
                            id: b.id,
                            x0: e.clientX,
                            y0: e.clientY,
                            x: e.clientX,
                            y: e.clientY,
                            grab: e.clientY - rect.top,
                            minutes: (b.end - b.start) / MINUTE,
                            active: editing,
                          };
                          if (editing) e.currentTarget.setPointerCapture?.(e.pointerId);
                          else {
                            const el = e.currentTarget;
                            const pointer = e.pointerId;
                            clearTimeout(pressTimer.current);
                            pressTimer.current = setTimeout(() => {
                              const live = dragRef.current;
                              if (live?.id !== b.id) return;
                              el.setPointerCapture?.(pointer);
                              navigator.vibrate?.(10);
                              setDrag({ ...live, active: true });
                            }, LONG_PRESS_MS);
                          }
                          setDrag(press);
                        }
                      : undefined
                  }
                  onPointerMove={
                    dragged
                      ? (e) => {
                          const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
                          if (!drag.active) {
                            // Moving before the long-press fires is a scroll, not a drag.
                            if (moved > 8) {
                              clearTimeout(pressTimer.current);
                              setDrag(null);
                            }
                            return;
                          }
                          const target =
                            moved < 6
                              ? null
                              : landing(e.clientX, e.clientY - drag.grab, drag.minutes, b.id);
                          setDrag({ ...drag, x: e.clientX, y: e.clientY, target });
                        }
                      : undefined
                  }
                  ref={b.id === focusId ? (el) => el?.focus() : undefined}
                  onKeyDown={
                    movable
                      ? (e) => {
                          // Arrows move by one slot (up/down) or one day (left/right).
                          const slot = data.settings.slotMinutes * MINUTE;
                          const step = {
                            ArrowUp: -slot,
                            ArrowDown: slot,
                            ArrowLeft: -24 * 60 * MINUTE,
                            ArrowRight: 24 * 60 * MINUTE,
                          }[e.key];
                          if (step === undefined) return;
                          e.preventDefault();
                          const start = b.start + step;
                          if (start <= now) return;
                          dispatch({ type: "pin", blockId: b.id, start });
                          setFocusId(pinId(b.taskId, start));
                        }
                      : undefined
                  }
                  onPointerCancel={
                    dragged
                      ? () => {
                          clearTimeout(pressTimer.current);
                          setDrag(null);
                        }
                      : undefined
                  }
                  onPointerUp={
                    dragged
                      ? (e) => {
                          clearTimeout(pressTimer.current);
                          setDrag(null);
                          if (!drag.active) return; // a plain tap: onClick opens it
                          if (!editing) droppedAt.current = Date.now();
                          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) {
                            if (editing) setBubble({ item, x: e.clientX, y: e.clientY });
                            return;
                          }
                          drop(b.id, drag, e.clientX, e.clientY);
                        }
                      : undefined
                  }
                  onContextMenu={future ? (e) => e.preventDefault() : undefined}
                  onClick={(e) => {
                    // The click that ends a long-press drag is not a tap.
                    if (Date.now() - droppedAt.current < 400) return;
                    // Pointer taps on movable blocks open from onPointerUp; keyboard clicks (detail 0) here.
                    if (!movable || e.detail === 0) setBubble({ item, x: e.clientX, y: e.clientY });
                  }}
                />
              );
            })}
            {drag?.active &&
              drag.target?.date === d &&
              draggedBlock &&
              (() => {
                const start = zonedInstant(tz, d, drag.target.minute);
                const ghost = position(d, { start, end: start + drag.minutes * MINUTE });
                return (
                  ghost && (
                    <div
                      className="pill planned ghost"
                      aria-hidden
                      style={{ ...ghost, ["--c" as string]: colorOf(draggedBlock) }}
                    />
                  )
                );
              })()}
            {d === today &&
              now > zonedInstant(tz, d, startMin) &&
              now < zonedInstant(tz, d, endMin) && (
                <div
                  className="now-line"
                  style={{
                    top: `${((now - zonedInstant(tz, d, startMin)) / (zonedInstant(tz, d, endMin) - zonedInstant(tz, d, startMin))) * 100}%`,
                  }}
                />
              )}
          </div>
        ))}
        {dragMarks.length > 0 && (
          <div className="guides" aria-hidden>
            {dragMarks.map((m) => (
              <div key={m} className="guide" style={{ top: `${((m - startMin) / span) * 100}%` }} />
            ))}
          </div>
        )}
      </div>
      {drag?.active && drag.target && draggedBlock && (
        <Loupe
          x={drag.x}
          y={drag.y}
          date={drag.target.date}
          minute={drag.target.minute}
          minutes={drag.minutes}
          color={colorOf(draggedBlock)}
          items={items.filter((i) => i.id !== drag.id)}
          colorOf={colorOf}
        />
      )}

      <button
        type="button"
        className={`fab${critical ? " on" : ""}`}
        aria-pressed={critical}
        onClick={() => {
          setCritical(!critical);
          setBubble(null);
        }}
      >
        <CriticalIcon /> Camino crítico
      </button>
      {toast && (
        <div className="calm" role="status">
          {toast}
        </div>
      )}
      {critical && short.length > 0 && (
        <div className="calm short" role="status">
          No llegás: faltan{" "}
          {short.map((s) => `${hours(s.minDeficit)} de ${titleOfTask(s.taskId)}`).join(", ")}
        </div>
      )}
      {critical && short.length === 0 && !anyCritical && (
        <div className="calm">Semana tranquila ✓</div>
      )}

      {bubble && (
        <>
          <button
            type="button"
            className="scrim"
            aria-label="Cerrar"
            onClick={() => setBubble(null)}
          />
          <BubbleCard
            bubble={bubble}
            onOpen={() => {
              setOpen(bubble.item);
              setBubble(null);
            }}
            onRelease={(blockId) => {
              dispatch({ type: "unpin", blockId });
              setBubble(null);
              flash("Soltado · el plan lo reacomodó");
            }}
          />
        </>
      )}
      {open && <BlockSheet item={open} onClose={() => setOpen(null)} />}
    </div>
  );

  function titleOf(b: PlanBlock) {
    return data.tasks.find((t) => t.id === b.taskId)?.title ?? "Bloque";
  }
}

/** Minutes shown above and below the dragged block in the loupe. */
const LOUPE_MARGIN = 90;
const LOUPE_HEIGHT = 150;
const LOUPE_WIDTH = 180;

/**
 * A magnified slice of the landing day that floats above the finger, so the
 * target is readable even though the finger covers the block.
 */
function Loupe(props: {
  x: number;
  y: number;
  date: string;
  minute: number;
  minutes: number;
  color: string;
  items: Item[];
  colorOf: (b: PlanBlock) => string;
}) {
  const { data } = useStore();
  const tz = data.settings.timezone;
  const { date, minute, minutes } = props;
  const from = minute - LOUPE_MARGIN;
  const to = minute + minutes + LOUPE_MARGIN;
  const midnight = zonedInstant(tz, date, 0);
  const y = (m: number) => ((m - from) / (to - from)) * LOUPE_HEIGHT;
  const box = (start: number, end: number) => {
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    return e > s ? { top: y(s), height: y(e) - y(s) } : null;
  };
  const hoursIn = [];
  for (let h = Math.ceil(from / 60); h * 60 < to; h++) hoursIn.push(h * 60);
  const left = Math.min(
    Math.max(props.x - LOUPE_WIDTH / 2, 8),
    window.innerWidth - LOUPE_WIDTH - 8,
  );
  const above = props.y - LOUPE_HEIGHT - 70;
  const start = midnight + minute * MINUTE;
  return (
    <div
      className="loupe"
      role="status"
      style={{ left, top: above > 8 ? above : props.y + 40, width: LOUPE_WIDTH }}
    >
      <div className="loupe-head">
        {weekdayShort(tz, start)} {Number(date.slice(8))} · {time(tz, start)}–
        {time(tz, start + minutes * MINUTE)}
      </div>
      <div className="loupe-body" style={{ height: LOUPE_HEIGHT }}>
        {hoursIn.map((m) => (
          <div key={m} className="loupe-hour" style={{ top: y(m) }}>
            <span>{clock(m)}</span>
          </div>
        ))}
        {props.items.map((i) => {
          const b = box((i.start - midnight) / MINUTE, (i.end - midnight) / MINUTE);
          if (!b) return null;
          return i.kind === "event" ? (
            <div key={i.id} className={`loupe-item fixed${i.event.busy ? "" : " free"}`} style={b}>
              {i.event.title}
            </div>
          ) : (
            <div
              key={i.id}
              className="loupe-item planned"
              style={{ ...b, ["--c" as string]: props.colorOf(i.block) }}
            />
          );
        })}
        <div
          className="loupe-item target"
          style={{ ...box(minute, minute + minutes), ["--c" as string]: props.color }}
        />
      </div>
    </div>
  );
}

function BubbleCard({
  bubble,
  onOpen,
  onRelease,
}: {
  bubble: Bubble;
  onOpen: () => void;
  onRelease: (blockId: string) => void;
}) {
  const { data, now } = useStore();
  const tz = data.settings.timezone;
  const { item } = bubble;
  const left = Math.min(Math.max(16, bubble.x - 130), window.innerWidth - 276);
  const top = bubble.y > window.innerHeight * 0.6 ? bubble.y - 150 : bubble.y + 14;

  if (item.kind === "event") {
    return (
      <div className="bubble-card" style={{ left, top, ["--c" as string]: "var(--ink-soft)" }}>
        <button type="button" className="bubble" onClick={onOpen}>
          <h3>{item.event.title}</h3>
          <p>
            {dayAndTime(tz, item.start)} – {time(tz, item.end)}
          </p>
          {item.event.location && <p>{item.event.location}</p>}
          <p className="more">Abrir evento ›</p>
        </button>
      </div>
    );
  }
  const b = item.block;
  const task = data.tasks.find((t) => t.id === b.taskId);
  const activity = data.activities.find((a) => a.id === b.activityId);
  const p = progress(data, now).find((x) => x.task.id === b.taskId);
  return (
    <div className="bubble-card" style={{ left, top, ["--c" as string]: activity?.color }}>
      <button type="button" className="bubble" onClick={onOpen}>
        <h3>{task?.title}</h3>
        <p>
          {activity?.name} · {dayAndTime(tz, item.start)} – {time(tz, item.end)}
        </p>
        {p && (
          <p>
            Faltan {hours(p.remainingMinutes)} de {hours(p.totalMinutes)}
            {b.level === "critical" && <span className="tag critical"> crítico</span>}
            {b.level === "warn" && <span className="tag warn"> justo</span>}
          </p>
        )}
        {isPinned(b) && item.start <= now && <p>📌 Fijado por vos</p>}
        <p className="more">{item.end <= now ? "Marcar cómo te fue ›" : "Ver detalle ›"}</p>
      </button>
      {isPinned(b) && item.start > now && (
        <div className="bubble-pin">
          <span>📌 Fijado por vos</span>
          <button type="button" className="btn small" onClick={() => onRelease(b.id)}>
            Soltar
          </button>
        </div>
      )}
    </div>
  );
}
