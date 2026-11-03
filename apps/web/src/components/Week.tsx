import { localParts, type PlanBlock, zonedInstant } from "@critical/engine";
import { type CSSProperties, useMemo, useState } from "react";
import { visibleEvents } from "../calendars";
import { dayAndTime, dayMonth, hours, time, weekdayShort } from "../format";
import type { AppEvent } from "../model";
import { progress, weekDates } from "../planning";
import { useStore } from "../store";
import { BlockSheet } from "./BlockSheet";
import { SyncDot } from "./Calendars";
import { ChevronLeft, ChevronRight, CriticalIcon, GearIcon } from "./icons";

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
  const { data, now } = useStore();
  const tz = data.settings.timezone;
  const [offset, setOffset] = useState(0);
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
        <h1>
          {offset === 0 ? "Esta semana" : "Semana"}{" "}
          <span className="sub">
            {dayMonth(tz, zonedInstant(tz, dates[0] as string, 720))} –{" "}
            {dayMonth(tz, zonedInstant(tz, dates[6] as string, 720))}
          </span>
        </h1>
        <button
          type="button"
          className="icon-btn"
          aria-label="Semana siguiente"
          onClick={() => setOffset(offset + 1)}
        >
          <ChevronRight />
        </button>
        <SyncDot onClick={onSettings} />
        <button type="button" className="icon-btn" aria-label="Ajustes" onClick={onSettings}>
          <GearIcon />
        </button>
      </div>

      <div className={`week${critical ? " critical-mode" : ""}`} data-testid="week">
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
              return (
                <button
                  key={`${d}-${item.id}`}
                  type="button"
                  data-level={b.level}
                  aria-label={`${titleOf(b)}, ${time(tz, item.start)}`}
                  className={`pill planned ${b.level ?? "ok"}${past ? " past" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                  style={{ ...style, ["--c" as string]: colorOf(b) }}
                  onClick={(e) => setBubble({ item, x: e.clientX, y: e.clientY })}
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
      {critical && !anyCritical && <div className="calm">Semana tranquila ✓</div>}

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
      <p className="more">{item.end <= now ? "Marcar cómo te fue ›" : "Ver detalle ›"}</p>
    </button>
  );
}
