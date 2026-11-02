import { subtract } from "./intervals";
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
  freeFrom: number;
}

function dayWindow(settings: Settings, date: string, override?: DayOverride): DayWindow {
  const tz = settings.timezone;
  const base = settings.week[weekdayOf(date)];
  if (!base) throw new Error(`No settings for weekday of ${date}`);
  const wake = override?.wake ?? base.wake;
  const rawBed = override?.bed ?? base.bed;
  const bed = rawBed <= wake ? rawBed + 1440 : rawBed;
  const awake = subtract(
    [{ start: zonedInstant(tz, date, wake), end: zonedInstant(tz, date, bed) }],
    base.meals.map((m) => ({
      start: zonedInstant(tz, date, m.start),
      end: zonedInstant(tz, date, m.end),
    })),
  );
  return {
    date,
    midnight: zonedInstant(tz, date, 0),
    awake,
    freeFrom: zonedInstant(tz, date, base.freeFrom),
  };
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
    for (const free of subtract(window.awake, busy)) {
      let start = Math.ceil(Math.max(free.start, from) / step) * step;
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
