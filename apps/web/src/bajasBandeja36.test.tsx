import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Places } from "./components/Places.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { mealNoRoom, optionLine } from "./friendly.js";
import type { AppEvent } from "./model.js";
import { StoreProvider } from "./store.js";

// Bajas de las vueltas 35 y 36: Bandeja y comidas.
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return zonedInstant(TIMEZONE, date, h * 60 + m);
};
const NOW = at("2026-11-05", "08:00");
const MON = at("2026-11-02", "08:00");

const jornada: AppEvent = {
  id: "Jornada",
  title: "Jornada",
  start: at("2026-11-10", "10:00"),
  end: at("2026-11-10", "17:00"),
  busy: true,
  source: "demo",
};
const withEvents = (events: AppEvent[]) => (now: number) => ({
  ...demoData(now),
  events,
  preferences: { holidaysOff: false },
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

describe("«Comidas sin lugar»", () => {
  it("no nombra «Hoy no» ni cita una franja", () => {
    const text = mealNoRoom("13:00");
    expect(text).not.toMatch(/Hoy no/);
    expect(text).not.toMatch(/\d\d:\d\d y las/);
    expect(text).toMatch(/13:00/);
    expect(text.length).toBeLessThan(80);
  });

  it("«Ver el día» marca y enfoca el día de la comida", { timeout: 30_000 }, () => {
    render(<App fixedNow={NOW} initial={withEvents([jornada])} />);
    fireEvent.click(screen.getByText("Bandeja"));
    fireEvent.click(screen.getByText("Ver el día"));
    const marked = document.querySelector(".day-head.marked");
    expect(marked?.textContent).toContain("10");
    expect(marked?.getAttribute("aria-current")).toBe("date");
    expect(document.activeElement).toBe(marked);
  });
});

describe("una comida salteada", () => {
  it("un toque abre sus opciones y no la restaura", { timeout: 30_000 }, () => {
    render(<App fixedNow={MON} initial={withEvents([])} />);
    fireEvent.click(screen.getByRole("button", { name: /^Almuerzo, lun 13:00/ }));
    fireEvent.click(screen.getByText("Hoy no almuerzo"));
    fireEvent.click(screen.getByLabelText(/sacado ese día, lun 13:00: volver a ponerlo/));
    expect(screen.queryByRole("button", { name: /^Almuerzo, lun 13:00/ })).toBeNull();
    fireEvent.click(screen.getByText("Volver a ponerlo"));
    expect(screen.getByRole("button", { name: /^Almuerzo, lun 13:00/ })).toBeTruthy();
  });

  it("doble toque en «no almuerzo» y Deshacer deja el almuerzo en su lugar", {
    timeout: 30_000,
  }, async () => {
    render(<App fixedNow={MON} initial={withEvents([])} />);
    fireEvent.click(screen.getByRole("button", { name: /^Almuerzo, lun 13:00/ }));
    fireEvent.click(screen.getByText("Hoy no almuerzo"));
    // El segundo toque cae donde estaba el botón: ahora el bloque salteado.
    fireEvent.click(screen.getByLabelText(/sacado ese día, lun 13:00: volver a ponerlo/));
    // Abre sus opciones sin cambiar nada; se cierra y Deshacer devuelve el almuerzo.
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Deshacer: mover o sacar una comida" }));
    await act(() => new Promise((r) => setTimeout(r, 30)));
    expect(screen.getByRole("button", { name: /^Almuerzo, lun 13:00/ })).toBeTruthy();
  });
});

describe("textos cortos", () => {
  it("el encabezado de Lugares es una línea", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <Places />
      </StoreProvider>,
    );
    const intro = document.getElementById("places-intro");
    expect(intro?.textContent?.length).toBeLessThan(80);
  });
});

describe("«No llegás a todo»", () => {
  const feasible = { kind: "drop", result: { feasible: true, status: [{ targetDeficit: 0 }] } };

  it("con una tarea que no entra y sigue corta, la opción no promete «llegás»", () => {
    const text = optionLine(feasible, false, ["Correr"]);
    expect(text).toMatch(/«Correr»/);
    expect(text).not.toMatch(/llegás a todos los mínimos\./);
  });

  it("sin tareas que no entren, la opción que alcanza lo dice", () => {
    expect(optionLine(feasible, false, null)).toBe("Con esto llegás a todos los mínimos.");
  });
});
