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
  const validCheckIn = (c: unknown) =>
    isObject(c) &&
    str(c.id) &&
    str(c.taskId) &&
    num(c.minutesDone) &&
    num(c.createdAt) &&
    Array.isArray(c.unitIds) &&
    c.unitIds.every(str);
  if (
    !isObject(d.settings) ||
    !Array.isArray(week) ||
    week.length !== 7 ||
    !week.every(isObject) ||
    lists.some((k) => !Array.isArray(d[k]) || !(d[k] as unknown[]).every(isObject)) ||
    !(d.activities as unknown[]).every((a) => isObject(a) && str(a.id)) ||
    !(d.tasks as unknown[]).every(validTask) ||
    !(d.checkIns as unknown[]).every(validCheckIn)
  ) {
    return { error: "Al respaldo le faltan datos." };
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
