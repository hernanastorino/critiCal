import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Places } from "./components/Places.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { pruebasData } from "./demoPruebas.js";
import { overlaps, zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { estimatedMinutes } from "./places.js";
import { onFixedOrTrip, placeClash, refreshPlan, travelIntervals } from "./planning.js";
import { StoreProvider } from "./store.js";

// 40.ª vuelta del agente atacante: traslados que se pisan con otras cosas.
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
const NOW = at("2026-11-02", "08:00");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("ningún bloque cae dentro de un traslado", () => {
  it.each(["2026-11-24", "2026-11-27", "2026-11-30"])(
    "en la Demo de pruebas desde el %s el plan deja libres los traslados",
    (date) => {
      const now = at(date, "08:00");
      const d = pruebasData(now);
      const trips = travelIntervals(d);
      expect(trips.length).toBeGreaterThan(5);
      const { plan } = refreshPlan(d, now);
      expect(plan.length).toBeGreaterThan(0);
      const inside = plan.filter((b) => trips.some((t) => overlaps(t, b)));
      expect(inside).toEqual([]);
    },
  );

  it("un bloque de hoy planeado antes de que un traslado creciera se replantea", () => {
    const base = pruebasData(NOW);
    const first = refreshPlan(base, NOW);
    const block = first.plan.find((b) => b.start > NOW);
    expect(block).toBeTruthy();
    if (!block) return;
    // Un evento con lugar justo después del bloque: su traslado de ida cae encima.
    const event: AppEvent = {
      id: "nuevo",
      title: "Nuevo",
      start: block.end + 5 * 60_000,
      end: block.end + 65 * 60_000,
      busy: true,
      source: "demo",
      location: "Club del Cerro",
    };
    const d = { ...base, plan: first.plan, events: [...base.events, event] };
    const after = refreshPlan(d, NOW);
    // Lo que pisa se propone replantear: nada queda dentro del traslado en el plan nuevo.
    expect(after.proposal?.conflicts.length).toBeGreaterThan(0);
    const trips = travelIntervals(d);
    expect(
      after.result.blocks.filter((b) => b.start > NOW && trips.some((t) => overlaps(t, b))),
    ).toEqual([]);
  });
});

describe("eventos que se superponen en lugares distintos", () => {
  const now = at("2026-11-26", "08:00");
  const d = pruebasData(now);
  const find = (title: string) => d.events.find((e) => e.title === title);

  it("la Demo de pruebas no reserva traslado dentro de «Clase en la Facultad»", () => {
    const clase = find("Clase en la Facultad");
    expect(clase).toBeTruthy();
    if (!clase) return;
    const inside = travelIntervals(d).filter((t) => t.start > clase.start && t.start < clase.end);
    expect(inside).toEqual([]);
  });

  it("placeClash nombra al otro evento; con el mismo lugar o sin superponerse, nada", () => {
    const clase = find("Clase en la Facultad");
    const estudio = find("Estudiar en lo de Fran");
    const reunion = find("Reunión de grupo");
    if (!clase || !estudio || !reunion) throw new Error("faltan eventos de la demo");
    expect(placeClash(d, clase)?.title).toBe("Estudiar en lo de Fran");
    expect(placeClash(d, estudio)?.title).toBe("Clase en la Facultad");
    expect(placeClash(d, reunion)).toBeUndefined();
    const same = {
      ...d,
      events: d.events.map((e) => (e.id === estudio.id ? { ...e, location: "Facultad" } : e)),
    };
    expect(placeClash(same, clase)).toBeUndefined();
  });
});

const casa: Place = {
  id: "casa",
  name: "Casa",
  aliases: [],
  isHome: true,
  lat: -34.9055,
  lon: -56.1905,
};
const club: Place = { id: "club", name: "Club del Cerro", aliases: [], lat: -34.89, lon: -56.26 };
const taller: AppEvent = {
  id: "taller",
  title: "Taller",
  start: at("2026-11-03", "20:30"),
  end: at("2026-11-03", "22:00"),
  busy: true,
  location: "Club del Cerro",
  source: "demo",
};
const withTaller = (now: number): AppData => ({
  ...demoData(now),
  events: [taller],
  places: [casa, club],
  travelTimes: [
    { from: "casa", to: "club", minutes: 30, manual: true },
    { from: "club", to: "casa", minutes: 30, manual: true },
  ],
  preferences: { holidaysOff: false },
});

describe("una comida a mano sí se deja sobre un evento o un traslado", () => {
  const span = (from: string, to: string) => ({
    start: at("2026-11-03", from),
    end: at("2026-11-03", to),
  });

  it("onFixedOrTrip: el evento, su traslado de ida y su vuelta cuentan; lo libre no", () => {
    const d = withTaller(NOW);
    expect(onFixedOrTrip(d, span("21:00", "21:30"))).toBe(true);
    // Ida: 30 minutos más el margen antes de las 20:30.
    expect(onFixedOrTrip(d, span("19:45", "20:15"))).toBe(true);
    // Vuelta: después de las 22:00.
    expect(onFixedOrTrip(d, span("22:00", "22:20"))).toBe(true);
    expect(onFixedOrTrip(d, span("12:00", "12:30"))).toBe(false);
  });

  it("«Mover a» encima del evento la deja ahí, fijada a mano y con ↶", () => {
    render(<App fixedNow={NOW} initial={withTaller} />);
    const dinner = document.querySelector('[aria-label^="Cena, mar"]');
    if (!dinner) throw new Error("falta la cena");
    fireEvent.click(dinner);
    fireEvent.change(screen.getByLabelText("Mover cena a"), { target: { value: "21:00" } });
    fireEvent.click(screen.getByText("Mover"));
    expect(screen.queryByText(/un evento o un traslado/)).toBeNull();
    expect(document.querySelector('[aria-label^="Cena, mar 21:00"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deshacer: mover o sacar una comida" })).toBeTruthy();
  });

  it("«Mover a» a un rato libre sí la mueve", () => {
    render(<App fixedNow={NOW} initial={withTaller} />);
    const dinner = document.querySelector('[aria-label^="Cena, mar"]');
    if (!dinner) throw new Error("falta la cena");
    fireEvent.click(dinner);
    fireEvent.change(screen.getByLabelText("Mover cena a"), { target: { value: "19:00" } });
    fireEvent.click(screen.getByText("Mover"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector('[aria-label^="Cena, mar 19:00"]')).toBeTruthy();
  });
});

describe("«Minutos en auto» muestra lo que usa el plan", () => {
  const trips = (extra: Partial<AppData>): AppData => ({
    ...demoData(NOW),
    events: [{ ...taller, start: at("2026-11-03", "10:00"), end: at("2026-11-03", "11:00") }],
    places: [casa, club],
    ...extra,
  });
  const open = (data: AppData) => {
    render(
      <ToastProvider>
        <StoreProvider initial={() => data} persist={false} fixedNow={NOW}>
          <Places />
        </StoreProvider>
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("Minutos en auto"));
  };

  it("sin minutos guardados, la estimación va de placeholder y el campo queda vacío", () => {
    const data = trips({});
    open(data);
    const box = screen.getByRole("textbox", { name: "Minutos de Casa a Club del Cerro" });
    expect(box.getAttribute("value")).toBe("");
    expect(box.getAttribute("placeholder")).toBe(String(estimatedMinutes(data, "casa", "club")));
  });

  it("con solo los de la vuelta, el placeholder es el de la vuelta", () => {
    open(trips({ travelTimes: [{ from: "club", to: "casa", minutes: 33, manual: true }] }));
    const box = screen.getByRole("textbox", { name: "Minutos de Casa a Club del Cerro" });
    expect(box.getAttribute("value")).toBe("");
    expect(box.getAttribute("placeholder")).toBe("33");
  });

  it("los guardados se muestran como valor", () => {
    open(trips({ travelTimes: [{ from: "casa", to: "club", minutes: 41, manual: true }] }));
    const box = screen.getByRole("textbox", { name: "Minutos de Casa a Club del Cerro" });
    expect(box.getAttribute("value")).toBe("41");
  });
});
