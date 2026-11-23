import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { seedHistory } from "./store.js";

const MONDAY = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const open = () => {
  render(
    <App
      fixedNow={MONDAY}
      initial={(now) => seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
};
const hechos = () => screen.queryAllByLabelText(/^Hecho: /);
const tocar = (el: HTMLElement | undefined) => {
  if (!el) throw new Error("no hay con qué tocar");
  act(() => {
    el.click();
  });
};
const partes = () => screen.getAllByRole("button").filter((b) => b.hasAttribute("aria-pressed"));
const faltan = (): string[] => {
  fireEvent.click(screen.getByRole("button", { name: /Silos/ }));
  const out = Array.from(document.querySelectorAll(".silo[data-task]")).map(
    (e) => e.getAttribute("aria-label") ?? "",
  );
  fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
  return out;
};

describe("«Hecho» pregunta las partes (SPEC §3)", () => {
  it("con partes: elegir una la registra y «faltan» baja; Deshacer lo devuelve", () => {
    open();
    const antes = faltan();
    const total = hechos().length;
    tocar(hechos().at(0));
    // Todavía no se anotó nada: la tarjeta pregunta.
    expect(hechos().length).toBe(total - 1);
    expect(screen.queryByText("Anotado como hecho.")).toBeNull();
    expect(partes().length).toBeGreaterThan(1);
    tocar(partes().at(0));
    expect(partes().at(0)?.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Anotar hecho" }));
    expect(screen.getByText("Anotado como hecho.")).toBeTruthy();
    expect(faltan()).not.toEqual(antes);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(hechos().length).toBe(total);
    expect(faltan()).toEqual(antes);
  });

  it("sin elegir ninguna: cuenta como tiempo, «faltan» no cambia y Deshacer vuelve", () => {
    open();
    const antes = faltan();
    const total = hechos().length;
    tocar(hechos().at(0));
    fireEvent.click(screen.getByRole("button", { name: "Anotar hecho" }));
    expect(screen.getByText("Anotado como hecho.")).toBeTruthy();
    expect(hechos().length).toBe(total - 1);
    expect(faltan()).toEqual(antes);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(hechos().length).toBe(total);
  });

  it("«Volver» deja la tarjeta como estaba, sin anotar nada", () => {
    open();
    const total = hechos().length;
    tocar(hechos().at(0));
    fireEvent.click(screen.getByRole("button", { name: "Volver" }));
    expect(hechos().length).toBe(total);
    expect(screen.queryByText("Anotado como hecho.")).toBeNull();
  });

  it("deslizar a la derecha también pregunta", () => {
    open();
    const card = hechos().at(0)?.closest(".card") ?? document.body;
    fireEvent.touchStart(card, { touches: [{ clientX: 200, clientY: 300 }], timeStamp: 1000 });
    fireEvent.touchEnd(card, {
      changedTouches: [{ clientX: 320, clientY: 300 }],
      timeStamp: 1200,
    });
    expect(screen.getByRole("button", { name: "Anotar hecho" })).toBeTruthy();
    expect(screen.queryByText("Anotado como hecho.")).toBeNull();
  });
});
