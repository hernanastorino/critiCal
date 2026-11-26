import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockSheet } from "./components/BlockSheet.js";
import { Places } from "./components/Places.js";
import { ToastProvider } from "./components/Toast.js";
import { Week } from "./components/Week.js";
import { emptyData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppEvent, Place } from "./model.js";
import { reducer, StoreProvider, useStore } from "./store.js";

// 38.ª vuelta del agente atacante: Lugares y traslados (Demo de pruebas, 375×812).
const tz = "America/Montevideo";
const NOW = zonedInstant(tz, "2026-11-23", 8 * 60);

const casa: Place = { id: "casa", name: "Casa", aliases: [], isHome: true };
const club: Place = { id: "club", name: "Club del Cerro", aliases: ["Cerro"] };
const gym: Place = { id: "gym", name: "Gym", aliases: [] };
const taller: AppEvent = {
  id: "e1",
  title: "Taller",
  start: zonedInstant(tz, "2026-11-24", 10 * 60),
  end: zonedInstant(tz, "2026-11-24", 11 * 60),
  busy: true,
  location: "Cerro",
  source: "google",
};

const base = (): AppData => ({
  ...emptyData(),
  places: [casa, club, gym],
  events: [taller],
  travelTimes: [
    { from: "casa", to: "club", minutes: 20, manual: true },
    { from: "club", to: "casa", minutes: 20, manual: true },
    { from: "casa", to: "gym", minutes: 10, manual: true },
    { from: "club", to: "gym", minutes: 15, manual: true },
  ],
});

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const inside = (ui: React.ReactNode, initial: () => AppData = base) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

/** The «Minutos en auto» fold, open. */
const openTrips = () => {
  const summary = screen.getByText("Minutos en auto").closest("summary");
  if (!summary) throw new Error("sin pliegue");
  fireEvent.click(summary);
};
const field = (name: string) => screen.getByLabelText(name);
const shown = (name: string) => screen.getByRole("textbox", { name }).getAttribute("value");
const type = (name: string, text: string) => {
  const input = field(name);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
};

describe("Minutos en auto", () => {
  it("avisa junto al campo que el máximo es un día, en vez de bajarlo callado", () => {
    inside(<Places />);
    openTrips();
    type("Minutos de Casa a Club del Cerro", "99999");
    expect(shown("Minutos de Casa a Club del Cerro")).toBe("1440");
    expect(screen.getByRole("alert").textContent).toBe("El máximo es 1440 minutos (un día).");
    // Al volver a escribir el aviso se va.
    fireEvent.change(field("Minutos de Casa a Club del Cerro"), { target: { value: "30" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("vaciar el campo borra el valor y no vuelve al anterior", () => {
    inside(<Places />);
    openTrips();
    type("Minutos de Casa a Club del Cerro", "");
    expect(shown("Minutos de Casa a Club del Cerro")).toBe("");
    expect(latest?.travelTimes?.some((t) => t.from === "casa" && t.to === "club")).toBe(false);
    // Lo demás queda como estaba.
    expect(latest?.travelTimes).toHaveLength(3);
  });

  it("la fila no se mueve mientras se edita", () => {
    inside(<Places />);
    openTrips();
    const order = () =>
      screen.getAllByLabelText(/^Minutos de /).map((el) => el.getAttribute("aria-label"));
    const before = order();
    fireEvent.focus(field("Minutos de Club del Cerro a Gym"));
    fireEvent.change(field("Minutos de Club del Cerro a Gym"), { target: { value: "99" } });
    expect(order()).toEqual(before);
    fireEvent.blur(field("Minutos de Club del Cerro a Gym"));
    expect(order()).toEqual(before);
    // También con la primera: ya no pasa al final de la lista.
    type("Minutos de Casa a Club del Cerro", "45");
    expect(order()).toEqual(before);
  });

  it("el reducer deja el viaje editado en su lugar de la lista", () => {
    const next = reducer(base(), {
      type: "travelTime",
      from: "casa",
      to: "club",
      minutes: 5,
      now: NOW,
    });
    expect(next.travelTimes?.map((t) => `${t.from}>${t.to}`)).toEqual([
      "casa>club",
      "club>casa",
      "casa>gym",
      "club>gym",
    ]);
  });
});

describe("la dirección de un lugar en ómnibus", () => {
  const abrir = () => {
    inside(<Places />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Biblioteca" } });
    fireEvent.click(screen.getByRole("button", { name: "Ómnibus" }));
  };
  const aviso = () => screen.queryByText(/Sin dirección no se puede calcular el viaje en ómnibus/);

  it.each([
    ["espacios", "     "],
    ["invisibles", "​‌ ⠀"],
  ])("avisa con %s igual que con la dirección vacía", (_caso, texto) => {
    abrir();
    expect(aviso()).not.toBeNull();
    fireEvent.change(screen.getByLabelText(/^Dirección/), { target: { value: texto } });
    expect(aviso()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const saved = latest?.places?.find((p) => p.name === "Biblioteca");
    expect(saved?.address).toBeUndefined();
  });

  it("con una dirección real no avisa", () => {
    abrir();
    fireEvent.change(screen.getByLabelText(/^Dirección/), { target: { value: "Rivera 1234" } });
    expect(aviso()).toBeNull();
  });
});

describe("↶ de la cabecera cubre Lugares", () => {
  it("editar Minutos en auto deja su propio ↶ y lo deshace", () => {
    const start = reducer(base(), {
      type: "savePlace",
      place: { id: "x", name: "Otro", aliases: [] },
      now: NOW,
    });
    const edited = reducer(start, {
      type: "travelTime",
      from: "casa",
      to: "club",
      minutes: 99,
      now: NOW,
    });
    expect(edited.planHistory?.at(-1)?.label).toBe("cambiar minutos en auto");
    const back = reducer(edited, { type: "undoPlan", now: NOW });
    expect(back.travelTimes?.find((t) => t.from === "casa" && t.to === "club")?.minutes).toBe(20);
    expect(back.planHistory?.at(-1)?.label).toBe("guardar un lugar");
  });

  it("vaciar los minutos también se deshace", () => {
    const cleared = reducer(base(), {
      type: "forgetTravelTime",
      from: "casa",
      to: "club",
      now: NOW,
    });
    expect(cleared.planHistory?.at(-1)?.label).toBe("cambiar minutos en auto");
    const back = reducer(cleared, { type: "undoPlan", now: NOW });
    expect(back.travelTimes).toEqual(base().travelTimes);
  });

  it("olvidar una dirección deja su propio ↶ y devuelve la dirección con sus minutos", () => {
    const withSpot: AppData = {
      ...base(),
      spots: [{ key: "rivera 1", text: "Rivera 1", minutes: 12, manual: true }],
      eventTravel: { e1: { minutes: 12, key: "rivera 1" } },
    };
    const forgot = reducer(withSpot, { type: "forgetSpot", key: "rivera 1", now: NOW });
    expect(forgot.planHistory?.at(-1)?.label).toBe("olvidar una dirección");
    expect(forgot.spots ?? []).toHaveLength(0);
    const back = reducer(forgot, { type: "undoPlan", now: NOW });
    expect(back.spots).toEqual(withSpot.spots);
    expect(back.eventTravel).toEqual(withSpot.eventTravel);
  });

  it("editar los minutos de una dirección de evento se deshace", () => {
    const withSpot: AppData = {
      ...base(),
      spots: [{ key: "rivera 1", text: "Rivera 1", minutes: 12, manual: true }],
    };
    const edited = reducer(withSpot, {
      type: "spotMinutes",
      text: "Rivera 1",
      minutes: 40,
      now: NOW,
    });
    expect(edited.planHistory?.at(-1)?.label).toBe("cambiar minutos de una dirección");
    const back = reducer(edited, { type: "undoPlan", now: NOW });
    expect(back.spots?.at(0)?.minutes).toBe(12);
  });
});

describe("el traslado de un evento con lugar conocido se ve", () => {
  it("la hoja del evento ofrece Auto y Ómnibus, también para un lugar en ómnibus", () => {
    const data = (): AppData => ({
      ...base(),
      places: [casa, { ...club, travelMode: "bus" }, gym],
    });
    inside(
      <BlockSheet
        item={{ kind: "event", id: taller.id, start: taller.start, end: taller.end, event: taller }}
        onClose={vi.fn()}
      />,
      data,
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Cómo llegar")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "Ómnibus" }).getAttribute("aria-pressed"),
    ).toBe("true");
    fireEvent.click(within(dialog).getByRole("button", { name: "Auto" }));
    expect(latest?.tripModes).toEqual({ e1: "car" });
  });

  it("un evento sin lugar guardado no ofrece nada", () => {
    const sin: AppEvent = { ...taller, location: "Plaza" };
    inside(
      <BlockSheet
        item={{ kind: "event", id: sin.id, start: sin.start, end: sin.end, event: sin }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByText("Cómo llegar")).toBeNull();
  });

  it("la Semana dibuja el tiempo reservado antes y después del evento", () => {
    inside(<Week day="2026-11-23" onSettings={vi.fn()} />);
    const names = screen
      .getAllByRole("img", { name: /^Traslado,/ })
      .map((el) => el.getAttribute("aria-label") ?? "");
    // 20 min + el margen antes de las 10:00; 20 min al terminar a las 11:00.
    expect(names.some((n) => /^Traslado, mar 09:\d\d a 10:00$/.test(n))).toBe(true);
    expect(names).toContain("Traslado, mar 11:00 a 11:20");
  });

  it("con 1440 minutos el traslado ocupa el día y se ve", () => {
    const data = (): AppData => ({
      ...base(),
      travelTimes: [{ from: "casa", to: "club", minutes: 1440, manual: true }],
    });
    inside(<Week day="2026-11-23" onSettings={vi.fn()} />, data);
    expect(screen.getAllByRole("img", { name: /^Traslado,/ }).length).toBeGreaterThan(1);
  });
});
