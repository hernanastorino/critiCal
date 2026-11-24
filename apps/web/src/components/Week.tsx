import { type CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { isTentative, visibleEvents } from "../calendars.js";
import { dropTarget, keyboardLanding, nearestFree } from "../drag.js";
import {
  addDays,
  localParts,
  type MealTime,
  MINUTE,
  overlaps,
  type PlanBlock,
  zonedInstant,
} from "../engine.js";
import {
  dayAndTime,
  dayRange,
  hhmmToMinutes,
  hours,
  minutesToHhmm,
  time,
  weekdayShort,
} from "../format.js";
import { forgetImport, importToUndo } from "../importUndo.js";
import { lanes } from "../lanes.js";
import { deadlineMaxYear } from "../limits.js";
import type { AppData, AppEvent, PlanVersion } from "../model.js";
import { type MoveBounds, moveBounds, moveRefusal } from "../moveBounds.js";
import {
  isPinned,
  MEAL_NAMES,
  mealOverPin,
  mealTimes,
  pinId,
  progress,
  sleptBlockIds,
  standingCheckIns,
  wakingDay,
  weekDates,
} from "../planning.js";
import { blockRuns } from "../runs.js";
import { useStore } from "../store.js";
import { BlockSheet } from "./BlockSheet.js";
import { SyncDot } from "./Calendars.js";
import { EventTrip } from "./EventTrip.js";
import { FirstSteps } from "./FirstSteps.js";
import {
  CheckIcon,
  ChevronLeft,
  ChevronRight,
  CriticalIcon,
  EditIcon,
  GearIcon,
  Marks,
  ReplanIcon,
  UndoIcon,
} from "./icons.js";
import { useModal } from "./modal.js";
import type { PageId } from "./Settings.js";
import { useToast } from "./Toast.js";
import { useEditEscape } from "./useEditEscape.js";
import { useSwipe } from "./useSwipe.js";

/**
 * The plan's blocks as the week draws them: those of one activity that touch are one pill,
 * except while editing, where each is its own to move. A run does not mix levels, pins or
 * what is already past, so the pill never hides one of those.
 */
function planItems(plan: PlanBlock[], editing: boolean, now: number, slept: Set<string>): Item[] {
  const runs = editing
    ? plan.map((b) => [b])
    : blockRuns(
        plan,
        (a, b) =>
          a.level === b.level &&
          isPinned(a) === isPinned(b) &&
          a.end <= now === b.end <= now &&
          slept.has(a.id) === slept.has(b.id),
      );
  return runs.map((run) => {
    const first = run[0] as PlanBlock;
    return {
      kind: "block" as const,
      id: first.id,
      start: first.start,
      end: (run[run.length - 1] as PlanBlock).end,
      block: first,
      ...(run.length > 1 ? { run } : {}),
    };
  });
}

export type Item =
  | {
      kind: "block";
      id: string;
      start: number;
      end: number;
      block: PlanBlock;
      /** Blocks of one activity that touch, drawn as one pill (the first is `block`). */
      run?: PlanBlock[];
    }
  | { kind: "event"; id: string; start: number; end: number; event: AppEvent };

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
  /** The block's id, or a meal's key (`meal:date:kind`). */
  id: string;
  /** Set when a meal is being dragged: it only moves within its own day. */
  meal?: MealBubble["meal"];
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

/**
 * The day an undo will change on the calendar: the first pin or meal choice that differs
 * between the plan now and the version it goes back to.
 */
function changedWeek(
  v: PlanVersion | undefined,
  now: { pins: PlanBlock[]; meals: NonNullable<AppData["mealChoices"]> },
  tz: string,
) {
  if (!v) return null;
  const ids = (l: PlanBlock[]) => new Set(l.map((p) => p.id));
  const [was, is] = [ids(v.pins), ids(now.pins)];
  const days = [
    ...[...v.pins.filter((p) => !is.has(p.id)), ...now.pins.filter((p) => !was.has(p.id))].map(
      (p) => localParts(tz, p.start).date,
    ),
  ];
  // Meal choices: those only in one of the two lists (by what they say).
  if (v.mealChoices) {
    const key = (c: (typeof now.meals)[number]) =>
      `${c.date}|${c.kind}|${c.skip ?? ""}|${c.start ?? ""}`;
    const [a, b] = [new Set(v.mealChoices.map(key)), new Set(now.meals.map(key))];
    for (const c of v.mealChoices) if (!b.has(key(c))) days.push(c.date);
    for (const c of now.meals) if (!a.has(key(c))) days.push(c.date);
  }
  return days.sort()[0] ?? null;
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
  onSettings: (page?: PageId) => void;
}) {
  const { data, now, result, pinShort, clashes, dispatch } = useStore();
  const tz = data.settings.timezone;
  /** Weeks between this one and the week of `date` (weeks start as `weekDates` says). */
  const weekOffset = (date: string) =>
    Math.round(
      (zonedInstant(tz, weekDates(tz, zonedInstant(tz, date, 720))[0] as string, 720) -
        zonedInstant(tz, weekDates(tz, now)[0] as string, 720)) /
        (7 * DAY_MS),
    );
  /** «2 – 8 nov» for the week of `date`. */
  const weekLabel = (date: string) => {
    const w = weekDates(tz, zonedInstant(tz, date, 720));
    return dayRange(
      tz,
      zonedInstant(tz, w[0] as string, 720),
      zonedInstant(tz, w[6] as string, 720),
    );
  };
  /** The weeks the app takes: its years run 2000 to the last one a deadline may fall in, as everywhere else. */
  const inRange = (o: number) => {
    const year = Number(localParts(tz, now + o * 7 * DAY_MS).date.slice(0, 4));
    return year >= 2000 && year <= deadlineMaxYear(now);
  };
  // Opens on the week of `day`.
  const [offset, setOffset] = useState(() => (day ? weekOffset(day) : 0));
  const [replanning, setReplanning] = useState(false);
  const [replanned, setReplanned] = useState(false);
  const [editing, setEditing] = useState(false);
  useEditEscape(editing, () => setEditing(false));
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
  useSwipe(weekRef, {
    enabled: !editing && !drag?.active,
    onNext: () => setOffset((o) => (inRange(o + 1) ? o + 1 : o)),
    onPrev: () => setOffset((o) => (inRange(o - 1) ? o - 1 : o)),
  });
  const replanRef = useRef<HTMLButtonElement>(null);
  /**
   * A replan under way: the undo version it started from, and whether one came out of it
   * (the store adds a version only when the replan moved something).
   */
  const replanWatch = useRef<{ from: PlanVersion | undefined; changed: boolean } | null>(null);
  const lastVersion = data.planHistory?.at(-1);
  useEffect(() => {
    const w = replanWatch.current;
    if (w && lastVersion !== w.from) w.changed = true;
  }, [lastVersion]);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);

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
      clearTimeout(replanTimer.current);
    };
  }, []);
  const toaster = useToast();
  /** Said only to screen readers: the replan button shows its result itself. */
  const [spoken, setSpoken] = useState("");
  /** A keyboard move, said once the store shows it (the reducer may refuse a time just gone). */
  const [moveSaid, setMoveSaid] = useState<{ id: string; start: number; text: string } | null>(
    null,
  );
  useEffect(() => {
    if (!moveSaid) return;
    if (data.pins?.some((p) => p.id === moveSaid.id && p.start === moveSaid.start)) {
      setSpoken(moveSaid.text);
      setMoveSaid(null);
      return;
    }
    // Still not there a moment later: the reducer refused it.
    const refused = setTimeout(() => {
      setSpoken("No se pudo mover: ese horario ya pasó");
      setMoveSaid(null);
    }, 1000);
    return () => clearTimeout(refused);
  }, [moveSaid, data.pins]);
  const [critical, setCritical] = useState(false);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  /** The block whose bubble is open: its detail sheet gives focus back to it. */
  const bubbleFrom = useRef<HTMLElement | null>(null);
  const openBubble = (e: React.MouseEvent<HTMLElement>, item: Item) => {
    bubbleFrom.current = e.currentTarget;
    setBubble({ item, x: e.clientX, y: e.clientY });
  };
  const [mealBubble, setMealBubble] = useState<MealBubble | null>(null);
  const openMeal = (e: React.MouseEvent | React.PointerEvent, meal: MealBubble["meal"]) => {
    setBubble(null);
    setMealBubble({ meal, x: e.clientX, y: e.clientY });
  };
  const [open, setOpen] = useState<Item | null>(null);

  const replanTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (message: string, undo?: () => void, version?: PlanVersion, tone?: "alert") => {
    toaster.show(message, { undo, tag: version, tone });
  };
  /** A move or a drop that cannot be: the only notices drawn in red. */
  const refuse = (message: string) => flash(message, undefined, undefined, "alert");

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
  /** The newest plan version as of the last render, for an undo that runs later. */
  const latestRef = useRef(latest);
  latestRef.current = latest;
  useEffect(() => {
    const tag = toaster.current?.tag;
    if (tag && tag !== latest) toaster.clear(tag);
  }, [toaster, latest]);
  /** What a meal change says once the store shows it: the toast carries its undo. */
  const mealSaid = useRef<{ said: string; at?: number } | null>(null);
  /** `at`: where the meal was, so «Deshacer» gives the focus back to it. */
  const sayMeal = (said: string, at?: number) => {
    mealSaid.current = { said, at };
  };
  useEffect(() => {
    const heard = mealSaid.current;
    if (!heard) return;
    const { said, at } = heard;
    mealSaid.current = null;
    flash(
      said,
      () => {
        toaster.clear();
        // Only this change: if another one came after (this screen may be gone), nothing.
        dispatch({ type: "undoPlan", only: latest });
        // The notice that held the focus goes away: the meal that came back (or the
        // title) takes it, never the page.
        if (at !== undefined)
          requestAnimationFrame(() =>
            (
              document.querySelector<HTMLElement>(`.pill.meal[data-at="${at}"]:not(.skipped)`) ??
              titleRef.current
            )?.focus(),
          );
      },
      latest,
    );
  });

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
    if (said.length > 0) flash(said.join(" · "), w.undo, latest, "alert");
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
    const versionBefore = data.planHistory?.at(-1);
    watch.current = {
      id: moved,
      before: new Map(pinShort.short.map((s) => [s.taskId, s.minutes])),
      note:
        freed.length > 0
          ? `${freed.map((p) => titleOfTask(p.taskId)).join(", ")} ${freed.length > 1 ? "volvieron" : "volvió"} al plan`
          : undefined,
      flexible: flexible?.kind === "event" ? flexible.event.title : undefined,
      undo: () => {
        toaster.clear();
        // The pin saved a version of the plan: taking that one back leaves the plan and the
        // history as they were (a «soltar» would add one more change to undo).
        const saved = latestRef.current;
        if (saved && saved !== versionBefore) dispatch({ type: "undoPlan", only: saved });
        // The pins it freed come back with the plan as it was.
        else if (freed.length > 0) dispatch({ type: "undoPlan" });
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
  const rangeEnd = zonedInstant(tz, dates[6] as string, 720);
  // Another year's week says which one, so it is never mistaken for this one.
  const rangeDays = dayRange(tz, zonedInstant(tz, dates[0] as string, 720), rangeEnd);
  // Any part in another year names the years: «2026», or «2025–2026» across New Year.
  const [startYear, endYear] = [dates[0] as string, dates[6] as string].map((d) => d.slice(0, 4));
  const thisYear = today.slice(0, 4);
  const rangeYear =
    startYear === thisYear && endYear === thisYear
      ? ""
      : startYear === endYear
        ? endYear
        : `${startYear}–${endYear}`;
  const rangeLabel = rangeYear ? `${rangeDays} ${rangeYear}` : rangeDays;
  // An import is the last change until something else is changed.
  const imported = importToUndo(data);
  const lastChange = imported ? "importar" : data.planHistory?.at(-1)?.label;

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

  // Visible span: earliest wake to latest bedtime of the week, wide enough for a meal that
  // was kept where it was (the past is not worked out again: a breakfast at 01:30 stays
  // visible after the week goes back to waking at 07:30).
  const mealMinutes = meals.map((m) => ({
    start: (m.at.start - zonedInstant(tz, m.date, 0)) / MINUTE,
    end: (m.at.end - zonedInstant(tz, m.date, 0)) / MINUTE,
  }));
  const startMin = Math.floor(
    Math.min(...data.settings.week.map((d) => d.wake), ...mealMinutes.map((m) => m.start)),
  );
  const endMin = Math.ceil(
    Math.max(
      ...data.settings.week.map((d) => (d.bed <= d.wake ? d.bed + 1440 : d.bed)),
      ...mealMinutes.map((m) => m.end),
    ),
  );
  const span = endMin - startMin;

  const sleptIds = useMemo(() => sleptBlockIds(data), [data]);
  const items = useMemo(() => {
    const all: Item[] = [
      ...visibleEvents(data)
        .filter((e) => !e.allDay)
        .map((e) => ({ kind: "event" as const, id: e.id, start: e.start, end: e.end, event: e })),
      ...planItems(data.plan, editing, now, sleptBlockIds(data)),
    ];
    return all;
  }, [data, editing, now]);

  // Meals skipped for a day («Hoy no»), shown faint where they would be, to bring back.
  const skipped = useMemo(() => {
    const skips = (data.mealChoices ?? []).filter((c) => c.skip);
    if (skips.length === 0) return [];
    return mealTimes(
      {
        ...data,
        // As if not skipped: where it would be, at the time it had been moved to.
        mealChoices: (data.mealChoices ?? []).flatMap((c) =>
          !c.skip ? [c] : c.start !== undefined ? [{ ...c, skip: undefined }] : [],
        ),
      },
      now,
      zonedInstant(tz, firstDay, 0),
      zonedInstant(tz, addDays(firstDay, 7), 0),
    ).filter(
      (m): m is MealBubble["meal"] =>
        m.at !== null && skips.some((c) => c.date === m.date && c.kind === m.kind),
    );
  }, [data, now, tz, firstDay]);

  const colorOf = (b: PlanBlock) =>
    data.activities.find((a) => a.id === b.activityId)?.color ?? "#888";
  const anyCritical = data.plan.some((b) => b.level === "critical" && b.end > now);
  const short = result.status.filter((s) => s.minDeficit > 0);
  const titleOfTask = (id: string) => data.tasks.find((t) => t.id === id)?.title ?? "una tarea";
  // The critical summary stays among the app's notices while the button is on. By its
  // text: a new node every render would loop.
  const summary = !critical
    ? ""
    : short.length > 0
      ? `No llegás: faltan ${short.map((s) => `${hours(s.minDeficit)} de ${titleOfTask(s.taskId)}`).join(", ")}`
      : anyCritical
        ? ""
        : "Semana tranquila ✓";
  const { setPinned } = toaster;
  useEffect(() => {
    setPinned(
      summary ? (
        <div className={`snack${summary.startsWith("No llegás") ? " short" : ""}`}>{summary}</div>
      ) : null,
    );
    return () => setPinned(null);
  }, [summary, setPinned]);

  const position = (
    date: string,
    item: { start: number; end: number },
    lane?: { col: number; cols: number },
  ): CSSProperties | null => {
    const top = zonedInstant(tz, date, startMin);
    const bottom = zonedInstant(tz, date, endMin);
    const s = Math.max(item.start, top);
    const e = Math.min(item.end, bottom);
    if (e <= s) return null;
    return {
      top: `${((s - top) / (bottom - top)) * 100}%`,
      height: `${((e - s) / (bottom - top)) * 100}%`,
      // Overlapping blocks share the column side by side, narrower, never on top.
      ...(lane && lane.cols > 1
        ? {
            left: `${4 + (lane.col * 92) / lane.cols}%`,
            width: `calc(${92 / lane.cols}% - 2px)`,
            transform: "none",
          }
        : {}),
    };
  };
  const dayLanes = (date: string) => {
    const top = zonedInstant(tz, date, startMin);
    const bottom = zonedInstant(tz, date, endMin);
    const clip = (key: string, at: { start: number; end: number }) => ({
      key,
      start: Math.max(at.start, top),
      end: Math.min(at.end, bottom),
    });
    return lanes([
      ...meals.map((m) => clip(`m:${mealKey(m)}`, m.at)),
      ...items.map((i) => clip(`i:${i.id}`, i)),
    ]);
  };

  const hourMarks = [9, 12, 15, 18, 21].filter((h) => h * 60 > startMin && h * 60 < endMin);
  // While dragging: the landing start and end, in red on the hour axis.
  const dragMarks =
    drag?.active && drag.target ? [drag.target.minute, drag.target.minute + drag.minutes] : [];
  const draggedBlock = drag ? data.plan.find((b) => b.id === drag.id) : undefined;
  /** What the ghost and the loupe are drawn with: the block's color, or the meals'. */
  const dragColor = draggedBlock ? colorOf(draggedBlock) : drag?.meal ? "var(--meal)" : undefined;

  /** The day columns as drawn now, to find the day and time under a finger. */
  const columns = () =>
    [...document.querySelectorAll<HTMLElement>("[data-date]")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        date: el.dataset.date as string,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    });

  /**
   * Snapped landing slot under the finger, moved off what is fixed: busy events that are
   * not flexible, and blocks already under way. Plan blocks, pins and flexible events
   * are not in the way; they move around the block (or are offered to).
   */
  const landing = (x: number, y: number, minutes: number, blockId: string) => {
    const slot = data.settings.slotMinutes;
    const spot = dropTarget(columns(), x, y, startMin, endMin, minutes, slot);
    if (!spot) return null;
    const { busy, earliest, latest } = landingLimits(spot.date, blockId);
    const minute = nearestFree(spot.minute, minutes, busy, slot, earliest, latest);
    return minute === null ? null : { date: spot.date, minute };
  };

  /** The study hours and deadline a block of `blockId` keeps on `date`, for drops and keys alike. */
  const boundsOf = (date: string, blockId: string): MoveBounds =>
    moveBounds(
      data,
      now,
      date,
      data.tasks.find((t) => t.id === data.plan.find((b) => b.id === blockId)?.taskId),
    );

  /** What is fixed on `date` (minutes of that day) and the window a block may take. */
  const landingLimits = (date: string, blockId: string) => {
    const slot = data.settings.slotMinutes;
    const midnight = zonedInstant(tz, date, 0);
    const toMinute = (t: number) => (t - midnight) / MINUTE;
    const busy = items
      .filter((i) =>
        i.kind === "event"
          ? i.event.busy && !i.event.flexible
          : i.id !== blockId && i.start <= now && i.end > now,
      )
      .map((i) => ({ start: toMinute(i.start), end: toMinute(i.end) }));
    const bounds = boundsOf(date, blockId);
    const earliest = Math.max(
      Math.ceil(Math.max(startMin, bounds.from) / slot) * slot,
      Math.floor(toMinute(now) / slot) * slot + slot,
    );
    const latest = Math.min(endMin, bounds.to, bounds.deadline ?? Number.POSITIVE_INFINITY);
    return { busy, earliest, latest, bounds };
  };

  /** Pins `b` where an arrow key takes it, keeping what a drop respects; says why when it cannot. */
  const keyMove = (b: PlanBlock, step: number) => {
    const start = b.start + step;
    const day = localParts(tz, start).date;
    if (day < today) return refuse("Ese día ya pasó");
    if (!dates.includes(day)) return refuse("Fuera de la semana que se ve");
    if (start <= now) return refuse("Ese horario ya pasó");
    const minutes = (b.end - b.start) / MINUTE;
    const { busy, earliest, latest, bounds } = landingLimits(day, b.id);
    const target = (start - zonedInstant(tz, day, 0)) / MINUTE;
    const sameDay = day === localParts(tz, b.start).date;
    // Within its day the exact slot is the only candidate, so its refusal says why.
    const why = sameDay ? moveRefusal(bounds, target, minutes) : null;
    if (why) return refuse(why);
    const minute = keyboardLanding(
      target,
      minutes,
      busy,
      data.settings.slotMinutes,
      earliest,
      latest,
      sameDay,
      // The meals that give way to the block must not end up on top of it.
      (m) => !mealOverPin(data, now, b, zonedInstant(tz, day, m)),
    );
    if (minute === null) {
      return refuse(
        moveRefusal(bounds, target, minutes) ??
          "Ahí hay algo fijo o una comida y no queda un hueco libre",
      );
    }
    const at = zonedInstant(tz, day, minute);
    const pin = pinAt(b, at);
    setFocusId(pin);
    setMoveSaid({
      id: pin,
      start: at,
      text: `${titleOf(b)} movido a ${weekdayShort(tz, at)} ${time(tz, at)}`,
    });
  };

  /**
   * The earliest and latest start for a meal of `minutes` on `date`, whole within that
   * day's waking hours (as «Mover a…» asks) and, today, not before now.
   */
  const mealRange = (date: string, minutes: number) => {
    const slot = data.settings.slotMinutes;
    const { wake, bed } = wakingDay(data, now, date);
    const sinceMidnight = (now - zonedInstant(tz, date, 0)) / MINUTE;
    const from = date === today ? Math.ceil(sinceMidnight / slot) * slot : 0;
    // On the slot grid, as the blocks are; off it only when that leaves no room at all.
    const snapped = {
      earliest: Math.max(Math.ceil(wake / slot) * slot, from),
      latest: Math.floor((bed - minutes) / slot) * slot,
    };
    return snapped.latest >= snapped.earliest
      ? snapped
      : { earliest: Math.max(wake, from), latest: bed - minutes };
  };

  /** The day column under `x`, if the finger is over one. */
  const dayUnder = (x: number) =>
    [...document.querySelectorAll<HTMLElement>("[data-date]")].find((el) => {
      const r = el.getBoundingClientRect();
      return x >= r.left && x < r.right;
    })?.dataset.date;

  /** Where a meal dragged by the finger lands: its own day only, snapped, within the waking hours. */
  const mealLanding = (meal: MealBubble["meal"], x: number, y: number, grab: number) => {
    const over = dayUnder(x);
    if (over && over !== meal.date) return null;
    const col = document.querySelector<HTMLElement>(`[data-date="${meal.date}"]`);
    if (!col) return null;
    const r = col.getBoundingClientRect();
    const minutes = (meal.at.end - meal.at.start) / MINUTE;
    const spot = dropTarget(
      [{ date: meal.date, left: r.left, right: r.right, top: r.top, bottom: r.bottom }],
      r.left + 1,
      y - grab,
      startMin,
      endMin,
      minutes,
      data.settings.slotMinutes,
    );
    if (!spot) return null;
    const { earliest, latest } = mealRange(meal.date, minutes);
    if (latest < earliest) return null;
    return { date: meal.date, minute: Math.min(latest, Math.max(earliest, spot.minute)) };
  };

  /** Where `d` would land with the finger at (`x`, `y`). */
  const landingFor = (d: Drag, x: number, y: number) =>
    d.meal ? mealLanding(d.meal, x, y, d.grab) : landing(x, y - d.grab, d.minutes, d.id);

  /** Moves a meal to where it lands, that day only; its id when it moved. */
  const dropMeal = (m: MealBubble["meal"], d: Drag, x: number, y: number) => {
    if (!m.kind) return null;
    const target = mealLanding(m, x, y, d.grab);
    if (!target) {
      const over = dayUnder(x);
      if (over && over !== m.date) refuse("Una comida se mueve solo dentro de su día");
      return null;
    }
    const start = zonedInstant(tz, target.date, target.minute);
    if (start === m.at.start) return null;
    dispatch({ type: "mealChoice", date: m.date, kind: m.kind, start: target.minute });
    sayMeal(`${mealName(m)} a las ${time(tz, start)}, solo ese día`);
    return mealKey(m);
  };

  /**
   * A meal that is over is not dragged (the past is not changed): a try to lift it (a long
   * press, or a drag while editing) says so instead of doing nothing.
   */
  const pastPress = useRef<{ x: number; y: number; said: boolean } | null>(null);
  const pastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sayPast = () => {
    if (!pastPress.current || pastPress.current.said) return;
    pastPress.current.said = true;
    toaster.show("Esa comida ya pasó: el pasado no se cambia.");
  };
  const startPastPress = (e: React.PointerEvent<HTMLElement>) => {
    pastPress.current = { x: e.clientX, y: e.clientY, said: false };
    clearTimeout(pastTimer.current);
    if (!editing) pastTimer.current = setTimeout(sayPast, LONG_PRESS_MS);
  };
  const movePastPress = (e: React.PointerEvent<HTMLElement>) => {
    const p = pastPress.current;
    if (!p) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      clearTimeout(pastTimer.current);
      // Moving a finger before the long press is a scroll; while editing it is a drag.
      if (editing) sayPast();
    }
  };
  const endPastPress = () => {
    clearTimeout(pastTimer.current);
    pastPress.current = null;
  };

  /** A press on a block or meal: it drags at once while editing, after a long press otherwise. */
  const startPress = (
    e: React.PointerEvent<HTMLElement>,
    id: string,
    minutes: number,
    meal?: MealBubble["meal"],
  ) => {
    // A new press: an earlier drag's click is no longer coming.
    dropped.current = { ids: [] };
    const rect = e.currentTarget.getBoundingClientRect();
    const press: Drag = {
      id,
      meal,
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      y: e.clientY,
      grab: e.clientY - rect.top,
      minutes,
      active: editing,
    };
    if (editing) e.currentTarget.setPointerCapture?.(e.pointerId);
    else {
      const el = e.currentTarget;
      const pointer = e.pointerId;
      clearTimeout(pressTimer.current);
      pressTimer.current = setTimeout(() => {
        const live = dragRef.current;
        if (live?.id !== id) return;
        el.setPointerCapture?.(pointer);
        navigator.vibrate?.(10);
        setDrag({ ...live, active: true });
      }, LONG_PRESS_MS);
    }
    setDrag(press);
  };

  /** The finger moves: a scroll before the long press fires, a drag after it. */
  const movePress = (e: React.PointerEvent<HTMLElement>, d: Drag) => {
    const moved = Math.hypot(e.clientX - d.x0, e.clientY - d.y0);
    if (!d.active) {
      if (moved > 8) {
        clearTimeout(pressTimer.current);
        setDrag(null);
      }
      return;
    }
    const target = moved < 6 ? null : landingFor(d, e.clientX, e.clientY);
    setDrag({ ...d, x: e.clientX, y: e.clientY, target });
  };

  /** Pins the block where it lands; returns the pinned block's new id. */
  const drop = (block: PlanBlock, d: Drag, x: number, y: number) => {
    const target = landing(x, y - d.grab, d.minutes, block.id);
    if (!target) {
      const why = whyNotHere(x, y - d.grab, d.minutes, block.id);
      if (why) refuse(why);
      return null;
    }
    return pinAt(block, zonedInstant(tz, target.date, target.minute));
  };

  /**
   * Why a block cannot land on the day under `x`: the same reasons a key move gives (after
   * the deadline, outside the study hours), else that nothing fixed leaves room.
   * Nothing when it is not over a day.
   */
  const whyNotHere = (x: number, y: number, minutes: number, blockId: string) => {
    const date = dayUnder(x);
    if (!date) return null;
    if (date < today) return "No se puede mover a un día que ya pasó";
    const spot = dropTarget(columns(), x, y, startMin, endMin, minutes, data.settings.slotMinutes);
    const bounds = spot ? boundsOf(spot.date, blockId) : null;
    return (
      (bounds && spot ? moveRefusal(bounds, spot.minute, minutes) : null) ??
      "No hay un hueco libre ahí: probá otra hora u otro día"
    );
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
        {/* The week and its arrows stay tight; the tools share the rest of the bar. */}
        <div className="week-nav">
          <button
            type="button"
            className="icon-btn"
            aria-label="Semana anterior"
            aria-disabled={inRange(offset - 1) ? undefined : true}
            onClick={() => inRange(offset - 1) && setOffset(offset - 1)}
          >
            <ChevronLeft />
          </button>
          <h1 ref={titleRef} tabIndex={-1} className={`range${offset === 0 ? " current" : ""}`}>
            {offset === 0 ? (
              <span className="range-stack">
                {rangeDays}
                {rangeYear && <span className="range-year">{rangeYear}</span>}
              </span>
            ) : (
              <button
                type="button"
                className="range-today"
                title="Volver a esta semana"
                aria-label={`${rangeLabel}. Volver a esta semana`}
                onClick={() => {
                  setOffset(0);
                  // The button goes with the other week: the title keeps the focus.
                  requestAnimationFrame(() => titleRef.current?.focus());
                }}
              >
                {rangeDays}
                {rangeYear && <span className="range-year">{rangeYear}</span>}
              </button>
            )}
          </h1>
          <span className="sr-only" aria-live="polite">
            {/* The week shown, also when the arrows come back to this one. */}
            {rangeLabel}
          </span>
          <button
            type="button"
            className="icon-btn"
            aria-label="Semana siguiente"
            aria-disabled={inRange(offset + 1) ? undefined : true}
            onClick={() => inRange(offset + 1) && setOffset(offset + 1)}
          >
            <ChevronRight />
          </button>
        </div>
        <div className="week-tools">
          <button
            type="button"
            className={`icon-btn${editing ? " active" : ""}`}
            aria-label="Modo edición"
            ref={editRef}
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
            ref={replanRef}
            aria-label="Reacomodar semana"
            // aria-disabled, not disabled: a disabled button drops the keyboard focus.
            aria-disabled={replanning || undefined}
            onClick={() => {
              if (replanning) return;
              clearTimeout(replanTimer.current);
              setReplanned(false);
              // Emptied first, so a second replan in the same minute is announced again.
              setSpoken("");
              setReplanning(true);
              const run = { from: data.planHistory?.at(-1), changed: false };
              replanWatch.current = run;
              dispatch({ type: "replanWeek" });
              const at = now;
              replanTimer.current = setTimeout(() => {
                setReplanning(false);
                // Nothing moved: say so, and no tick for a change that did not happen.
                if (!run.changed) {
                  flash("Ya estaba acomodada");
                  setSpoken("Ya estaba acomodada");
                  replanRef.current?.focus();
                  return;
                }
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
          {/* Always there (hidden when empty) so the buttons never shift under the finger. */}
          <button
            type="button"
            className={`icon-btn${lastChange ? "" : " placeholder"}`}
            aria-label={lastChange ? `Deshacer: ${lastChange}` : undefined}
            title={lastChange ? `Deshacer: ${lastChange}` : undefined}
            ref={undoRef}
            aria-hidden={lastChange ? undefined : true}
            tabIndex={lastChange ? undefined : -1}
            disabled={!lastChange}
            onClick={() => {
              if (!lastChange) return;
              if (imported) {
                forgetImport();
                dispatch({ type: "replace", data: imported });
                flash("Deshecho: importar");
                setSpoken("");
                return;
              }
              const last = (data.planHistory ?? []).length === 1;
              // What the change touched, if it is in another week: go there, so the
              // undo is seen and not blind.
              const where = changedWeek(
                data.planHistory?.at(-1),
                { pins: data.pins ?? [], meals: data.mealChoices ?? [] },
                tz,
              );
              const away = where && !dates.includes(where) ? where : null;
              dispatch({ type: "undoPlan" });
              if (away) setOffset(weekOffset(away));
              flash(`Deshecho: ${lastChange}${away ? ` · semana del ${weekLabel(away)}` : ""}`);
              setSpoken("");
              // The focus stays on the button; once it hides (the last change) it goes to
              // the week's title, never to the page.
              requestAnimationFrame(() => (last ? titleRef : undoRef).current?.focus());
            }}
          >
            <UndoIcon />
          </button>
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
      </div>

      <FirstSteps onSettings={(page) => onSettings(page)} />
      {editing && (
        <div className="edit-banner">
          <span role="status">
            Arrastrá los bloques a donde quieras, o con el bloque enfocado usá las flechas del
            teclado. Quedan fijados y el resto se reacomoda. Las comidas se mueven igual, solo
            dentro de su día.
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              setEditing(false);
              // The banner goes with its button: focus returns to the edit toggle.
              requestAnimationFrame(() => editRef.current?.focus());
            }}
          >
            Terminar edición
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
        {dates.map((d) => {
          const lane = dayLanes(d);
          return (
            <div key={d} className="day" data-date={d}>
              {inReadingOrder([
                skipped.map((m) => {
                  const style = position(d, m.at);
                  if (!style || !m.kind) return null;
                  const kind = m.kind;
                  return (
                    <button
                      key={`${d}-skip-${mealKey(m)}`}
                      data-at={m.at.start}
                      type="button"
                      aria-label={`${mealName(m)} ${m.kind === "cena" || m.kind === "merienda" ? "sacada" : "sacado"} ese día, ${weekdayShort(tz, m.at.start)} ${time(tz, m.at.start)}: volver a ${m.kind === "cena" || m.kind === "merienda" ? "ponerla" : "ponerlo"}`}
                      className="pill meal skipped"
                      style={style}
                      onClick={() => {
                        const had = data.mealChoices?.find(
                          (c) => c.date === m.date && c.kind === kind,
                        )?.start;
                        dispatch({ type: "mealChoice", date: m.date, kind, start: had });
                        sayMeal(
                          `${mealName(m)} otra vez a ${had !== undefined ? "la hora que le habías puesto" : "su hora"}`,
                        );
                      }}
                    />
                  );
                }),
                meals.map((m) => {
                  const key = mealKey(m);
                  const style = position(d, m.at, lane.get(`m:${key}`));
                  if (!style) return null;
                  const moved = m.at.start !== m.preferred.start;
                  // One that is over cannot be moved or skipped, nor dragged.
                  const future = m.at.end > now && !!m.kind;
                  const movable = editing && future;
                  const dragged = drag?.id === key;
                  const lifted = dragged && drag.active;
                  return (
                    <button
                      key={`${d}-${key}`}
                      data-at={m.at.start}
                      type="button"
                      aria-label={`${mealName(m)}, ${weekdayShort(tz, m.at.start)} ${time(tz, m.at.start)} a ${time(tz, m.at.end)}${m.chosen ? ", movido por vos" : moved ? `, corrido de las ${time(tz, m.preferred.start)}` : ""}${m.overlapping ? ", encima de algo fijo" : ""}`}
                      className={`pill meal${m.overlapping ? " over" : ""}${m.at.end <= now ? " past" : ""}${movable ? " movable" : ""}${lifted ? " dragging" : ""}${mealBubble && mealKey(mealBubble.meal) === key ? " selected" : ""}`}
                      style={style}
                      onPointerDown={
                        future
                          ? (e) => startPress(e, key, (m.at.end - m.at.start) / MINUTE, m)
                          : m.kind
                            ? startPastPress
                            : undefined
                      }
                      onPointerMove={
                        dragged
                          ? (e) => movePress(e, drag)
                          : m.kind && !future
                            ? movePastPress
                            : undefined
                      }
                      onPointerLeave={!future ? endPastPress : undefined}
                      onPointerCancel={
                        dragged
                          ? () => {
                              clearTimeout(pressTimer.current);
                              setDrag(null);
                            }
                          : !future
                            ? endPastPress
                            : undefined
                      }
                      onPointerUp={
                        dragged
                          ? (e) => {
                              clearTimeout(pressTimer.current);
                              setDrag(null);
                              if (!drag.active) return; // a plain tap: onClick opens it
                              if (!editing) dropped.current = { ids: [key] };
                              if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) {
                                if (editing) openMeal(e, m);
                                return;
                              }
                              dropMeal(m, drag, e.clientX, e.clientY);
                            }
                          : !future
                            ? endPastPress
                            : undefined
                      }
                      onKeyDown={
                        movable
                          ? (e) => {
                              // Up and down move it by one slot, within its day.
                              const step = { ArrowUp: -1, ArrowDown: 1 }[e.key];
                              if (step === undefined || !m.kind) return;
                              e.preventDefault();
                              const slot = data.settings.slotMinutes;
                              const length = (m.at.end - m.at.start) / MINUTE;
                              const { earliest, latest } = mealRange(m.date, length);
                              const minute =
                                (m.at.start - zonedInstant(tz, m.date, 0)) / MINUTE + step * slot;
                              if (minute < earliest || minute > latest) return;
                              dispatch({
                                type: "mealChoice",
                                date: m.date,
                                kind: m.kind,
                                start: minute,
                              });
                              sayMeal(
                                `${mealName(m)} a las ${time(tz, zonedInstant(tz, m.date, minute))}, solo ese día`,
                              );
                            }
                          : undefined
                      }
                      onContextMenu={future ? (e) => e.preventDefault() : undefined}
                      onClick={(e) => {
                        // The click that ends a long-press drag is not a tap.
                        if (e.detail !== 0 && dropped.current.ids.includes(key)) {
                          dropped.current = { ids: [] };
                          return;
                        }
                        // Pointer taps on movable meals open from onPointerUp.
                        if (!movable || e.detail === 0) openMeal(e, m);
                      }}
                    />
                  );
                }),
                items.map((item) => {
                  const style = position(d, item, lane.get(`i:${item.id}`));
                  if (!style) return null;
                  const past = item.end <= now;
                  if (item.kind === "event") {
                    return (
                      <button
                        key={`${d}-${item.id}`}
                        data-at={item.start}
                        type="button"
                        aria-label={`${item.event.title}, ${weekdayShort(tz, item.start)} ${time(tz, item.start)} a ${time(tz, item.end)}${
                          // A part of an event that started another day says it goes on here.
                          localParts(tz, item.start).date === d
                            ? ""
                            : `, sigue el ${weekdayShort(tz, zonedInstant(tz, d, 720))}`
                        }${isTentative(item.event) ? ", tentativo" : ""}`}
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
                      data-at={item.start}
                      type="button"
                      data-level={b.level}
                      aria-label={`${titleOf(b)}, ${weekdayShort(tz, item.start)} ${time(tz, item.start)} a ${time(tz, item.end)}${item.run ? `, ${item.run.length} bloques seguidos` : ""}${isPinned(b) ? ", fijado" : ""}${sleptIds.has(b.id) ? ", no hecho: dormías" : b.level === "critical" ? ", crítico: no llega a tiempo" : b.level === "warn" ? ", justo de tiempo" : ""}`}
                      className={`pill planned ${b.level ?? "ok"}${past ? " past" : ""}${sleptIds.has(b.id) ? " slept" : ""}${isPinned(b) ? " pinned" : ""}${movable ? " movable" : ""}${lifted ? " dragging" : ""}${displaced(b) ? " displaced" : ""}${item.run ? " run" : ""}${bubble?.item.id === item.id ? " selected" : ""}`}
                      style={{ ...style, ["--c" as string]: colorOf(b) }}
                      onPointerDown={
                        // A run of blocks is not dragged: editing shows each one apart.
                        future && !item.run
                          ? (e) => startPress(e, b.id, (b.end - b.start) / MINUTE)
                          : undefined
                      }
                      onPointerMove={dragged ? (e) => movePress(e, drag) : undefined}
                      // Once, right after a keyboard move: kept, it would pull focus back on
                      // every render (the clock ticks each minute).
                      ref={
                        b.id === focusId
                          ? (el) => {
                              if (!el) return;
                              el.focus();
                              setFocusId(null);
                            }
                          : undefined
                      }
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
                              keyMove(b, step);
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
                }),
              ])}
              {drag?.active &&
                drag.target?.date === d &&
                dragColor &&
                (() => {
                  const start = zonedInstant(tz, d, drag.target.minute);
                  const ghost = position(d, { start, end: start + drag.minutes * MINUTE });
                  return (
                    ghost && (
                      <div
                        className="pill planned ghost"
                        aria-hidden
                        style={{ ...ghost, ["--c" as string]: dragColor }}
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
          );
        })}
        {dragMarks.length > 0 && (
          <div className="guides" aria-hidden>
            {dragMarks.map((m) => (
              <div key={m} className="guide" style={{ top: `${((m - startMin) / span) * 100}%` }} />
            ))}
          </div>
        )}
      </div>
      {drag?.active && drag.target && dragColor && (
        <Loupe
          x={drag.x}
          y={drag.y}
          date={drag.target.date}
          minute={drag.target.minute}
          minutes={drag.minutes}
          color={dragColor}
          items={items.filter((i) => i.id !== drag.id)}
          meals={meals.filter((m) => mealKey(m) !== drag.id)}
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
            onClose={() => setBubble(null)}
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
              // The block gets a new id: focus goes to the pinned one, not to the page.
              setFocusId(pinAt(block, block.start));
              // The same «Deshacer» as a drag: a pinned block goes back to the plan.
              flash("Fijado acá · el resto se acomoda alrededor", watch.current?.undo);
            }}
            onPinRun={(run) => {
              setBubble(null);
              dispatch({ type: "pinAll", blockIds: run.map((x) => x.id) });
              flash(`Fijaste ${run.length} bloques · el resto se acomoda alrededor`, () => {
                toaster.clear();
                dispatch({ type: "undoPlan" });
              });
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
            onSaid={sayMeal}
            onClose={() => setMealBubble(null)}
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
          // If replanning took the block away («Soltar»), to the gear: always there.
          returnTo={() =>
            bubbleFrom.current?.isConnected
              ? bubbleFrom.current
              : document.querySelector<HTMLElement>('button[aria-label="Ajustes"]')
          }
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
  onPinRun,
  onClose,
}: {
  bubble: Bubble;
  onClose: () => void;
  onOpen: () => void;
  onRelease: (blockId: string) => void;
  onPin: (block: PlanBlock) => void;
  /** «Fijar acá» on a run: every block of it, where it is. */
  onPinRun: (run: PlanBlock[]) => void;
}) {
  const { data, now } = useStore();
  const tz = data.settings.timezone;
  const { item } = bubble;
  const left = Math.min(Math.max(16, bubble.x - 130), window.innerWidth - 276);
  const top = cardTop(bubble.y, 150);

  if (item.kind === "event") {
    return (
      <BubbleDialog
        label={item.event.title}
        onClose={onClose}
        style={{ left, top, ["--c" as string]: "var(--ink-soft)" }}
      >
        <button type="button" className="bubble" onClick={onOpen}>
          <h3>{item.event.title}</h3>
          <p>
            {dayAndTime(tz, item.start)} – {time(tz, item.end)}
          </p>
          {item.event.location && <p>{item.event.location}</p>}
          <p className="more">Abrir evento ›</p>
        </button>
        <EventTrip event={item.event} />
      </BubbleDialog>
    );
  }
  const b = item.block;
  const task = data.tasks.find((t) => t.id === b.taskId);
  const activity = data.activities.find((a) => a.id === b.activityId);
  const p = progress(data, now).find((x) => x.task.id === b.taskId);
  // A run of blocks may mix tasks of the activity: all their names, the progress of a single one.
  const titles = [
    ...new Set(
      (item.run ?? [b]).map((x) => data.tasks.find((t) => t.id === x.taskId)?.title ?? "Bloque"),
    ),
  ].join(" · ");
  // Already registered: the sheet offers to correct it, not to mark how it went.
  const answeredIds = new Set(standingCheckIns(data).map((c) => c.blockId));
  const unanswered = (item.run ?? [b]).some((x) => !answeredIds.has(x.id));
  return (
    <BubbleDialog
      label={titles}
      onClose={onClose}
      style={{ left, top, ["--c" as string]: activity?.color }}
    >
      <button type="button" className="bubble" onClick={onOpen}>
        <h3>{titles}</h3>
        <p>
          {activity?.name} · {dayAndTime(tz, item.start)} – {time(tz, item.end)}
          {item.run && ` · ${item.run.length} bloques seguidos`}
        </p>
        {p && titles === task?.title && (
          <p>
            Faltan {hours(p.remainingMinutes)} de {hours(p.totalMinutes)}
            {b.level === "critical" && (
              <>
                {" "}
                <span className="tag critical">crítico</span>
              </>
            )}
            {b.level === "warn" && (
              <>
                {" "}
                <span className="tag warn">justo</span>
              </>
            )}
          </p>
        )}
        {(item.run ?? [b]).every((x) => sleptBlockIds(data).has(x.id)) && <p>No hecho · dormías</p>}
        {isPinned(b) && item.start <= now && (
          <p>
            <Marks.pinned /> Fijado por vos
          </p>
        )}
        <p className="more">
          {item.end <= now && unanswered ? "Marcar cómo te fue ›" : "Ver detalle ›"}
        </p>
      </button>
      {isPinned(b) && item.start > now && !item.run && (
        <div className="bubble-pin">
          <span>
            <Marks.pinned /> Fijado por vos
          </span>
          <button type="button" className="btn small" onClick={() => onRelease(b.id)}>
            Soltar
          </button>
        </div>
      )}
      {!isPinned(b) && item.start > now && !item.run && (
        <div className="bubble-pin">
          <span>Lo puso el plan</span>
          <button type="button" className="btn small" onClick={() => onPin(b)}>
            Fijar acá
          </button>
        </div>
      )}
      {item.run && item.start > now && !item.run.some(isPinned) && (
        <div className="bubble-pin">
          <span>Los puso el plan</span>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              if (item.run) onPinRun(item.run);
            }}
          >
            Fijar acá
          </button>
        </div>
      )}
    </BubbleDialog>
  );
}

/** The blocks of a day by start time, so a screen reader reads them in the order of the day. */
function inReadingOrder(groups: (React.ReactElement | null)[][]) {
  return groups
    .flat()
    .filter((el): el is React.ReactElement<{ "data-at": number }> => el !== null)
    .sort((a, b) => a.props["data-at"] - b.props["data-at"]);
}

/** Where a bubble opened by a tap at `y` goes: below it, or above when it would reach the tab bar. */
function cardTop(y: number, height: number) {
  const room = window.innerHeight - 80 - height;
  return Math.max(8, Math.min(y > window.innerHeight * 0.6 ? y - height : y + 14, room));
}

/**
 * The small window of a block, event or meal: a dialog. Focus goes into it, Escape closes it
 * and gives the focus back to what was tapped, and the rest of the screen is inert meanwhile.
 */
function BubbleDialog({
  label,
  onClose,
  style,
  children,
}: {
  label: string;
  onClose: () => void;
  style: CSSProperties;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useModal(ref, onClose);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="bubble-card"
      // Where it sits is clamped in CSS, so a resize (a rotation) never pushes it off screen;
      // the room left under it, minus the tab bar, is never below 10rem: a tall card scrolls inside.
      style={
        {
          ...style,
          "--bubble-top": `min(${Number(style.top ?? 0)}px, max(8px, calc(100dvh - 80px - 10rem)))`,
          top: "var(--bubble-top)",
          maxHeight: "calc(100dvh - var(--bubble-top) - 80px)",
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}

/**
 * A meal's time and why it is there; move it that day to any time, skip it that day
 * («Hoy no»), or go to where its usual time is set.
 */
function MealCard({
  bubble,
  onClose,
  onSettings,
  onSaid,
}: {
  bubble: MealBubble;
  onClose: () => void;
  onSettings: () => void;
  /** Tells what was done (the app offers its «Deshacer»); `at` is where the meal was. */
  onSaid: (said: string, at?: number) => void;
}) {
  const { data, now, dispatch } = useStore();
  const tz = data.settings.timezone;
  const { meal } = bubble;
  const past = meal.at.end <= now;
  const kind = meal.kind;
  const name = mealName(meal);
  const [at, setAt] = useState(time(tz, meal.at.start));
  const left = Math.min(Math.max(16, bubble.x - 130), window.innerWidth - 276);
  const top = cardTop(bubble.y, 260);
  // Within that day's waking hours, whole: a meal at 00:30 or one at 23:59 that runs
  // past bedtime would fall off the calendar.
  // As the planner sees that day: a holiday's routine, a late night's wake-up.
  const { wake, bed } = wakingDay(data, now, meal.date);
  const length = (meal.at.end - meal.at.start) / MINUTE;
  // Minutes since that day's midnight: a time before waking up that still fits before
  // bedtime is after midnight (00:30 in a day awake until 02:00 is 24:30).
  const minuteOf = (hhmm: string) => {
    const m = hhmmToMinutes(hhmm);
    return m < wake && m + 1440 + length <= bed ? m + 1440 : m;
  };
  const [moveError, setMoveError] = useState<string | null>(null);
  const today = meal.date === localParts(tz, now).date;
  const dayWord = today ? "Hoy" : `El ${weekdayShort(tz, meal.at.start)}`;
  const choose = (choice: { start?: number; skip?: boolean }, said: string) => {
    if (!kind) return;
    const before = data.mealChoices?.find((c) => c.date === meal.date && c.kind === kind);
    // Skipping a meal that was moved keeps its time, to come back to it.
    dispatch({
      type: "mealChoice",
      date: meal.date,
      kind,
      ...(choice.skip && before?.start !== undefined ? { start: before.start } : {}),
      ...choice,
    });
    onClose();
    onSaid(said, meal.at.start);
  };
  return (
    <BubbleDialog
      label={name}
      onClose={onClose}
      style={{ left, top, ["--c" as string]: "var(--meal)" }}
    >
      <div className="bubble">
        <h3>{name}</h3>
        <p>
          {dayAndTime(tz, meal.at.start)} – {time(tz, meal.at.end)}
        </p>
        {meal.chosen ? (
          <p>La pusiste vos a esta hora, solo este día.</p>
        ) : meal.overlapping ? (
          <p>
            No hay un rato libre cerca de las {time(tz, meal.preferred.start)}: quedó encima de lo
            fijo. Dejala ahí o movela a cualquier hora.
          </p>
        ) : (
          meal.at.start !== meal.preferred.start && (
            <p>
              Se corrió de las {time(tz, meal.preferred.start)}: a esa hora hay algo fijo o un
              bloque fijado.
            </p>
          )
        )}
        {past && <p className="meta">Ya pasó: no se puede mover ni sacar.</p>}
        {kind && !past && (
          <>
            <form
              className="row fields"
              onSubmit={(e) => {
                e.preventDefault();
                if (!at) return;
                const start = minuteOf(at);
                // The same time is no move.
                if (zonedInstant(tz, meal.date, start) === meal.at.start) return onClose();
                if (start < wake || start + length > bed) {
                  setMoveError(
                    `Elegí una hora entre las ${minutesToHhmm(wake)} y las ${minutesToHhmm(bed - length)}, cuando estás despierto.`,
                  );
                  return;
                }
                choose({ start }, `${name} a las ${at}, solo ese día`);
              }}
            >
              <label style={{ flex: 1 }}>
                <span className="meta">Mover a</span>
                <input
                  type="time"
                  aria-label={`Mover ${name.toLowerCase()} a`}
                  value={at}
                  aria-invalid={moveError ? true : undefined}
                  onChange={(e) => {
                    setAt(e.target.value);
                    setMoveError(null);
                  }}
                />
              </label>
              <button type="submit" className="btn small" disabled={!at}>
                Mover
              </button>
            </form>
            {moveError && (
              <p className="meta" role="alert">
                {moveError}
              </p>
            )}
            <div className="row">
              <button
                type="button"
                className="btn small"
                onClick={() =>
                  choose(
                    { skip: true },
                    `${dayWord} no ${name.toLowerCase()} · ${
                      today ? "reacomodá hoy para usar ese rato" : "el plan usa ese rato"
                    }`,
                  )
                }
              >
                {dayWord} no {name.toLowerCase()}
              </button>
              {meal.chosen && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => choose({}, `${name} vuelve a su hora de siempre`)}
                >
                  A su hora
                </button>
              )}
            </div>
          </>
        )}
        <button type="button" className="more link-btn" onClick={onSettings}>
          Cambiar hora y duración de siempre ›
        </button>
      </div>
    </BubbleDialog>
  );
}
