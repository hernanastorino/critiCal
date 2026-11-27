import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "./components/BlockSheet.js";
import { ToastProvider } from "./components/Toast.js";
import { emptyData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { estimatedMinutes, minutesBetween, travelOptions, tripPairs } from "./places.js";
import { missedMeals, travelIntervals } from "./planning.js";
import { StoreProvider, useStore } from "./store.js";

// 39.ª vuelta del agente atacante: Lugares y traslados (Demo de pruebas, 375×812).
const NOW = zonedInstant(TIMEZONE, "2026-11-27", 8 * 60);
const at = (date: string, hhmm: number) => zonedInstant(TIMEZONE, date, hhmm);

const casa: Place = {
  id: "casa",
  name: "Casa",
  aliases: [],
  isHome: true,
  lat: -34.9055,
  lon: -56.1905,
};
const club: Place = {
  id: "club",
  name: "Club del Cerro",
  aliases: [],
  lat: -34.89,
  lon: -56.26,
};
const sinCoords: Place = { id: "abuela", name: "Casa de la abuela", aliases: [] };
const taller: AppEvent = {
  id: "taller",
  title: "Taller",
  start: at("2026-11-28", 10 * 60),
  end: at("2026-11-28", 11 * 60 + 30),
  busy: true,
  location: "Club del Cerro",
  source: "google",
};
const withEvents = (events: AppEvent[], extra: Partial<AppData> = {}): AppData => ({
  ...emptyData(),
  places: [casa, club, sinCoords],
  events,
  ...extra,
});

describe("minutos en auto que faltan", () => {
  it("un par sin minutos no vale 0: se estima por la línea recta", () => {
    const d = withEvents([taller]);
    const guess = estimatedMinutes(d, "casa", "club");
    expect(guess).toBeGreaterThan(10);
    expect(travelOptions(d)?.travelMinutes("casa", "club")).toBe(guess);
    // La estimación sale igual de ida que de vuelta.
    expect(estimatedMinutes(d, "club", "casa")).toBe(guess);
  });

  it("los minutos guardados (a mano o calculados) mandan sobre la estimación", () => {
    const d = withEvents([taller], {
      travelTimes: [{ from: "casa", to: "club", minutes: 40, manual: false }],
    });
    expect(travelOptions(d)?.travelMinutes("casa", "club")).toBe(40);
    // Sin los de vuelta, vuelve con los de ida.
    expect(travelOptions(d)?.travelMinutes("club", "casa")).toBe(40);
    expect(minutesBetween(d, "club", "casa")).toBeUndefined();
  });

  it("sin coordenadas ni minutos no hay cifra que inventar", () => {
    const d = withEvents([taller]);
    expect(estimatedMinutes(d, "casa", "abuela")).toBeUndefined();
    expect(travelOptions(d)?.travelMinutes("casa", "abuela")).toBeUndefined();
  });

  it("el plan reserva la ida con la estimación en vez de solo el margen", () => {
    const d = withEvents([taller]);
    const guess = estimatedMinutes(d, "casa", "club") ?? 0;
    const margin = d.settings.travelMarginMinutes;
    const [there] = travelIntervals(d);
    expect(there?.end).toBe(taller.start);
    expect((taller.start - (there?.start ?? 0)) / 60_000).toBe(guess + margin);
  });

  it("la vuelta se reserva también: el Taller deja libre el viaje a casa", () => {
    const d = withEvents([taller], {
      travelTimes: [
        { from: "casa", to: "club", minutes: 40, manual: false },
        { from: "club", to: "casa", minutes: 40, manual: false },
      ],
    });
    const back = travelIntervals(d).find((i) => i.start === taller.end);
    expect(back?.end).toBe(taller.end + 40 * 60_000);
  });
});

describe("comidas con un traslado más largo", () => {
  const desayuno = (d: AppData) => missedMeals(d, NOW).filter((m) => m.kind === "desayuno");

  it("el desayuno que queda encima del traslado avisa en «Comidas sin lugar»", () => {
    const d = withEvents([taller], {
      travelTimes: [
        { from: "casa", to: "club", minutes: 40, manual: false },
        { from: "club", to: "casa", minutes: 40, manual: false },
      ],
    });
    // Casa → Club del Cerro = 40 queda 09:10–10:00, encima del desayuno de las 9:00.
    expect(desayuno(d)).toHaveLength(1);
  });

  it("con pocos minutos el desayuno se acomoda solo y no avisa", () => {
    const d = withEvents([taller], {
      travelTimes: [
        { from: "casa", to: "club", minutes: 5, manual: false },
        { from: "club", to: "casa", minutes: 5, manual: false },
      ],
    });
    expect(desayuno(d)).toHaveLength(0);
  });
});

describe("la Demo de pruebas trae los minutos de sus traslados", () => {
  it("todos los pares que usa tienen minutos", () => {
    const d = pruebasData(NOW);
    const pairs = tripPairs(d, NOW);
    expect(pairs.length).toBeGreaterThanOrEqual(9);
    for (const p of pairs) expect(minutesBetween(d, p.from, p.to)).toBeDefined();
  });

  it("el Taller reserva la ida de Casa (40 min más el margen) y el viaje al almuerzo que sigue", () => {
    const d = pruebasData(NOW);
    const find = (title: string) => d.events.find((e) => e.title === title);
    const t = find("Taller en el Cerro");
    const lunch = find("Almuerzo en lo de la abuela");
    expect(t && lunch).toBeTruthy();
    if (!t || !lunch) return;
    const trips = travelIntervals(d);
    const minutes = (i?: { start: number; end: number }) => i && (i.end - i.start) / 60_000;
    const margin = d.settings.travelMarginMinutes;
    expect(minutes(trips.find((i) => i.end === t.start))).toBe(40 + margin);
    // Del Taller al almuerzo sin pasar por casa: Club del Cerro → lo de la abuela = 30.
    expect(minutes(trips.find((i) => i.end === lunch.start))).toBe(30 + margin);
  });
});

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

describe("la hoja de un evento sin ubicación con traslado", () => {
  const cumple: AppEvent = {
    id: "cumple",
    title: "Cumple de Sofi",
    start: at("2026-11-28", 21 * 60),
    end: at("2026-11-28", 23 * 60 + 59),
    busy: true,
    source: "google",
  };
  const data = (): AppData =>
    withEvents([cumple], {
      spots: [{ key: "cumple de sofi", text: "Cumple de Sofi", minutes: 26 }],
    });
  const open = () =>
    render(
      <ToastProvider>
        <StoreProvider initial={data} persist={false} fixedNow={NOW}>
          <Spy />
          <BlockSheet
            item={{
              kind: "event",
              id: cumple.id,
              start: cumple.start,
              end: cumple.end,
              event: cumple,
            }}
            onClose={vi.fn()}
          />
        </StoreProvider>
      </ToastProvider>,
    );

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it("muestra los minutos cargados en la Bandeja", () => {
    open();
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByRole("textbox", { name: /^Minutos desde casa/ });
    expect(input.getAttribute("value")).toBe("26");
  });

  it("deja cambiarlos, con deshacer", () => {
    open();
    const input = screen.getByRole("textbox", { name: /^Minutos desde casa/ });
    fireEvent.change(input, { target: { value: "35" } });
    fireEvent.blur(input);
    expect(latest?.spots?.at(0)?.minutes).toBe(35);
    fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }));
    expect(latest?.spots?.at(0)?.minutes).toBe(26);
  });

  it("deja olvidarlos, con deshacer", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Olvidar el traslado de Cumple de Sofi" }));
    expect(latest?.spots).toEqual([]);
    expect(screen.queryByRole("textbox", { name: /^Minutos desde casa/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Deshacer/ }));
    expect(latest?.spots?.at(0)?.minutes).toBe(26);
  });

  it("sin minutos cargados no muestra nada", () => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => withEvents([cumple])} persist={false} fixedNow={NOW}>
          <BlockSheet
            item={{
              kind: "event",
              id: cumple.id,
              start: cumple.start,
              end: cumple.end,
              event: cumple,
            }}
            onClose={vi.fn()}
          />
        </StoreProvider>
      </ToastProvider>,
    );
    expect(screen.queryByText("Minutos desde casa")).toBeNull();
  });
});
