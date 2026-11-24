import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { Inbox } from "./components/Inbox.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { forgetImport } from "./importUndo.js";
import { StoreProvider } from "./store.js";

// Bajas de la 33.ª vuelta del agente atacante.
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

describe("Mi semana: Enter en un campo", () => {
  it("guarda, como el botón", async () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Mi semana/ }));
    const bed = screen.getByLabelText("Me acuesto");
    fireEvent.change(bed, { target: { value: "23:30" } });
    fireEvent.keyDown(bed, { key: "Enter" });
    await tick();
    expect(screen.getByText("Mi semana guardada")).toBeTruthy();
  });
});

describe("Mi semana: Enter en un campo de hora", () => {
  it("guarda desde «Me levanto»", async () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Mi semana/ }));
    const wake = screen.getByLabelText("Me levanto");
    fireEvent.change(wake, { target: { value: "07:00" } });
    fireEvent.keyDown(wake, { key: "Enter" });
    await tick();
    expect(screen.getByText("Mi semana guardada")).toBeTruthy();
  });

  it("con un error no guarda y manda el foco al primer campo marcado", async () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Mi semana/ }));
    const meal = screen.getByLabelText("Cena");
    fireEvent.change(meal, { target: { value: "03:00" } });
    fireEvent.keyDown(meal, { key: "Enter" });
    await tick();
    expect(screen.queryByText("Mi semana guardada")).toBeNull();
    const focused = document.activeElement;
    expect(focused instanceof HTMLElement && focused.matches('[aria-invalid="true"]')).toBe(true);
  });

  it("no deja párrafos explicativos", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByLabelText("Ajustes"));
    fireEvent.click(screen.getByRole("button", { name: /^Mi semana/ }));
    expect(screen.queryByText(/Siempre hay lugar para comer/)).toBeNull();
    expect(screen.queryByText(/No se planifica nada antes de/)).toBeNull();
    expect(screen.queryByText(/casi nunca cambia/)).toBeNull();
  });
});

describe("Bandeja: Enter en los minutos de «¿Dónde es?»", () => {
  it("el foco pasa a la tarjeta siguiente, a un botón y no al buscador de lugar", () => {
    const casa = { id: "casa", name: "Casa", aliases: [], isHome: true, address: "Rivera 1234" };
    const NOW2 = zonedInstant(TIMEZONE, "2026-11-03", 8 * 60);
    const event = (id: string, title: string, h: number) => ({
      id,
      title,
      start: zonedInstant(TIMEZONE, "2026-11-03", h * 60),
      end: zonedInstant(TIMEZONE, "2026-11-03", (h + 1) * 60),
      busy: true,
      location: `Lugar ${title}`,
      source: "google" as const,
    });
    render(
      <StoreProvider
        initial={() => ({
          ...emptyData(),
          places: [casa],
          events: [event("a", "Inglés", 18), event("b", "Francés", 19)],
        })}
        persist
        fixedNow={NOW2}
      >
        <ToastProvider>
          <Inbox />
        </ToastProvider>
      </StoreProvider>,
    );
    const first = screen.getAllByLabelText(/^O minutos desde casa para/).at(0);
    if (!first) throw new Error("falta el campo de minutos");
    first.focus();
    fireEvent.change(first, { target: { value: "15" } });
    fireEvent.keyDown(first, { key: "Enter" });
    expect(document.activeElement?.tagName).toBe("BUTTON");
  });
});
