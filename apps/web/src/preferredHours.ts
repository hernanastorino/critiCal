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

/** Active routines whose preferred window never meets their valid hours. */
export function preferenceMisfits(data: AppData): PreferenceMisfit[] {
  const out: PreferenceMisfit[] = [];
  for (const activity of data.activities) {
    const { preferred, validHours } = activity;
    if (activity.kind !== "rutina" || !preferred || !validHours) continue;
    const habit = data.tasks.find(
      (t) => t.activityId === activity.id && t.kind === "habit" && t.status === "active",
    );
    if (!habit || habit.paused) continue;
    // The days that follow the general range; with none, the days' own ranges decide.
    const follows = [0, 1, 2, 3, 4, 5, 6].some((d) => validHours.days?.[d] === undefined);
    if (follows && !validHours.all) continue; // Unrestricted days: anything fits.
    const ranges: MinuteRange[] =
      follows && validHours.all
        ? [validHours.all]
        : Object.values(validHours.days ?? {}).filter((r): r is MinuteRange => !!r);
    const first = ranges.at(0);
    if (!first || ranges.some((r) => overlaps(r, preferred))) continue;
    out.push({ activity, preferred, allowed: hoursRange(first) });
  }
  return out;
}
