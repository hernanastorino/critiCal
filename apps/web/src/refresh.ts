import { importFromCalendars } from "./calendars.js";
import type { AppData } from "./model.js";
import { newId, uniqueColors } from "./model.js";
import { refreshPlan } from "./planning.js";

/** Imports calendar tasks and re-plans from `now`; shared by the app and the server. */
export function refresh(raw: AppData, now: number): AppData {
  // Pins that already happened live on as plan history.
  const input = raw.pins?.some((p) => p.end <= now)
    ? { ...raw, pins: raw.pins.filter((p) => p.end > now) }
    : raw;
  const imported = importFromCalendars(input, now, newId);
  const activities = uniqueColors(imported.activities);
  const data = activities === imported.activities ? imported : { ...imported, activities };
  const r = refreshPlan(data, now);
  const proposals = r.proposal
    ? [...data.proposals.filter((p) => !p.id.startsWith("conflict@")), r.proposal]
    : data.proposals.filter((p) => !p.id.startsWith("conflict@"));
  return { ...data, plan: r.plan, proposals };
}
