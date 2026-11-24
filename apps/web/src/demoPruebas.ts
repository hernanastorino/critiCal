import { defaultSettings, demoData, TIMEZONE } from "./demo.js";
import { addDays, localParts, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, AppTask, MealRun } from "./model.js";
import { PALETTE } from "./model.js";
import { weekStart } from "./planning.js";

/** Which demo this device is in: the plain one or the one armed to try every case. */
export const DEMO_KIND_KEY = "critical.demoKind";
export type DemoKind = "ejemplo" | "pruebas";

export const demoKind = (): DemoKind => {
  try {
    return globalThis.localStorage?.getItem(DEMO_KIND_KEY) === "pruebas" ? "pruebas" : "ejemplo";
  } catch {
    return "ejemplo";
  }
};
export const isTestDemo = () => demoKind() === "pruebas";
export const setDemoKind = (kind: DemoKind) => {
  try {
    if (kind === "pruebas") globalThis.localStorage?.setItem(DEMO_KIND_KEY, kind);
    else globalThis.localStorage?.removeItem(DEMO_KIND_KEY);
  } catch {
    // Blocked storage: the demo is the plain one.
  }
};

/**
 * «Demo de pruebas»: no account, nothing leaves the device. Armed so that each case of
 * the checklist in docs/OPERATIONS.md shows up on its own (see «Qué probar en la demo de
 * pruebas»): every Bandeja card, a trip by bus, routines with different days, meals of
 * days already over, a parcial and entregas next week, a home with an address and a
 * place without one, and today's blocks waiting for Hecho / Parcial / No.
 */
export function pruebasData(now: number): AppData {
  const tz = TIMEZONE;
  const base = demoData(now);
  const monday = weekStart(tz, now);
  const today = localParts(tz, now).date;
  const nextMonday = addDays(monday, 7);
  const at = (date: string, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number) as [number, number];
    return zonedInstant(tz, date, h * 60 + m);
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
    start: at(addDays(monday, day), from),
    end: at(addDays(monday, day), to),
    busy: true,
    source: "demo",
    ...extra,
  });

  const activities = base.activities.map((a) => {
    if (a.id === "gym") {
      return {
        ...a,
        // «Distinto según el día»: 9–17 on weekdays, Wednesday evening, never the weekend.
        validHours: {
          all: { start: 9 * 60, end: 17 * 60 },
          days: { 3: { start: 17 * 60, end: 20 * 60 }, 6: null, 0: null },
        },
      };
    }
    return { ...a, kind: "materia" as const };
  });
  activities.push({
    id: "sd",
    name: "Sistemas Distribuidos",
    color: PALETTE[5],
    academic: true,
    kind: "materia",
    aliases: ["sdist"],
    maxSessionMinutes: 120,
    minBlockMinutes: 60,
  });

  const nextTasks: AppTask[] = [
    // Next week (Planificación semanal): a parcial with weighted parts and two entregas.
    {
      id: "parcial-fis",
      activityId: "fis",
      title: "Parcial Física I",
      kind: "deliverable",
      exam: true,
      dayBeforeOnly: true,
      deadline: at(addDays(nextMonday, 3), "09:00"),
      estimateMinutes: 600,
      minMinutes: 360,
      priority: 3,
      status: "active",
      units: [
        { id: "pf1", title: "Cinemática", estimateMinutes: 120, weight: 25 },
        { id: "pf2", title: "Dinámica", estimateMinutes: 180, weight: 35 },
        { id: "pf3", title: "Energía", estimateMinutes: 180, weight: 25 },
        { id: "pf4", title: "Parciales anteriores", estimateMinutes: 120, weight: 15 },
      ],
    },
    {
      id: "entrega-sd",
      activityId: "sd",
      title: "Entrega Sistemas Distribuidos",
      kind: "deliverable",
      deadline: at(addDays(nextMonday, 4), "23:59"),
      estimateMinutes: 420,
      minMinutes: 240,
      priority: 2,
      status: "active",
      units: [],
    },
    {
      id: "entrega-prog",
      activityId: "prog",
      title: "Entrega Programación 2",
      kind: "deliverable",
      deadline: at(addDays(nextMonday, 5), "23:59"),
      estimateMinutes: 360,
      minMinutes: 240,
      priority: 2,
      status: "active",
      units: [],
    },
    // «Empezar antes»: it may start only on its deadline's day, which is too late.
    {
      id: "entrega-corta",
      activityId: "sd",
      title: "Informe corto SD",
      kind: "deliverable",
      deadline: at(addDays(today, 3), "23:59"),
      startAfter: { date: addDays(today, 3) },
      estimateMinutes: 600,
      minMinutes: 540,
      priority: 3,
      status: "active",
      units: [],
    },
    // Waits in the inbox to be assigned (made by itself from a calendar event).
    {
      id: "parcial-nuevo",
      activityId: "sd",
      title: "Parcial SD (del calendario)",
      kind: "deliverable",
      exam: true,
      deadline: at(addDays(nextMonday, 8), "18:00"),
      estimateMinutes: 300,
      minMinutes: 180,
      priority: 2,
      status: "active",
      needsReview: true,
      sourceEventId: "google:parcial-sd",
      units: [],
    },
  ];
  // Lighter than the plain demo, so the only thing that does not fit is the one armed to.
  const tasks = base.tasks.filter((t) => t.id !== "tp-prog");

  const events: AppEvent[] = [
    ...base.events.filter((e) => e.id !== "familia"),
    // Far away, by car: an address of its own with minutes already known.
    event("evento-gran", "evento gran", 2, "13:00", "14:00", { location: "Atlántida 1213 Bis" }),
    event("familia", "Almuerzo en lo de la abuela", 6, "12:30", "15:30", {
      location: "Casa de la abuela Marta",
    }),
    // A place nobody knows: the inbox asks how long it takes from home.
    event("reunion", "Reunión de grupo", 1, "18:00", "19:00", { location: "Parque Rodó" }),
    event("estudio-fran", "Estudiar en lo de Fran", 4, "15:00", "17:00", {
      location: "Casa Fran",
    }),
  ];

  // By bus (SPEC §15), always ahead of today so the trip card can be tried any day: one with
  // plans (invented ones: demoTransit.ts) and one in a place the bus does not reach, whose
  // plan keeps the car's minutes with a notice.
  const ahead = (
    id: string,
    title: string,
    day: number,
    from: string,
    to: string,
    place: string,
  ) => ({
    id,
    title,
    start: at(addDays(today, day), from),
    end: at(addDays(today, day), to),
    busy: true,
    source: "demo" as const,
    location: place,
  });
  events.push(
    ahead("clase-fing", "Clase en la Facultad", 1, "14:00", "16:00", "Facultad"),
    ahead("taller-cerro", "Taller en el Cerro", 2, "10:00", "11:30", "Club del Cerro"),
  );

  // Meals of days already over: until two weeks ago lunch and dinner were earlier. Changing
  // the hours in Ajustes must not touch them.
  const runs: MealRun[] = [];
  const since = addDays(today, -45);
  const changed = addDays(today, -14);
  for (let weekday = 0; weekday < 7; weekday++) {
    for (const m of defaultSettings.week[weekday]?.meals ?? []) {
      if (!m.kind) continue;
      const early = m.kind === "almuerzo" ? 12 * 60 + 30 : m.kind === "cena" ? 20 * 60 + 30 : null;
      if (early !== null) {
        runs.push({
          meal: m.kind,
          weekday,
          from: since,
          to: addDays(changed, -1),
          start: early,
          end: early + (m.end - m.start),
        });
      }
      runs.push({
        meal: m.kind,
        weekday,
        from: early !== null ? changed : since,
        start: m.start,
        end: m.end,
      });
    }
  }

  return {
    ...base,
    activities,
    tasks: [...tasks, ...nextTasks],
    events,
    places: [
      {
        id: "casa",
        name: "Casa",
        aliases: [],
        address: "Av. 18 de Julio 1234, Montevideo",
        lat: -34.9055,
        lon: -56.1905,
        isHome: true,
      },
      {
        id: "fing",
        name: "Facultad",
        aliases: ["FING", "Facultad de Ingeniería"],
        address: "Julio Herrera y Reissig 565, Montevideo",
        lat: -34.918,
        lon: -56.166,
        travelMode: "bus",
      },
      // By bus too, but the demo has no schedules there: the plan keeps the car's minutes.
      {
        id: "cerro",
        name: "Club del Cerro",
        aliases: [],
        address: "Grecia 4100, Montevideo",
        lat: -34.89,
        lon: -56.26,
        travelMode: "bus",
      },
      // With an address the minutes can be worked out; without it they are typed.
      {
        id: "fran",
        name: "Casa Fran",
        aliases: ["juntada patas?"],
        address: "Bulevar Artigas 1500, Montevideo",
      },
      // A long address: the one line cuts it.
      {
        id: "club",
        name: "Club Remeros",
        aliases: ["piscinada"],
        address:
          "Avenida Doctor Luis Alberto de Herrera 3365, Barrio Parque Batlle, Montevideo, Uruguay",
      },
      { id: "abuela", name: "Casa de la abuela Marta", aliases: [] },
    ],
    spots: [{ key: "atlantida 1213 bis", text: "Atlántida 1213 Bis", minutes: 55 }],
    mealRuns: runs,
    mealsFrozenThrough: addDays(today, -1),
    preferences: { semester: { start: addDays(today, -100), end: addDays(today, 20) } },
  };
}
