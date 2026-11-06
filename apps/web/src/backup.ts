// Export and import of everything as one JSON file (also a manual backup).
import type { AppData } from "./model.js";
import { markLegacyStudy } from "./subjects.js";

/** 2: tasks carry the `study` mark; version 1 files get it from their titles. */
export const BACKUP_VERSION = 2;

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
  const between = (x: unknown, lo: number, hi: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const validUnit = (u: unknown) =>
    isObject(u) && str(u.id) && str(u.title) && num(u.estimateMinutes);
  // An instant Date can represent (toISOString would throw otherwise).
  const instant = (x: unknown) => num(x) && !Number.isNaN(new Date(x as number).getTime());
  const opt = (x: unknown, ok: (v: unknown) => boolean) => x === undefined || ok(x);
  // A hand-edited deadline («mañana») would blank Silos on every visit.
  const validTask = (t: unknown) =>
    isObject(t) &&
    str(t.id) &&
    str(t.activityId) &&
    Array.isArray(t.units) &&
    t.units.every(validUnit) &&
    opt(t.deadline, instant) &&
    opt(t.estimateMinutes, (v) => between(v, 0, 100_000)) &&
    opt(t.minMinutes, (v) => between(v, 0, 100_000)) &&
    opt(t.sessionsPerWeek, (v) => between(v, 1, 14)) &&
    opt(t.sessionMinutes, (v) => between(v, 1, 1440));
  const validActivity = (a: unknown) =>
    isObject(a) &&
    str(a.id) &&
    opt(a.maxSessionMinutes, (v) => between(v, 1, 1440)) &&
    opt(a.minBlockMinutes, (v) => between(v, 1, 1440)) &&
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
    between(settings.maxActivitiesPerDay, 1, 100) &&
    between(settings.warnSlackMinutes, 0, 100_000);
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
    typeof e.title === "string" &&
    // Without it the planner would silently treat busy time as free.
    typeof e.busy === "boolean" &&
    instant(e.start) &&
    instant(e.end) &&
    (e.end as number) >= (e.start as number) &&
    (e.end as number) - (e.start as number) <= 366 * DAY_MS;
  const proposal = (p: unknown) =>
    isObject(p) &&
    str(p.id) &&
    Array.isArray(p.plan) &&
    p.plan.every(block) &&
    Array.isArray(p.conflicts);
  const place = (p: unknown) =>
    isObject(p) &&
    str(p.id) &&
    str(p.name) &&
    Array.isArray(p.aliases) &&
    p.aliases.every((a) => typeof a === "string") &&
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
        typeof a.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(a.color),
    ) ||
    !(d.tasks as unknown[]).every(validTask) ||
    !(d.checkIns as unknown[]).every(validCheckIn) ||
    !(d.overrides as unknown[]).every(validOverride) ||
    !validShapes() ||
    !validPreferences(d.preferences)
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
  return { data: file.version < 2 ? markLegacyStudy(d as AppData) : (d as AppData) };
}
