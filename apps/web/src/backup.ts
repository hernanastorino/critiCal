// Export and import of everything as one JSON file (also a manual backup).
import { backupProblem } from "./backupProblems.js";
import { awakeMinutes, awakeProblem, awakeText } from "./dayLength.js";
import { minutesToHhmm } from "./format.js";
import {
  BACKUP_TEXT_MAX,
  deadlineInRange,
  deadlineMaxYear,
  isRealDate,
  SESSIONS_PER_WEEK_MAX,
  UNIT_MINUTES_MAX,
  UNIT_MINUTES_MIN,
} from "./limits.js";
import type { AppData } from "./model.js";
import { markLegacyStudy, validRoutine } from "./subjects.js";

/** 2: tasks carry the `study` mark; version 1 files get it from their titles. */
export const BACKUP_VERSION = 2;

export function exportJson(data: AppData, now: number): string {
  return JSON.stringify(
    { app: "critiCal", version: BACKUP_VERSION, exportedAt: now, data },
    null,
    2,
  );
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * What is wrong with a day of the week of a backup whose times are valid («El lunes tiene
 * 23 h 30 min despierto»), or null: awake 4 to 22 h, and no free time asleep (what «Mi semana»
 * and «Hoy» take).
 */
export function dayProblem(w: Record<string, unknown>, weekday: number): string | null {
  const [wake, bed, free] = [w.wake, w.bed, w.freeFrom] as number[];
  const [from, to] = [minutesToHhmm(wake as number), minutesToHhmm(bed as number)];
  const name = `El ${WEEKDAYS[weekday] ?? "día"}`;
  if (awakeProblem(from, to)) {
    return `${name} tiene ${awakeText(awakeMinutes(from, to))} despierto (de ${from} a ${to}): tiene que tener entre 4 y 22 h.`;
  }
  const asleep =
    (bed as number) < (wake as number)
      ? (free as number) < (wake as number) && (free as number) > (bed as number)
      : (free as number) < (wake as number);
  return asleep ? `${name}, «Nada de estudio desde» cae cuando estás dormido.` : null;
}

type Task = Record<string, unknown>;
const isRecord = (x: unknown): x is Task => !!x && typeof x === "object" && !Array.isArray(x);
const nameOf = (t: Task) => `"${typeof t.title === "string" ? t.title : "sin título"}"`;

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

/** The data in a backup file, or an error message in Spanish for the user. */
export function parseBackup(
  text: string,
  options: { strictIds?: boolean } = {},
): { data: AppData } | { error: string } {
  const now = Date.now();
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
  const between = (x: unknown, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  // Names and titles go into cards, notices and calendar events: a bounded length.
  const bounded = (x: unknown) => str(x) && (x as string).length <= BACKUP_TEXT_MAX;
  // A part of 0 would never plan; the most is the editor's (see `limits.ts`).
  const validUnit = (u: unknown) =>
    isObject(u) &&
    str(u.id) &&
    bounded(u.title) &&
    between(u.estimateMinutes, UNIT_MINUTES_MIN, UNIT_MINUTES_MAX);
  const distinctIds = (units: Rec[]) => new Set(units.map((u) => u.id)).size === units.length;
  // An instant Date can represent (toISOString would throw otherwise).
  const instant = (x: unknown) => num(x) && !Number.isNaN(new Date(x as number).getTime());
  const opt = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || ok(x);
  const routineIds = new Set(
    (Array.isArray(d.activities) ? d.activities : [])
      .filter((a) => isObject(a) && a.kind === "rutina")
      .map((a) => (a as { id: unknown }).id),
  );
  // A hand-edited deadline («mañana») would blank Silos on every visit.
  // «Puedo empezar» (§18.7): a real local date, or whole days before the deadline.
  // Exactly one of the three shapes, and nothing else: a real day, whole days, or «ya».
  const validStart = (s: unknown) => {
    if (!isObject(s)) return false;
    const keys = Object.keys(s);
    if (keys.length !== 1) return false;
    if (keys[0] === "date") return isRealDate(s.date);
    if (keys[0] === "daysBefore")
      return Number.isInteger(s.daysBefore) && between(s.daysBefore, 0, 365);
    return keys[0] === "now" && s.now === true;
  };
  const validTask = (t: unknown) =>
    isObject(t) &&
    str(t.id) &&
    (t.title === undefined || bounded(t.title)) &&
    opt(t.startAfter, validStart) &&
    opt(t.deadlineSyncedFrom, instant) &&
    str(t.activityId) &&
    Array.isArray(t.units) &&
    t.units.every(validUnit) &&
    distinctIds(t.units as Rec[]) &&
    // The date field's range: 2000 up to the end of the year five years ahead.
    opt(t.deadline, (v) => instant(v) && deadlineInRange(v as number, now)) &&
    // Without its durations the planner gets NaN and leaves it unplanned.
    between(t.estimateMinutes, 0, 100_000) &&
    between(t.minMinutes, 0, 100_000) &&
    // A deliverable's minimum is part of its estimate (a habit keeps its session in it).
    (t.kind !== "deliverable" || (t.minMinutes as number) <= (t.estimateMinutes as number)) &&
    opt(t.sessionsPerWeek, (v) => between(v, 1, SESSIONS_PER_WEEK_MAX)) &&
    opt(t.sessionMinutes, (v) => between(v, 1, 1440)) &&
    // A routine's habit as Rutinas allows it (6 h a time, 40 h a week); other habits,
    // saved from the editor, keep their own limits.
    (!routineIds.has(t.activityId as string) ||
      t.sessionsPerWeek === undefined ||
      validRoutine(t.sessionsPerWeek as number, (t.sessionMinutes as number) ?? 0));
  const validActivity = (a: unknown) =>
    isObject(a) &&
    str(a.id) &&
    opt(a.startAfter, validStart) &&
    // Both limits, and the block within the session (as the form requires).
    between(a.maxSessionMinutes, 1, 1440) &&
    between(a.minBlockMinutes, 1, 1440) &&
    (a.minBlockMinutes as number) <= (a.maxSessionMinutes as number) &&
    opt(
      a.preferred,
      (p) =>
        isObject(p) && minute(p.start) && minute(p.end) && (p.end as number) > (p.start as number),
    );
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
    (c.factor === undefined || (num(c.factor) && (c.factor as number) >= 1)) &&
    Array.isArray(c.unitIds) &&
    c.unitIds.every(str);
  // Minutes since midnight; up to two days for times after midnight (meals, free time).
  // Whole minutes (the database stores integers).
  const minute = (x: unknown, max = 1440) =>
    Number.isInteger(x) && (x as number) >= 0 && (x as number) <= max;
  const range = (r: unknown) =>
    isObject(r) &&
    minute(r.start, 2880) &&
    minute(r.end, 2880) &&
    (r.end as number) > (r.start as number);
  // The day «Mi semana» and «Hoy» would take: awake 4 to 22 h, and no free time asleep.
  const sensibleDay = (w: Rec) => dayProblem(w, 0) === null;
  const validDay = (w: unknown) =>
    isObject(w) &&
    minute(w.wake) &&
    minute(w.bed) &&
    minute(w.freeFrom, 2880) &&
    (w.morningMinutes === undefined || minute(w.morningMinutes)) &&
    Array.isArray(w.meals) &&
    w.meals.every(range) &&
    sensibleDay(w);
  const realDate = isRealDate;
  const validOverride = (o: unknown) =>
    isObject(o) &&
    realDate(o.date) &&
    (o.wake === undefined || o.wake === null || minute(o.wake)) &&
    (o.bed === undefined || o.bed === null || minute(o.bed)) &&
    (o.asWeekday === undefined ||
      (Number.isInteger(o.asWeekday) &&
        (o.asWeekday as number) >= 0 &&
        (o.asWeekday as number) <= 6));
  const validPreferences = (p: unknown) => {
    if (p === undefined || p === null) return true;
    if (!isObject(p)) return false;
    const s = p.semester;
    if (
      s !== undefined &&
      !(
        isObject(s) &&
        realDate(s.start) &&
        realDate(s.end) &&
        (s.end as string) >= (s.start as string)
      )
    )
      return false;
    const optional = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || ok(x);
    const bool = (v: unknown) => typeof v === "boolean";
    const effort = (e: unknown) =>
      isObject(e) &&
      minute(e.estimate, 100_000) &&
      minute(e.min, 100_000) &&
      (e.min as number) <= (e.estimate as number) &&
      [1, 2, 3].includes(e.priority as number);
    const defaults = p.importDefaults;
    if (
      defaults !== undefined &&
      !(
        isObject(defaults) &&
        Object.entries(defaults).every(
          ([k, v]) => ["parcial", "entrega", "presentacion"].includes(k) && effort(v),
        )
      )
    )
      return false;
    const n = p.notifications;
    if (
      n !== undefined &&
      !(
        isObject(n) &&
        optional(n.critical, bool) &&
        optional(n.proposals, bool) &&
        optional(n.sunday, bool) &&
        optional(n.leadMinutes, (v) => minute(v, 1440)) &&
        optional(n.sundayAt, (v) => minute(v, 1439))
      )
    )
      return false;
    return optional(p.holidaysOff, bool);
  };
  const zone = (z: unknown) => {
    if (typeof z !== "string" || !z) return false;
    try {
      new Intl.DateTimeFormat("es-UY", { timeZone: z });
      return true;
    } catch {
      return false;
    }
  };
  const settings = d.settings as unknown as Record<string, unknown> | undefined;
  const validSettings =
    isObject(settings) &&
    zone(settings.timezone) &&
    [15, 30, 60].includes(settings.slotMinutes as number) &&
    // The rules form accepts decimals, so a backup may carry them.
    between(settings.travelMarginMinutes, 0, 1440) &&
    between(settings.maxActivitiesPerDay, 1, 50) &&
    between(settings.warnSlackMinutes, 0, 10_080);
  const DAY_MS = 86_400_000;
  // Bounded intervals: the planner walks them slot by slot.
  const block = (b: unknown) =>
    isObject(b) &&
    str(b.id) &&
    str(b.taskId) &&
    instant(b.start) &&
    instant(b.end) &&
    (b.end as number) > (b.start as number) &&
    (b.end as number) - (b.start as number) <= DAY_MS;
  const event = (e: unknown) =>
    isObject(e) &&
    str(e.id) &&
    // A long title is cut on import, and a long event (the calendar sends them) is kept.
    typeof e.title === "string" &&
    // Without it the planner would silently treat busy time as free.
    typeof e.busy === "boolean" &&
    instant(e.start) &&
    instant(e.end) &&
    (e.end as number) >= (e.start as number);
  const proposal = (p: unknown) =>
    isObject(p) &&
    str(p.id) &&
    Array.isArray(p.plan) &&
    p.plan.every(block) &&
    Array.isArray(p.conflicts);
  const place = (p: unknown) =>
    isObject(p) &&
    str(p.id) &&
    bounded(p.name) &&
    Array.isArray(p.aliases) &&
    p.aliases.every((a) => typeof a === "string" && a.length <= BACKUP_TEXT_MAX) &&
    (p.lat === undefined || between(p.lat, -90, 90)) &&
    (p.lon === undefined || between(p.lon, -180, 180));
  const travel = (t: unknown) =>
    isObject(t) &&
    str(t.from) &&
    str(t.to) &&
    minute(t.minutes, 1440) &&
    typeof t.manual === "boolean";
  const spot = (s: unknown) =>
    isObject(s) &&
    str(s.key) &&
    str(s.text) &&
    (s.minutes === undefined || minute(s.minutes, 1440)) &&
    (s.manual === undefined || typeof s.manual === "boolean") &&
    (s.failed === undefined || typeof s.failed === "boolean");
  const optionalList = (x: unknown, ok: (v: unknown) => boolean) =>
    x === undefined || (Array.isArray(x) && x.every(ok));
  // Called only once the lists are known to be arrays.
  const validShapes = () =>
    (d.plan as unknown[]).every(block) &&
    optionalList(d.pins, block) &&
    (d.events as unknown[]).every(event) &&
    (d.proposals as unknown[]).every(proposal) &&
    optionalList(d.places, place) &&
    optionalList(d.travelTimes, travel) &&
    optionalList(d.spots, spot);
  const known = backupProblem(d as Rec, !!options.strictIds);
  if (known) return { error: known };
  if (
    !validSettings ||
    !Array.isArray(week) ||
    week.length !== 7 ||
    !week.every(validDay) ||
    lists.some((k) => !Array.isArray(d[k]) || !(d[k] as unknown[]).every(isObject)) ||
    // A colour goes into style attributes: only #rrggbb. A materia needs a name to be told apart.
    !(d.activities as unknown[]).every(
      (a) =>
        validActivity(a) &&
        isObject(a) &&
        str(a.id) &&
        typeof a.name === "string" &&
        a.name.trim() !== "" &&
        a.name.length <= BACKUP_TEXT_MAX &&
        typeof a.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(a.color),
    ) ||
    !(d.tasks as unknown[]).every(validTask) ||
    !(d.checkIns as unknown[]).every(validCheckIn) ||
    !(d.overrides as unknown[]).every(validOverride) ||
    !validShapes() ||
    !validPreferences(d.preferences)
  ) {
    // Say which day is the problem when that is the only one (the rest of the file reads).
    const badDay = Array.isArray(week)
      ? week.findIndex(
          (w) =>
            isObject(w) &&
            minute(w.wake) &&
            minute(w.bed) &&
            minute(w.freeFrom, 2880) &&
            !sensibleDay(w),
        )
      : -1;
    const message = badDay >= 0 ? dayProblem((week as unknown[])[badDay] as Rec, badDay) : null;
    return { error: message ?? taskProblem(d.tasks, now) ?? "Al respaldo le faltan datos." };
  }
  if (new Set(d.checkIns?.map((c) => c.id)).size !== d.checkIns?.length) {
    return { error: "El respaldo tiene registros duplicados." };
  }
  // Two materias, tareas or bloques with one id would overwrite each other in the database.
  const idLists: unknown[][] = [d.activities ?? [], d.tasks ?? [], d.plan ?? []];
  if (idLists.some((l) => new Set(l.map((x) => (x as { id: string }).id)).size !== l.length)) {
    return { error: "El respaldo tiene materias, tareas o bloques repetidos." };
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
  const clipped = {
    ...d,
    events: d.events?.map((e) =>
      e.title.length > BACKUP_TEXT_MAX ? { ...e, title: e.title.slice(0, BACKUP_TEXT_MAX) } : e,
    ),
  } as AppData;
  return { data: file.version < 2 ? markLegacyStudy(clipped) : clipped };
}
