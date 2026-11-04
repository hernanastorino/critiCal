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
  const isObject = (x: unknown) => !!x && typeof x === "object";
  if (
    !d.settings ||
    !Array.isArray(week) ||
    week.length !== 7 ||
    !week.every(isObject) ||
    lists.some((k) => !Array.isArray(d[k]) || !(d[k] as unknown[]).every(isObject))
  ) {
    return { error: "Al respaldo le faltan datos." };
  }
  const activities = new Set(d.activities?.map((a) => a.id));
  if (d.tasks?.some((t) => !activities.has(t.activityId))) {
    return { error: "El respaldo está incompleto: hay actividades sin materia." };
  }
  return { data: d as AppData };
}
