// A routine whose «Prefiero desde / hasta» falls outside the hours it may go in: the planner
// never gets to use that preference, so the Bandeja says it.
import type { Activity, MinuteRange } from "./engine.js";
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

/** The ranges that decide: the general one for the days that follow it, else the days' own. */
function decidingRanges(validHours: ValidHours): MinuteRange[] | null {
  const own = Object.values(validHours.days ?? {});
  // A day follows the general range when it has none of its own.
  const follows = own.filter((r) => r !== undefined).length < 7;
  if (!follows) return own.filter((r): r is MinuteRange => !!r);
  return validHours.all ? [validHours.all] : null; // Unrestricted days: anything fits.
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
  const first = ranges?.at(0);
  if (!ranges || !first || ranges.some((r) => overlaps(r, preferred))) return null;
  return { activity, preferred, allowed: hoursRange(first) };
}

/** Active routines whose preferred window never meets their valid hours. */
export function preferenceMisfits(data: AppData): PreferenceMisfit[] {
  return data.activities.flatMap((a) => misfitOf(data, a) ?? []);
}
