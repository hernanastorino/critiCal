// Limits shared by the app and its server functions.

/** Longest event address the travel function accepts. */
export const SPOT_TEXT_MAX = 200;

/** Earliest deadline accepted: older dates are a typo, not a task. */
export const DEADLINE_MIN = Date.UTC(2000, 0, 1);
/** How far ahead a deadline may be. Year 9999 overflows the database's timestamps. */
export const DEADLINE_YEARS_AHEAD = 5;

/** A deadline the app and the database can hold: a real instant in a sane range. */
export function deadlineInRange(at: number, now: number): boolean {
  return (
    Number.isFinite(at) &&
    at >= DEADLINE_MIN &&
    at <= now + DEADLINE_YEARS_AHEAD * 365.25 * 86_400_000
  );
}
