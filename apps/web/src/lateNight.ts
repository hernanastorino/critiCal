// Late nights: after an event that ends past bedtime, the next morning starts later.
import { visibleEvents } from "./calendars.js";
import { addDays, type DayOverride, localParts, MINUTE, zonedInstant } from "./engine.js";
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
  const weekday = (date: string) => localParts(tz, zonedInstant(tz, date, 720)).weekday;
  const night = data.settings.week[weekday(evening)];
  const morning = data.settings.week[weekday(today)];
  if (!night || !morning) return null;
  // A bedtime at or before wake-up time is after midnight.
  const bedtime = zonedInstant(tz, night.bed <= night.wake ? today : evening, night.bed);
  const usualWake = zonedInstant(tz, today, morning.wake);
  const sleep = usualWake - bedtime;
  if (sleep <= 0) return null;
  const late = visibleEvents(data)
    // Started before bedtime and ended after it: not an early start (a 5 a.m. flight).
    .filter((e) => !e.allDay && e.start < bedtime && e.end > bedtime)
    .sort((a, b) => b.end - a.end)[0];
  if (!late) return null;
  const wake = late.end + sleep;
  const minutes = Math.round((wake - zonedInstant(tz, today, 0)) / MINUTE);
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
