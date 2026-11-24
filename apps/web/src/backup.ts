// Export and import of everything as one JSON file (also a manual backup).
import { needsNewIds, withNewIds } from "./backupIds.js";
import { backupProblem, dropBadExtras } from "./backupNamed.js";
import { dayProblem, settingsProblem, shapeOk, weekProblem } from "./backupRules.js";
import {
  BACKUP_TEXT_MAX,
  deadlineInRange,
  deadlineMaxYear,
  stripInvisible,
  UNIT_MINUTES_MAX,
  UNIT_MINUTES_MIN,
} from "./limits.js";
import type { AppData } from "./model.js";
import { withHandMarks } from "./planning.js";
import { markLegacyStudy } from "./subjects.js";

export { dayProblem };

/** 2: tasks carry the `study` mark; version 1 files get it from their titles. */
export const BACKUP_VERSION = 2;

export function exportJson(data: AppData, now: number): string {
  return JSON.stringify(
    { app: "critiCal", version: BACKUP_VERSION, exportedAt: now, data },
    null,
    2,
  );
}

type Task = Record<string, unknown>;
const isRecord = (x: unknown): x is Task => !!x && typeof x === "object" && !Array.isArray(x);
const nameOf = (t: Task) =>
  `"${typeof t.title === "string" ? stripInvisible(t.title.slice(0, 120)).slice(0, 80) || "sin título" : "sin título"}"`;

/** What is wrong with the minutes of a part of a silo, or null. */
function partProblem(t: Task): string | null {
  const parts = Array.isArray(t.units) ? t.units : [];
  const bad = parts.find(
    (u) =>
      !isRecord(u) ||
      typeof u.estimateMinutes !== "number" ||
      !(u.estimateMinutes >= UNIT_MINUTES_MIN && u.estimateMinutes <= UNIT_MINUTES_MAX),
  );
  if (bad === undefined) return null;
  const m = isRecord(bad) ? bad.estimateMinutes : undefined;
  const said = typeof m === "number" ? `${m} min` : "minutos inválidos";
  return `La entrega ${nameOf(t)} tiene una parte de ${said}: tiene que ser de ${UNIT_MINUTES_MIN} a ${UNIT_MINUTES_MAX} min.`;
}

function repeatedPartProblem(t: Task): string | null {
  const ids = (Array.isArray(t.units) ? t.units : []).map((u) => (u as Task)?.id);
  return new Set(ids).size === ids.length
    ? null
    : `Hay dos partes con el mismo id en ${nameOf(t)}.`;
}

function minimumProblemOf(t: Task): string | null {
  const [min, estimate] = [t.minMinutes, t.estimateMinutes];
  const over = typeof min === "number" && typeof estimate === "number" && min > estimate;
  return t.kind === "deliverable" && over
    ? `El mínimo de ${nameOf(t)} es mayor que lo estimado.`
    : null;
}

function dateProblem(t: Task, now: number): string | null {
  const at = t.deadline;
  const ok = at === undefined || (typeof at === "number" && deadlineInRange(at, now));
  return ok ? null : `La fecha de ${nameOf(t)} está fuera de 2000–${deadlineMaxYear(now)}.`;
}

function hoursProblemOf(t: Task): string | null {
  const ok = (x: unknown) => typeof x === "number" && x >= 0 && x <= 100_000;
  return ok(t.estimateMinutes) && ok(t.minMinutes)
    ? null
    : `Las horas de ${nameOf(t)} no son válidas (de 0 a 100000 min).`;
}

/** The first thing wrong with a silo of the file, said with its name, or null. */
export function taskProblem(tasks: unknown, now: number): string | null {
  const checks = [partProblem, repeatedPartProblem, minimumProblemOf, hoursProblemOf];
  for (const t of Array.isArray(tasks) ? tasks : []) {
    if (!isRecord(t)) continue;
    const found = checks.map((check) => check(t)).find(Boolean) ?? dateProblem(t, now);
    if (found) return found;
  }
  return null;
}

/** Two materias, tareas or bloques with one id would overwrite each other in the database. */
const repeated = (d: AppData) =>
  [d.activities, d.tasks, d.plan].some((l) => new Set(l.map((x) => x.id)).size !== l.length);

/** What is missing or repeated between the lists of the file, or null. */
function linksProblem(d: AppData): string | null {
  const activities = new Set(d.activities.map((a) => a.id));
  const tasks = new Set(d.tasks.map((t) => t.id));
  const checks: [boolean, string][] = [
    [
      new Set(d.checkIns.map((c) => c.id)).size !== d.checkIns.length,
      "El respaldo tiene registros duplicados.",
    ],
    [repeated(d), "El respaldo tiene materias, tareas o bloques repetidos."],
    [
      d.tasks.some((t) => !activities.has(t.activityId)),
      "El respaldo está incompleto: hay actividades sin materia.",
    ],
    // Every check-in needs its task in the file (the database enforces it too).
    [
      d.checkIns.some((c) => !tasks.has(c.taskId)),
      "El respaldo está incompleto: hay registros de tareas que no están.",
    ],
  ];
  return checks.find(([bad]) => bad)?.[1] ?? null;
}

/** The file's contents when it is a backup this version reads, or what is wrong with it. */
function readFile(text: string): { raw: Task; version: number } | { error: string } {
  let parsed: { app?: unknown; version?: unknown; data?: unknown } | null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: "El archivo no es JSON." };
  }
  const { app, version, data } = parsed ?? {};
  if (app !== "critiCal" || typeof version !== "number" || !isRecord(data)) {
    return { error: "No es un respaldo de critiCal." };
  }
  return version > BACKUP_VERSION
    ? { error: "El respaldo es de una versión más nueva." }
    : { raw: data, version };
}

/** What is wrong with the data of the file, said for the user, or null. */
function dataProblem(raw: Task, now: number): string | null {
  const named = backupProblem(raw);
  if (named || shapeOk(raw, now)) return named;
  // Say which day is the problem when that is the only one (the rest of the file reads).
  const week = (raw.settings as { week?: unknown } | undefined)?.week;
  return (
    weekProblem(week) ??
    settingsProblem(raw.settings) ??
    taskProblem(raw.tasks, now) ??
    "Al respaldo le faltan datos."
  );
}

/**
 * A habit without a creation date (a file from before it was kept, or the demo) is older than
 * any week: the database would stamp «now» on its row, and the routine would then ask only the
 * share of the week left, when the ones from before ask the whole week (SPEC §5.4).
 */
export const BEFORE_CREATION_DATES = Date.UTC(2000, 0, 1);

/** `d` as the account's: new ids when needed, and every habit with a creation date. */
function ownedBy(d: AppData, account: string): AppData {
  const fresh = needsNewIds(d, account) ? withNewIds(d) : d;
  const tasks = fresh.tasks.map((t) =>
    t.kind === "habit" && t.createdAt === undefined
      ? { ...t, createdAt: BEFORE_CREATION_DATES }
      : t,
  );
  return { ...fresh, tasks, owner: account };
}

/**
 * The data in a backup file, or an error message in Spanish for the user. `dropped` names the
 * optional data left out because it was malformed (the rest is imported). With `account` (the
 * signed-in user's id) the data is that account's: a file from another owner, from the demo or
 * with ids that are not uuids gets new ids everywhere; the account's own file keeps its ids.
 */
export function parseBackup(
  text: string,
  options: { account?: string } = {},
): { data: AppData; dropped?: string[] } | { error: string } {
  const read = readFile(text);
  if ("error" in read) return read;
  const { data: clean, dropped } = dropBadExtras(read.raw);
  const problem = dataProblem(clean, Date.now());
  const d = clean as unknown as AppData;
  const error = problem ?? linksProblem(d);
  if (error) return { error };
  // A long event title is cut on import: the calendar sends them, and the rest is kept.
  const events = d.events.map((e) =>
    e.title.length > BACKUP_TEXT_MAX ? { ...e, title: e.title.slice(0, BACKUP_TEXT_MAX) } : e,
  );
  // A file from before `doneByHand` is read with the migration's rule, against its own records.
  // Parts that say «declared by a record» when no record of the file declares them are read as
  // by hand later, in `importCandidate`, once the records made after the backup are counted.
  const whole = withHandMarks({ ...d, events });
  const marked = read.version < 2 ? markLegacyStudy(whole) : whole;
  const { account } = options;
  const data = account === undefined ? marked : ownedBy(marked, account);
  return dropped.length > 0 ? { data, dropped } : { data };
}
