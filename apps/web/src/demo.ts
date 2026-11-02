import {
  addDays,
  type DaySettings,
  localParts,
  type Settings,
  zonedInstant,
} from "@critical/engine";
import type { AppData, AppEvent } from "./model";
import { PALETTE } from "./model";
import { weekStart } from "./planning";

export const TIMEZONE = "America/Montevideo";

const weekday: DaySettings = {
  wake: 7 * 60 + 30,
  bed: 0,
  meals: [
    { start: 13 * 60, end: 14 * 60 },
    { start: 21 * 60, end: 21 * 60 + 30 },
  ],
  freeFrom: 19 * 60 + 30,
};
const weekend: DaySettings = { ...weekday, wake: 9 * 60, freeFrom: 18 * 60 };

export const defaultSettings: Settings = {
  timezone: TIMEZONE,
  week: [weekend, weekday, weekday, weekday, weekday, weekday, weekend],
  slotMinutes: 30,
  travelMarginMinutes: 10,
  maxActivitiesPerDay: 2,
  warnSlackMinutes: 240,
};

export function emptyData(): AppData {
  return {
    settings: defaultSettings,
    activities: [],
    tasks: [],
    events: [],
    checkIns: [],
    overrides: [],
    plan: [],
    proposals: [],
  };
}

/** A believable week for trying the app without connecting anything. */
export function demoData(now: number): AppData {
  const tz = TIMEZONE;
  const monday = weekStart(tz, now);
  const today = localParts(tz, now).date;
  /** Deadlines are relative to today so the demo always has something tight. */
  const due = (days: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return zonedInstant(tz, addDays(today, days), h * 60 + m);
  };
  const at = (day: number, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return zonedInstant(tz, addDays(monday, day), h * 60 + m);
  };
  const event = (
    id: string,
    title: string,
    day: number,
    from: string,
    to: string,
    extra: Partial<AppEvent> = {},
  ): AppEvent => ({
    id,
    title,
    start: at(day, from),
    end: at(day, to),
    busy: true,
    source: "demo",
    ...extra,
  });

  const events: AppEvent[] = [];
  for (const d of [0, 2, 4])
    events.push(
      event(`calc-${d}`, "Cálculo II (clase)", d, "08:00", "10:00", { location: "Facultad" }),
    );
  for (const d of [1, 3])
    events.push(
      event(`fis-${d}`, "Física I (clase)", d, "09:00", "11:00", { location: "Facultad" }),
    );
  events.push(event("lab", "Laboratorio de Física", 3, "14:00", "17:00", { location: "Facultad" }));
  events.push(event("cumple", "Cumple de Sofi", 5, "21:00", "23:59"));
  events.push(event("familia", "Almuerzo en lo de la abuela", 6, "12:30", "15:30"));
  events.push(event("podcast", "Escuchar podcast", 2, "18:00", "18:30", { busy: false }));

  return {
    ...emptyData(),
    activities: [
      {
        id: "calc",
        name: "Cálculo II",
        color: PALETTE[0],
        academic: true,
        maxSessionMinutes: 120,
        minBlockMinutes: 60,
        preferred: { start: 8 * 60, end: 13 * 60 },
      },
      {
        id: "fis",
        name: "Física I",
        color: PALETTE[4],
        academic: true,
        maxSessionMinutes: 90,
        minBlockMinutes: 60,
      },
      {
        id: "prog",
        name: "Programación",
        color: PALETTE[6],
        academic: true,
        maxSessionMinutes: 150,
        minBlockMinutes: 60,
      },
      {
        id: "gym",
        name: "Gym",
        color: PALETTE[2],
        academic: false,
        maxSessionMinutes: 90,
        minBlockMinutes: 90,
        preferred: { start: 17 * 60, end: 21 * 60 },
      },
    ],
    tasks: [
      {
        id: "parcial-calc",
        activityId: "calc",
        title: "Parcial Cálculo II",
        kind: "deliverable",
        deadline: due(2, "08:00"),
        estimateMinutes: 780,
        minMinutes: 690,
        priority: 3,
        status: "active",
        units: [
          { id: "u1", title: "Práctico 4: integrales dobles", estimateMinutes: 180 },
          { id: "u2", title: "Práctico 5: cambio de variable", estimateMinutes: 180 },
          { id: "u3", title: "Parcial 2024", estimateMinutes: 120 },
          { id: "u4", title: "Parcial 2025", estimateMinutes: 120 },
        ],
      },
      {
        id: "informe-fis",
        activityId: "fis",
        title: "Informe Lab Física",
        kind: "deliverable",
        deadline: due(3, "23:59"),
        estimateMinutes: 300,
        minMinutes: 180,
        priority: 2,
        status: "active",
        units: [
          { id: "u5", title: "Procesar datos", estimateMinutes: 120 },
          { id: "u6", title: "Redactar", estimateMinutes: 120 },
          { id: "u7", title: "Gráficas", estimateMinutes: 60 },
        ],
      },
      {
        id: "tp-prog",
        activityId: "prog",
        title: "Entrega TP Programación",
        kind: "deliverable",
        deadline: due(6, "23:59"),
        estimateMinutes: 480,
        minMinutes: 300,
        priority: 2,
        status: "active",
        units: [],
      },
      {
        id: "gym",
        activityId: "gym",
        title: "Gym",
        kind: "habit",
        estimateMinutes: 270,
        minMinutes: 180,
        sessionsPerWeek: 3,
        sessionMinutes: 90,
        priority: 1,
        status: "active",
        units: [],
      },
    ],
    events,
  };
}
