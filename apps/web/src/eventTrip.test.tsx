// SPEC §15, interface: the car/bus pickers (per place and per event) and the bus plan card.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BusPlan, EventTrip } from "./components/EventTrip.js";
import { Places } from "./components/Places.js";
import { ToastProvider } from "./components/Toast.js";
import { emptyData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { StoreProvider, useStore } from "./store.js";
import { ATTRIBUTION, type PlanOk } from "./transit.js";

afterEach(cleanup);

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

function Probe() {
  const { data: d } = useStore();
  return <output data-testid="state">{JSON.stringify([d.tripModes, d.places])}</output>;
}

const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "[]");

describe("cómo llegar a un evento", () => {
  it("muestra el modo del lugar y cambiarlo vale solo para ese evento", () => {
    render(
      <StoreProvider initial={data} persist={false} fixedNow={NOW}>
        <EventTrip event={clase} />
        <Probe />
      </StoreProvider>,
    );
    expect(screen.getByRole("button", { name: "Ómnibus" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // Sin cuenta (demo) no hay horarios que consultar.
    // La ida y la vuelta lo dicen cada una.
    expect(screen.getAllByText("Los horarios de ómnibus necesitan tu cuenta.")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    expect(state()[0]).toEqual({ e1: "car" });
    expect(screen.getByText(/Solo esta vez/)).toBeTruthy();
    // El lugar sigue diciendo ómnibus.
    expect(state()[1].find((p: Place) => p.id === "facu").travelMode).toBe("bus");
    fireEvent.click(screen.getByRole("button", { name: /Volver a ómnibus/ }));
    // Por el JSON, lo que no hay vuelve como null.
    expect(state()[0] ?? null).toBeNull();
  });

  it("no ofrece nada para un evento sin lugar guardado o ya pasado", () => {
    const { container, rerender } = render(
      <StoreProvider initial={data} persist={false} fixedNow={NOW}>
        <EventTrip event={{ ...clase, location: "Plaza" }} />
      </StoreProvider>,
    );
    expect(container.textContent).toBe("");
    rerender(
      <StoreProvider initial={data} persist={false} fixedNow={NOW}>
        <EventTrip event={{ ...clase, start: NOW - 7_200_000, end: NOW - 3_600_000 }} />
      </StoreProvider>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("el ómnibus de un lugar", () => {
  it("se elige en el formulario del lugar y se guarda", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={data} persist={false} fixedNow={NOW}>
          <Places />
          <Probe />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Editar Facultad" }));
    expect(screen.getByRole("button", { name: "Ómnibus" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "Auto" }));
    fireEvent.click(screen.getByText("Guardar"));
    expect(state()[1].find((p: Place) => p.id === "facu").travelMode).toBeUndefined();
  });
});

describe("el plan de ómnibus", () => {
  const stop = (id: string, name: string) => ({ id, name, lat: -34.9, lon: -56.1 });
  const ok: PlanOk = {
    ok: true,
    walkOnly: null,
    dayType: 1,
    maxTransfers: 1,
    raised: false,
    attribution: ATTRIBUTION,
    feed: { version: "v", builtAt: "2026-11-20", validTo: null, sources: [] },
    options: [
      {
        leaveMin: 490,
        arriveMin: 532,
        totalMinutes: 42,
        walkMinutes: 8,
        waitMinutes: 0,
        rideMinutes: 32,
        transfers: 0,
        theoretical: true,
        legs: [
          {
            kind: "bus",
            line: "128",
            headsign: "Ciudad Vieja",
            company: null,
            source: "stm",
            board: stop("s1", "Rivera y Ellauri"),
            alight: stop("s2", "Herrera y Reissig"),
            boardMin: 495,
            alightMin: 527,
            stops: 20,
            waitMinutes: 0,
            theoretical: true,
          },
        ],
      },
    ],
  };
  const show = (answer: Parameters<typeof BusPlan>[0]["answer"], waiting = false) =>
    render(
      <BusPlan
        signedIn
        missing={null}
        answer={answer}
        waiting={waiting}
        home="Casa"
        place="Facultad"
      />,
    );

  it("línea, parada, hora de pasada y la fuente", () => {
    show(ok);
    expect(screen.getByText("Salí a las 08:10 · llegás a las 08:52 (42 min)")).toBeTruthy();
    expect(
      screen.getByText(/Línea 128 a Ciudad Vieja · parada Rivera y Ellauri a las 08:15/),
    ).toBeTruthy();
    expect(screen.getByText(/Horario teórico/)).toBeTruthy();
    expect(screen.getByText((t) => t.includes(ATTRIBUTION))).toBeTruthy();
  });

  it("dice qué pasa cuando no hay ómnibus, falta ubicar un lugar o falla el servidor", () => {
    const none = show({ ...ok, options: [] });
    expect(screen.getByText(/Ningún ómnibus llega a tiempo/)).toBeTruthy();
    none.unmount();
    show({ ok: false, error: "rate_limited" });
    expect(screen.getByText(/muchos traslados seguidos/)).toBeTruthy();
    cleanup();
    render(
      <BusPlan signedIn missing="to" answer={null} waiting={false} home="Casa" place="Facultad" />,
    );
    expect(screen.getByText(/Falta ubicar Facultad/)).toBeTruthy();
    cleanup();
    show(null, true);
    expect(screen.getByText("Buscando ómnibus…")).toBeTruthy();
  });
});
