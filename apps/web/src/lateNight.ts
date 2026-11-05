// Late nights: after an event that ends past bedtime, the next morning starts later.
import { visibleEvents } from "./calendars.js";
import { addDays, type DayOverride, localParts, zonedInstant } from "./engine.js";
import { withHolidays } from "./holidays.js";
import type { AppData, AppEvent } from "./model.js";

export interface LateNight {
  /** The morning after (local date) whose wake-up time is unknown. */
  date: string;
  event: AppEvent;
  /** Wake-up assumed until answered: the usual hours of sleep from when it ended. */
  assumedWake: number;
}

/**
 * This morning, if last night an event ended after that evening's bedtime and today's
 * wake-up time was not set by hand: the inbox asks, and meanwhile the plan assumes the
 * usual hours of sleep counted from the end of the event.
 */
export function lateNight(data: AppData, now: number): LateNight | null {
  const tz = data.settings.timezone;
  const today = localParts(tz, now).date;
  if (data.overrides.some((o) => o.date === today && o.wake !== undefined)) return null;
  const evening = addDays(today, -1);
  // Each day's routine as the planner sees it: holidays and saved overrides included.
  const overrides =
    data.preferences?.holidaysOff === false
      ? data.overrides
      : withHolidays(data.overrides, tz, zonedInstant(tz, evening, 720), now);
  const routine = (date: string) => {
    const o = overrides.find((x) => x.date === date);
    const base =
      data.settings.week[o?.asWeekday ?? localParts(tz, zonedInstant(tz, date, 720)).weekday];
    return base && { wake: o?.wake ?? base.wake, bed: o?.bed ?? base.bed };
  };
  const night = routine(evening);
  const morning = routine(today);
  if (!night || !morning) return null;
  // A bedtime at or before wake-up time is after midnight.
  const bedtime = zonedInstant(tz, evening, night.bed <= night.wake ? night.bed + 1440 : night.bed);
  const usualWake = zonedInstant(tz, today, morning.wake);
  const sleep = usualWake - bedtime;
  if (sleep <= 0) return null;
  const late = visibleEvents(data)
    // Busy, started before bedtime and ended after it (not an early start, a 5 a.m.
    // flight), and over: no asking how the night went while it goes on.
    .filter((e) => e.busy && !e.allDay && e.start < bedtime && e.end > bedtime && e.end <= now)
    .sort((a, b) => b.end - a.end)[0];
  if (!late) return null;
  const wake = late.end + sleep;
  // Clock time of that instant (not minutes since midnight, which a DST change skews).
  const at = localParts(tz, wake);
  const minutes = at.date === today ? at.minuteOfDay : 1440;
  // Not past the end of the day, and only while it still matters.
  if (minutes >= 1440 || now > zonedInstant(tz, today, 1440)) return null;
  return { date: today, event: late, assumedWake: Math.max(morning.wake, minutes) };
}

/** Overrides with this morning's assumed late wake-up, until the user answers. */
export function withLateNight(data: AppData, now: number): DayOverride[] {
  const late = lateNight(data, now);
  if (!late) return data.overrides;
  const own = data.overrides.find((o) => o.date === late.date);
  return [
    ...data.overrides.filter((o) => o.date !== late.date),
    { ...own, date: late.date, wake: late.assumedWake },
  ];
}
