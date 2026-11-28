import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askKey, busTripsToAsk } from "./busTrip.js";
import { type SyncApi, SyncContext } from "./Connected.js";
import { BusPrefetch } from "./components/BusPrefetch.js";
import { legLine } from "./components/EventTrip.js";
import { TIMEZONE } from "./demo.js";
import { DEMO_KIND_KEY } from "./demoPruebas.js";
import { DEMO_MINUTES, demoPlan } from "./demoTransit.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { busMinutes } from "./places.js";
import { loadDemo, StoreProvider, useStore } from "./store.js";
import type { TransitOption } from "./transit.js";

// 47.ª vuelta, puntos 1 y 8: el plan reserva el ómnibus sin abrir la tarjeta, y la tarjeta
// dice las líneas con palabras. Cada prueba con fecha fija y con la fecha real.
const planBus = vi.fn();
vi.mock("./remote.js", async (orig) => ({
  ...(await orig<typeof import("./remote.js")>()),
  planBus: (_client: unknown, request: unknown) => planBus(request),
  busFeedVersion: () => Promise.resolve("demo"),
}));
vi.mock("./busRoutes.js", async (orig) => ({
  ...(await orig<typeof import("./busRoutes.js")>()),
  loadRoutes: () => Promise.resolve([]),
}));

const real = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
const MOMENTS = [
  ["fecha fija", "2026-11-23"],
  ["fecha real", real],
] as const;

afterEach(() => {
  cleanup();
  localStorage.removeItem(DEMO_KIND_KEY);
  planBus.mockReset();
});

function Probe() {
  const { data } = useStore();
  return <output data-testid="minutes">{JSON.stringify(data.tripMinutes ?? {})}</output>;
}

interface Saved {
  minutes: number;
  back?: number;
  start: number;
}
const minutes = (): Record<string, Saved | undefined> =>
  JSON.parse(screen.getByTestId("minutes").textContent ?? "{}");

describe.each(MOMENTS)(
  "1. minutos del ómnibus sin abrir la tarjeta: %s",
  { timeout: 30_000 },
  (_n, date) => {
    const now = zonedInstant(TIMEZONE, date, 10 * 60);
    const demoData = (): AppData => {
      localStorage.setItem(DEMO_KIND_KEY, "pruebas");
      return loadDemo(now);
    };

    it("busTripsToAsk: solo ómnibus de los próximos 7 días, sin dato para su inicio, de a uno", () => {
      const data = demoData();
      const todo = busTripsToAsk(data, now);
      expect(todo.map((e) => e.id)).toContain("clase-fing");
      expect(todo.map((e) => e.start)).toEqual([...todo.map((e) => e.start)].sort((a, b) => a - b));
      for (const e of todo) expect(e.start).toBeLessThan(now + 7 * 86_400_000);
      // Con dato para su inicio (las dos puntas) ya no se pide; con otro inicio sí.
      const fing = todo.find((e) => e.id === "clase-fing");
      if (!fing) throw new Error("falta la clase");
      const done = {
        ...data,
        tripMinutes: { [fing.id]: { minutes: 40, back: 45, start: fing.start } },
      };
      expect(busTripsToAsk(done, now).map((e) => e.id)).not.toContain("clase-fing");
      const moved = { ...data, tripMinutes: { [fing.id]: { minutes: 40, back: 45, start: 1 } } };
      expect(busTripsToAsk(moved, now).map((e) => e.id)).toContain("clase-fing");
      // Lo ya preguntado se salta.
      expect(busTripsToAsk(data, now, new Set([askKey(fing)])).map((e) => e.id)).not.toContain(
        "clase-fing",
      );
    });

    it("en la demo de pruebas usa directo los datos inventados y el plan los usa", async () => {
      const data = demoData();
      const fing = data.events.find((e) => e.id === "clase-fing");
      if (!fing) throw new Error("falta la clase");
      expect(busMinutes(data, fing)).toBeUndefined();
      render(
        <StoreProvider initial={() => data} persist={false} fixedNow={now}>
          <BusPrefetch />
          <Probe />
        </StoreProvider>,
      );
      await waitFor(() => {
        expect(minutes()["clase-fing"]).toEqual({
          minutes: DEMO_MINUTES.there,
          back: DEMO_MINUTES.back,
          start: fing.start,
        });
      });
      // El Cerro no tiene horarios en la demo: queda con los minutos del auto.
      expect(minutes()["taller-cerro"]).toBeUndefined();
      expect(planBus).not.toHaveBeenCalled();
    });

    it("sin cuenta y sin demo de pruebas no pide nada: queda como hoy", async () => {
      localStorage.removeItem(DEMO_KIND_KEY);
      const data = loadDemo(now);
      render(
        <StoreProvider initial={() => data} persist={false} fixedNow={now}>
          <BusPrefetch />
          <Probe />
        </StoreProvider>,
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(minutes()).toEqual({});
    });

    it("con cuenta pide al servidor una vez por evento y no repite los que ya tienen dato", async () => {
      const data = demoData();
      const only: AppData = { ...data, events: data.events.filter((e) => e.id === "clase-fing") };
      planBus.mockImplementation((request) => demoPlan(request));
      const account = { client: {} } as unknown as SyncApi;
      render(
        <SyncContext.Provider value={account}>
          <StoreProvider initial={() => only} persist={false} fixedNow={now}>
            <BusPrefetch />
            <Probe />
          </StoreProvider>
        </SyncContext.Provider>,
      );
      await waitFor(
        () => {
          const fing = minutes()["clase-fing"];
          if (!fing) throw new Error("todavía no hay minutos");
          expect(fing.back).toBe(DEMO_MINUTES.back);
        },
        { timeout: 6000 },
      );
      expect(planBus).toHaveBeenCalledTimes(2);
      await new Promise((r) => setTimeout(r, 1300));
      expect(planBus).toHaveBeenCalledTimes(2);
    }, 15_000);

    it("si el servidor no responde, no insiste en bucle", async () => {
      const data = demoData();
      const only: AppData = { ...data, events: data.events.filter((e) => e.id === "clase-fing") };
      planBus.mockResolvedValue({ ok: false, error: "unreachable" });
      const account = { client: {} } as unknown as SyncApi;
      render(
        <SyncContext.Provider value={account}>
          <StoreProvider initial={() => only} persist={false} fixedNow={now}>
            <BusPrefetch />
            <Probe />
          </StoreProvider>
        </SyncContext.Provider>,
      );
      await waitFor(() => expect(planBus).toHaveBeenCalledTimes(1), { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 1500));
      expect(planBus).toHaveBeenCalledTimes(1);
      expect(minutes()).toEqual({});
    }, 15_000);
  },
);

describe("8. las líneas de un traslado, con palabras", () => {
  const ok = demoPlan({
    action: "plan",
    from: { lat: -34.9, lon: -56.16 },
    to: { lat: -34.918, lon: -56.166 },
    date: "2026-11-23",
    time: "08:00",
    mode: "arrive",
  });
  const base = ok.ok ? ok.options.at(0) : undefined;
  const bus = base?.legs.find((l) => l.kind === "bus");
  const via = (lines: string[]): TransitOption => {
    if (!base || !bus) throw new Error("sin plan");
    return { ...base, legs: lines.map((line) => ({ ...bus, line })) };
  };

  it.each([
    [["128"], "línea 128"],
    [["128", "710"], "líneas 128 y 710"],
    [["17", "128", "710"], "líneas 17, 128 y 710"],
  ])("%j dice «%s»", (lines, words) => {
    const line = legLine("Ida", via(lines));
    expect(line.endsWith(` · ${words}`)).toBe(true);
    expect(line).toMatch(/^Ida · salís \d\d:\d\d · /);
    expect(line).not.toContain("→");
  });
});
