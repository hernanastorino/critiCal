import { importFromCalendars } from "./calendars.js";
import type { AppData } from "./model.js";
import { newId, stableId, uniqueColors } from "./model.js";
import { refreshPlan } from "./planning.js";

/** Imports calendar tasks and re-plans from `now`; shared by the app and the server. */
export function refresh(raw: AppData, now: number): AppData {
  // Pins that already happened live on as plan history.
  const input = raw.pins?.some((p) => p.end <= now)
    ? { ...raw, pins: raw.pins.filter((p) => p.end > now) }
    : raw;
  // Same ids for the same user on every device and on the server; never across users.
  const owner = raw.owner;
  const ids = owner ? (seed: string) => stableId(`${owner}:${seed}`) : newId;
  const imported = importFromCalendars(input, now, ids);
  const activities = uniqueColors(imported.activities);
  const data = activities === imported.activities ? imported : { ...imported, activities };
  const r = refreshPlan(data, now);
  const proposals = r.proposal
    ? [...data.proposals.filter((p) => !p.id.startsWith("conflict@")), r.proposal]
    : data.proposals.filter((p) => !p.id.startsWith("conflict@"));
  return { ...data, plan: r.plan, proposals };
}
