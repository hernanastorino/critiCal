import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Places } from "./components/Places.js";
import { Routines } from "./components/Preferences.js";
import { ActivitySettings } from "./components/Subjects.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clearDrafts, hasSettingsDrafts, settingsToRestore } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { StoreProvider } from "./store.js";

const MON = zonedInstant("America/Montevideo", "2026-11-02", 6 * 60);

afterEach(() => {
  cleanup();
  clearDrafts();
});

const mount = () =>
  render(
    <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
      <ToastProvider>
        <Routines />
      </ToastProvider>
    </StoreProvider>,
  );
const minutes = () => screen.getByLabelText("Minutos por vez") as HTMLInputElement;

/** Edits Gym's minutes and "reloads": the editor comes back from its draft. */
function editAndReload() {
  const first = mount();
  fireEvent.click(screen.getByRole("button", { name: /^Gym, / }));
  fireEvent.click(screen.getByRole("button", { name: "Editar" }));
  fireEvent.change(minutes(), { target: { value: "45" } });
  first.unmount();
  mount();
  expect(minutes().value).toBe("45");
}

describe("una rutina eliminada con su formulario abierto", () => {
  it("el borrador de un formulario de rutina cuenta como cambio pendiente de Ajustes", () => {
    editAndReload();
    expect(hasSettingsDrafts()).toBe(true);
    expect(settingsToRestore()).toBeTruthy();
  });

  it("eliminarla cierra el formulario y descarta el borrador, y no vuelve", {
    timeout: 30_000,
  }, async () => {
    editAndReload();
    fireEvent.click(screen.getByRole("button", { name: /^Gym, / }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar…" }));
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar de hoy en adelante/ }));
    await waitFor(() => expect(screen.queryByLabelText("Minutos por vez")).toBeNull());
    expect(hasSettingsDrafts()).toBe(false);
    expect(settingsToRestore()).toBe(false);
    expect(screen.queryByRole("button", { name: /^Gym, / })).toBeNull();
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });
});

describe("una materia o un lugar eliminados con un campo editado", () => {
  it("la materia se lleva su borrador: no queda nada por descartar", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Programación/ }));
    fireEvent.change(screen.getAllByLabelText("Nombre")[0] as HTMLInputElement, {
      target: { value: "Programación 2" },
    });
    expect(hasSettingsDrafts()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /^Eliminar/ }));
    expect(screen.queryByRole("button", { name: /^Programación/ })).toBeNull();
    expect(hasSettingsDrafts()).toBe(false);
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });

  it("el lugar se lleva su borrador", () => {
    const withPlace = () => ({
      ...demoData(MON),
      places: [{ id: "facu", name: "Facultad", aliases: [] }],
    });
    render(
      <StoreProvider initial={withPlace} persist={false} fixedNow={MON}>
        <ToastProvider>
          <Places />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText("Editar Facultad"));
    fireEvent.change(screen.getByPlaceholderText("Facu"), { target: { value: "Facu 2" } });
    expect(hasSettingsDrafts()).toBe(true);
    fireEvent.click(screen.getByText("Borrar lugar"));
    expect(hasSettingsDrafts()).toBe(false);
    expect(sessionStorage.getItem("critical.drafts")).toBeNull();
  });
});
