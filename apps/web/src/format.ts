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

export function hours(minutes: number): string {
  if (minutes <= 0) return "0h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

export function hhmmToMinutes(v: string): number {
  const [h, m] = v.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToHhmm(v: number): string {
  const n = ((v % 1440) + 1440) % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}
