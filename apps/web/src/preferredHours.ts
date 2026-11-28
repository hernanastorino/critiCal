// A routine whose «Prefiero desde / hasta» falls outside the hours it may go in: the planner
// never gets to use that preference, so the Bandeja says it.
import { type Activity, joinList, type MinuteRange } from "./engine.js";
import { minutesToHhmm } from "./format.js";
import type { AppData } from "./model.js";

export interface PreferenceMisfit {
  activity: Activity;
  preferred: MinuteRange;
  /** The hours it may go in, as «09:00–17:00». */
  allowed: string;
}

const overlaps = (a: MinuteRange, b: MinuteRange) => a.start < b.end && b.start < a.end;

/** «17:00–21:00». */
export const hoursRange = (r: MinuteRange) => `${minutesToHhmm(r.start)}–${minutesToHhmm(r.end)}`;

type ValidHours = NonNullable<Activity["validHours"]>;

/**
 * The ranges the routine can use: the general one for the days that follow it (a day with
 * none of its own), plus every day's own. «No ese día» has none.
 */
function decidingRanges(validHours: ValidHours): MinuteRange[] | null {
  const own = Object.values(validHours.days ?? {});
  const mine = own.filter((r): r is MinuteRange => !!r);
  const follows = own.filter((r) => r !== undefined).length < 7;
  if (follows && !validHours.all) return null; // Unrestricted days: anything fits.
  return follows && validHours.all ? [validHours.all, ...mine] : mine;
}

const hasActiveHabit = (data: AppData, activity: Activity) =>
  data.tasks.some(
    (t) => t.activityId === activity.id && t.kind === "habit" && t.status === "active" && !t.paused,
  );

function misfitOf(data: AppData, activity: Activity): PreferenceMisfit | null {
  const { preferred, validHours } = activity;
  if (activity.kind !== "rutina" || !preferred || !validHours) return null;
  if (!hasActiveHabit(data, activity)) return null;
  const ranges = decidingRanges(validHours);
  if (!ranges || ranges.length === 0 || ranges.some((r) => overlaps(r, preferred))) return null;
  const allowed = joinList([...new Set(ranges.map(hoursRange))]);
  return { activity, preferred, allowed };
}

/** Active routines whose preferred window never meets their valid hours. */
export function preferenceMisfits(data: AppData): PreferenceMisfit[] {
  return data.activities.flatMap((a) => misfitOf(data, a) ?? []);
}
