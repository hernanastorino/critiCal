// Limits shared by the app and its server functions.

/** Longest event address the travel function accepts. */
export const SPOT_TEXT_MAX = 200;

/** Earliest deadline accepted: older dates are a typo, not a task. */
export const DEADLINE_MIN = Date.UTC(2000, 0, 1);
/** Deadlines may go up to the end of the year this many years ahead. Year 9999 overflows the database's timestamps. */
export const DEADLINE_YEARS_AHEAD = 5;

/** The last year a deadline may fall in (the date field's max and the error say it). */
export const deadlineMaxYear = (now: number) =>
  new Date(now).getUTCFullYear() + DEADLINE_YEARS_AHEAD;

/**
 * A deadline the app and the database can hold: a real instant from 2000 to the end of
 * `deadlineMaxYear`. The upper bound has a day of slack so 31/12 23:59 passes in any zone.
 */
export function deadlineInRange(at: number, now: number): boolean {
  return Number.isFinite(at) && at >= DEADLINE_MIN && at < Date.UTC(deadlineMaxYear(now) + 1, 0, 2);
}

/**
 * A typed calendar date ("2031-12-31", "2031-12-31T23:59") whose year the plan accepts:
 * 2000 to `deadlineMaxYear`, by the date as written, whatever the time zone.
 */
export function dateYearInRange(value: string, now: number): boolean {
  const year = Number(/^(\d{4,6})-\d{2}-\d{2}/.exec(value)?.[1]);
  return year >= 2000 && year <= deadlineMaxYear(now);
}
