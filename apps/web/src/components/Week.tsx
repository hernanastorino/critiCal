import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTentative, visibleEvents } from "../calendars.js";
import { dropTarget, nearestFree } from "../drag.js";
import {
  addDays,
  localParts,
  type MealTime,
  MINUTE,
  overlaps,
  type PlanBlock,
  zonedInstant,
} from "../engine.js";
import { dayAndTime, dayMonth, hours, time, weekdayShort } from "../format.js";
import type { AppEvent, PlanVersion } from "../model.js";
import { isPinned, MEAL_NAMES, mealTimes, pinId, progress, weekDates } from "../planning.js";
import { useStore } from "../store.js";
import { BlockSheet } from "./BlockSheet.js";
import { SyncDot } from "./Calendars.js";
import {
  CheckIcon,
  ChevronLeft,
  ChevronRight,
  CriticalIcon,
  EditIcon,
  GearIcon,
  ReplanIcon,
} from "./icons.js";

export type Item =
  | { kind: "block"; id: string; start: number; end: number; block: PlanBlock }
  | { kind: "event"; id: string; start: number; end: number; event: AppEvent };

interface Toast {
  message: string;
  /** Puts things back as they were; shown as a button. */
  undo?: () => void;
  /** The plan version `undo` goes back from: once another one is newer, it is gone. */
  version?: PlanVersion;
}

interface Bubble {
  item: Item;
  x: number;
  y: number;
}

/** A meal that the plan placed, as tapped on the calendar. */
interface MealBubble {
  meal: MealTime & { at: { start: number; end: number } };
  x: number;
  y: number;
}

const mealName = (m: MealTime) => (m.kind ? MEAL_NAMES[m.kind] : "Comida");
const mealKey = (m: MealTime) => `meal:${m.date}:${m.kind ?? m.preferred.start}`;

const DAY_MS = 86_400_000;
/** Hold this long on a block to start dragging it outside edit mode. */
const LONG_PRESS_MS = 400;
/** How long the replan button shows its tick. */
const DONE_MS = 1500;

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

/** The week view: the plan and the calendar day by day, with drag-and-drop to pin blocks. */
export function Week({
  day,
  onSettings,
}: {
  day?: string;
  /** Opens Ajustes, on one of its screens if given. */
  onSettings: (page?: "week") => void;
}) {
  const { data, now, result, pinShort, clashes, dispatch } = useStore();
  const tz = data.settings.timezone;
  // Opens on the week of `day` (weeks start on the same weekday as `weekDates`).
  const [offset, setOffset] = useState(() =>
    day
      ? Math.round(
          (zonedInstant(tz, weekDates(tz, zonedInstant(tz, day, 720))[0] as string, 720) -
            zonedInstant(tz, weekDates(tz, now)[0] as string, 720)) /
            (7 * DAY_MS),
        )
      : 0,
  );
  const [replanning, setReplanning] = useState(false);
  const [replanned, setReplanned] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  useLayoutEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  const pressTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The last long-press drop: the click right after it, on that block, is not a tap. */
  const dropped = useRef<{ ids: string[] }>({ ids: [] });
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
      clearTimeout(toastTimer.current);
      clearTimeout(replanTimer.current);
    };
  }, []);
  const [toast, setToast] = useState<Toast | null>(null);
  /** Said only to screen readers: the replan button shows its result itself. */
  const [spoken, setSpoken] = useState("");
  const [critical, setCritical] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  /** The block whose bubble is open: its detail sheet gives focus back to it. */
  const bubbleFrom = useRef<HTMLElement | null>(null);
  const openBubble = (e: React.MouseEvent<HTMLElement>, item: Item) => {
    bubbleFrom.current = e.currentTarget;
    setBubble({ item, x: e.clientX, y: e.clientY });
  };
  const [mealBubble, setMealBubble] = useState<MealBubble | null>(null);
  const [open, setOpen] = useState<Item | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const replanTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (message: string, undo?: () => void, version?: PlanVersion) => {
    clearTimeout(toastTimer.current);
    setToast({ message, undo, version });
    toastTimer.current = setTimeout(() => setToast(null), undo ? 6000 : 2500);
  };

  /**
   * A pin just made, to tell right away if it puts a minimum out of reach, which pins it
   * gave back to the plan (`note`) and which flexible event it landed on.
   */
  const watch = useRef<{
    id: string;
    before: Map<string, number>;
    undo: () => void;
    note?: string;
    flexible?: string;
  } | null>(null);
  // Once the plan changes again, a drop's undo would take back the wrong thing.
  const latest = data.planHistory?.at(-1);
  useEffect(() => {
    if (toast?.version && toast.version !== latest) setToast(null);
  }, [toast, latest]);
  useEffect(() => {
    const w = watch.current;
    if (!w) return;
    watch.current = null;
    // A drop the store turned down left nothing to tell.
    if (!data.pins?.some((p) => p.id === w.id)) return;
    const worse = pinShort.short.filter((s) => s.minutes > (w.before.get(s.taskId) ?? 0));
    // Offered to move only when the inbox has somewhere to move it (not under way, room).
    const offer = clashes.some((c) => c.pin.id === w.id && c.moveTo);
    const said = [
      w.note,
      w.flexible &&
        `Quedó sobre ${w.flexible}: ${offer ? "en la Bandeja te propongo moverlo" : "revisá el choque en la Bandeja"}`,
      worse.length > 0 &&
        `Con esto no llegás: faltan ${worse.map((s) => `${hours(s.minutes)} de ${titleOfTask(s.taskId)}`).join(", ")}`,
    ].filter(Boolean);
    // The pin itself saved the latest plan version.
    if (said.length > 0) flash(said.join(" · "), w.undo, latest);
  });

  /** Pins `block` at `start`, offering to put it back if that breaks a minimum. */
  const pinAt = (block: PlanBlock, start: number) => {
    const moved = pinId(block.taskId, start);
    const spot = { start, end: start + (block.end - block.start) };
    // What it lands on that is not fixed: other pins go back to the plan, and a
    // flexible event is offered to move in the inbox.
    const freed = (data.pins ?? []).filter(
      (p) => p.id !== block.id && p.start > now && overlaps(p, spot),
    );
    const flexible = items.find(
      (i) => i.kind === "event" && i.event.busy && i.event.flexible && overlaps(i, spot),
    );
    watch.current = {
      id: moved,
      before: new Map(pinShort.short.map((s) => [s.taskId, s.minutes])),
      note:
        freed.length > 0
          ? `${freed.map((p) => `📌 ${titleOfTask(p.taskId)}`).join(", ")} ${freed.length > 1 ? "volvieron" : "volvió"} al plan`
          : undefined,
      flexible: flexible?.kind === "event" ? flexible.event.title : undefined,
      undo: () => {
        setToast(null);
        // The pins it freed come back with the plan as it was.
        if (freed.length > 0) dispatch({ type: "undoPlan" });
        // A block placed by the plan goes back to the plan; a pinned one to its old spot.
        else if (isPinned(block)) dispatch({ type: "pin", blockId: moved, start: block.start });
        else dispatch({ type: "unpin", blockId: moved });
      },
    };
    dispatch({ type: "pin", blockId: block.id, start });
    return moved;
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

  // Meals of the week shown, placed around fixed events and pins as the planner does.
  const firstDay = dates[0] as string;
  const meals = useMemo(
    () =>
      mealTimes(
        data,
        now,
        zonedInstant(tz, firstDay, 0),
        zonedInstant(tz, addDays(firstDay, 7), 0),
      ).filter((m): m is MealBubble["meal"] => m.at !== null),
    [data, now, tz, firstDay],
  );

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

  /**
   * Snapped landing slot under the finger, moved off what is fixed: busy events that are
   * not flexible, and blocks already under way. Plan blocks, pins and flexible events
   * are not in the way; they move around the block (or are offered to).
   */
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
    const busy = items
      .filter((i) =>
        i.kind === "event"
          ? i.event.busy && !i.event.flexible
          : i.id !== blockId && i.start <= now && i.end > now,
      )
      .map((i) => ({ start: toMinute(i.start), end: toMinute(i.end) }));
    const earliest = Math.max(
      Math.ceil(startMin / slot) * slot,
      Math.floor(toMinute(now) / slot) * slot + slot,
    );
    const minute = nearestFree(spot.minute, minutes, busy, slot, earliest, endMin);
    return minute === null ? null : { date: spot.date, minute };
  };

  /** Pins the block where it lands; returns the pinned block's new id. */
  const drop = (block: PlanBlock, d: Drag, x: number, y: number) => {
    const target = landing(x, y - d.grab, d.minutes, block.id);
    if (!target) return null;
    return pinAt(block, zonedInstant(tz, target.date, target.minute));
  };

  // While dragging: the plan's blocks under the landing spot, which it will move.
  const ghostStart =
    drag?.active && drag.target ? zonedInstant(tz, drag.target.date, drag.target.minute) : 0;
  const displaced = (b: PlanBlock) =>
    !!drag?.active &&
    !!drag.target &&
    b.id !== drag.id &&
    b.start > now &&
    b.start < ghostStart + drag.minutes * MINUTE &&
    b.end > ghostStart;

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
          className={`icon-btn replan${replanning ? " spinning" : ""}${replanned ? " done" : ""}`}
          aria-label="Reacomodar semana"
          disabled={replanning}
          onClick={() => {
            clearTimeout(replanTimer.current);
            setReplanned(false);
            // Emptied first, so a second replan in the same minute is announced again.
            setSpoken("");
            setReplanning(true);
            dispatch({ type: "replanWeek" });
            const at = now;
            replanTimer.current = setTimeout(() => {
              setReplanning(false);
              setReplanned(true);
              setSpoken(`Semana reacomodada · ${time(tz, at)}`);
              replanTimer.current = setTimeout(() => setReplanned(false), DONE_MS);
            }, 600);
          }}
        >
          {replanned ? <CheckIcon /> : <ReplanIcon />}
        </button>
        <span className="sr-only" role="status">
          {spoken}
        </span>
        {(data.planHistory ?? []).length > 0 && (
          <button
            type="button"
            className="icon-btn"
            aria-label={`Deshacer: ${data.planHistory?.at(-1)?.label}`}
            title={`Deshacer: ${data.planHistory?.at(-1)?.label}`}
            onClick={() => dispatch({ type: "undoPlan" })}
          >
            ↶
          </button>
        )}
        <SyncDot onClick={() => onSettings()} />
        <button
          type="button"
          className="icon-btn"
          aria-label="Ajustes"
          onClick={() => onSettings()}
        >
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
            {meals.map((m) => {
              const style = position(d, m.at);
              if (!style) return null;
              const key = mealKey(m);
              const moved = m.at.start !== m.preferred.start;
              return (
                <button
                  key={`${d}-${key}`}
                  type="button"
                  aria-label={`${mealName(m)}, ${time(tz, m.at.start)}${moved ? `, corrido de las ${time(tz, m.preferred.start)}` : ""}`}
                  className={`pill meal${m.at.end <= now ? " past" : ""}${mealBubble && mealKey(mealBubble.meal) === key ? " selected" : ""}`}
                  style={style}
                  onClick={(e) => {
                    setBubble(null);
                    setMealBubble({ meal: m, x: e.clientX, y: e.clientY });
                  }}
                />
              );
            })}
            {items.map((item) => {
              const style = position(d, item);
              if (!style) return null;
              const past = item.end <= now;
              if (item.kind === "event") {
                return (
                  <button
                    key={`${d}-${item.id}`}
                    type="button"
                    aria-label={`${item.event.title}, ${time(tz, item.start)}${isTentative(item.event) ? ", tentativo" : ""}`}
                    className={`pill fixed${item.event.busy ? "" : " free"}${isTentative(item.event) ? " tentative" : ""}${past ? " past" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                    style={style}
                    onClick={(e) => openBubble(e, item)}
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
                  className={`pill planned ${b.level ?? "ok"}${past ? " past" : ""}${isPinned(b) ? " pinned" : ""}${movable ? " movable" : ""}${lifted ? " dragging" : ""}${displaced(b) ? " displaced" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                  style={{ ...style, ["--c" as string]: colorOf(b) }}
                  onPointerDown={
                    future
                      ? (e) => {
                          // A new press: an earlier drag's click is no longer coming.
                          dropped.current = { ids: [] };
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
                          setFocusId(pinAt(b, start));
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
                          if (!editing) dropped.current = { ids: [b.id] };
                          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) {
                            if (editing) openBubble(e, item);
                            return;
                          }
                          const moved = drop(b, drag, e.clientX, e.clientY);
                          if (moved && !editing) dropped.current.ids.push(moved);
                        }
                      : undefined
                  }
                  onContextMenu={future ? (e) => e.preventDefault() : undefined}
                  onClick={(e) => {
                    // The click that ends a long-press drag is not a tap, however late it
                    // arrives (a slow phone may still be replanning after the drop).
                    if (e.detail !== 0 && dropped.current.ids.includes(b.id)) {
                      dropped.current = { ids: [] };
                      return;
                    }
                    // Pointer taps on movable blocks open from onPointerUp; keyboard clicks (detail 0) here.
                    if (!movable || e.detail === 0) openBubble(e, item);
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
          meals={meals}
          colorOf={colorOf}
        />
      )}

      <button
        type="button"
        className={`fab${critical ? " on" : ""}`}
        aria-label="Camino crítico"
        title="Camino crítico"
        aria-pressed={critical}
        onClick={() => {
          setCritical(!critical);
          setBubble(null);
        }}
      >
        <CriticalIcon />
      </button>
      {/* Notices sit above the tab bar, beside the button; touches pass through them. */}
      <div className="snacks" role="status">
        {critical && short.length > 0 && (
          <div className="snack short">
            No llegás: faltan{" "}
            {short.map((s) => `${hours(s.minDeficit)} de ${titleOfTask(s.taskId)}`).join(", ")}
          </div>
        )}
        {critical && short.length === 0 && !anyCritical && (
          <div className="snack">Semana tranquila ✓</div>
        )}
        {toast && (
          <div className={`snack${toast.undo ? " short" : ""}`}>
            <span>{toast.message}</span>
            {toast.undo && (
              <button type="button" className="btn small snack-btn" onClick={toast.undo}>
                Deshacer
              </button>
            )}
          </div>
        )}
      </div>

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
            onPin={(block) => {
              setBubble(null);
              pinAt(block, block.start);
              flash("Fijado acá · el resto se acomoda alrededor");
            }}
          />
        </>
      )}
      {mealBubble && (
        <>
          <button
            type="button"
            className="scrim"
            aria-label="Cerrar"
            onClick={() => setMealBubble(null)}
          />
          <MealCard
            bubble={mealBubble}
            onSettings={() => {
              setMealBubble(null);
              // Meal times live in «Mi semana».
              onSettings("week");
            }}
          />
        </>
      )}
      {open && (
        <BlockSheet
          item={open}
          onClose={() => setOpen(null)}
          // The bubble that opened it is gone by then: back to its block.
          returnTo={() => (bubbleFrom.current?.isConnected ? bubbleFrom.current : null)}
        />
      )}
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
  meals: MealBubble["meal"][];
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
        {props.meals.map((m) => {
          const b = box((m.at.start - midnight) / MINUTE, (m.at.end - midnight) / MINUTE);
          return (
            b && (
              <div key={mealKey(m)} className="loupe-item meal" style={b}>
                {mealName(m)}
              </div>
            )
          );
        })}
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
  onPin,
}: {
  bubble: Bubble;
  onOpen: () => void;
  onRelease: (blockId: string) => void;
  onPin: (block: PlanBlock) => void;
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
      {!isPinned(b) && item.start > now && (
        <div className="bubble-pin">
          <span>Lo puso el plan</span>
          <button type="button" className="btn small" onClick={() => onPin(b)}>
            Fijar acá
          </button>
        </div>
      )}
    </div>
  );
}

/** A meal's time, why it moved, and where to change it. */
function MealCard({ bubble, onSettings }: { bubble: MealBubble; onSettings: () => void }) {
  const { data } = useStore();
  const tz = data.settings.timezone;
  const { meal } = bubble;
  const left = Math.min(Math.max(16, bubble.x - 130), window.innerWidth - 276);
  const top = bubble.y > window.innerHeight * 0.6 ? bubble.y - 150 : bubble.y + 14;
  return (
    <div className="bubble-card" style={{ left, top, ["--c" as string]: "var(--meal)" }}>
      <button type="button" className="bubble" onClick={onSettings}>
        <h3>{mealName(meal)}</h3>
        <p>
          {dayAndTime(tz, meal.at.start)} – {time(tz, meal.at.end)}
        </p>
        {meal.at.start !== meal.preferred.start && (
          <p>
            Corrido de las {time(tz, meal.preferred.start)}: a esa hora hay algo fijo o un bloque
            fijado.
          </p>
        )}
        <p className="more">Cambiar hora y duración ›</p>
      </button>
    </div>
  );
}
