// Uruguay's public holidays (Ley 16.805 and 17.414), computed for any year.
import { addDays, type DayOverride, localParts } from "./engine.js";

export interface Holiday {
  date: string;
  name: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/** Easter Sunday (anonymous Gregorian algorithm). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Movable holidays: Tuesday or Wednesday go to the Monday before, Thursday or Friday to the next. */
function moved(date: string): string {
  const w = weekday(date);
  if (w === 2 || w === 3) return addDays(date, -(w - 1));
  if (w === 4 || w === 5) return addDays(date, 8 - w);
  return date;
}

export function uruguayHolidays(year: number): Holiday[] {
  const e = easter(year);
  const list: Holiday[] = [
    { date: iso(year, 1, 1), name: "Año Nuevo" },
    { date: iso(year, 1, 6), name: "Día de Reyes" },
    { date: addDays(e, -48), name: "Carnaval" },
    { date: addDays(e, -47), name: "Carnaval" },
    ...[-6, -5, -4, -3, -2].map((d) => ({ date: addDays(e, d), name: "Semana de Turismo" })),
    { date: moved(iso(year, 4, 19)), name: "Desembarco de los 33 Orientales" },
    { date: iso(year, 5, 1), name: "Día de los Trabajadores" },
    { date: moved(iso(year, 5, 18)), name: "Batalla de Las Piedras" },
    { date: iso(year, 6, 19), name: "Natalicio de Artigas" },
    { date: iso(year, 7, 18), name: "Jura de la Constitución" },
    { date: iso(year, 8, 25), name: "Declaratoria de la Independencia" },
    { date: moved(iso(year, 10, 12)), name: "Día de la Diversidad Cultural" },
    { date: iso(year, 11, 2), name: "Día de los Difuntos" },
    { date: iso(year, 12, 25), name: "Navidad" },
  ];
  return list.sort((a, b) => a.date.localeCompare(b.date));
}

/** Holidays from `from` to `to` (inclusive local dates). */
export function holidaysBetween(from: string, to: string): Holiday[] {
  const years = new Set([Number(from.slice(0, 4)), Number(to.slice(0, 4))]);
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.add(y);
  return [...years]
    .sort()
    .flatMap(uruguayHolidays)
    .filter((h) => h.date >= from && h.date <= to);
}

/**
 * Day overrides with holidays planned as Sundays (later wake-up, earlier free time),
 * keeping the user's own wake/bed changes for those days.
 */
export function withHolidays(
  overrides: readonly DayOverride[],
  timeZone: string,
  from: number,
  to: number,
): DayOverride[] {
  const days = holidaysBetween(localParts(timeZone, from).date, localParts(timeZone, to).date);
  const byDate = new Map(overrides.map((o) => [o.date, o]));
  for (const h of days) byDate.set(h.date, { asWeekday: 0, ...byDate.get(h.date), date: h.date });
  return [...byDate.values()];
}
