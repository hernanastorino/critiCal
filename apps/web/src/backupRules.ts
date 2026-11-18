// The shape of a backup file the app can use, as lists of tests over each kind of record
// (a record passes when every test does). `backupProblems.ts` says what the database
// refuses with its own messages; this is what the screens and the planner need.
import {
  allOf,
  arrayOf,
  bool,
  dupes,
  instant,
  int,
  isRec,
  listOf,
  looseBlockTests,
  looseProposalTests,
  name,
  num,
  type Ok,
  opt,
  type Rec,
  shape,
  str,
  type Test,
  text,
} from "./backupProblems.js";
import { awakeMinutes, awakeProblem, awakeText } from "./dayLength.js";
import { minutesToHhmm } from "./format.js";
import {
  deadlineInRange,
  isRealDate,
  SESSIONS_PER_WEEK_MAX,
  UNIT_MINUTES_MAX,
  UNIT_MINUTES_MIN,
} from "./limits.js";
import { validRoutine } from "./subjects.js";

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DAY_MS = 86_400_000;

/**
 * What is wrong with a day of the week of a backup whose times are valid («El lunes tiene
 * 23 h 30 min despierto»), or null: awake 4 to 22 h, and no free time asleep (what «Mi semana»
 * and «Hoy» take).
 */
export function dayProblem(w: Record<string, unknown>, weekday: number): string | null {
  const [wake = 0, bed = 0, free = 0] = [w.wake, w.bed, w.freeFrom] as number[];
  const [from, to] = [minutesToHhmm(wake), minutesToHhmm(bed)];
  const who = `El ${WEEKDAYS.at(weekday) ?? "día"}`;
  if (awakeProblem(from, to)) {
    return `${who} tiene ${awakeText(awakeMinutes(from, to))} despierto (de ${from} a ${to}): tiene que tener entre 4 y 22 h.`;
  }
  const asleep = bed < wake ? free < wake && free > bed : free < wake;
  return asleep ? `${who}, «Nada de estudio desde» cae cuando estás dormido.` : null;
}

const between =
  (lo: number, hi: number): Ok =>
  (v) =>
    num(v) && v >= lo && v <= hi;
/** Minutes since midnight (up to two days for times after midnight): whole, the database stores integers. */
const minute = (max = 1440): Ok => int(0, max);
/** This field is greater than `other` (or equal, with `orEqual`) in the same record. */
const after =
  (other: string, orEqual = false): Ok =>
  (v, x) => {
    const [a, b] = [v as number, Reflect.get(x ?? {}, other) as number];
    return orEqual ? a >= b : a > b;
  };
const nullable =
  (ok: Ok): Ok =>
  (v, x) =>
    v === null || v === undefined || ok(v, x);
// «Puedo empezar» (§18.7): exactly one of a real local date, whole days before, or «ya».
const startShapes = new Map<string, Ok>([
  ["date", (_, x) => isRealDate(x?.date)],
  ["daysBefore", (_, x) => int(0, 365)(x?.daysBefore)],
  ["now", (_, x) => x?.now === true],
]);
const startOk: Ok = (s) => {
  const keys = isRec(s) ? Object.keys(s) : [];
  const check = startShapes.get(keys[0] ?? "");
  return keys.length === 1 && !!check && check(undefined, s as Rec);
};

const zone: Ok = (z) => {
  if (typeof z !== "string" || !z) return false;
  try {
    new Intl.DateTimeFormat("es-UY", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const mealTests: Test[] = [
  ["start", minute(2880)],
  ["end", minute(2880)],
  ["end", after("start")],
];
const dayTests: Test[] = [
  ["wake", minute()],
  ["bed", minute()],
  ["freeFrom", minute(2880)],
  ["morningMinutes", opt(minute())],
  ["meals", listOf(mealTests)],
  // The day «Mi semana» and «Hoy» would take: awake 4 to 22 h, and no free time asleep.
  ["wake", (_, x) => dayProblem(x ?? {}, 0) === null],
];
const settingsTests: Test[] = [
  ["timezone", zone],
  ["travelMarginMinutes", between(0, 1440)],
  ["week", (v) => Array.isArray(v) && v.length === 7 && v.every((w) => shape(dayTests)(w))],
];

const unitTests: Test[] = [
  ["id", str],
  ["title", name],
  // A part of 0 would never plan; the most is the editor's (see `limits.ts`).
  ["estimateMinutes", between(UNIT_MINUTES_MIN, UNIT_MINUTES_MAX)],
];
const activityTests: Test[] = [
  ["id", str],
  // A colour goes into style attributes: only #rrggbb.
  ["color", (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)],
  ["startAfter", opt(startOk)],
  ["maxSessionMinutes", between(1, 1440)],
  // The block within the session (as the form requires).
  [
    "minBlockMinutes",
    (v, x) => between(1, 1440)(v) && (v as number) <= (x?.maxSessionMinutes as number),
  ],
];

interface Ctx {
  now: number;
  routineIds: Set<unknown>;
}
const isDeliverable = (x?: Rec) => x?.kind === "deliverable";
const taskTests = ({ now, routineIds }: Ctx): Test[] => [
  ["id", str],
  ["startAfter", opt(startOk)],
  ["deadlineSyncedFrom", opt(instant)],
  ["activityId", str],
  [
    "units",
    (v) => Array.isArray(v) && v.every((u) => shape(unitTests)(u)) && !dupes(v.map((u) => u?.id)),
  ],
  // The date field's range: 2000 up to the end of the year five years ahead.
  ["deadline", opt((v) => instant(v) && deadlineInRange(v as number, now))],
  // Without its durations the planner gets NaN and leaves it unplanned.
  ["estimateMinutes", between(0, 100_000)],
  ["minMinutes", between(0, 100_000)],
  // A deliverable's minimum is part of its estimate (a habit keeps its session in it).
  ["estimateMinutes", (v, x) => !isDeliverable(x) || after("minMinutes", true)(v, x)],
  ["sessionsPerWeek", opt(between(1, SESSIONS_PER_WEEK_MAX))],
  ["sessionMinutes", opt(between(1, 1440))],
  // A routine's habit as Rutinas allows it (6 h a time, 40 h a week); other habits keep their own limits.
  [
    "activityId",
    (v, x) =>
      !routineIds.has(v) ||
      x?.sessionsPerWeek === undefined ||
      validRoutine(x.sessionsPerWeek as number, Number(x.sessionMinutes ?? 0)),
  ],
];

const checkInTests: Test[] = [
  ["id", str],
  ["blockId", str],
  ["taskId", str],
  ["status", (v) => ["done", "missed", "partial"].includes(v as string)],
  ["minutesDone", between(0, Number.MAX_SAFE_INTEGER)],
  // A missed block did no work.
  ["status", (v, x) => v !== "missed" || x?.minutesDone === 0],
  ["createdAt", instant],
  ["factor", opt(between(1, Number.MAX_SAFE_INTEGER))],
  ["unitIds", arrayOf(str)],
];
const overrideTests: Test[] = [
  ["date", isRealDate],
  ["wake", nullable(minute())],
  ["bed", nullable(minute())],
  ["asWeekday", opt(int(0, 6))],
];
// Bounded intervals: the planner walks them slot by slot.
const blockTests: Test[] = [
  ...looseBlockTests,
  ["end", after("start")],
  ["end", (v, x) => (v as number) - (x?.start as number) <= DAY_MS],
];
const eventTests: Test[] = [
  ["id", str],
  ["title", text],
  // Without it the planner would silently treat busy time as free.
  ["busy", bool],
  ["start", instant],
  ["end", instant],
  ["end", after("start", true)],
];
const proposalTests: Test[] = [
  ...looseProposalTests,
  ["plan", listOf(blockTests)],
  ["conflicts", (v) => Array.isArray(v)],
];
const placeTests: Test[] = [
  ["id", str],
  ["lat", opt(between(-90, 90))],
  ["lon", opt(between(-180, 180))],
];
const travelTests: Test[] = [
  ["from", str],
  ["to", str],
  ["minutes", minute()],
  ["manual", bool],
];
const spotTests: Test[] = [
  ["key", str],
  ["text", str],
  ["minutes", opt(minute())],
  ["manual", opt(bool)],
  ["failed", opt(bool)],
];

const effortTests: Test[] = [
  ["estimate", minute(100_000)],
  ["min", minute(100_000)],
  ["estimate", after("min", true)],
  ["priority", int(1, 3)],
];
const defaultsOk: Ok = (v) =>
  isRec(v) &&
  Object.entries(v).every(
    ([k, e]) => ["parcial", "entrega", "presentacion"].includes(k) && shape(effortTests)(e),
  );
const notificationTests: Test[] = [
  ["critical", opt(bool)],
  ["proposals", opt(bool)],
  ["sunday", opt(bool)],
  ["leadMinutes", opt(minute(1440))],
  ["sundayAt", opt(minute(1439))],
];
const semesterTests: Test[] = [
  ["start", isRealDate],
  ["end", isRealDate],
  ["end", after("start", true)],
];
const preferencesTests: Test[] = [
  ["semester", opt(shape(semesterTests))],
  ["importDefaults", opt(defaultsOk)],
  ["notifications", opt(shape(notificationTests))],
  ["holidaysOff", opt(bool)],
];

const fileTests = (ctx: Ctx): Test[] => [
  ["settings", shape(settingsTests)],
  ["activities", listOf(activityTests)],
  ["tasks", listOf(taskTests(ctx))],
  ["events", listOf(eventTests)],
  ["checkIns", listOf(checkInTests)],
  ["overrides", listOf(overrideTests)],
  ["plan", listOf(blockTests)],
  ["proposals", listOf(proposalTests)],
  ["pins", opt(listOf(blockTests))],
  ["places", opt(listOf(placeTests))],
  ["travelTimes", opt(listOf(travelTests))],
  ["spots", opt(listOf(spotTests))],
  ["preferences", nullable(shape(preferencesTests))],
];

/** Whether the data has the shape the app reads (what `backupProblems` did not already refuse by name). */
export function shapeOk(d: Rec, now: number): boolean {
  const routineIds = new Set(
    (Array.isArray(d.activities) ? d.activities : [])
      .filter((a) => isRec(a) && a.kind === "rutina")
      .map((a) => (a as Rec).id),
  );
  return allOf(d, fileTests({ now, routineIds }));
}

/** The day of the week that is the only thing wrong (says which), or null. */
export function weekProblem(week: unknown): string | null {
  const days = Array.isArray(week) ? week : [];
  const timesOk = shape(dayTests.slice(0, 3));
  const at = days.findIndex((w) => timesOk(w) && dayProblem(w as Rec, 0) !== null);
  return at >= 0 ? dayProblem(days.at(at) as Rec, at) : null;
}
