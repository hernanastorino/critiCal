import type { MinuteRange, ValidHours } from "./engine.js";
import { minutesToHhmm, parseClock } from "./format.js";

/** What is typed for one franja: «Desde» and «Hasta», each empty or a clock («7», «19:30»). */
export interface HoursField {
  from: string;
  to: string;
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

/** What is wrong with a range of minutes (the side it is about and what to say), or null. */
function rangeProblem(from: number, to: number, sessionMinutes: number | undefined) {
  if (from >= to) return { side: "from", text: "«Desde» tiene que ser antes de «Hasta»." };
  return sessionMinutes !== undefined && to - from < sessionMinutes
    ? { side: "to", text: `la franja es más corta que una sesión (${sessionMinutes} min).` }
    : null;
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
): { range: MinuteRange | null; problems: HoursProblem[] } {
  if (isEmpty(f)) return { range: null, problems: [] };
  const from = clockOf(f.from, 0);
  const to = clockOf(f.to, 1440);
  const problems: HoursProblem[] = [];
  const say = (side: string, text: string) =>
    problems.push({ field: `${key}-${side}`, text: `${who}${text}` });
  if (from === null) say("from", "la hora «Desde» no es válida (por ejemplo 7 o 07:30).");
  if (to === null) say("to", "la hora «Hasta» no es válida (por ejemplo 19 o 19:30).");
  const wrong = from === null || to === null ? null : rangeProblem(from, to, sessionMinutes);
  if (wrong) say(wrong.side, wrong.text);
  if (from === null || to === null || problems.length) return { range: null, problems };
  return { range: { start: from, end: to }, problems };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The valid hours a form says (undefined: no limit) and what is wrong with it, field by
 * field. `sessionMinutes` is the routine's session, when known: a franja shorter than it
 * could never hold one.
 */
export function readHours(
  form: HoursForm,
  sessionMinutes?: number,
): { hours: ValidHours | undefined; problems: HoursProblem[] } {
  const all = readField(form.all, "all", "", sessionMinutes);
  const problems = [...all.problems.map((p) => ({ ...p, text: cap(p.text) }))];
  const days: Partial<Record<number, MinuteRange>> = {};
  if (form.perDay) {
    for (const d of HOURS_DAYS) {
      const f = form.days[d.weekday] ?? EMPTY;
      const read = readField(f, `day-${d.weekday}`, `El ${d.name}: `, sessionMinutes);
      problems.push(...read.problems.map((p) => ({ ...p, text: cap(p.text) })));
      if (read.range) days[d.weekday] = read.range;
    }
  }
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
    if (range) form.days[Number(weekday)] = text(range);
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

/** A franja in words, for the routine's row: «17:00 a 19:00», or «hasta las 19:00». */
export function describeHours(hours: ValidHours | undefined): string {
  if (!hours) return "";
  const days = Object.keys(hours.days ?? {}).length;
  const all = hours.all ? span(hours.all) : "";
  if (days === 0) return all;
  return all
    ? `${all} (${days === 1 ? "con 1 día distinto" : `con ${days} días distintos`})`
    : "según el día";
}
