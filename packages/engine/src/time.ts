import { MINUTE } from "./types";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  minuteOfDay: number;
  /** YYYY-MM-DD */
  date: string;
}

export function localParts(timeZone: string, instant: number): LocalParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(instant))) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
    minuteOfDay: Number(parts.hour) * 60 + Number(parts.minute),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (local = utc + offset). */
export function offsetAt(timeZone: string, instant: number): number {
  const p = localParts(timeZone, instant);
  const seconds = new Date(instant).getUTCSeconds();
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minuteOfDay, seconds);
  return asUtc - (instant - (instant % 1000));
}

/** Instant of local `date` (YYYY-MM-DD) at `minuteOfDay` (may exceed 1440). */
export function zonedInstant(timeZone: string, date: string, minuteOfDay: number): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d) + minuteOfDay * MINUTE;
  const first = naive - offsetAt(timeZone, naive);
  const second = naive - offsetAt(timeZone, first);
  return second;
}

/** Local dates (YYYY-MM-DD) touched by [from, to). */
export function localDates(timeZone: string, from: number, to: number): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor < to) {
    const { date } = localParts(timeZone, cursor);
    if (dates[dates.length - 1] !== date) dates.push(date);
    cursor = zonedInstant(timeZone, date, 1440);
  }
  return dates;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
