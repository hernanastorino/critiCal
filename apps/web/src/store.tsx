import { type Activity, type DayOverride, zonedInstant } from "@critical/engine";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import { demoData } from "./demo";
import type { AppData, AppTask, CheckIn } from "./model";
import { newId } from "./model";
import {
  applyOption,
  type Decisions,
  decisions,
  pendingConfirmations,
  refreshPlan,
  weekStart,
} from "./planning";

export type Action =
  | { type: "refresh"; now: number }
  | { type: "replace"; data: AppData; now: number }
  | { type: "checkIn"; checkIn: Omit<CheckIn, "id" | "createdAt">; now: number }
  | { type: "saveTask"; task: AppTask; activity?: Activity; now: number }
  | { type: "override"; override: DayOverride; now: number }
  | { type: "acceptProposal"; id: string; now: number }
  | { type: "rejectProposal"; id: string; now: number }
  | { type: "applyOption"; optionId: string; now: number }
  | { type: "relaxContext"; until: number; now: number };

function refresh(data: AppData, now: number): AppData {
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
      return refresh(applyOption(data, r.input, option, now), now);
    }
    case "relaxContext":
      return refresh({ ...data, relaxContextUntil: action.until }, now);
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
  children,
}: {
  initial: (now: number) => AppData;
  fixedNow?: number;
  persist?: boolean;
  children: ReactNode;
}) {
  const now = useNow(60_000, fixedNow);
  const [data, raw] = useReducer(reducer, undefined, () =>
    reducer(initial(now), { type: "refresh", now }),
  );
  useEffect(() => {
    raw({ type: "refresh", now });
  }, [now]);
  useEffect(() => {
    if (persist) saveDemo(data);
  }, [data, persist]);

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
      inboxCount:
        pending.length + data.proposals.length + d.options.length + d.recommendations.length,
    };
  }, [data, now, fixedNow]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
