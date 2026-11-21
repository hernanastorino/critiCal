// SPEC §15, interface: how to get to an event (car or bus), the request for the server,
// the steps the screen reads, and what is saved (place column, one-off choice, backup).
import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import { placeMode, planRequestFor, stepsOf, summaryOf, tripOf, unlocatedEnd } from "./busTrip.js";
import { diffData, rowsToData } from "./data.js";
import { demoData, emptyData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { reducer } from "./store.js";
import type { TransitOption } from "./transit.js";

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-23", 8 * 60);

const casa: Place = {
  id: "casa",
  name: "Casa",
  aliases: [],
  isHome: true,
  lat: -34.9,
  lon: -56.16,
};
const facu: Place = {
  id: "facu",
  name: "Facultad de Ingeniería",
  aliases: ["FING"],
  lat: -34.918,
  lon: -56.166,
  travelMode: "bus",
};
const gym: Place = { id: "gym", name: "Gym", aliases: [], lat: -34.9, lon: -56.2 };

const event = (id: string, title: string, date: string, location?: string): AppEvent => ({
  id,
  title,
  start: zonedInstant(tz, date, 9 * 60),
  end: zonedInstant(tz, date, 10 * 60),
  busy: true,
  location,
  source: "google",
});

/** The value, or a failure: for what a test has just arranged to exist. */
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("expected a value");
  return v;
}

const base = (extra: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  places: [casa, facu, gym],
  events: [
    event("e1", "Cálculo", "2026-11-24", "FING"),
    event("e2", "Gimnasio", "2026-11-24", "Gym"),
  ],
  ...extra,
});

describe("el modo de cada traslado", () => {
  it("sale del lugar: auto salvo que el lugar diga ómnibus", () => {
    expect(placeMode(facu)).toBe("bus");
    expect(placeMode(gym)).toBe("car");
    expect(placeMode(undefined)).toBe("car");
    const d = base();
    expect(tripOf(d, must(d.events[0]))?.mode).toBe("bus");
    expect(tripOf(d, must(d.events[1]))?.mode).toBe("car");
  });

  it("elegirlo en el evento vale solo para ese evento", () => {
    let d = base();
    d = reducer(d, { type: "tripMode", eventId: "e1", mode: "car", now: NOW });
    expect(tripOf(d, must(d.events[0]))).toMatchObject({ mode: "car", once: true });
    expect(tripOf(d, must(d.events[1]))).toMatchObject({ mode: "car", once: false });
    d = reducer(d, { type: "tripMode", eventId: "e1", mode: null, now: NOW });
    expect(d.tripModes).toBeUndefined();
    expect(tripOf(d, must(d.events[0]))).toMatchObject({ mode: "bus", once: false });
  });

  it("no guarda el modo de un evento que no existe", () => {
    const d = base();
    expect(reducer(d, { type: "tripMode", eventId: "nope", mode: "bus", now: NOW })).toBe(d);
  });

  it("no hay traslado sin casa, sin lugar o hacia la casa misma", () => {
    const d = base();
    const e = must(d.events[0]);
    expect(tripOf({ ...d, places: [{ ...casa, isHome: false }, facu] }, e)).toBeUndefined();
    expect(tripOf(d, event("x", "Algo", "2026-11-24", "Plaza Independencia"))).toBeUndefined();
    expect(tripOf(d, event("y", "Casa", "2026-11-24", "Casa"))).toBeUndefined();
  });
});

describe("el pedido al servidor", () => {
  const d = base();
  const trip = must(tripOf(d, must(d.events[0])));

  it("llegar a la hora del evento, de casa al lugar", () => {
    const req = planRequestFor(trip, must(d.events[0]), tz);
    expect(req).toEqual({
      action: "plan",
      from: { lat: -34.9, lon: -56.16 },
      to: { lat: -34.918, lon: -56.166 },
      date: "2026-11-24",
      time: "09:00",
      mode: "arrive",
      dayType: 1,
    });
  });

  it("un feriado y un domingo corren con el horario de domingo; el sábado, el suyo", () => {
    const on = (date: string) => planRequestFor(trip, event("h", "Cálculo", date, "FING"), tz);
    expect(on("2026-12-25")?.dayType).toBe(3); // Navidad (viernes)
    expect(on("2026-11-29")?.dayType).toBe(3); // domingo
    expect(on("2026-11-28")?.dayType).toBe(2); // sábado
  });

  it("sin coordenadas o fuera de la zona no se pide", () => {
    const e = must(d.events[0]);
    const sinCasa = tripOf({ ...d, places: [{ ...casa, lat: undefined }, facu] }, e);
    expect(unlocatedEnd(must(sinCasa))).toBe("from");
    const sinLugar = tripOf({ ...d, places: [casa, { ...facu, lon: undefined }] }, e);
    expect(unlocatedEnd(must(sinLugar))).toBe("to");
    const lejos = tripOf({ ...d, places: [casa, { ...facu, lat: -34.6, lon: -58.4 }] }, e);
    expect(unlocatedEnd(must(lejos))).toBe("area");
    expect(planRequestFor(must(lejos), e, tz)).toBeNull();
  });
});

describe("lo que se lee en pantalla", () => {
  const stop = (id: string, name: string) => ({ id, name, lat: -34.9, lon: -56.1 });
  const option: TransitOption = {
    leaveMin: 8 * 60 + 10,
    arriveMin: 8 * 60 + 52,
    totalMinutes: 42,
    walkMinutes: 8,
    waitMinutes: 2,
    rideMinutes: 32,
    transfers: 0,
    theoretical: true,
    legs: [
      {
        kind: "walk",
        minutes: 3.4,
        meters: 250,
        source: "estimate",
        to: stop("s1", "Rivera y Ellauri"),
      },
      {
        kind: "bus",
        line: "128",
        headsign: "Ciudad Vieja",
        company: null,
        source: "stm",
        board: stop("s1", "Rivera y Ellauri"),
        alight: stop("s2", "Julio Herrera y Reissig"),
        boardMin: 8 * 60 + 15,
        alightMin: 8 * 60 + 47,
        stops: 20,
        waitMinutes: 0,
        theoretical: true,
      },
      {
        kind: "walk",
        minutes: 5,
        meters: 380,
        source: "route",
        from: stop("s2", "Julio Herrera y Reissig"),
      },
    ],
  };

  it("línea, parada y hora de pasada", () => {
    const steps = stepsOf(option);
    expect(steps.map((s) => s.text)).toEqual([
      "Caminá 3 min hasta Rivera y Ellauri",
      "Línea 128 a Ciudad Vieja · parada Rivera y Ellauri a las 08:15",
      "Caminá 5 min desde Julio Herrera y Reissig",
    ]);
    expect(steps[1]?.bus?.alight.name).toBe("Julio Herrera y Reissig");
    expect(summaryOf(option)).toBe("Salí a las 08:10 · llegás a las 08:52 (42 min)");
  });
});

describe("lo que se guarda", () => {
  it("el modo de un lugar va a la columna travel_mode y vuelve", () => {
    const w = diffData(base({ places: [casa] }), base({ places: [casa, facu, gym] }));
    const rows = w.upserts.find((u) => u.table === "places")?.rows as Record<string, unknown>[];
    expect(rows.map((r) => [r.id, r.travel_mode])).toEqual([
      ["facu", "bus"],
      ["gym", "car"],
    ]);
    const back = rowsToData({
      settings: null,
      activities: [],
      tasks: [],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
      places: [
        { id: "facu", name: "Facu", aliases: [], travel_mode: "bus" },
        { id: "gym", name: "Gym", aliases: [], travel_mode: "car" },
      ],
    });
    expect(back.places?.map((p) => p.travelMode)).toEqual(["bus", undefined]);
  });

  it("la elección de un evento va en el estado de los ajustes", () => {
    const a = base();
    const b = reducer(a, { type: "tripMode", eventId: "e2", mode: "bus", now: NOW });
    const w = diffData(a, b);
    const row = w.upserts.find((u) => u.table === "settings")?.rows[0] as {
      state: { tripModes: unknown };
    };
    expect(row.state.tripModes).toEqual({ e2: "bus" });
  });

  it("el respaldo los conserva y descarta lo inválido", () => {
    const d = base({ tripModes: { e1: "car" } });
    const ok = parseBackup(exportJson(d, NOW));
    expect("data" in ok && ok.data.tripModes).toEqual({ e1: "car" });
    expect("data" in ok && ok.data.places?.find((p) => p.id === "facu")?.travelMode).toBe("bus");

    const file = (data: unknown) =>
      JSON.stringify({ app: "critiCal", version: 2, exportedAt: NOW, data });
    const plain = JSON.parse(JSON.stringify(demoData(NOW)));
    const mixed = parseBackup(file({ ...plain, tripModes: { a: "bus", b: "tren" } }));
    expect("data" in mixed && mixed.data.tripModes).toEqual({ a: "bus" });
    const bad = parseBackup(
      file({ ...plain, places: [{ id: "p", name: "X", aliases: [], travelMode: "tren" }] }),
    );
    expect("error" in bad).toBe(true);
  });
});
