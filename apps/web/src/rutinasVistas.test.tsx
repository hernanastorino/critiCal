import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { demoData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { StoreProvider } from "./store.js";

const MON = zonedInstant("America/Montevideo", "2026-11-02", 6 * 60);

afterEach(() => {
  cleanup();
  clearDrafts();
});

const open = () =>
  render(
    <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
      <Routines />
    </StoreProvider>,
  );
const create = () => fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
const name = () => screen.getByPlaceholderText("Gimnasio");

describe("Ajustes › Rutinas: la lista y el formulario son dos vistas", () => {
  it("shows the routines and «Crear rutina nueva», with no form", () => {
    open();
    expect(screen.getByRole("button", { name: "Crear rutina nueva" })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Gimnasio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Agregar rutina" })).toBeNull();
  });

  it("the form view has only the form, and «‹ Rutinas» goes back with nothing typed", () => {
    open();
    create();
    expect(screen.getByRole("button", { name: "Agregar rutina" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Crear rutina nueva" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "‹ Rutinas" }));
    expect(screen.getByRole("button", { name: "Crear rutina nueva" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("saving goes back to the list with the new routine", () => {
    open();
    create();
    fireEvent.change(name(), { target: { value: "Yoga" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(screen.getByRole("button", { name: /^Yoga, 3 por semana/ })).toBeTruthy();
    expect(screen.queryByPlaceholderText("Gimnasio")).toBeNull();
  });

  it("going back with something typed asks before discarding; keeping it keeps the form", () => {
    open();
    create();
    fireEvent.change(name(), { target: { value: "Yoga" } });
    fireEvent.click(screen.getByRole("button", { name: "‹ Rutinas" }));
    expect(screen.getByRole("alertdialog", { name: "¿Descartar los cambios?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Seguir editando" }));
    expect((name() as HTMLInputElement).value).toBe("Yoga");
    fireEvent.click(screen.getByRole("button", { name: "‹ Rutinas" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    expect(screen.getByRole("button", { name: "Crear rutina nueva" })).toBeTruthy();
    create();
    expect((name() as HTMLInputElement).value).toBe("");
  });

  it("a draft waiting from before opens straight on the form", () => {
    const first = open();
    create();
    fireEvent.change(name(), { target: { value: "Yoga" } });
    first.unmount();
    open();
    expect((name() as HTMLInputElement).value).toBe("Yoga");
  });
});
