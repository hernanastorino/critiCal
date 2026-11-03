import { merge, subtract } from "./intervals";
import { addDays, localDates, weekdayOf, zonedInstant } from "./time";
import { type DayOverride, type Interval, MINUTE, type Settings } from "./types";

export interface Slot {
  start: number;
  end: number;
  /** Logical day (the wake-up date), YYYY-MM-DD. */
  date: string;
  /** Inside free time. */
  soft: boolean;
  /** Minutes since the logical day's midnight. */
  minuteOfDay: number;
}

interface DayWindow {
  date: string;
  midnight: number;
  awake: Interval[];
  /** Preferred meal times; placed around fixed events by `placeMeal`. */
  meals: Interval[];
  bedAt: number;
  freeFrom: number;
}

function dayWindow(settings: Settings, date: string, override?: DayOverride): DayWindow {
  const tz = settings.timezone;
  const base = settings.week[weekdayOf(date)];
  if (!base) throw new Error(`No settings for weekday of ${date}`);
  const wake = override?.wake ?? base.wake;
  const rawBed = override?.bed ?? base.bed;
  const bed = rawBed <= wake ? rawBed + 1440 : rawBed;
  const plannable = wake + (base.morningMinutes ?? 0);
  const bedAt = zonedInstant(tz, date, bed);
  return {
    date,
    midnight: zonedInstant(tz, date, 0),
    awake: [{ start: zonedInstant(tz, date, plannable), end: bedAt }],
    meals: base.meals.map((m) => ({
      start: zonedInstant(tz, date, m.start),
      end: zonedInstant(tz, date, m.end),
    })),
    bedAt,
    freeFrom: zonedInstant(tz, date, base.freeFrom),
  };
}

/** A class ending this long before the preferred time still means "eat right after". */
const EARLY = 45 * MINUTE;
/** Eating later than this after the preferred time is too late: eat before the class instead. */
const LATE = 60 * MINUTE;

/**
 * Where a meal really happens given the day's fixed events. The configured time
 * is a preference: right after a class that ends close to it (up to 45 min
 * before or 60 min after) you eat then; if the preferred time is free you eat
 * then; if the only "after" is too late (or runs into bedtime) you eat before
 * the class. Returns null when nothing fits.
 */
export function placeMeal(
  pref: Interval,
  busy: readonly Interval[],
  bedAt: number,
): Interval | null {
  const length = pref.end - pref.start;
  const p = pref.start;
  const blocks = merge(busy);
  const fits = (start: number) =>
    start + length <= bedAt && !blocks.some((b) => b.start < start + length && start < b.end);
  const at = (start: number) => ({ start, end: start + length });

  // Right after a class ending near the preferred time.
  const afterClass = blocks
    .map((b) => b.end)
    .filter((end) => end >= p - EARLY && end <= p + LATE)
    .sort((a, b) => Math.abs(a - p) - Math.abs(b - p));
  for (const start of afterClass) if (fits(start)) return at(start);
  if (fits(p)) return at(p);

  // Too late after: eat before the class that covers the preferred time.
  const before = blocks
    .filter((b) => b.start <= p + LATE && b.end > p - EARLY)
    .map((b) => b.start - length)
    .filter((start) => start >= p - 3 * LATE)
    .sort((a, b) => Math.abs(a - p) - Math.abs(b - p));
  for (const start of before) if (fits(start)) return at(start);
  return null;
}

/**
 * Free slots on a fixed grid between `from` and `to`: awake, not eating and not
 * overlapping `busy`.
 */
export function buildSlots(
  settings: Settings,
  overrides: readonly DayOverride[],
  from: number,
  to: number,
  busy: readonly Interval[],
): Slot[] {
  const step = settings.slotMinutes * MINUTE;
  const byDate = new Map(overrides.map((o) => [o.date, o]));
  const first = localDates(settings.timezone, from, from + 1)[0] as string;
  const dates = [addDays(first, -1), ...localDates(settings.timezone, from, to)];
  const slots: Slot[] = [];

  for (const date of dates) {
    const window = dayWindow(settings, date, byDate.get(date));
    const meals = window.meals.flatMap((m) => {
      const placed = placeMeal(m, busy, window.bedAt);
      return placed ? [placed] : [];
    });
    for (const free of subtract(window.awake, [...busy, ...meals])) {
      // Grid anchored to the logical day's local midnight, not the UTC epoch.
      const offset = Math.max(free.start, from) - window.midnight;
      let start = window.midnight + Math.ceil(offset / step) * step;
      while (start + step <= Math.min(free.end, to)) {
        slots.push({
          start,
          end: start + step,
          date,
          soft: start >= window.freeFrom,
          minuteOfDay: (start - window.midnight) / MINUTE,
        });
        start += step;
      }
    }
  }
  return slots.sort((a, b) => a.start - b.start);
}
