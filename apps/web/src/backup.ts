// Export and import of everything as one JSON file (also a manual backup).
import type { AppData } from "./model.js";

export const BACKUP_VERSION = 1;

export function exportJson(data: AppData, now: number): string {
  return JSON.stringify(
    { app: "critiCal", version: BACKUP_VERSION, exportedAt: now, data },
    null,
    2,
  );
}

/** The data in a backup file, or an error message in Spanish for the user. */
export function parseBackup(text: string): { data: AppData } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "El archivo no es JSON." };
  }
  const file = parsed as { app?: unknown; version?: unknown; data?: Partial<AppData> };
  if (file?.app !== "critiCal" || typeof file.version !== "number" || !file.data) {
    return { error: "No es un respaldo de critiCal." };
  }
  if (file.version > BACKUP_VERSION) return { error: "El respaldo es de una versión más nueva." };
  const d = file.data;
  const lists = [
    "activities",
    "tasks",
    "events",
    "checkIns",
    "overrides",
    "plan",
    "proposals",
  ] as const;
  const week = (d.settings as { week?: unknown } | undefined)?.week;
  type Rec = Record<string, unknown>;
  const isObject = (x: unknown): x is Rec => !!x && typeof x === "object" && !Array.isArray(x);
  const str = (x: unknown) => typeof x === "string" && x.length > 0;
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const validUnit = (u: unknown) =>
    isObject(u) && str(u.id) && str(u.title) && num(u.estimateMinutes);
  const validTask = (t: unknown) =>
    isObject(t) &&
    str(t.id) &&
    str(t.activityId) &&
    Array.isArray(t.units) &&
    t.units.every(validUnit);
  // An instant Date can represent (toISOString would throw otherwise).
  const instant = (x: unknown) => num(x) && !Number.isNaN(new Date(x as number).getTime());
  const validCheckIn = (c: unknown) =>
    isObject(c) &&
    str(c.id) &&
    str(c.blockId) &&
    str(c.taskId) &&
    ["done", "missed", "partial"].includes(c.status as string) &&
    num(c.minutesDone) &&
    (c.minutesDone as number) >= 0 &&
    // A missed block did no work.
    (c.status !== "missed" || c.minutesDone === 0) &&
    instant(c.createdAt) &&
    Array.isArray(c.unitIds) &&
    c.unitIds.every(str);
  // Minutes since midnight; up to two days for times after midnight (meals, free time).
  const minute = (x: unknown, max = 1440) => num(x) && (x as number) >= 0 && (x as number) <= max;
  const range = (r: unknown) =>
    isObject(r) &&
    minute(r.start, 2880) &&
    minute(r.end, 2880) &&
    (r.end as number) > (r.start as number);
  const validDay = (w: unknown) =>
    isObject(w) &&
    minute(w.wake) &&
    minute(w.bed) &&
    minute(w.freeFrom, 2880) &&
    (w.morningMinutes === undefined || minute(w.morningMinutes)) &&
    Array.isArray(w.meals) &&
    w.meals.every(range);
  // A real calendar day, not just its shape (2026-02-30 is not one).
  const realDate = (x: unknown) => {
    if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
    const d = new Date(`${x}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === x;
  };
  const validOverride = (o: unknown) =>
    isObject(o) &&
    realDate(o.date) &&
    (o.wake === undefined || o.wake === null || minute(o.wake)) &&
    (o.bed === undefined || o.bed === null || minute(o.bed)) &&
    (o.asWeekday === undefined ||
      (Number.isInteger(o.asWeekday) &&
        (o.asWeekday as number) >= 0 &&
        (o.asWeekday as number) <= 6));
  if (
    !isObject(d.settings) ||
    !Array.isArray(week) ||
    week.length !== 7 ||
    !week.every(validDay) ||
    lists.some((k) => !Array.isArray(d[k]) || !(d[k] as unknown[]).every(isObject)) ||
    !(d.activities as unknown[]).every((a) => isObject(a) && str(a.id)) ||
    !(d.tasks as unknown[]).every(validTask) ||
    !(d.checkIns as unknown[]).every(validCheckIn) ||
    !(d.overrides as unknown[]).every(validOverride)
  ) {
    return { error: "Al respaldo le faltan datos." };
  }
  if (new Set(d.checkIns?.map((c) => c.id)).size !== d.checkIns?.length) {
    return { error: "El respaldo tiene registros duplicados." };
  }
  const activities = new Set(d.activities?.map((a) => a.id));
  if (d.tasks?.some((t) => !activities.has(t.activityId))) {
    return { error: "El respaldo está incompleto: hay actividades sin materia." };
  }
  // Every check-in needs its task in the file (the database enforces it too).
  const tasks = new Set(d.tasks?.map((t) => t.id));
  if (d.checkIns?.some((c) => !tasks.has(c.taskId))) {
    return { error: "El respaldo está incompleto: hay registros de tareas que no están." };
  }
  return { data: d as AppData };
}
