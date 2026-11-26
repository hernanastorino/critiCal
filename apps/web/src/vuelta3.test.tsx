import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Places } from "./components/Places.js";
import { Routines } from "./components/Preferences.js";
import { Semester } from "./components/Semester.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { StoreProvider, seedHistory } from "./store.js";

const MON = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);
const seeded = (now: number) =>
  seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now);

const inside = (ui: React.ReactNode) =>
  render(
    <ToastProvider>
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

const openWeeklyFromSettings = () => {
  fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
  fireEvent.click(screen.getByText("Planificación semanal"));
};

describe("Planificación semanal", () => {
  it("its Bandeja button says the same total as the tab", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    const badge = document.querySelector("nav.tabs .badge")?.textContent?.replace(/\D/g, "");
    expect(badge).toBeTruthy();
    openWeeklyFromSettings();
    expect(screen.getByRole("button", { name: `Ver la Bandeja (${badge})` })).toBeTruthy();
  });

  it("Escape and ✕ go back to the Ajustes list", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    openWeeklyFromSettings();
    expect(screen.getByRole("dialog", { name: "Planificación semanal" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Planificación semanal" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBeTruthy();
    fireEvent.click(screen.getByText("Planificación semanal"));
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.getByRole("dialog", { name: "Ajustes" })).toBeTruthy();
  });
});

describe("the demo's Gym", () => {
  it("is a rutina, not a materia", () => {
    const gym = demoData(MON).activities.find((a) => a.id === "gym");
    expect(gym?.kind).toBe("rutina");
  });
});

describe("Inicio de cuatrimestre", () => {
  it("refuses a negative weekly study without creating the materia", () => {
    inside(<Semester />);
    const name = screen.getByPlaceholderText("Física II");
    fireEvent.change(name, { target: { value: "Química" } });
    const hours = screen.getByLabelText("Estudio semanal (h)");
    fireEvent.change(hours, { target: { value: "-5" } });
    expect(screen.getByText("El estudio semanal va de 0 a 168 h.")).toBeTruthy();
    expect(hours.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Agregar materia" }));
    expect(document.activeElement).toBe(hours);
    expect((name as HTMLInputElement).value).toBe("Química");
    expect(screen.queryByText("Química agregada")).toBeNull();
  });

  it("after adding a materia the focus goes back to its name field", () => {
    inside(<Semester />);
    const name = screen.getByPlaceholderText("Física II");
    fireEvent.change(name, { target: { value: "Química" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar materia" }));
    expect(screen.getByText("Química agregada")).toBeTruthy();
    expect(document.activeElement).toBe(name);
  });

  it("says why «Guardar fechas» does nothing when it ends before it starts", () => {
    inside(<Semester />);
    fireEvent.change(screen.getByLabelText("Empieza"), { target: { value: "2027-03-01" } });
    const end = screen.getByLabelText("Termina");
    fireEvent.change(end, { target: { value: "2027-02-01" } });
    expect(screen.getByText(/no puede ser anterior/)).toBeTruthy();
    expect(end.getAttribute("aria-invalid")).toBe("true");
    const save = screen.getByRole("button", { name: "Guardar fechas" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(document.activeElement).toBe(end);
    expect(screen.queryByText("Fechas guardadas")).toBeNull();
  });
});

describe("Rutinas", () => {
  it("explains 99 times a week and focuses the field", () => {
    inside(<Routines />);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    const times = screen.getByLabelText("Veces/sem.");
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Nadar" } });
    fireEvent.change(times, { target: { value: "99" } });
    expect(screen.getByText("Las veces por semana van de 1 a 14.")).toBeTruthy();
    expect(times.getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(document.activeElement).toBe(times);
    expect(screen.queryByText("Nadar, 99 por semana de 60 min")).toBeNull();
  });

  it("says in the field that a routine goes once a day at most", () => {
    inside(<Routines />);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    const times = screen.getByLabelText("Veces/sem.");
    fireEvent.change(screen.getByPlaceholderText("Gimnasio"), { target: { value: "Nadar" } });
    fireEvent.change(times, { target: { value: "8" } });
    expect(
      screen.getByText("Como mucho una por día: con esos días son 7 por semana."),
    ).toBeTruthy();
    expect(times.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(times, { target: { value: "7" } });
    expect(times.getAttribute("aria-invalid")).toBeNull();
  });

  it("after adding a rutina the focus goes back to «Crear rutina nueva»", () => {
    inside(<Routines />);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    const name = screen.getByPlaceholderText("Gimnasio");
    fireEvent.change(name, { target: { value: "Nadar" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Crear rutina nueva" }));
  });
});

describe("Lugares", () => {
  it("opens on the Nombre field, which is capped at 60 characters", () => {
    inside(<Places />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    const name = screen.getByPlaceholderText("Facu");
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute("maxlength")).toBe("60");
  });

  it("an empty name says why and takes focus; saving moves focus to the place's row", async () => {
    inside(<Places />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar lugar" }));
    const name = screen.getByPlaceholderText("Facu");
    (document.activeElement as HTMLElement).blur();
    const save = screen.getByRole("button", { name: "Guardar" });
    expect(save.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(save);
    expect(screen.getByText("Poné un nombre para el lugar.")).toBeTruthy();
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "Taller" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const row = screen.getByText("Taller").closest(".place-row");
    expect(document.activeElement).toBe(row);
  });
});

describe("modo edición de la semana", () => {
  it("Escape leaves it and returns focus to the pencil", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    const pencil = screen.getByRole("button", { name: "Modo edición" });
    fireEvent.click(pencil);
    expect(pencil.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(pencil.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(pencil);
  });
});
