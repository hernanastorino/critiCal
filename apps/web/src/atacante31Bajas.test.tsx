import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { awakeProblem } from "./dayLength.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { forgetImport } from "./importUndo.js";
import { StoreProvider } from "./store.js";
import { durationLabel } from "./taskForm.js";

// Bajas de la 31.ª vuelta del agente atacante.
const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo
const tick = () => act(() => new Promise((r) => setTimeout(r, 20)));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDrafts();
  forgetImport();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const openSettingsPage = (name: RegExp) => {
  fireEvent.click(screen.getByLabelText("Ajustes"));
  fireEvent.click(screen.getByRole("button", { name }));
};

describe("Escape en la hoja de una rutina", () => {
  it("vuelve a Rutinas, no a la raíz de Ajustes", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    openSettingsPage(/^Rutinas/);
    fireEvent.click(screen.getByRole("button", { name: /^Gym, 3 por semana/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Rutinas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear rutina nueva" })).toBeTruthy();
  });
});

describe("Escape en el formulario de una rutina nueva", () => {
  it("vuelve a Rutinas, no a la raíz de Ajustes", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    openSettingsPage(/^Rutinas/);
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    expect(screen.getByRole("heading", { name: "Rutina nueva" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Rutinas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Crear rutina nueva" })).toBeTruthy();
  });
});

describe("Mi semana: «Nada de estudio desde»", () => {
  it("no puede ser después de la hora de acostarse", async () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    openSettingsPage(/^Mi semana/);
    fireEvent.change(screen.getByLabelText("Me acuesto"), { target: { value: "23:00" } });
    fireEvent.change(screen.getByLabelText("Nada de estudio desde"), {
      target: { value: "23:50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Guardar/ }));
    await tick();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(
      /«Nada de estudio desde» \(23:50\) cae después de que te acuestes \(23:00\)/,
    );
    expect(screen.getByLabelText("Nada de estudio desde").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});

describe("horas con un solo formato", () => {
  it("las duraciones se escriben compactas, como «faltan 6h15»", () => {
    expect(durationLabel(270)).toBe("4h30");
    expect(durationLabel(120)).toBe("2h");
    expect(durationLabel(45)).toBe("45m");
    expect(awakeProblem("08:00", "11:59")).toMatch(/estás despierto 3h59:/);
  });
});

describe("Bandeja: «¿Dónde es?»", () => {
  it("«Usar» avisa y ofrece «Deshacer», que devuelve la tarjeta", () => {
    const casa = { id: "casa", name: "Casa", aliases: [], isHome: true, address: "Rivera 1234" };
    const NOW2 = zonedInstant(TIMEZONE, "2026-11-03", 8 * 60);
    const event = {
      id: "x",
      title: "Inglés",
      start: zonedInstant(TIMEZONE, "2026-11-03", 18 * 60),
      end: zonedInstant(TIMEZONE, "2026-11-03", 19 * 60),
      busy: true,
      location: "Instituto Anglo",
      source: "google" as const,
    };
    render(
      <StoreProvider
        initial={() => ({ ...emptyData(), places: [casa], events: [event] })}
        persist
        fixedNow={NOW2}
      >
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.change(screen.getByLabelText("O minutos desde casa para Inglés"), {
      target: { value: "15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Usar" }));
    expect(screen.queryByLabelText("O minutos desde casa para Inglés")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(screen.getByLabelText("O minutos desde casa para Inglés")).toBeTruthy();
  });
});

describe("Semana: la burbuja de un bloque", () => {
  it("se cierra al cambiar de semana", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    const pill = screen.getByTestId("week").querySelector<HTMLElement>(".pill.planned");
    if (!pill) throw new Error("no block");
    fireEvent.click(pill);
    expect(screen.getByRole("dialog")).toBeTruthy();
    const week = screen.getByTestId("week");
    fireEvent.touchStart(week, { touches: [{ clientX: 200, clientY: 300 }], timeStamp: 1000 });
    fireEvent.touchEnd(week, {
      changedTouches: [{ clientX: 80, clientY: 300 }],
      timeStamp: 1200,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("Semana: el aviso de «Deshacer» nombra el año de otra semana", () => {
  it("la semana de otro año lleva el año en el título", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    for (let i = 0; i < 8; i++) fireEvent.click(screen.getByLabelText("Semana siguiente"));
    expect(document.querySelector(".week-nav h1")?.textContent).toMatch(/2027/);
  });
});

describe("Lugares: un alias repetido", () => {
  it("«Guardar» lleva el foco al campo de alias, no al nombre", () => {
    const casa = { id: "casa", name: "Casa", aliases: ["Hogar"], isHome: true };
    const club = { id: "club", name: "Club", aliases: [] };
    render(<App fixedNow={NOW} initial={() => ({ ...demoData(NOW), places: [casa, club] })} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Lugares y traslados/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Editar Club/ }));
    const alias = screen.getByLabelText(/^Alias/);
    fireEvent.change(alias, { target: { value: "hogar" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(document.activeElement).toBe(alias);
  });
});
