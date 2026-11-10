import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { DEFAULTS, eventRole, normalize, visibleEvents } from "./calendars.js";
import { demoData } from "./demo.js";
import {
  type Activity,
  addDays,
  type DayOverride,
  localParts,
  type MealKind,
  overlaps,
  type ScheduleResult,
  type Settings,
  zonedInstant,
} from "./engine.js";
import { lateNight } from "./lateNight.js";
import type {
  AppData,
  AppliedDecision,
  AppTask,
  CalendarRole,
  CheckIn,
  EventTravel,
  Place,
  PlanVersion,
  Preferences,
  Spot,
} from "./model.js";
import { newId, nextColor, pruneApplied, undoable } from "./model.js";
import { eventSpotKey, home, keepableEvents, spotKey, unlocated } from "./places.js";
import {
  applyOption,
  checkInFactor,
  type Decisions,
  decisions,
  endOfDay,
  endOfWeek,
  missedMeals,
  pendingConfirmations,
  pinBlock,
  pinClashes,
  pinShortfall,
  refreshPlan,
  weekStart,
} from "./planning.js";
import { refresh } from "./refresh.js";
import {
  aliasFrom,
  isNoSubject,
  markLegacyStudy,
  newClassTitles,
  studyOf,
  studyTitle,
  unassignedTasks,
  unsortedActivities,
  validRoutine,
} from "./subjects.js";
import { hold } from "./updates.js";

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
  /** Takes an archived task back (only its status: later edits to it stay). */
  | { type: "unarchive"; taskId: string; status: "active" | "done"; now: number }
  | { type: "settings"; settings: Settings; now: number }
  | { type: "preferences"; preferences: Preferences; now: number }
  | { type: "saveActivity"; activity: Activity; now: number }
  | { type: "savePlace"; place: Place; now: number }
  | { type: "deletePlace"; placeId: string; now: number }
  | { type: "travelTime"; from: string; to: string; minutes: number; now: number }
  /** An event's place: adds what the event says as an alias, or marks it as no trip. */
  | { type: "locate"; text: string; placeId: string | null; now: number }
  /** Driving times the server found for event addresses (null: not found or no route). */
  | { type: "spots"; results: { text: string; minutes: number | null }[]; now: number }
  /** Minutes from home typed for an event, without saving a place. */
  | { type: "spotMinutes"; text: string; minutes: number; now: number }
  /** Turns an event address into a saved place called `name`. */
  | { type: "saveSpot"; key: string; name: string; now: number }
  | { type: "forgetSpot"; key: string; now: number }
  /**
   * That day only: a meal skipped («Hoy no»), moved to `start` (minutes since that
   * day's midnight), or back to automatic (neither).
   */
  | {
      type: "mealChoice";
      date: string;
      kind: MealKind;
      start?: number;
      skip?: boolean;
      now: number;
    }
  /** Minutes kept for one event (after «Eliminar lugar») changed, or forgotten (`null`). */
  | { type: "eventTravelMinutes"; eventId: string; minutes: number | null; now: number }
  /** Deletes an event address but keeps its minutes on each event that used it. */
  | { type: "dropSpotAddress"; key: string; now: number }
  /**
   * Takes «Eliminar lugar» back: the address returns (unless a newer one took its key)
   * and each event's kept minutes go back to what they were (`before`), unless they
   * changed since.
   */
  | {
      type: "restoreSpot";
      spot: Spot;
      before: Record<string, EventTravel | undefined>;
      now: number;
    }
  /** A flexible event goes back to its own time in the plan. */
  | { type: "unmoveEvent"; eventId: string; now: number }
  /** A flexible event is planned at `start`–`end` until the calendar shows it moved. */
  | { type: "moveEvent"; eventId: string; start: number; end: number; now: number }
  /** Back to the plan as it was before the last reorganization. */
  | { type: "undoPlan"; now: number }
  /** A title from the class calendar: a new materia, or just an event (a talk…). */
  | { type: "classTitle"; title: string; as: "materia" | "event"; now: number }
  /** A class-calendar title that is another name of an existing materia. */
  | { type: "classOf"; title: string; activityId: string; now: number }
  /** An activity from before the distinction is a materia or a routine. */
  | { type: "sortActivity"; activityId: string; as: "materia" | "rutina"; now: number }
  /** An activity that was really part of a materia (its evaluations): merged into it. */
  | { type: "mergeActivity"; activityId: string; into: string; now: number }
  /** An evaluation waiting under "Sin materia" belongs to this materia. */
  | { type: "assignSubject"; taskId: string; activityId: string; now: number }
  /** A new materia by name, taking the evaluation `taskId` if given. */
  | { type: "newSubject"; name: string; taskId?: string; now: number }
  /** Weekly study time for a materia beyond its evaluations (0 removes it). */
  | { type: "weeklyStudy"; activityId: string; minutes: number; now: number }
  /** A routine (gym…) the plan places `sessionsPerWeek` times a week. */
  | {
      type: "saveRoutine";
      name: string;
      sessionsPerWeek: number;
      sessionMinutes: number;
      now: number;
    };

/**
 * Every change, plus one rule for the undo history: a task whose status changed by
 * anything other than a decision or its undo leaves the earlier decisions, so undo
 * never overrides it, even if it later returns to the same status.
 */
/** Reorganizations of the plan that «Deshacer» in the week can take back. */
const VERSIONED: Partial<Record<Action["type"], string>> = {
  pin: "mover o fijar un bloque",
  unpin: "soltar un bloque",
  replanWeek: "reacomodar la semana",
  override: "ajustar el día",
  acceptProposal: "aceptar un cambio propuesto",
  rejectProposal: "rechazar un cambio propuesto",
};
/** Plan versions kept for undo. */
export const PLAN_HISTORY = 20;

/** Applies `action` and records a plan version for the ones that can be undone. */
export function reducer(data: AppData, action: Action): AppData {
  const next = versioned(data, action, apply(data, action));
  // Decisions themselves, and data that arrives whole (loaded, re-planned), already
  // carry their own history.
  const exempt = ["applyOption", "undoDecision", "replace", "refresh"].includes(action.type);
  if (exempt || !next.applied?.length) return next;
  const before = new Map(data.tasks.map((t) => [t.id, t.status]));
  const moved = new Set(
    next.tasks.filter((t) => before.has(t.id) && before.get(t.id) !== t.status).map((t) => t.id),
  );
  if (moved.size === 0) return next;
  return { ...next, applied: pruneApplied(next.applied, (id) => moved.has(id)) };
}

/** The data after `action`, planned again where it changes the plan. */
function apply(data: AppData, action: Action): AppData {
  const now = action.now;
  switch (action.type) {
    case "refresh":
      return refresh(data, now);
    case "replace":
      return refresh(action.data, now);
    case "checkIn": {
      const checkIn: CheckIn = {
        ...action.checkIn,
        id: newId(),
        createdAt: now,
        factor: checkInFactor(data, action.checkIn.taskId),
      };
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
    case "unarchive": {
      if (!data.tasks.some((t) => t.id === action.taskId && t.status === "dropped")) return data;
      return refresh(
        {
          ...data,
          tasks: data.tasks.map((t) =>
            t.id === action.taskId ? { ...t, status: action.status } : t,
          ),
        },
        now,
      );
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
        // No to a plan B: today keeps its blocks for the rest of the day.
        ...(p.id.startsWith("tentative@")
          ? { tentativeHoldUntil: endOfDay(data.settings.timezone, now) }
          : {}),
      };
    }
    case "applyOption": {
      const r = refreshPlan(data, now);
      const option = decisions(r.input, r.result).options.find((o) => o.id === action.optionId);
      if (!option) return data;
      const next = applyOption(data, r.input, option, now);
      const previousMove =
        option.kind === "move-event"
          ? data.movedEvents?.find((m) => m.eventId === option.eventId)
          : undefined;
      // Only tasks whose undoable fields really moved, so undo cannot clobber later edits.
      const changed = data.tasks.filter((t) => {
        const n = next.tasks.find((x) => x.id === t.id);
        return (
          !!n &&
          (n.minMinutes !== t.minMinutes ||
            n.estimateMinutes !== t.estimateMinutes ||
            n.status !== t.status ||
            JSON.stringify(n.startAfter) !== JSON.stringify(t.startAfter) ||
            n.units.some((u, i) => !!u.skipped !== !!t.units[i]?.skipped))
        );
      });
      const dropped = changed
        .filter(
          (t) =>
            t.status !== "dropped" && next.tasks.find((x) => x.id === t.id)?.status === "dropped",
        )
        .map((t) => t.id);
      // Units this decision left out: undo brings back only these.
      const skippedUnits = next.tasks.flatMap((n) => {
        const t = data.tasks.find((x) => x.id === n.id);
        return n.units
          .filter((u) => u.skipped && !t?.units.find((o) => o.id === u.id)?.skipped)
          .map((u) => u.id);
      });
      const record: AppliedDecision = {
        id: `${option.id}@${now}`,
        label: option.label,
        at: now,
        before: changed,
        ...(dropped.length ? { dropped } : {}),
        ...(skippedUnits.length ? { skippedUnits } : {}),
        after: Object.fromEntries(
          changed.map((t) => [t.id, next.tasks.find((x) => x.id === t.id)?.status ?? t.status]),
        ),
        afterMinutes: Object.fromEntries(
          changed.map((t) => {
            const n = next.tasks.find((x) => x.id === t.id) ?? t;
            return [t.id, { min: n.minMinutes, estimate: n.estimateMinutes }];
          }),
        ),
        freeTimeUntil: data.freeTimeUntil,
        ...(option.kind === "start-earlier" && option.taskId
          ? (() => {
              const set = next.tasks.find((x) => x.id === option.taskId)?.startAfter;
              return set ? { startAfter: { [option.taskId]: set } } : {};
            })()
          : {}),
        ...(option.kind === "move-event" && option.eventId
          ? {
              movedEventId: option.eventId,
              ...(previousMove ? { previousMove } : {}),
              ...(() => {
                const move = next.movedEvents?.find((m) => m.eventId === option.eventId);
                return move ? { move } : {};
              })(),
            }
          : {}),
      };
      return refresh({ ...next, applied: [...(data.applied ?? []), record] }, now);
    }
    case "undoDecision": {
      const record = data.applied?.find((d) => d.id === action.id);
      if (!record) return data;
      // Deleted silos stay deleted and silos dropped since stay dropped.
      const restore = undoable(data, record);
      const tasks = data.tasks.map((t) => {
        const old = restore.find((b) => b.id === t.id);
        return old
          ? {
              ...t,
              // Back what this decision cut, on top of whatever changed since.
              ...(() => {
                const after = record.afterMinutes?.[t.id];
                return after
                  ? {
                      minMinutes: Math.max(0, t.minMinutes + old.minMinutes - after.min),
                      estimateMinutes: Math.max(
                        0,
                        t.estimateMinutes + old.estimateMinutes - after.estimate,
                      ),
                    }
                  : { minMinutes: old.minMinutes, estimateMinutes: old.estimateMinutes };
              })(),
              status: old.status,
              // An earlier start comes back unless the rule was changed since.
              ...(record.startAfter?.[t.id] &&
              JSON.stringify(t.startAfter) === JSON.stringify(record.startAfter[t.id])
                ? { startAfter: old.startAfter }
                : {}),
              // Units this decision left out come back; ones a later decision left out
              // stay out (whatever was done since stays done).
              units: t.units.map((u) =>
                record.skippedUnits?.includes(u.id) ? { ...u, skipped: undefined } : u,
              ),
            }
          : t;
      });
      return refresh(
        {
          ...data,
          tasks,
          movedEvents: undoMove(data.movedEvents, record),
          freeTimeUntil: record.freeTimeUntil,
          // A later move of the same event that replaced this one now replaces what
          // this one replaced, so undoing it never brings back an undone move.
          applied: data.applied
            ?.filter((d) => d.id !== record.id)
            .map((d) =>
              record.move && d.previousMove && sameMove(d.previousMove, record.move)
                ? { ...d, previousMove: record.previousMove }
                : d,
            ),
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
        // Resetting hours keeps dropped or done tasks as they are; only an explicit
        // single-task reset brings one back.
        return {
          ...t,
          estimateMinutes: d.estimate,
          minMinutes: d.min,
          status: action.taskId ? ("active" as const) : t.status,
        };
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
                factor: checkInFactor(data, task.id),
              },
            ]
          : data.checkIns;
      return refresh({ ...data, tasks, checkIns }, now);
    }
    case "pin": {
      const block = data.plan.find((b) => b.id === action.blockId);
      if (!block || block.start <= now || action.start <= now) return data;
      const moved = pinBlock(block, action.start);
      // Other pins it lands on go back to the plan, which places them around it; one
      // already under way stays frozen.
      const covered = (data.pins ?? []).filter(
        (p) => p.id !== block.id && p.start > now && overlaps(p, moved),
      );
      const rest = (data.pins ?? []).filter((p) => p.id !== block.id && !covered.includes(p));
      // Two blocks of one task dropped on the same slot would share an id.
      if (rest.some((p) => p.id === moved.id)) return data;
      const gone = new Set([block.id, ...covered.map((p) => p.id)]);
      return refresh(
        { ...data, pins: [...rest, moved], plan: data.plan.filter((b) => !gone.has(b.id)) },
        now,
      );
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
            applied: pruneApplied(data.applied, (t) => t === id),
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
      if (action.change === "endFromToday") {
        return refresh(
          {
            ...data,
            tasks,
            // A silo that stops repeating keeps no hand-placed future blocks…
            pins: (data.pins ?? []).filter((b) => b.taskId !== id || b.end <= now),
            // …and undoing an earlier decision must not bring it back.
            applied: pruneApplied(data.applied, (t) => t === id),
          },
          now,
        );
      }
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
      // Asked for a new plan: a turned-down plan B no longer holds today.
      return refresh({ ...data, plan, proposals: [], tentativeHoldUntil: undefined }, now);
    }
    case "settings":
      return refresh({ ...data, settings: action.settings }, now);
    case "preferences":
      return refresh({ ...data, preferences: action.preferences }, now);
    case "saveActivity": {
      const old = data.activities.find((a) => a.id === action.activity.id);
      const activities = old
        ? data.activities.map((a) => (a.id === action.activity.id ? action.activity : a))
        : [...data.activities, action.activity];
      // A renamed materia keeps its weekly study: the silo is found by its title.
      const renamed = !!old && old.name !== action.activity.name;
      const study = renamed && old ? studyOf(data, old) : undefined;
      const tasks = data.tasks.map((t) => {
        if (study && t.id === study.id) return { ...t, title: studyTitle(action.activity) };
        // A routine's silo carries its name: renaming the routine renames it.
        if (
          renamed &&
          old?.kind === "rutina" &&
          t.activityId === old.id &&
          t.kind === "habit" &&
          t.title === old.name
        )
          return { ...t, title: action.activity.name };
        return t;
      });
      return refresh({ ...data, activities, tasks }, now);
    }
    case "savePlace": {
      const old = (data.places ?? []).find((p) => p.id === action.place.id);
      const exists = !!old;
      // A new address makes its computed times stale; manual ones are the user's.
      const travelTimes =
        old && (old.address ?? "") !== (action.place.address ?? "")
          ? (data.travelTimes ?? []).filter(
              (t) => t.manual || (t.from !== old.id && t.to !== old.id),
            )
          : data.travelTimes;
      let places = exists
        ? (data.places ?? []).map((p) => (p.id === action.place.id ? action.place : p))
        : [...(data.places ?? []), action.place];
      // Only one home.
      if (action.place.isHome)
        places = places.map((p) =>
          p.id !== action.place.id && p.isHome ? { ...p, isHome: undefined } : p,
        );
      // Spots are timed from home: a new home (or address) makes the computed ones stale.
      const was = home(data);
      const moved = action.place.isHome
        ? was?.id !== action.place.id || (old?.address ?? "") !== (action.place.address ?? "")
        : // Or the home stops being one.
          was?.id === action.place.id;
      const spots = moved ? (data.spots ?? []).filter((s) => s.manual) : data.spots;
      return refresh({ ...data, places, travelTimes, spots }, now);
    }
    case "deletePlace": {
      const places = (data.places ?? []).filter((p) => p.id !== action.placeId);
      const travelTimes = (data.travelTimes ?? []).filter(
        (t) => t.from !== action.placeId && t.to !== action.placeId,
      );
      // Without that home, minutes computed from it mean nothing; typed ones stay.
      const spots =
        home(data)?.id === action.placeId ? (data.spots ?? []).filter((s) => s.manual) : data.spots;
      return refresh({ ...data, places, travelTimes, spots }, now);
    }
    case "travelTime": {
      const others = (data.travelTimes ?? []).filter(
        (t) => !(t.from === action.from && t.to === action.to),
      );
      const minutes = Math.min(1440, Math.max(0, Math.round(action.minutes)));
      if (!Number.isFinite(minutes)) return data;
      const time = { from: action.from, to: action.to, minutes, manual: true };
      return refresh({ ...data, travelTimes: [...others, time] }, now);
    }
    case "classTitle": {
      const key = normalize(action.title);
      if (action.as === "event")
        return refresh(
          { ...data, notSubjects: [...new Set([...(data.notSubjects ?? []), key])] },
          now,
        );
      return refresh(
        { ...data, activities: [...data.activities, materia(data, action.title)] },
        now,
      );
    }
    case "classOf":
      return refresh(withAlias(data, action.activityId, normalize(action.title)), now);
    case "sortActivity":
      return refresh(
        {
          ...data,
          activities: data.activities.map((a) =>
            a.id === action.activityId
              ? { ...a, kind: action.as, academic: action.as === "materia" }
              : a,
          ),
        },
        now,
      );
    case "mergeActivity": {
      const from = data.activities.find((a) => a.id === action.activityId);
      if (!from || !data.activities.some((a) => a.id === action.into) || from.id === action.into)
        return data;
      const move = <T extends { activityId: string }>(x: T): T =>
        x.activityId === from.id ? { ...x, activityId: action.into } : x;
      const merged = withAlias(data, action.into, aliasFrom(from.name));
      const target = merged.activities.find((a) => a.id === action.into) as Activity;
      // One weekly study per materia: the target's wins; the other one ends here (its
      // history stays) along with its pins ahead.
      const ending =
        studyOf(merged, target) && studyOf(merged, from) ? studyOf(merged, from)?.id : undefined;
      return refresh(
        {
          ...merged,
          activities: merged.activities.filter((a) => a.id !== from.id),
          tasks: merged.tasks.map((t) => {
            const moved = move(t);
            return t.id === ending
              ? { ...moved, study: undefined, status: "dropped" as const, endedAt: now }
              : moved;
          }),
          plan: merged.plan.map(move),
          pins: merged.pins?.filter((p) => p.taskId !== ending || p.start <= now).map(move),
        },
        now,
      );
    }
    case "assignSubject": {
      const task = data.tasks.find((t) => t.id === action.taskId);
      if (!task || !data.activities.some((a) => a.id === action.activityId)) return data;
      const learned = withAlias(data, action.activityId, aliasFrom(task.title));
      return refresh(dropEmptyNoSubject(reassign(learned, task.id, action.activityId)), now);
    }
    case "newSubject": {
      const name = action.name.trim();
      if (!name) return data;
      const created = materia(data, name);
      const added = { ...data, activities: [...data.activities, created] };
      const task = action.taskId ? data.tasks.find((t) => t.id === action.taskId) : undefined;
      return refresh(task ? dropEmptyNoSubject(reassign(added, task.id, created.id)) : added, now);
    }
    case "weeklyStudy": {
      const subject = data.activities.find((a) => a.id === action.activityId);
      // At most a full week of study.
      if (!subject || !Number.isFinite(action.minutes) || action.minutes > 7 * 1440) return data;
      const study = studyOf(data, subject);
      if (action.minutes <= 0)
        return study
          ? refresh(
              {
                ...data,
                tasks: data.tasks.map((t) =>
                  t.id === study.id ? { ...t, status: "dropped" as const, endedAt: now } : t,
                ),
                // Its blocks pinned ahead go too; the past ones are history.
                pins: data.pins?.filter((p) => p.taskId !== study.id || p.start <= now),
              },
              now,
            )
          : data;
      // One-hour sessions, like the rest of the weekly silos.
      const habit: AppTask = {
        ...(study ?? {
          id: newId(),
          activityId: subject.id,
          title: studyTitle(subject),
          kind: "habit" as const,
          estimateMinutes: 0,
          priority: 2,
          status: "active" as const,
          units: [],
          sessionMinutes: 60,
          study: true,
        }),
        minMinutes: Math.round(action.minutes),
        sessionsPerWeek: Math.ceil(action.minutes / (study?.sessionMinutes ?? 60)),
      };
      const tasks = study
        ? data.tasks.map((t) => (t.id === study.id ? habit : t))
        : [...data.tasks, habit];
      return refresh({ ...data, tasks }, now);
    }
    case "saveRoutine": {
      const name = action.name.trim();
      if (!name || !validRoutine(action.sessionsPerWeek, action.sessionMinutes)) return data;
      const times = Math.round(action.sessionsPerWeek);
      const minutes = Math.round(action.sessionMinutes);
      const routine: Activity = {
        id: newId(),
        name,
        color: nextColor(data.activities),
        academic: false,
        kind: "rutina",
        maxSessionMinutes: Math.max(minutes, 30),
        minBlockMinutes: Math.min(minutes, 60),
      };
      const habit: AppTask = {
        id: newId(),
        activityId: routine.id,
        title: name,
        kind: "habit",
        estimateMinutes: 0,
        minMinutes: times * minutes,
        sessionsPerWeek: times,
        sessionMinutes: minutes,
        priority: 2,
        status: "active",
        units: [],
      };
      return refresh(
        { ...data, activities: [...data.activities, routine], tasks: [...data.tasks, habit] },
        now,
      );
    }
    case "spots": {
      let spots = data.spots ?? [];
      for (const r of action.results) {
        const key = spotKey(r.text);
        // What the user typed stays.
        if (spots.some((s) => s.key === key && s.manual)) continue;
        const spot =
          r.minutes === null
            ? { key, text: r.text, failed: true }
            : { key, text: r.text, minutes: Math.min(1440, Math.max(0, Math.round(r.minutes))) };
        spots = [...spots.filter((s) => s.key !== key), spot];
      }
      return refresh({ ...data, spots }, now);
    }
    case "spotMinutes": {
      // Whole minutes within a day, like every other travel time.
      if (!Number.isFinite(action.minutes) || action.minutes < 0 || !action.text.trim())
        return data;
      const key = spotKey(action.text);
      const minutes = Math.min(1440, Math.round(action.minutes));
      const spot = { key, text: action.text, minutes, manual: true };
      return refresh(
        { ...data, spots: [...(data.spots ?? []).filter((s) => s.key !== key), spot] },
        now,
      );
    }
    case "saveSpot": {
      const spot = (data.spots ?? []).find((s) => s.key === action.key);
      const at = home(data);
      const name = action.name.trim();
      if (!spot || !name) return data;
      const place: Place = { id: newId(), name, aliases: [spot.text], address: spot.text };
      const travelTimes = [...(data.travelTimes ?? [])];
      if (at && spot.minutes !== undefined) {
        const manual = !!spot.manual;
        travelTimes.push(
          { from: at.id, to: place.id, minutes: spot.minutes, manual },
          { from: place.id, to: at.id, minutes: spot.minutes, manual },
        );
      }
      return refresh(
        {
          ...data,
          places: [...(data.places ?? []), place],
          travelTimes,
          spots: (data.spots ?? []).filter((s) => s.key !== action.key),
        },
        now,
      );
    }
    case "moveEvent": {
      const event = data.events.find((e) => e.id === action.eventId);
      if (!event || action.start <= now) return data;
      const move = { eventId: event.id, from: event.start, start: action.start, end: action.end };
      return refresh(
        {
          ...data,
          movedEvents: [...(data.movedEvents ?? []).filter((m) => m.eventId !== event.id), move],
        },
        now,
      );
    }
    case "unmoveEvent":
      return refresh(
        {
          ...data,
          movedEvents: data.movedEvents?.filter((m) => m.eventId !== action.eventId),
        },
        now,
      );
    case "undoPlan": {
      const history = data.planHistory ?? [];
      const v = history.at(-1);
      if (!v) return data;
      // What already started stays; today's blocks ahead and the inputs come back.
      const kept = data.plan.filter((b) => b.start <= now);
      // A task deleted since then does not come back with its blocks.
      const live = new Set(data.tasks.map((t) => t.id));
      return refresh(
        {
          ...data,
          plan: [...kept, ...v.today.filter((b) => b.start > now && live.has(b.taskId))],
          pins: v.pins.filter((b) => live.has(b.taskId)),
          overrides: v.overrides,
          proposals: v.proposals,
          freeTimeUntil: v.freeTimeUntil,
          relaxContextUntil: v.relaxContextUntil,
          tentativeHoldUntil: v.tentativeHoldUntil,
          planHistory: history.slice(0, -1),
        },
        now,
      );
    }
    case "mealChoice": {
      const rest = (data.mealChoices ?? []).filter(
        (c) => !(c.date === action.date && c.kind === action.kind),
      );
      const start =
        action.start !== undefined && Number.isFinite(action.start)
          ? Math.max(0, Math.min(1439 + 1440, Math.round(action.start)))
          : undefined;
      const choice =
        action.skip || start !== undefined
          ? [
              {
                date: action.date,
                kind: action.kind,
                ...(action.skip ? { skip: true } : { start }),
              },
            ]
          : [];
      // Past days' choices are of no use any more.
      const today = localParts(data.settings.timezone, now).date;
      return refresh(
        { ...data, mealChoices: [...rest, ...choice].filter((c) => c.date >= addDays(today, -1)) },
        now,
      );
    }
    case "dropSpotAddress": {
      const spot = (data.spots ?? []).find((s) => s.key === action.key);
      if (spot?.minutes === undefined) return data;
      const eventTravel = { ...data.eventTravel };
      // Minutes an event already kept for this same address stay as they are; ones
      // kept for an address it no longer has give way to these.
      for (const id of keepableEvents(data, spot.key))
        if (eventTravel[id]?.key !== spot.key)
          eventTravel[id] = { minutes: spot.minutes, key: spot.key };
      return refresh(
        { ...data, eventTravel, spots: (data.spots ?? []).filter((s) => s.key !== spot.key) },
        now,
      );
    }
    case "eventTravelMinutes": {
      const eventTravel = { ...data.eventTravel };
      const event = data.events.find((e) => e.id === action.eventId);
      if (action.minutes === null) delete eventTravel[action.eventId];
      else if (!event || !Number.isFinite(action.minutes) || action.minutes < 0) return data;
      else
        eventTravel[action.eventId] = {
          minutes: Math.min(1440, Math.round(action.minutes)),
          key: eventTravel[action.eventId]?.key ?? eventSpotKey(event),
        };
      return refresh({ ...data, eventTravel }, now);
    }
    case "restoreSpot": {
      const eventTravel = { ...data.eventTravel };
      for (const [id, before] of Object.entries(action.before)) {
        const current = eventTravel[id];
        // What the deletion set goes back to what was there; what «Olvidar» removed
        // comes back; a later change of that event's minutes stays.
        const set = current?.key === action.spot.key && current.minutes === action.spot.minutes;
        if (set && before) eventTravel[id] = before;
        else if (set) delete eventTravel[id];
        else if (!current && before) eventTravel[id] = before;
      }
      const newer = (data.spots ?? []).some((s) => s.key === action.spot.key);
      return refresh(
        {
          ...data,
          eventTravel,
          spots: newer ? data.spots : [...(data.spots ?? []), action.spot],
        },
        now,
      );
    }
    case "forgetSpot": {
      // Forgetting an address also forgets the minutes events kept from it.
      const eventTravel = Object.fromEntries(
        Object.entries(data.eventTravel ?? {}).filter(([, t]) => t.key !== action.key),
      );
      return refresh(
        { ...data, eventTravel, spots: (data.spots ?? []).filter((s) => s.key !== action.key) },
        now,
      );
    }
    case "locate": {
      // Answered: a failed lookup for this text is no longer needed.
      data = { ...data, spots: (data.spots ?? []).filter((s) => s.key !== spotKey(action.text)) };
      if (!action.placeId) {
        const noTravel = [...new Set([...(data.noTravel ?? []), normalize(action.text)])];
        return refresh({ ...data, noTravel }, now);
      }
      const places = (data.places ?? []).map((p) =>
        p.id === action.placeId && !p.aliases.includes(action.text)
          ? { ...p, aliases: [...p.aliases, action.text] }
          : p,
      );
      return refresh({ ...data, places }, now);
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

const STORAGE_KEY = "critical.demo.v2";
/** Demos saved before the study mark: migrated once, on the first load. */
const LEGACY_STORAGE_KEY = "critical.demo.v1";

export function loadDemo(now: number): AppData {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as AppData;
    const legacy = globalThis.localStorage?.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const data = markLegacyStudy(JSON.parse(legacy) as AppData);
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(data));
        // Only once the new copy is stored does the old one go.
        globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
      } catch {
        // Full storage: use the migrated data now and try again on the next load.
      }
      return data;
    }
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
    factor: checkInFactor(caught, b.taskId),
  }));
  return { ...caught, checkIns };
}

/** Stores the demo; false if the browser refused (full or blocked storage). */
function saveDemo(data: AppData): boolean {
  try {
    // Reading `localStorage` itself throws where the browser blocks storage.
    const storage = globalThis.localStorage;
    if (!storage) return false;
    const json = JSON.stringify(data);
    try {
      storage.setItem(STORAGE_KEY, json);
      storage.removeItem(LEGACY_STORAGE_KEY);
      return true;
    } catch {
      // A not-yet-migrated old copy may be what fills the storage. The data in hand is
      // already migrated, so the old copy makes room; if even that is not enough, it
      // goes back, so there is always one stored copy.
      const old = storage.getItem(LEGACY_STORAGE_KEY);
      if (old === null) return false;
      storage.removeItem(LEGACY_STORAGE_KEY);
      try {
        storage.setItem(STORAGE_KEY, json);
        return true;
      } catch {
        storage.setItem(LEGACY_STORAGE_KEY, old);
        return false;
      }
    }
  } catch {
    return false;
  }
}

export function resetDemo(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    globalThis.localStorage?.removeItem(LEGACY_STORAGE_KEY);
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
  /** Upcoming events whose place is unknown (only once a home is saved). */
  unlocated: ReturnType<typeof unlocated>;
  /** Minimums the upcoming pins put out of reach, and those pins. */
  pinShort: ReturnType<typeof pinShortfall>;
  /** Upcoming pins a calendar event overlaps. */
  clashes: ReturnType<typeof pinClashes>;
  /** Meals of the coming week with no room near their time. */
  missedMeals: ReturnType<typeof missedMeals>;
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

/** Holds the app data and what is derived from it (plan verdict, inbox, clashes). */
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
  // A layout effect runs right after the commit, so the saves start before any repaint
  // or task freeze that could let a reload for a new version in first.
  useLayoutEffect(() => {
    // A demo edit the browser refused to store lives only in memory: no reload then.
    if (persist) hold("demo", !saveDemo(data));
    if (onChange && previous.current !== data) onChange(previous.current, data);
    // Its saves are registered now, so a reload for a new version can wait for them.
    hold("edit", false);
    previous.current = data;
  }, [data, persist, onChange]);
  // Leaving the demo (signing in instead) discards it, and with it what it was holding.
  useEffect(() => () => hold("demo", false), []);

  const store = useMemo<Store>(() => {
    const r = refreshPlan(data, now);
    const pending = pendingConfirmations(data, now);
    const d = decisions(r.input, r.result);
    // Signed in, the server times event addresses by itself; the demo has no server.
    const where = unlocated(data, visibleEvents(data), now).map((u) =>
      persist ? { ...u, lookup: false } : u,
    );
    const pinShort = pinShortfall(data, now, r.result);
    const clashes = pinClashes(data, now, r.input);
    const meals = missedMeals(data, now);
    return {
      data,
      now,
      dispatch: (a) => {
        // Until the effect above hands it to a save, the edit lives only in memory. An
        // action that changes nothing runs no effect, so the hold also lapses.
        hold("edit", true, 1000);
        raw({ ...a, now: fixedNow ?? Date.now() } as Action);
      },
      pending,
      decisions: d,
      result: r.result,
      unlocated: where,
      pinShort,
      clashes,
      missedMeals: meals,
      inboxCount:
        (data.movedEvents?.length ?? 0) +
        (lateNight(data, now) ? 1 : 0) +
        // Addresses still being timed are not questions yet.
        where.filter((u) => !u.lookup).length +
        newClassTitles(data).length +
        unassignedTasks(data).length +
        unsortedActivities(data).length +
        (pinShort.short.length > 0 ? 1 : 0) +
        clashes.length +
        meals.length +
        pending.length +
        data.proposals.length +
        d.options.length +
        d.recommendations.length +
        data.tasks.filter((t) => t.needsReview && t.status === "active").length,
    };
  }, [data, now, fixedNow, persist]);

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

/** A new materia named `name`, with a free colour. */
function materia(data: AppData, name: string): Activity {
  return {
    id: newId(),
    name: name.trim(),
    color: nextColor(data.activities),
    academic: true,
    kind: "materia",
    maxSessionMinutes: 120,
    minBlockMinutes: 60,
  };
}

/** Teaches a materia another name it goes by (nothing if it already answers to it). */
function withAlias(data: AppData, activityId: string, alias: string): AppData {
  const key = normalize(alias);
  return {
    ...data,
    activities: data.activities.map((a) =>
      a.id !== activityId || !key || normalize(a.name) === key || (a.aliases ?? []).includes(key)
        ? a
        : { ...a, aliases: [...(a.aliases ?? []), key] },
    ),
  };
}

/** Moves a task, and the blocks planned or pinned for it, to another activity. */
function reassign(data: AppData, taskId: string, activityId: string): AppData {
  const move = <T extends { taskId: string; activityId: string }>(b: T): T =>
    b.taskId === taskId ? { ...b, activityId } : b;
  return {
    ...data,
    tasks: data.tasks.map((t) => (t.id === taskId ? { ...t, activityId } : t)),
    plan: data.plan.map(move),
    pins: data.pins?.map(move),
  };
}

/** "Sin materia" only exists while something waits in it. */
function dropEmptyNoSubject(data: AppData): AppData {
  const waiting = data.activities.find(isNoSubject);
  if (!waiting || data.tasks.some((t) => t.activityId === waiting.id)) return data;
  return { ...data, activities: data.activities.filter((a) => a.id !== waiting.id) };
}

/** Keeps what the plan looked like before a reorganization, so it can be undone. */
type Move = NonNullable<AppData["movedEvents"]>[number];
const sameMove = (a: Move, b: Move) =>
  a.eventId === b.eventId && a.start === b.start && a.end === b.end;

/**
 * The moved events after undoing `record`: the event goes back to the move this one
 * replaced (or its own time), but only while this decision's move still stands — not
 * if a later decision moved it again or the user put it back by hand.
 */
function undoMove(moves: AppData["movedEvents"], record: AppliedDecision) {
  if (!record.movedEventId) return moves;
  const current = moves?.find((m) => m.eventId === record.movedEventId);
  // Older records without `move`: whatever stands for the event is theirs.
  const own = current && (!record.move || sameMove(current, record.move));
  if (!own) return moves;
  return [
    ...(moves ?? []).filter((m) => m !== current),
    ...(record.previousMove ? [record.previousMove] : []),
  ];
}

function versioned(data: AppData, action: Action, next: AppData): AppData {
  const label = VERSIONED[action.type];
  if (!label || next === data) return next;
  const now = action.now;
  const version: PlanVersion = {
    at: now,
    label,
    pins: data.pins ?? [],
    today: data.plan.filter(
      (b) => b.start > now && b.start < endOfDay(data.settings.timezone, now),
    ),
    overrides: data.overrides,
    proposals: data.proposals,
    freeTimeUntil: data.freeTimeUntil,
    tentativeHoldUntil: data.tentativeHoldUntil,
    relaxContextUntil: data.relaxContextUntil,
  };
  return { ...next, planHistory: [...(data.planHistory ?? []), version].slice(-PLAN_HISTORY) };
}
