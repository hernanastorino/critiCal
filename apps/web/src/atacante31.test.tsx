import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { exportJson } from "./backup.js";
import { Routines } from "./components/Preferences.js";
import { Silos } from "./components/Silos.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { forgetImport } from "./importUndo.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider, useStore } from "./store.js";

// Medias de la 31.ª vuelta del agente atacante.
const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo
const casa = { id: "casa", name: "Casa", aliases: ["Hogar"], isHome: true, address: "Rivera 1234" };
const start = (): AppData => reducer(demoData(NOW), { type: "refresh", now: NOW });
const tick = () => act(() => new Promise((r) => setTimeout(r, 20)));

const seen: { store?: ReturnType<typeof useStore> } = {};
const Probe = () => {
  seen.store = useStore();
  return null;
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDrafts();
  forgetImport();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("Lugares: «Cancelar»", () => {
  it("con «Descartar» olvida el borrador: al editar otra vez está lo guardado", () => {
    render(<App fixedNow={NOW} initial={() => ({ ...demoData(NOW), places: [casa] })} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Lugares y traslados/ }));
    const edit = () => fireEvent.click(screen.getByRole("button", { name: /^Editar Casa/ }));
    edit();
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Casa nueva" } });
    fireEvent.change(screen.getByLabelText(/^Alias/), { target: { value: "Otro" } });
    fireEvent.click(screen.getByLabelText("Mi casa"));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar" }));
    edit();
    expect(screen.getByLabelText("Nombre")).toHaveProperty("value", "Casa");
    expect(screen.getByLabelText(/^Alias/)).toHaveProperty("value", "Hogar");
    expect(screen.getByLabelText("Mi casa")).toHaveProperty("checked", true);
  });
});

describe("rutina pausada", () => {
  it("no deja suelto el campo «Le dediqué (minutos)»", () => {
    render(
      <StoreProvider initial={start} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Probe />
          <Routines />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByLabelText(/^Gym,/));
    expect(screen.getByText("Le dediqué (minutos)")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Gym" })).getByText("Pausar…"));
    fireEvent.click(screen.getByText("Hasta que lo reactive"));
    fireEvent.click(screen.getByLabelText(/^Gym,/));
    expect(screen.queryByText("Le dediqué (minutos)")).toBeNull();
    expect(screen.queryByText("Registrar avance")).toBeNull();
  });
});

describe("entrega cerrada", () => {
  it("el silo dice 0h, no las horas que tenía", () => {
    render(
      <StoreProvider initial={start} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <Probe />
          <Silos />
        </ToastProvider>
      </StoreProvider>,
    );
    const silo = () => document.querySelector<HTMLElement>('[data-task="informe-fis"]');
    expect(silo()?.querySelector(".total")?.textContent).toMatch(/5h/);
    fireEvent.click(screen.getByLabelText(/^Informe Lab Física/));
    const sheet = within(screen.getByRole("dialog", { name: "Informe Lab Física" }));
    for (const part of ["Procesar datos", "Redactar", "Gráficas"])
      fireEvent.click(sheet.getByLabelText(part));
    fireEvent.click(sheet.getByRole("button", { name: "Guardar avance" }));
    expect(silo()?.querySelector(".total")?.textContent).not.toMatch(/5h/);
  });
});

describe("Deshacer tras importar un respaldo", () => {
  it("la cabecera dice «Deshacer: cargar un respaldo» y devuelve lo de antes", async () => {
    const version = {
      at: NOW,
      label: "ajustar el día",
      pins: [],
      today: [],
      overrides: [],
      proposals: [],
    };
    const file = new File([exportJson({ ...demoData(NOW), planHistory: [] }, NOW)], "r.json", {
      type: "application/json",
    });
    render(<App fixedNow={NOW} initial={() => ({ ...demoData(NOW), planHistory: [version] })} />);
    expect(screen.getByLabelText("Deshacer: ajustar el día")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Respaldo/ }));
    fireEvent.change(screen.getByLabelText("Archivo de respaldo"), { target: { files: [file] } });
    await tick();
    await tick();
    fireEvent.click(screen.getByLabelText("Cerrar"));
    await tick();
    expect(screen.queryByLabelText("Deshacer: ajustar el día")).toBeNull();
    fireEvent.click(screen.getByLabelText("Deshacer: cargar un respaldo"));
    expect(screen.getByLabelText("Deshacer: ajustar el día")).toBeTruthy();
    expect(screen.queryByLabelText("Deshacer: cargar un respaldo")).toBeNull();
  });
});

describe("rutina huérfana (sin silo)", () => {
  it("no cuenta en «Rutinas» ni aparece en «Materias»", () => {
    const orphan = {
      id: "huerfana",
      name: "Rutina vieja",
      kind: "rutina" as const,
      color: "#123456",
      academic: false,
      maxSessionMinutes: 60,
      minBlockMinutes: 30,
    };
    render(
      <App
        fixedNow={NOW}
        initial={() => {
          const d = demoData(NOW);
          return { ...d, activities: [...d.activities, orphan] };
        }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Ajustes"));
    const rutinas = screen.getByRole("button", { name: /^Rutinas/ }).textContent ?? "";
    expect(rutinas).toMatch(/1$/);
    fireEvent.click(screen.getByRole("button", { name: /^Materias/ }));
    expect(screen.queryByText("Rutina vieja")).toBeNull();
    expect(screen.queryByDisplayValue("Rutina vieja")).toBeNull();
  });
});
