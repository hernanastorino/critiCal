import { merge, subtract } from "./intervals.js";
import { addDays, localDates, weekdayOf, zonedInstant } from "./time.js";
import {
  type DayOverride,
  type Interval,
  type MealKind,
  type MealTime,
  MINUTE,
  type Settings,
} from "./types.js";

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
  meals: (Interval & { kind?: MealKind; chosen?: boolean })[];
  wakeAt: number;
  bedAt: number;
  freeFrom: number;
}

function dayWindow(settings: Settings, date: string, override?: DayOverride): DayWindow {
  const tz = settings.timezone;
  const base = settings.week[override?.asWeekday ?? weekdayOf(date)];
  if (!base) throw new Error(`No settings for weekday of ${date}`);
  const wake = override?.wake ?? base.wake;
  const rawBed = override?.bed ?? base.bed;
  const bed = rawBed <= wake ? rawBed + 1440 : rawBed;
  const wakeAt = zonedInstant(tz, date, wake);
  // Counted from the real wake instant (DST-safe), never before it.
  const plannableAt = wakeAt + Math.max(0, base.morningMinutes ?? 0) * MINUTE;
  const bedAt = zonedInstant(tz, date, bed);
  return {
    date,
    midnight: zonedInstant(tz, date, 0),
    awake: [{ start: plannableAt, end: bedAt }],
    meals: base.meals.flatMap((m) => {
      // The latest choice for that meal wins.
      const choice = override?.meals?.findLast((c) => c.kind === m.kind);
      if (choice?.skip) return [];
      const start = choice?.start ?? m.start;
      return [
        {
          start: zonedInstant(tz, date, start),
          end: zonedInstant(tz, date, start + (m.end - m.start)),
          ...(m.kind ? { kind: m.kind } : {}),
          ...(choice?.start !== undefined ? { chosen: true } : {}),
        },
      ];
    }),
    wakeAt,
    bedAt,
    freeFrom: zonedInstant(tz, date, base.freeFrom),
  };
}

/** A class in the way ending this long before the preferred time still means "eat right after". */
const EARLY = 45 * MINUTE;
/** Right after a class ending up to this long after the preferred time beats eating before. */
const LATE = 60 * MINUTE;
/** A meal never starts further than this from its preferred time. */
export const MEAL_RANGE = 90 * MINUTE;

/** The latest start `placeMeal` allows: 1 h 30 after the (wake-adjusted) time, not into bedtime. */
function latestMealStart(pref: Interval, bedAt: number, wakeAt: number, onWaking: boolean) {
  const p = onWaking ? Math.max(pref.start, wakeAt) : pref.start;
  return Math.min(p + MEAL_RANGE, bedAt - (pref.end - pref.start));
}

/**
 * Where a meal really happens given the day's fixed events (and pinned blocks). The
 * configured time is kept while it is free. Otherwise: right after the class in the
 * way if it ends close to it (up to 45 min before or 60 min after), or else at the
 * free time closest to it, before or after, starting at most 1 h 30 away. Never before waking up or into bedtime. `onWaking` (breakfast) moves
 * the preference to waking up when that is later. Returns null when nothing fits.
 */
export function placeMeal(
  pref: Interval,
  busy: readonly Interval[],
  bedAt: number,
  wakeAt = Number.NEGATIVE_INFINITY,
  onWaking = false,
): Interval | null {
  const length = pref.end - pref.start;
  const p = onWaking ? Math.max(pref.start, wakeAt) : pref.start;
  const lo = Math.max(p - MEAL_RANGE, wakeAt);
  const hi = latestMealStart(pref, bedAt, wakeAt, onWaking);
  const blocks = merge(busy);
  const fits = (start: number) =>
    start >= lo && start <= hi && !blocks.some((b) => b.start < start + length && start < b.end);
  const at = (start: number) => ({ start, end: start + length });
  const closest = (a: number, b: number) => Math.abs(a - p) - Math.abs(b - p) || b - a;

  if (fits(p)) return at(p);
  // Right after the class in the way, if it ends near the preferred time.
  const afterClass = blocks
    .map((b) => b.end)
    .filter((end) => end >= p - EARLY && end <= p + LATE)
    .sort(closest);
  for (const start of afterClass) if (fits(start)) return at(start);
  // The closest free time sits at an edge of the range or of a busy stretch.
  const edges = [lo, hi, ...blocks.flatMap((b) => [b.end, b.start - length])];
  const start = edges.filter(fits).sort(closest)[0];
  return start === undefined ? null : at(start);
}

/** An event that is a meal (a lunch out), which then needs no time of its own. */
export type MealEvent = Interval & { meal?: MealKind };

/**
 * The day's meals placed one after the other, each around the fixed events and the
 * meals already placed (so two meals never overlap). A meal that an event of that
 * day already is (`meal` of the same kind) is left out.
 */
function placeDayMeals(
  window: DayWindow,
  busy: readonly Interval[],
  eaten: readonly MealEvent[],
): MealTime[] {
  // An event that is the meal, anywhere in the day (waking to bedtime), replaces it.
  const out = (kind?: MealKind) =>
    !!kind && eaten.some((e) => e.meal === kind && e.start < window.bedAt && window.wakeAt < e.end);
  const meals = window.meals.filter((m) => !out(m.kind));
  // Meals put somewhere by hand go first and stay there (over anything fixed); of two
  // that overlap each other, the later one moves to right after the earlier. (The
  // window is built for this call, so adjusting its meals is safe.)
  const placed: Interval[] = [];
  for (const m of meals.filter((x) => x.chosen).sort((a, b) => a.start - b.start)) {
    const length = m.end - m.start;
    for (const p of placed) if (p.start < m.start + length && m.start < p.end) m.start = p.end;
    m.end = m.start + length;
    placed.push({ start: m.start, end: m.end });
  }
  const taken: Interval[] = [...busy, ...placed];
  return meals.map(({ kind, chosen, ...preferred }) => {
    const onWaking = kind === "desayuno";
    const latest = latestMealStart(preferred, window.bedAt, window.wakeAt, onWaking);
    const base = { date: window.date, ...(kind ? { kind } : {}), preferred, latest };
    if (chosen) return { ...base, at: preferred, chosen: true };
    const at = placeMeal(preferred, taken, window.bedAt, window.wakeAt, onWaking);
    if (at) {
      taken.push(at);
      placed.push(at);
      return { ...base, at };
    }
    // No room near its time: it stays anyway, at its (wake-adjusted) time on top of
    // what is fixed there, but never on another meal (then right after it).
    const length = preferred.end - preferred.start;
    let start = onWaking ? Math.max(preferred.start, window.wakeAt) : preferred.start;
    for (const m of [...placed].sort((a, b) => a.start - b.start))
      if (m.start < start + length && start < m.end) start = m.end;
    const forced = { start, end: start + length };
    taken.push(forced);
    placed.push(forced);
    // On top of something fixed, or only out of its range: the warning is for the first.
    return busy.some((b) => b.start < forced.end && forced.start < b.end)
      ? { ...base, at: forced, overlapping: true }
      : { ...base, at: forced };
  });
}

/** Days (wake-up dates) that may have time between `from` and `to`, the one before included. */
function windowsBetween(
  settings: Settings,
  overrides: readonly DayOverride[],
  from: number,
  to: number,
): DayWindow[] {
  // Several overrides for one day (a late night, a holiday, a meal moved) add up.
  const byDate = new Map<string, DayOverride>();
  for (const o of overrides) {
    const prev = byDate.get(o.date);
    byDate.set(
      o.date,
      prev ? { ...prev, ...o, meals: [...(prev.meals ?? []), ...(o.meals ?? [])] } : o,
    );
  }
  const first = localDates(settings.timezone, from, from + 1)[0] as string;
  const dates = [addDays(first, -1), ...localDates(settings.timezone, from, to)];
  return dates.map((date) => dayWindow(settings, date, byDate.get(date)));
}

/**
 * Where each meal between `from` and `to` happens around `busy` (fixed events, travel
 * and pinned blocks): see `placeMeal`. Meals with no room are kept with `at: null`;
 * meals that one of the `eaten` events already is are left out.
 */
export function placeMeals(
  settings: Settings,
  overrides: readonly DayOverride[],
  from: number,
  to: number,
  busy: readonly Interval[],
  eaten: readonly MealEvent[] = [],
): MealTime[] {
  return (
    windowsBetween(settings, overrides, from, to)
      .flatMap((w) => placeDayMeals(w, busy, eaten))
      // Placed: where it ended up. On top of something fixed: until its last possible
      // start too, so the inbox notice stays while it could still move.
      .filter((m) =>
        m.at && m.overlapping
          ? Math.max(m.at.end, m.latest) > from && m.at.start < to
          : !!m.at && m.at.end > from && m.at.start < to,
      )
  );
}

/**
 * Free slots on a fixed grid between `from` and `to`: awake, not eating and not
 * overlapping `busy`. `eaten`: events that are a meal (see `placeMeals`).
 */
export function buildSlots(
  settings: Settings,
  overrides: readonly DayOverride[],
  from: number,
  to: number,
  busy: readonly Interval[],
  eaten: readonly MealEvent[] = [],
): Slot[] {
  const step = settings.slotMinutes * MINUTE;
  const slots: Slot[] = [];

  for (const window of windowsBetween(settings, overrides, from, to)) {
    const { date } = window;
    const meals = placeDayMeals(window, busy, eaten).flatMap((m) => (m.at ? [m.at] : []));
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
