import type { MinuteRange, ValidHours } from "./engine.js";
import { minutesToHhmm, parseClock } from "./format.js";

/** What is typed for one franja: «Desde» and «Hasta», each empty or a clock («7», «19:30»). */
export interface HoursField {
  from: string;
  to: string;
  /** «No ese día»: the routine does not go on this day (only for a day of its own). */
  off?: boolean;
}

/** The form of a routine's valid hours: one franja for every day, and optional days of their own. */
export interface HoursForm {
  all: HoursField;
  /** «Distinto según el día»: the days below replace the franja of every day. */
  perDay: boolean;
  /** Indexed by weekday, 0 = Sunday … 6 = Saturday. */
  days: HoursField[];
}

const EMPTY: HoursField = { from: "", to: "" };

export const emptyHoursForm = (): HoursForm => ({
  all: { ...EMPTY },
  perDay: false,
  days: Array.from({ length: 7 }, () => ({ ...EMPTY })),
});

/** Monday first, the way the week is read (weekday numbers: 0 = Sunday). */
export const HOURS_DAYS: { weekday: number; name: string; short: string }[] = [
  { weekday: 1, name: "lunes", short: "Lun" },
  { weekday: 2, name: "martes", short: "Mar" },
  { weekday: 3, name: "miércoles", short: "Mié" },
  { weekday: 4, name: "jueves", short: "Jue" },
  { weekday: 5, name: "viernes", short: "Vie" },
  { weekday: 6, name: "sábado", short: "Sáb" },
  { weekday: 0, name: "domingo", short: "Dom" },
];

const blank = (v: string) => v.trim() === "";
const isEmpty = (f: HoursField) => blank(f.from) && blank(f.to);

export interface HoursProblem {
  /** The field it is about: `all-from`, `all-to`, `day-3-from`… */
  field: string;
  text: string;
}

/** A clock typed in a side of a franja: empty is the start (0) or the end (1440) of the day. */
const clockOf = (v: string, empty: number) => (blank(v) ? empty : parseClock(v));

/** The grid the engine places blocks on (`Settings.slotMinutes`, 30 in the app). */
export const GRID_MINUTES = 30;

/** The part of a franja the engine can use: whole slots of the grid inside it (null: none). */
export function gridPart(r: MinuteRange, slot = GRID_MINUTES): MinuteRange | null {
  const start = Math.ceil(r.start / slot) * slot;
  const end = Math.floor(r.end / slot) * slot;
  return end > start ? { start, end } : null;
}

/** What a session takes on the grid: whole slots, as the engine counts them. */
const sessionOnGrid = (sessionMinutes: number, slot: number) =>
  Math.max(1, Math.round(sessionMinutes / slot)) * slot;

/** Whether a franja has room for a session once cut to the grid (the engine's own count). */
export const franjaHolds = (r: MinuteRange, sessionMinutes: number, slot = GRID_MINUTES) => {
  const part = gridPart(r, slot);
  return !!part && part.end - part.start >= sessionOnGrid(sessionMinutes, slot);
};

/** What is wrong with a range of minutes (the side it is about and what to say), or null. */
function rangeProblem(from: number, to: number, sessionMinutes: number | undefined, slot: number) {
  if (from >= to) return { side: "from", text: "«Desde» tiene que ser antes de «Hasta»." };
  if (sessionMinutes === undefined) return null;
  const range = { start: from, end: to };
  if (to - from < sessionMinutes)
    return { side: "to", text: `la franja es más corta que una sesión (${sessionMinutes} min).` };
  if (franjaHolds(range, sessionMinutes, slot)) return null;
  const part = gridPart(range, slot);
  const fits = part
    ? `solo entra ${clock(part.start)}–${clock(part.end)}`
    : "no entra ningún bloque";
  return {
    side: "to",
    text: `con la grilla de ${slot} min, de ${clock(from)} a ${clock(to)} ${fits}: ampliá la franja.`,
  };
}

/**
 * A franja as typed: nothing (no limit), or a range. An empty «Desde» is from the start of
 * the day and an empty «Hasta» up to its end, so «a más tardar a las 19» is just «Hasta».
 */
function readField(
  f: HoursField,
  key: string,
  who: string,
  sessionMinutes: number | undefined,
  slot: number,
): { range: MinuteRange | null; problems: HoursProblem[] } {
  if (isEmpty(f)) return { range: null, problems: [] };
  const from = clockOf(f.from, 0);
  const to = clockOf(f.to, 1440);
  const problems: HoursProblem[] = [];
  const say = (side: string, text: string) =>
    problems.push({ field: `${key}-${side}`, text: `${who}${text}` });
  if (from === null) say("from", "la hora «Desde» no es válida (por ejemplo 7 o 07:30).");
  if (to === null) say("to", "la hora «Hasta» no es válida (por ejemplo 19 o 19:30).");
  const wrong = from === null || to === null ? null : rangeProblem(from, to, sessionMinutes, slot);
  if (wrong) say(wrong.side, wrong.text);
  if (from === null || to === null || problems.length) return { range: null, problems };
  return { range: { start: from, end: to }, problems };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The valid hours a form says (undefined: no limit) and what is wrong with it, field by
 * field. `sessionMinutes` is the routine's session, when known: a franja that, cut to the
 * grid, is shorter than it could never hold one.
 */
export function readHours(
  form: HoursForm,
  sessionMinutes?: number,
  slot = GRID_MINUTES,
): { hours: ValidHours | undefined; problems: HoursProblem[] } {
  const all = readField(form.all, "all", "", sessionMinutes, slot);
  const problems = [...all.problems.map((p) => ({ ...p, text: cap(p.text) }))];
  const days: Partial<Record<number, MinuteRange | null>> = {};
  if (form.perDay) {
    for (const d of HOURS_DAYS) {
      const f = form.days[d.weekday] ?? EMPTY;
      if (f.off) {
        days[d.weekday] = null;
        continue;
      }
      const read = readField(f, `day-${d.weekday}`, `El ${d.name}: `, sessionMinutes, slot);
      problems.push(...read.problems.map((p) => ({ ...p, text: cap(p.text) })));
      if (read.range) days[d.weekday] = read.range;
    }
  }
  // Every day «No»: the routine would never go.
  if (form.perDay && HOURS_DAYS.every((d) => form.days[d.weekday]?.off))
    problems.push({
      field: "days-off",
      text: "Marcaste «No» todos los días: la rutina no iría nunca. Dejá al menos un día.",
    });
  if (problems.length) return { hours: undefined, problems };
  const hasDays = Object.keys(days).length > 0;
  if (!all.range && !hasDays) return { hours: undefined, problems };
  return {
    hours: {
      ...(all.range && { all: all.range }),
      ...(hasDays && { days }),
    },
    problems,
  };
}

const clock = (m: number) => (m === 1440 ? "24:00" : minutesToHhmm(m));
const text = (r: MinuteRange): HoursField => ({
  from: r.start === 0 ? "" : clock(r.start),
  to: r.end === 1440 ? "" : clock(r.end),
});

/** The form that edits `hours` (the one for no limit when there are none). */
export function formOfHours(hours: ValidHours | undefined): HoursForm {
  const form = emptyHoursForm();
  if (!hours) return form;
  if (hours.all) form.all = text(hours.all);
  for (const [weekday, range] of Object.entries(hours.days ?? {})) {
    if (range === null) form.days[Number(weekday)] = { ...EMPTY, off: true };
    else if (range) form.days[Number(weekday)] = text(range);
  }
  form.perDay = Object.keys(hours.days ?? {}).length > 0;
  return form;
}

const span = (r: MinuteRange) =>
  r.start === 0
    ? `hasta las ${clock(r.end)}`
    : r.end === 1440
      ? `desde las ${clock(r.start)}`
      : `${clock(r.start)} a ${clock(r.end)}`;

/**
 * A franja in words, for the routine's row: «17:00 a 19:00», «hasta las 19:00», and the days
 * it does not go: «17:00 a 19:00 · no el domingo».
 */
export function describeHours(hours: ValidHours | undefined): string {
  if (!hours) return "";
  const entries = Object.entries(hours.days ?? {});
  const days = entries.filter(([, r]) => r).length;
  const off = HOURS_DAYS.filter((d) => hours.days?.[d.weekday] === null).map((d) => `el ${d.name}`);
  const all = hours.all ? span(hours.all) : "";
  const ranged =
    days === 0
      ? all
      : all
        ? `${all} (${days === 1 ? "con 1 día distinto" : `con ${days} días distintos`})`
        : "según el día";
  const not = off.length > 0 ? `no ${off.join(" ni ")}` : "";
  return [ranged, not].filter(Boolean).join(" · ");
}

/** Whether every day's franja is too short for a session on the grid (a day with none is unlimited). */
export function hoursTooShort(
  hours: ValidHours | undefined,
  sessionMinutes: number,
  slot = GRID_MINUTES,
): boolean {
  if (!hours) return false;
  const own = new Map(Object.entries(hours.days ?? {}));
  return [0, 1, 2, 3, 4, 5, 6].every((w) => {
    const day = own.get(String(w));
    // «No ese día» holds no session either.
    if (day === null) return true;
    const r = day ?? hours.all;
    return !!r && !franjaHolds(r, sessionMinutes, slot);
  });
}

/** Whether every franja of the hours (the form's own rule) has room for a session on the grid. */
export function hoursHold(hours: ValidHours, sessionMinutes: number, slot = GRID_MINUTES): boolean {
  const ranges = [hours.all, ...Object.values(hours.days ?? {})];
  return ranges.every((r) => !r || franjaHolds(r, sessionMinutes, slot));
}

/** The days of the week a routine can go: a day that is not off and whose franja holds a session. */
export function daysAllowed(
  hours: ValidHours | undefined,
  sessionMinutes: number,
  slot = GRID_MINUTES,
): number {
  const own = new Map(Object.entries(hours?.days ?? {}));
  return [0, 1, 2, 3, 4, 5, 6].filter((w) => {
    const day = own.get(String(w));
    if (day === null) return false;
    const r = day ?? hours?.all;
    return !r || franjaHolds(r, sessionMinutes, slot);
  }).length;
}
