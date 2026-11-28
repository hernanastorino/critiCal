import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EventTrip } from "./components/EventTrip.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { localParts, zonedInstant } from "./engine.js";
import { inboxRows } from "./inbox.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { earlyTrips, earlyTripText, wakingDay } from "./planning.js";
import { StoreProvider } from "./store.js";

// 47.ª vuelta, punto 7: un traslado que empieza antes de levantarse se dice, sin mover la hora.
const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const MOMENTS = [
  ["fecha fija", "2026-11-23"],
  ["fecha real", real],
] as const;

afterEach(cleanup);

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

describe.each(MOMENTS)("7. traslado antes de levantarse: %s", (_n, date) => {
  const now = zonedInstant(TIMEZONE, date, 10 * 60);
  // The next day, whatever weekday it is: the class starts half an hour after waking up.
  const tomorrow = localParts(TIMEZONE, now + 30 * 3_600_000).date;
  const world = (busMinutes: number): { data: AppData; clase: AppEvent; wake: number } => {
    const base: AppData = { ...emptyData(), places: [casa, facu] };
    const wake = wakingDay(base, now, tomorrow).wake;
    const clase: AppEvent = {
      id: "clase",
      title: "Cálculo",
      start: zonedInstant(TIMEZONE, tomorrow, wake + 30),
      end: zonedInstant(TIMEZONE, tomorrow, wake + 120),
      busy: true,
      location: "FING",
      source: "google",
    };
    const data: AppData = {
      ...base,
      events: [clase],
      tripMinutes: { clase: { minutes: busMinutes, back: 20, start: clase.start } },
    };
    return { data, clase, wake };
  };
  const provide = (data: AppData, child: React.ReactNode) =>
    render(
      <ToastProvider>
        <StoreProvider initial={() => data} persist={false} fixedNow={now}>
          {child}
        </StoreProvider>
      </ToastProvider>,
    );

  it("un traslado largo que arranca antes de levantarse lo dice, y no cambia la hora de levantarse", () => {
    const { data, clase, wake } = world(60);
    const early = earlyTrips(data, now);
    expect(early.map((t) => t.event.id)).toEqual(["clase"]);
    const trip = early.at(0);
    if (!trip) throw new Error("falta el traslado");
    expect(trip.start).toBe(clase.start - (60 + data.settings.travelMarginMinutes) * 60_000);
    expect(earlyTripText(TIMEZONE, trip)).toMatch(
      /^Para llegar tenés que salir \d\d:\d\d, antes de levantarte$/,
    );
    expect(wakingDay(data, now, tomorrow).wake).toBe(wake);
    provide(data, <EventTrip event={clase} />);
    expect(screen.getByRole("note").textContent).toBe(earlyTripText(TIMEZONE, trip));
  });

  it("la Bandeja lo lista", () => {
    const { data, clase } = world(60);
    const row = inboxRows(data, now).find((r) => r.title.startsWith(clase.title));
    expect(row?.detail).toMatch(/^Traslado antes de levantarte · Para llegar tenés que salir /);
    provide(data, <Inbox />);
    expect(screen.getByText("Traslado antes de levantarte")).toBeTruthy();
    expect(screen.getAllByText(/Para llegar tenés que salir/).length).toBeGreaterThan(0);
  });

  it("un traslado corto, que entra despues de levantarse, no dice nada", () => {
    const { data, clase } = world(5);
    expect(earlyTrips(data, now)).toEqual([]);
    expect(inboxRows(data, now).some((r) => r.title.startsWith(clase.title))).toBe(false);
    provide(data, <EventTrip event={clase} />);
    expect(screen.queryByText(/antes de levantarte/)).toBeNull();
  });
});
