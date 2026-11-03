import {
  type Activity,
  type DayOverride,
  type ScheduleResult,
  type Settings,
  zonedInstant,
} from "@critical/engine";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { DEFAULTS, eventRole, importFromCalendars } from "./calendars";
import { demoData } from "./demo";
import type {
  AppData,
  AppliedDecision,
  AppTask,
  CalendarRole,
  CheckIn,
  Preferences,
} from "./model";
import { newId, uniqueColors } from "./model";
import {
  applyOption,
  type Decisions,
  decisions,
  endOfWeek,
  pendingConfirmations,
  pinBlock,
  refreshPlan,
  weekStart,
} from "./planning";

/**
 * What to do with a weekly silo, like a repeating calendar event: skip only
 * this week, pause until resumed, stop from today keeping past weeks, or erase
 * it with all its history.
 */
export type RecurrenceChange = "skipWeek" | "pause" | "resume" | "endFromToday" | "deleteAll";

export type Action =
  | { type: "refresh"; now: number }
  | { type: "replace"; data: AppData; now: number }
  | { type: "checkIn"; checkIn: Omit<CheckIn, "id" | "createdAt">; now: number }
  | { type: "saveTask"; task: AppTask; activity?: Activity; now: number }
  | { type: "override"; override: DayOverride; now: number }
  | { type: "acceptProposal"; id: string; now: number }
  | { type: "rejectProposal"; id: string; now: number }
  | { type: "applyOption"; optionId: string; now: number }
  | { type: "relaxContext"; until: number; now: number }
  | { type: "calendarRole"; calendarId: string; role: CalendarRole; now: number }
  | { type: "review"; taskId: string; keep: boolean; now: number }
  | { type: "replanWeek"; now: number }
  | { type: "pin"; blockId: string; start: number; now: number }
  | { type: "unpin"; blockId: string; now: number }
  | { type: "recurrence"; taskId: string; change: RecurrenceChange; now: number }
  | {
      type: "logProgress";
      taskId: string;
      minutes: number;
      /** Mark these existing units done. */
      unitIds?: string[];
      /** For tasks without units: split into this many topics, the first `topicsDone` done. */
      topics?: number;
      topicsDone?: number;
      now: number;
    }
  | { type: "undoDecision"; id: string; now: number }
  | { type: "resetDetected"; taskId?: string; now: number }
  | { type: "settings"; settings: Settings; now: number }
  | { type: "preferences"; preferences: Preferences; now: number }
  | { type: "saveActivity"; activity: Activity; now: number };

function refresh(raw: AppData, now: number): AppData {
  // Pins that already happened live on as plan history.
  const input = raw.pins?.some((p) => p.end <= now)
    ? { ...raw, pins: raw.pins.filter((p) => p.end > now) }
    : raw;
  const imported = importFromCalendars(input, now, newId);
  const activities = uniqueColors(imported.activities);
  const data = activities === imported.activities ? imported : { ...imported, activities };
  const r = refreshPlan(data, now);
  const proposals = r.proposal
    ? [...data.proposals.filter((p) => !p.id.startsWith("conflict@")), r.proposal]
    : data.proposals.filter((p) => !p.id.startsWith("conflict@"));
  return { ...data, plan: r.plan, proposals };
}

export function reducer(data: AppData, action: Action): AppData {
  const now = action.now;
  switch (action.type) {
    case "refresh":
      return refresh(data, now);
    case "replace":
      return refresh(action.data, now);
    case "checkIn": {
      const checkIn: CheckIn = { ...action.checkIn, id: newId(), createdAt: now };
      const tasks = data.tasks.map((t) =>
        t.id === checkIn.taskId
          ? {
              ...t,
              units: t.units.map((u) =>
                checkIn.unitIds.includes(u.id) ? { ...u, doneAt: now } : u,
              ),
            }
          : t,
      );
      return refresh({ ...data, tasks, checkIns: [...data.checkIns, checkIn] }, now);
    }
    case "saveTask": {
      const exists = data.tasks.some((t) => t.id === action.task.id);
      const tasks = exists
        ? data.tasks.map((t) => (t.id === action.task.id ? action.task : t))
        : [...data.tasks, action.task];
      const activities = action.activity ? [...data.activities, action.activity] : data.activities;
      return refresh({ ...data, tasks, activities }, now);
    }
    case "override": {
      const overrides = [
        ...data.overrides.filter((o) => o.date !== action.override.date),
        action.override,
      ];
      return refresh({ ...data, overrides }, now);
    }
    case "acceptProposal": {
      const p = data.proposals.find((x) => x.id === action.id);
      if (!p) return data;
      return { ...data, plan: p.plan, proposals: data.proposals.filter((x) => x.id !== p.id) };
    }
    case "rejectProposal": {
      const p = data.proposals.find((x) => x.id === action.id);
      if (!p) return data;
      return {
        ...data,
        plan: data.plan.filter((b) => !p.conflicts.includes(b.id)),
        proposals: data.proposals.filter((x) => x.id !== p.id),
      };
    }
    case "applyOption": {
      const r = refreshPlan(data, now);
      const option = decisions(r.input, r.result).options.find((o) => o.id === action.optionId);
      if (!option) return data;
      const next = applyOption(data, r.input, option, now);
      const changed = data.tasks.filter((t) => next.tasks.find((n) => n.id === t.id) !== t);
      const record: AppliedDecision = {
        id: `${option.id}@${now}`,
        label: option.label,
        at: now,
        before: changed,
        freeTimeUntil: data.freeTimeUntil,
      };
      return refresh({ ...next, applied: [...(data.applied ?? []), record] }, now);
    }
    case "undoDecision": {
      const record = data.applied?.find((d) => d.id === action.id);
      if (!record) return data;
      const tasks = data.tasks.map((t) => {
        const old = record.before.find((b) => b.id === t.id);
        return old
          ? {
              ...t,
              minMinutes: old.minMinutes,
              estimateMinutes: old.estimateMinutes,
              status: old.status,
            }
          : t;
      });
      return refresh(
        {
          ...data,
          tasks,
          freeTimeUntil: record.freeTimeUntil,
          applied: data.applied?.filter((d) => d.id !== record.id),
        },
        now,
      );
    }
    case "resetDetected": {
      // Detected tasks go back to their category's default hours.
      const tasks = data.tasks.map((t) => {
        if (!t.sourceEventId || (action.taskId && t.id !== action.taskId)) return t;
        const event = data.events.find((e) => e.id === t.sourceEventId);
        const role = event ? eventRole(data, event) : undefined;
        if (role !== "parcial" && role !== "entrega" && role !== "presentacion") return t;
        const d = data.preferences?.importDefaults?.[role] ?? DEFAULTS[role];
        return { ...t, estimateMinutes: d.estimate, minMinutes: d.min, status: "active" as const };
      });
      return refresh({ ...data, tasks }, now);
    }
    case "relaxContext":
      return refresh({ ...data, relaxContextUntil: action.until }, now);
    case "calendarRole": {
      const calendars = (data.calendars ?? []).map((c) =>
        c.id === action.calendarId ? { ...c, role: action.role } : c,
      );
      return refresh({ ...data, calendars }, now);
    }
    case "logProgress": {
      const task = data.tasks.find((t) => t.id === action.taskId);
      if (!task) return data;
      let units = task.units;
      if (units.length === 0 && action.topics && action.topics > 0) {
        const each = Math.round(task.estimateMinutes / action.topics);
        units = Array.from({ length: action.topics }, (_, i) => ({
          id: newId(),
          title: `Tema ${i + 1}`,
          estimateMinutes: each,
          doneAt: i < (action.topicsDone ?? 0) ? now : undefined,
        }));
      }
      const marked = new Set(action.unitIds ?? []);
      const newlyDone = units.filter((u) => !u.doneAt && marked.has(u.id)).map((u) => u.id);
      units = units.map((u) => (marked.has(u.id) && !u.doneAt ? { ...u, doneAt: now } : u));
      const tasks = data.tasks.map((t) => (t.id === task.id ? { ...t, units } : t));
      const checkIns =
        action.minutes > 0 || newlyDone.length > 0
          ? [
              ...data.checkIns,
              {
                id: newId(),
                blockId: `manual@${now}`,
                taskId: task.id,
                status: "done" as const,
                minutesDone: Math.max(0, Math.round(action.minutes)),
                unitIds: newlyDone,
                createdAt: now,
              },
            ]
          : data.checkIns;
      return refresh({ ...data, tasks, checkIns }, now);
    }
    case "pin": {
      const block = data.plan.find((b) => b.id === action.blockId);
      if (!block || block.start <= now || action.start <= now) return data;
      const moved = pinBlock(block, action.start);
      // Two blocks of one task dropped on the same slot would share an id.
      if ((data.pins ?? []).some((p) => p.id === moved.id && p.id !== block.id)) return data;
      const pins = [...(data.pins ?? []).filter((p) => p.id !== block.id), moved];
      return refresh({ ...data, pins, plan: data.plan.filter((b) => b.id !== block.id) }, now);
    }
    case "recurrence": {
      const id = action.taskId;
      if (action.change === "deleteAll") {
        return refresh(
          {
            ...data,
            tasks: data.tasks.filter((t) => t.id !== id),
            checkIns: data.checkIns.filter((c) => c.taskId !== id),
            plan: data.plan.filter((b) => b.taskId !== id),
            pins: (data.pins ?? []).filter((b) => b.taskId !== id),
            // Nothing of it survives, not even in the undo history.
            applied: data.applied?.map((d) => ({
              ...d,
              before: d.before.filter((t) => t.id !== id),
            })),
          },
          now,
        );
      }
      const tz = data.settings.timezone;
      const change = (t: AppTask): AppTask => {
        switch (action.change) {
          case "skipWeek":
            return { ...t, skipUntil: endOfWeek(tz, now) };
          case "pause":
            return { ...t, paused: true };
          case "resume":
            return { ...t, paused: undefined, skipUntil: undefined };
          // endFromToday
          default:
            return { ...t, status: "dropped", endedAt: now, paused: undefined };
        }
      };
      const tasks = data.tasks.map((t) => (t.id === id ? change(t) : t));
      return refresh({ ...data, tasks }, now);
    }
    case "unpin": {
      const pins = (data.pins ?? []).filter((p) => p.id !== action.blockId);
      return refresh(
        { ...data, pins, plan: data.plan.filter((b) => b.id !== action.blockId) },
        now,
      );
    }
    case "replanWeek": {
      // Start over from now: keep history and the block in progress, drop the rest.
      const plan = data.plan.filter((b) => b.start <= now);
      return refresh({ ...data, plan, proposals: [] }, now);
    }
    case "settings":
      return refresh({ ...data, settings: action.settings }, now);
    case "preferences":
      return refresh({ ...data, preferences: action.preferences }, now);
    case "saveActivity": {
      const activities = data.activities.map((a) =>
        a.id === action.activity.id ? action.activity : a,
      );
      return refresh({ ...data, activities }, now);
    }
    case "review": {
      const tasks = data.tasks.map((t) =>
        t.id === action.taskId
          ? { ...t, needsReview: false, status: action.keep ? t.status : ("dropped" as const) }
          : t,
      );
      return refresh({ ...data, tasks }, now);
    }
  }
}

const STORAGE_KEY = "critical.demo.v1";

export function loadDemo(now: number): AppData {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppData;
  } catch {
    // Storage blocked or corrupt: start fresh.
  }
  return seedHistory(demoData(now), now);
}

/**
 * Plans the demo week from Monday morning, then catches up to `now` marking all
 * but the last two past blocks as done, so there is history and a short inbox.
 */
export function seedHistory(data: AppData, now: number): AppData {
  const tz = data.settings.timezone;
  const monday = zonedInstant(tz, weekStart(tz, now), 7 * 60);
  if (monday >= now) return data;
  const caught = reducer(reducer(data, { type: "refresh", now: monday }), { type: "refresh", now });
  const past = pendingConfirmations(caught, now).slice(0, -2);
  const checkIns: CheckIn[] = past.map((b) => ({
    id: `seed-${b.id}`,
    blockId: b.id,
    taskId: b.taskId,
    status: "done",
    minutesDone: (b.end - b.start) / 60_000,
    unitIds: [],
    createdAt: b.end,
  }));
  return { ...caught, checkIns };
}

function saveDemo(data: AppData): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Not persisting is fine for a demo.
  }
}

export function resetDemo(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

interface Store {
  data: AppData;
  now: number;
  dispatch: (a: DistributiveOmit<Action, "now">) => void;
  pending: ReturnType<typeof pendingConfirmations>;
  decisions: Decisions;
  /** The current plan's verdict (feasibility, per-task deficits). */
  result: ScheduleResult;
  inboxCount: number;
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

const StoreContext = createContext<Store | null>(null);

export function useNow(intervalMs = 60_000, fixed?: number): number {
  const [now, setNow] = useState(() => fixed ?? Date.now());
  useEffect(() => {
    if (fixed !== undefined) return;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, fixed]);
  return now;
}

export function StoreProvider({
  initial,
  fixedNow,
  persist = true,
  onChange,
  children,
}: {
  initial: (now: number) => AppData;
  fixedNow?: number;
  /** Save to this browser (demo mode). */
  persist?: boolean;
  /** Called after every change with the previous and new data (remote mode). */
  onChange?: (prev: AppData, next: AppData) => void;
  children: ReactNode;
}) {
  const now = useNow(60_000, fixedNow);
  // The unrefreshed seed is the baseline for persistence, so whatever the first
  // refresh adds (imported tasks and activities, the plan) gets written too.
  const [seed] = useState(() => initial(now));
  const [data, raw] = useReducer(reducer, seed, (s) => reducer(s, { type: "refresh", now }));
  useEffect(() => {
    raw({ type: "refresh", now });
  }, [now]);
  const previous = useRef(seed);
  useEffect(() => {
    if (persist) saveDemo(data);
    if (onChange && previous.current !== data) onChange(previous.current, data);
    previous.current = data;
  }, [data, persist, onChange]);

  const store = useMemo<Store>(() => {
    const r = refreshPlan(data, now);
    const pending = pendingConfirmations(data, now);
    const d = decisions(r.input, r.result);
    return {
      data,
      now,
      dispatch: (a) => raw({ ...a, now: fixedNow ?? Date.now() } as Action),
      pending,
      decisions: d,
      result: r.result,
      inboxCount:
        pending.length +
        data.proposals.length +
        d.options.length +
        d.recommendations.length +
        data.tasks.filter((t) => t.needsReview && t.status === "active").length,
    };
  }, [data, now, fixedNow]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
