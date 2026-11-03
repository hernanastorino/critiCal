import { localParts, MINUTE, type PlanBlock, zonedInstant } from "@critical/engine";
import { type CSSProperties, useMemo, useState } from "react";
import { visibleEvents } from "../calendars";
import { dropTarget } from "../drag";
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

export function Week({ onSettings }: { onSettings: () => void }) {
  const { data, now, result, dispatch } = useStore();
  const tz = data.settings.timezone;
  const [offset, setOffset] = useState(0);
  const [replanning, setReplanning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    x0: number;
    y0: number;
    grab: number;
    dx: number;
    dy: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [critical, setCritical] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  const [open, setOpen] = useState<Item | null>(null);

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

  const position = (date: string, item: Item): CSSProperties | null => {
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
              setToast(`Semana reacomodada · ${time(tz, Date.now())}`);
              setTimeout(() => setToast(null), 2500);
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
        className={`week${critical ? " critical-mode" : ""}${editing ? " editing" : ""}`}
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
            <span key={h} style={{ top: `${((h * 60 - startMin) / span) * 100}%` }}>
              {h}
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
              const movable = editing && item.start > now;
              const dragged = drag?.id === b.id;
              return (
                <button
                  key={`${d}-${item.id}`}
                  type="button"
                  data-level={b.level}
                  aria-label={`${titleOf(b)}, ${time(tz, item.start)}${isPinned(b) ? ", fijado" : ""}`}
                  className={`pill planned ${b.level ?? "ok"}${past ? " past" : ""}${isPinned(b) ? " pinned" : ""}${movable ? " movable" : ""}${dragged ? " dragging" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                  style={{
                    ...style,
                    ["--c" as string]: colorOf(b),
                    ...(dragged
                      ? { transform: `translate(calc(-50% + ${drag.dx}px), ${drag.dy}px)` }
                      : {}),
                  }}
                  onPointerDown={
                    movable
                      ? (e) => {
                          e.currentTarget.setPointerCapture?.(e.pointerId);
                          const rect = e.currentTarget.getBoundingClientRect();
                          setDrag({
                            id: b.id,
                            x0: e.clientX,
                            y0: e.clientY,
                            grab: e.clientY - rect.top,
                            dx: 0,
                            dy: 0,
                          });
                        }
                      : undefined
                  }
                  onPointerMove={
                    dragged
                      ? (e) =>
                          setDrag({ ...drag, dx: e.clientX - drag.x0, dy: e.clientY - drag.y0 })
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
                  onPointerCancel={dragged ? () => setDrag(null) : undefined}
                  onPointerUp={
                    dragged
                      ? (e) => {
                          setDrag(null);
                          if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) {
                            setBubble({ item, x: e.clientX, y: e.clientY });
                            return;
                          }
                          const columns = [
                            ...document.querySelectorAll<HTMLElement>("[data-date]"),
                          ].map((el) => {
                            const r = el.getBoundingClientRect();
                            return {
                              date: el.dataset.date as string,
                              left: r.left,
                              right: r.right,
                              top: r.top,
                              bottom: r.bottom,
                            };
                          });
                          const target = dropTarget(
                            columns,
                            e.clientX,
                            e.clientY - drag.grab,
                            startMin,
                            endMin,
                            (b.end - b.start) / 60_000,
                            data.settings.slotMinutes,
                          );
                          if (target) {
                            dispatch({
                              type: "pin",
                              blockId: b.id,
                              start: zonedInstant(tz, target.date, target.minute),
                            });
                          }
                        }
                      : undefined
                  }
                  onClick={(e) => {
                    // Pointer taps on movable blocks open from onPointerUp; keyboard clicks (detail 0) here.
                    if (!movable || e.detail === 0) setBubble({ item, x: e.clientX, y: e.clientY });
                  }}
                />
              );
            })}
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
      </div>

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

function BubbleCard({ bubble, onOpen }: { bubble: Bubble; onOpen: () => void }) {
  const { data, now } = useStore();
  const tz = data.settings.timezone;
  const { item } = bubble;
  const left = Math.min(Math.max(16, bubble.x - 130), window.innerWidth - 276);
  const top = bubble.y > window.innerHeight * 0.6 ? bubble.y - 150 : bubble.y + 14;

  if (item.kind === "event") {
    return (
      <button
        type="button"
        className="bubble"
        style={{ left, top, ["--c" as string]: "var(--ink-soft)" }}
        onClick={onOpen}
      >
        <h3>{item.event.title}</h3>
        <p>
          {dayAndTime(tz, item.start)} – {time(tz, item.end)}
        </p>
        {item.event.location && <p>{item.event.location}</p>}
        <p className="more">Abrir evento ›</p>
      </button>
    );
  }
  const b = item.block;
  const task = data.tasks.find((t) => t.id === b.taskId);
  const activity = data.activities.find((a) => a.id === b.activityId);
  const p = progress(data, now).find((x) => x.task.id === b.taskId);
  return (
    <button
      type="button"
      className="bubble"
      style={{ left, top, ["--c" as string]: activity?.color }}
      onClick={onOpen}
    >
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
      {isPinned(b) && <p>📌 Fijado por vos</p>}
      <p className="more">{item.end <= now ? "Marcar cómo te fue ›" : "Ver detalle ›"}</p>
    </button>
  );
}
