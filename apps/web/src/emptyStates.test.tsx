import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Inbox } from "./components/Inbox.js";
import { Places } from "./components/Places.js";
import { Routines } from "./components/Preferences.js";
import { Silos } from "./components/Silos.js";
import { ActivitySettings } from "./components/Subjects.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, emptyData } from "./demo.js";
import type { AppData } from "./model.js";
import { StoreProvider } from "./store.js";

afterEach(cleanup);

const NOW = Date.UTC(2026, 10, 2, 20);

const show = (ui: React.ReactNode, initial: () => AppData = emptyData) =>
  render(
    <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
      <ToastProvider>{ui}</ToastProvider>
    </StoreProvider>,
  );

const silos = (initial: () => AppData) =>
  render(
    <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Silos />
      </ToastProvider>
    </StoreProvider>,
  );

describe("empty states (SPEC §14)", () => {
  it("Silos with nothing yet says what goes there and where to start", () => {
    silos(emptyData);
    expect(screen.getByText(/Acá van tus entregas y parciales/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Nueva actividad" })).toBeTruthy();
  });

  it("is not shown once there is something", () => {
    silos(() => demoData(NOW));
    expect(screen.queryByText(/Acá van tus entregas/)).toBeNull();
  });

  it("Bandeja with nothing pending says what lands there and offers the week", () => {
    const onWeek = vi.fn();
    show(<Inbox onWeek={onWeek} />);
    expect(screen.getByText("Todo al día ✓")).toBeTruthy();
    expect(screen.getByText(/Acá aparece lo que necesita una decisión tuya/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver mi semana" }));
    expect(onWeek).toHaveBeenCalledOnce();
  });

  it("Rutinas without routines says so and keeps the button to create one", () => {
    show(<Routines />);
    expect(screen.getByText(/Todavía no tenés rutinas/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear rutina nueva" })).toBeTruthy();
  });

  it("Lugares without places says to start with home and keeps «Agregar lugar»", () => {
    show(<Places />);
    expect(screen.getByText(/Todavía no guardaste ningún lugar\. Empezá por tu casa/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agregar lugar" })).toBeTruthy();
  });

  it("Materias without any leads to where they are made", () => {
    const onOpen = vi.fn();
    show(<ActivitySettings onOpen={onOpen} />);
    expect(screen.getByText(/No tenés materias ni rutinas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ir a Inicio de cuatrimestre" }));
    fireEvent.click(screen.getByRole("button", { name: "Ir a Rutinas" }));
    expect(onOpen.mock.calls).toEqual([["semester"], ["routines"]]);
  });
});
