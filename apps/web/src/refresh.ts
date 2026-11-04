import { importFromCalendars, isTentative, visibleEvents } from "./calendars.js";
import type { AppData } from "./model.js";
import { newId, stableId, uniqueColors } from "./model.js";
import { endOfDay, refreshPlan } from "./planning.js";

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
  let proposals = r.proposal
    ? [...data.proposals.filter((p) => !p.id.startsWith("conflict@")), r.proposal]
    : data.proposals.filter((p) => !p.id.startsWith("conflict@"));
  const fallen = planB(data, now, proposals);
  proposals = fallen.proposals;
  const tentativeSeen =
    JSON.stringify(fallen.seen) === JSON.stringify(data.tentativeSeen ?? [])
      ? data.tentativeSeen
      : fallen.seen;
  return { ...data, plan: r.plan, proposals, tentativeSeen };
}

const TENTATIVE = "tentative@";

/**
 * A tentative event of today that is gone from the calendar frees its time, but today's
 * plan only changes with an OK: the plan B (the rest of the day planned again) waits as
 * a proposal. Later days are planned again on their own. Proposals already waiting get
 * a fresh plan B every time, so accepting one never brings back an old plan.
 */
function planB(data: AppData, now: number, proposals: AppData["proposals"]) {
  const seen = visibleEvents(data)
    .filter((e) => isTentative(e) && e.end > now)
    .map((e) => ({ id: e.id, title: e.title, start: e.start, end: e.end }));
  const todayEnd = endOfDay(data.settings.timezone, now);
  const gone = (data.tentativeSeen ?? []).filter(
    (s) => s.end > now && s.start < todayEnd && !data.events.some((e) => e.id === s.id),
  );
  const waiting = proposals.some((p) => p.id.startsWith(TENTATIVE));
  if (gone.length === 0 && !waiting) return { proposals, seen };
  // Everything from now on, except the block in progress, planned again.
  const plan = refreshPlan({ ...data, plan: data.plan.filter((b) => b.start <= now) }, now).plan;
  return {
    seen,
    proposals: [
      ...proposals.map((p) => (p.id.startsWith(TENTATIVE) ? { ...p, plan } : p)),
      ...gone.map((s) => ({
        id: `${TENTATIVE}${s.id}`,
        message: `Se cayó «${s.title.replace(/\s*\?\s*$/, "")}» (era tentativo): ¿reacomodo el día con ese tiempo?`,
        plan,
        conflicts: [],
        createdAt: now,
      })),
    ],
  };
}
