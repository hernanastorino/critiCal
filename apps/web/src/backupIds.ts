// A backup from another account or the demo, imported into an account: every row gets a new
// uuid (the database keys rows by id, and another account's, or text ids, would clash or be
// refused), and every reference between them is rewritten to follow.
import type { PlanBlock } from "./engine.js";
import { isUuid } from "./limits.js";
import { type AppData, type AppliedDecision, type AppTask, newId, type Proposal } from "./model.js";

/** The ids the database stores as uuids (the rest of the ids are text anyway). */
const rowIds = (d: AppData): unknown[] => [
  ...d.activities.map((a) => a.id),
  ...d.tasks.flatMap((t) => [t.id, ...t.units.map((u) => u.id)]),
  ...d.checkIns.map((c) => c.id),
  ...(d.places ?? []).map((p) => p.id),
];

/**
 * Whether importing `d` into the account `account` needs new ids: the file is from another
 * owner (or the demo), or has ids that are not uuids. A file of this same account keeps its
 * ids, so importing one's own backup again does not duplicate anything.
 */
export const needsNewIds = (d: AppData, account: string): boolean =>
  d.owner !== account || !rowIds(d).every(isUuid);

/** `d` with a new id for every row and every reference between them rewritten. */
export function withNewIds(d: AppData, fresh: () => string = newId): AppData {
  const made = new Map<string, string>();
  const id = (old: string): string => {
    const known = made.get(old);
    if (known !== undefined) return known;
    const next = fresh();
    made.set(old, next);
    return next;
  };
  const taskIds = new Set(d.tasks.map((t) => t.id));
  /** Block ids are `taskId@start`: they follow their task. Any other id stays. */
  const block = (old: string): string => {
    const at = old.indexOf("@");
    const task = old.slice(0, at);
    return at > 0 && taskIds.has(task) ? `${id(task)}${old.slice(at)}` : old;
  };
  const rekey = <T>(r: Record<string, T> | undefined) =>
    r && Object.fromEntries(Object.entries(r).map(([k, v]) => [id(k), v]));
  const task = (t: AppTask): AppTask => ({
    ...t,
    id: id(t.id),
    activityId: id(t.activityId),
    units: t.units.map((u) => ({ ...u, id: id(u.id) })),
  });
  const placed = (b: PlanBlock): PlanBlock => ({
    ...b,
    id: block(b.id),
    taskId: id(b.taskId),
    activityId: id(b.activityId),
  });
  const proposal = (p: Proposal): Proposal => ({
    ...p,
    plan: p.plan.map(placed),
    conflicts: p.conflicts.map(block),
  });
  const decision = (a: AppliedDecision): AppliedDecision => ({
    ...a,
    before: a.before.map(task),
    ...(a.dropped && { dropped: a.dropped.map(id) }),
    ...(a.after && { after: rekey(a.after) }),
    ...(a.afterMinutes && { afterMinutes: rekey(a.afterMinutes) }),
    ...(a.addedBlocks && { addedBlocks: a.addedBlocks.map(block) }),
    ...(a.skippedUnits && { skippedUnits: a.skippedUnits.map(id) }),
    ...(a.skipUntil && { skipUntil: rekey(a.skipUntil) }),
    ...(a.startAfter && { startAfter: rekey(a.startAfter) }),
  });
  return {
    ...d,
    activities: d.activities.map((a) => ({ ...a, id: id(a.id) })),
    tasks: d.tasks.map(task),
    checkIns: d.checkIns.map((c) => ({
      ...c,
      id: id(c.id),
      blockId: block(c.blockId),
      taskId: id(c.taskId),
      unitIds: c.unitIds.map(id),
    })),
    plan: d.plan.map(placed),
    proposals: d.proposals.map(proposal),
    ...(d.pins && { pins: d.pins.map(placed) }),
    ...(d.places && { places: d.places.map((p) => ({ ...p, id: id(p.id) })) }),
    ...(d.travelTimes && {
      travelTimes: d.travelTimes.map((t) => ({ ...t, from: id(t.from), to: id(t.to) })),
    }),
    ...(d.applied && { applied: d.applied.map(decision) }),
    ...(d.planHistory && {
      planHistory: d.planHistory.map((v) => ({
        ...v,
        pins: v.pins.map(placed),
        today: v.today.map(placed),
        proposals: v.proposals.map(proposal),
      })),
    }),
  };
}
