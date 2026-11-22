// @vitest-environment node
// SPEC §15: the way back as a trip of its own, and the regular routes (`bus_routes`).
import { describe, expect, it } from "vitest";
import { exportJson, parseBackup } from "./backup.js";
import {
  type BusRoute,
  findRoute,
  routeAnswer,
  routeRow,
  routeStale,
  slotOf,
} from "./busRoutes.js";
import { planRequestFor, tripOf, wayMinutes } from "./busTrip.js";
import { emptyData } from "./demo.js";
import { travelBuffers, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { busMinutes, travelOptions } from "./places.js";
import { reducer } from "./store.js";
import type { PlanOk, TransitOption } from "./transit.js";

const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-23", 8 * 60);
const MIN = 60_000;

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
  name: "Facultad",
  aliases: ["FING"],
  lat: -34.918,
  lon: -56.166,
  travelMode: "bus",
};
// Tuesday 24 November 2026, 9:00 to 10:00.
const clase: AppEvent = {
  id: "e1",
  title: "Cálculo",
  start: zonedInstant(tz, "2026-11-24", 9 * 60),
  end: zonedInstant(tz, "2026-11-24", 10 * 60),
  busy: true,
  location: "FING",
  source: "google",
};
const data = (): AppData => ({
  ...emptyData(),
  places: [casa, facu],
  events: [clase],
  travelTimes: [
    { from: "casa", to: "facu", minutes: 15, manual: true },
    { from: "facu", to: "casa", minutes: 15, manual: true },
  ],
});

const option = (leave: number, arrive: number): TransitOption => ({
  leaveMin: leave,
  arriveMin: arrive,
  totalMinutes: arrive - leave,
  walkMinutes: 5,
  waitMinutes: 3,
  rideMinutes: 20,
  transfers: 0,
  legs: [],
  theoretical: true,
});
const answer = (o: TransitOption): PlanOk => ({
  ok: true,
  options: [o],
  walkOnly: null,
  dayType: 1,
  maxTransfers: 1,
  raised: false,
  feed: { version: "stm:a", builtAt: "", validTo: "2026-12-31", sources: [] },
  attribution: "x",
});

function trip() {
  const t = tripOf(data(), clase);
  if (!t) throw new Error("expected a trip");
  return t;
}
function req(way: "there" | "back") {
  const r = planRequestFor(trip(), clase, tz, way);
  if (!r) throw new Error("expected a request");
  return r;
}

describe("la vuelta del ómnibus", () => {
  it("se pide del lugar a casa, saliendo cuando termina el evento", () => {
    const back = req("back");
    expect(back.mode).toBe("depart");
    expect(back.time).toBe("10:00");
    expect(back.from).toEqual({ lat: facu.lat, lon: facu.lon });
    expect(back.to).toEqual({ lat: casa.lat, lon: casa.lon });
    const there = req("there");
    expect(there.mode).toBe("arrive");
    expect(there.time).toBe("09:00");
  });

  it("la ida cuenta puerta a puerta; la vuelta, desde que termina el evento con la espera", () => {
    expect(wayMinutes(option(500, 540), "there", req("there"))).toBe(40);
    // Termina a las 10:00 (600): el ómnibus sale a las 10:12 y llega a las 10:45.
    expect(wayMinutes(option(612, 645), "back", req("back"))).toBe(45);
  });

  it("el plan reserva la vuelta propia, y sin ella la de la ida", () => {
    let d = reducer(data(), { type: "tripMinutes", eventId: "e1", minutes: 40, now: NOW });
    expect(busMinutes(d, clase, "back")).toBe(40);
    d = reducer(d, { type: "tripMinutes", eventId: "e1", minutes: 70, way: "back", now: NOW });
    expect(busMinutes(d, clase, "there")).toBe(40);
    expect(busMinutes(d, clase, "back")).toBe(70);
    const opts = travelOptions(d);
    if (!opts) throw new Error("expected options");
    const [there, back] = travelBuffers([clase], opts).busy;
    if (!there || !back) throw new Error("expected both trips");
    expect(clase.start - there.start).toBe((40 + d.settings.travelMarginMinutes) * MIN);
    expect(back.end - clase.end).toBe(70 * MIN);
  });

  it("si la vuelta responde antes que la ida, la ida vale lo mismo hasta que responda", () => {
    let d = reducer(data(), {
      type: "tripMinutes",
      eventId: "e1",
      minutes: 70,
      way: "back",
      now: NOW,
    });
    expect(d.tripMinutes?.e1).toEqual({ minutes: 70, start: clase.start, back: 70 });
    d = reducer(d, { type: "tripMinutes", eventId: "e1", minutes: 40, now: NOW });
    expect(d.tripMinutes?.e1).toEqual({ minutes: 40, start: clase.start, back: 70 });
    // Repetir lo mismo no cambia nada.
    expect(reducer(d, { type: "tripMinutes", eventId: "e1", minutes: 40, now: NOW })).toBe(d);
  });

  it("si el evento se mueve, ni la ida ni la vuelta valen", () => {
    const d = reducer(data(), {
      type: "tripMinutes",
      eventId: "e1",
      minutes: 70,
      way: "back",
      now: NOW,
    });
    const moved = { ...clase, start: clase.start + 3_600_000 };
    expect(busMinutes(d, moved, "back")).toBeUndefined();
  });

  it("el respaldo conserva la vuelta", () => {
    const d = reducer(data(), {
      type: "tripMinutes",
      eventId: "e1",
      minutes: 70,
      way: "back",
      now: NOW,
    });
    const ok = parseBackup(exportJson(d, NOW));
    expect("data" in ok && ok.data.tripMinutes?.e1?.back).toBe(70);
  });
});

describe("las rutas habituales", () => {
  const slot = () => {
    const s = slotOf(trip(), clase, tz, "there", req("there"));
    if (!s) throw new Error("expected a slot");
    return s;
  };
  const row = (extra: Partial<BusRoute> = {}): BusRoute => ({
    id: "r1",
    ...routeRow(slot(), option(500, 540), answer(option(500, 540)), 1),
    ...extra,
  });

  it("el hueco es el del día de la semana y la hora del evento", () => {
    expect(slot()).toEqual({
      from_place: "casa",
      to_place: "facu",
      weekday: 2,
      time_minutes: 540,
      mode: "arrive",
    });
    expect(slotOf(trip(), clase, tz, "back", req("back"))).toEqual({
      from_place: "facu",
      to_place: "casa",
      weekday: 2,
      time_minutes: 600,
      mode: "depart",
    });
  });

  it("se encuentra la ruta del hueco; una de todos los días también, la del día primero", () => {
    expect(findRoute([row()], slot())?.id).toBe("r1");
    expect(findRoute([row({ weekday: 3 })], slot())).toBeUndefined();
    expect(findRoute([row({ time_minutes: 541 })], slot())).toBeUndefined();
    expect(findRoute([row({ id: "todos", weekday: null }), row()], slot())?.id).toBe("r1");
    expect(findRoute([row({ id: "todos", weekday: null })], slot())?.id).toBe("todos");
  });

  it("vale mientras los horarios son los mismos y corre ese día", () => {
    const r = row();
    expect(routeStale(r, req("there"), "stm:a")).toBeNull();
    expect(routeStale(r, req("there"), "stm:b")).toBe("feed");
    // Sin poder preguntar (sin conexión) se confía en la ruta.
    expect(routeStale(r, req("there"), null)).toBeNull();
    expect(routeStale(r, { ...req("there"), dayType: 3 }, "stm:a")).toBe("day");
    expect(routeStale(r, { ...req("there"), date: "2027-01-05" }, "stm:a")).toBe("expired");
  });

  it("la ruta se muestra como una respuesta, con la opción guardada", () => {
    const shown = routeAnswer(row());
    expect(shown.options).toEqual([option(500, 540)]);
    expect(shown.feed.version).toBe("stm:a");
  });
});
