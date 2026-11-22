// SPEC §15: the card asks for the way there and the way back, and uses or keeps the
// regular route (the network and the database are replaced).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RouteRow } from "./busRoutes.js";
import { EventTrip } from "./components/EventTrip.js";
import { emptyData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { StoreProvider, useStore } from "./store.js";
import { ATTRIBUTION, type PlanOk, type PlanRequest, type TransitOption } from "./transit.js";

const mocks = vi.hoisted(() => ({
  planBus: vi.fn(),
  busFeed: vi.fn(),
  loadRoutes: vi.fn(),
  saveRoute: vi.fn(),
  deleteRoute: vi.fn(),
}));

const sync = { client: {} };
vi.mock("./Connected.js", () => ({ useSync: () => sync }));
vi.mock("./remote.js", () => ({ planBus: mocks.planBus, busFeed: mocks.busFeed }));
vi.mock("./busRoutes.js", async (original) => ({
  ...(await original<typeof import("./busRoutes.js")>()),
  loadRoutes: mocks.loadRoutes,
  saveRoute: mocks.saveRoute,
  deleteRoute: mocks.deleteRoute,
}));

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
  name: "Facultad",
  aliases: ["FING"],
  lat: -34.918,
  lon: -56.166,
  travelMode: "bus",
};
const clase: AppEvent = {
  id: "e1",
  title: "Cálculo",
  start: zonedInstant(tz, "2026-11-24", 9 * 60),
  end: zonedInstant(tz, "2026-11-24", 10 * 60),
  busy: true,
  location: "FING",
  source: "google",
};
const data = (): AppData => ({ ...emptyData(), places: [casa, facu], events: [clase] });

const option = (total: number, leave: number): TransitOption => ({
  leaveMin: leave,
  arriveMin: leave + total,
  totalMinutes: total,
  walkMinutes: 5,
  waitMinutes: 0,
  rideMinutes: total - 5,
  transfers: 0,
  theoretical: true,
  legs: [],
});
const feed = { version: "v1", builtAt: "2026-11-20", validTo: null, sources: [] };
const planOk = (total: number, leave: number): PlanOk => ({
  ok: true,
  options: [option(total, leave)],
  walkOnly: null,
  dayType: 1,
  maxTransfers: 1,
  raised: false,
  feed,
  attribution: ATTRIBUTION,
});

/** Ida: 42 min saliendo 08:10. Vuelta: 35 min saliendo 10:05. */
const answers = (_client: unknown, req: PlanRequest) =>
  Promise.resolve(req.mode === "arrive" ? planOk(42, 490) : planOk(35, 605));

const saved = (extra: Partial<RouteRow> = {}): RouteRow => ({
  id: "r1",
  from_place: "casa",
  to_place: "facu",
  weekday: 2,
  time_minutes: 540,
  mode: "arrive",
  feed_version: "v1",
  plan: { option: option(40, 495), dayType: 1, validTo: null },
  computed_at: "2026-11-21T10:00:00Z",
  theoretical: true,
  ...extra,
});

function Probe() {
  const { data: d } = useStore();
  return <output data-testid="state">{JSON.stringify([d.tripMinutes, d.tripBack])}</output>;
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "[]");
const modes = () => mocks.planBus.mock.calls.map((c) => (c[1] as PlanRequest).mode);

const show = () =>
  render(
    <StoreProvider initial={data} persist={false} fixedNow={NOW}>
      <EventTrip event={clase} />
      <Probe />
    </StoreProvider>,
  );

beforeEach(() => {
  mocks.planBus.mockImplementation(answers);
  mocks.busFeed.mockResolvedValue(feed);
  mocks.loadRoutes.mockResolvedValue([]);
  mocks.saveRoute.mockImplementation((_c, row) =>
    Promise.resolve({ ...row, id: "nueva", computed_at: "2026-11-22T10:00:00Z" }),
  );
  mocks.deleteRoute.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("la vuelta en la tarjeta del evento", () => {
  it("pide la ida llegando al inicio y la vuelta saliendo al fin, y el plan guarda las dos", async () => {
    show();
    expect(await screen.findByText(/Salí a las 08:10/)).toBeTruthy();
    expect(await screen.findByText(/Salí a las 10:05/)).toBeTruthy();
    const asked = mocks.planBus.mock.calls.map((c) => c[1] as PlanRequest);
    const ida = asked.find((r) => r.mode === "arrive");
    const vuelta = asked.find((r) => r.mode === "depart");
    expect(ida).toMatchObject({ from: { lat: -34.9 }, time: "09:00" });
    expect(vuelta).toMatchObject({ from: { lat: -34.918 }, to: { lat: -34.9 }, time: "10:00" });
    await waitFor(() =>
      expect(state()).toEqual([
        { e1: { minutes: 42, start: clase.start } },
        { e1: { minutes: 35, end: clase.end } },
      ]),
    );
    expect(screen.getByRole("region", { name: "Vuelta" })).toBeTruthy();
    expect(screen.queryByText(/Todavía no tengo los minutos/)).toBeNull();
  });

  it("si no hay ómnibus para volver lo dice y el plan usa la ida", async () => {
    mocks.planBus.mockImplementation((_c, req: PlanRequest) =>
      Promise.resolve(req.mode === "arrive" ? planOk(42, 490) : { ...planOk(0, 0), options: [] }),
    );
    show();
    expect(await screen.findByText(/No hay más ómnibus para volver/)).toBeTruthy();
    expect(await screen.findByText(/Todavía no tengo los minutos de la vuelta/)).toBeTruthy();
  });
});

describe("las rutas habituales en la tarjeta", () => {
  it("guarda la ida como ruta habitual de ese día de la semana", async () => {
    show();
    await screen.findAllByText(/Salí a las/);
    const [button] = await screen.findAllByRole("button", {
      name: "Guardar como ruta habitual los martes",
    });
    fireEvent.click(button as HTMLElement);
    await waitFor(() => expect(mocks.saveRoute).toHaveBeenCalledTimes(1));
    const row = mocks.saveRoute.mock.calls[0]?.[1];
    expect(row).toMatchObject({
      from_place: "casa",
      to_place: "facu",
      weekday: 2,
      time_minutes: 540,
      mode: "arrive",
      feed_version: "v1",
    });
    expect(row.plan.option.totalMinutes).toBe(42);
    expect(await screen.findByText("Guardada como ruta habitual los martes.")).toBeTruthy();
  });

  it("usa la ruta guardada sin pedirla al servidor mientras valga", async () => {
    mocks.loadRoutes.mockResolvedValue([saved()]);
    show();
    expect(await screen.findByText(/Ruta habitual \(los martes\)/)).toBeTruthy();
    expect(screen.getByText(/Salí a las 08:15/)).toBeTruthy();
    // Solo se pidió la vuelta: la ida salió de la ruta guardada.
    await screen.findByText(/Salí a las 10:05/);
    expect(modes()).toEqual(["depart"]);
    await waitFor(() => expect(state()[0]).toEqual({ e1: { minutes: 40, start: clase.start } }));
  });

  it("si cambiaron los horarios la calcula de nuevo y avisa", async () => {
    mocks.loadRoutes.mockResolvedValue([saved({ feed_version: "viejo" })]);
    show();
    expect(await screen.findByText(/ya no sirve \(cambiaron los horarios\)/)).toBeTruthy();
    expect(screen.queryByText(/Ruta habitual \(/)).toBeNull();
    await waitFor(() => expect(mocks.planBus).toHaveBeenCalledTimes(2));
  });

  it("«Recalcular» pide de nuevo la ida", async () => {
    mocks.loadRoutes.mockResolvedValue([saved()]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Recalcular" }));
    expect(await screen.findByText(/Salí a las 08:10/)).toBeTruthy();
    expect(modes()).toContain("arrive");
  });

  it("«Borrar ruta habitual» la quita y ofrece Deshacer", async () => {
    mocks.loadRoutes.mockResolvedValue([saved()]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Borrar ruta habitual" }));
    await waitFor(() => expect(mocks.deleteRoute).toHaveBeenCalledWith({}, "r1"));
    expect(await screen.findByText("Ruta habitual borrada.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(mocks.saveRoute).toHaveBeenCalled());
    expect(mocks.saveRoute.mock.calls[0]?.[1]).toMatchObject({ from_place: "casa", weekday: 2 });
  });
});
