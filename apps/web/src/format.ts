const cache = new Map<string, Intl.DateTimeFormat>();

function fmt(tz: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = tz + JSON.stringify(opts);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("es-UY", { timeZone: tz, ...opts });
    cache.set(key, f);
  }
  return f;
}

export const time = (tz: string, t: number) =>
  fmt(tz, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(t);

export const weekdayShort = (tz: string, t: number) =>
  fmt(tz, { weekday: "short" }).format(t).replace(".", "").slice(0, 3);

/** "viernes" */
export const weekdayLong = (tz: string, t: number) => fmt(tz, { weekday: "long" }).format(t);

/** "vie 22/10" */
export const dayDate = (tz: string, t: number) => {
  const p = fmt(tz, { day: "numeric", month: "numeric" }).formatToParts(t);
  const day = p.find((x) => x.type === "day")?.value;
  const month = p.find((x) => x.type === "month")?.value;
  return `${weekdayShort(tz, t)} ${day}/${month}`;
};

/** "vie 22/10 08:00" */
export const dayAndTime = (tz: string, t: number) => `${dayDate(tz, t)} ${time(tz, t)}`;

/** "dom 10/8 10:00", or "dom 10/8/2025 10:00" when it is not this year (`now`'s). */
export function dueDate(tz: string, t: number, now: number) {
  const year = (x: number) => fmt(tz, { year: "numeric" }).format(x);
  return year(t) === year(now) ? dayAndTime(tz, t) : `${dayDate(tz, t)}/${year(t)} ${time(tz, t)}`;
}

export const dayMonth = (tz: string, t: number) =>
  fmt(tz, { day: "numeric", month: "short" }).format(t).replace(".", "");

/** "2 – 8 nov", or "27 oct – 2 nov" when the range crosses a month. */
export const dayRange = (tz: string, from: number, to: number) => {
  const start = dayMonth(tz, from);
  const end = dayMonth(tz, to);
  const month = (s: string) => s.slice(s.indexOf(" ") + 1);
  return month(start) === month(end)
    ? `${start.slice(0, start.indexOf(" "))} – ${end}`
    : `${start} – ${end}`;
};

export function hours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** A time of day as a time field writes it: «07:30», never «25:99» or «abc». */
export const isHhmm = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/**
 * A time of day as typed, in minutes since midnight, or null when it is not one: «7»,
 * «7:5» and «07:30» are read the same everywhere; «25:99», «» and «abc» are not times.
 */
export function parseClock(v: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{1,2}))?\s*$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

export function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHhmm(v: number): string {
  const n = ((v % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

/** A name the user typed, cut for a notice: a huge one would fill half the screen. */
export const clipName = (s: string, max = 40) => {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
};
