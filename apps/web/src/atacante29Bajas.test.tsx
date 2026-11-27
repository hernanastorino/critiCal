import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Silos } from "./components/Silos.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";

// Bajas de la 29.ª vuelta del agente atacante.
const NOW = zonedInstant(TIMEZONE, "2026-11-23", 15 * 60);
const RLO = String.fromCharCode(0x202e);
const ZWSP = String.fromCharCode(0x200b);
const DIRTY = `  Zeta${RLO}${ZWSP}   uno  `;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}
const inside = (ui: React.ReactNode, initial: () => AppData) =>
  render(
    <ToastProvider>
      <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
        <Spy />
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );

describe("nombres sin espacios de más ni invisibles en el dato", () => {
  it("rutina y materia nueva se guardan limpias", () => {
    let d = reducer(demoData(NOW), {
      type: "saveRoutine",
      name: DIRTY,
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      now: NOW,
    });
    expect(d.activities.some((a) => a.name === "Zeta uno")).toBe(true);
    d = reducer(d, { type: "newSubject", name: `  Otra${ZWSP}   materia `, now: NOW });
    expect(d.activities.some((a) => a.name === "Otra materia")).toBe(true);
  });

  it("«+ Nueva…» guarda el nombre limpio y con la etiqueta de materia", () => {
    inside(<TaskEditor onClose={() => undefined} />, () => demoData(NOW));
    fireEvent.change(screen.getByLabelText("Materia o actividad"), { target: { value: "new" } });
    fireEvent.change(screen.getByLabelText("Nombre de la materia"), { target: { value: DIRTY } });
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: `  TP${ZWSP}   final ` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    const zeta = latest?.activities.find((a) => a.name === "Zeta uno");
    expect(zeta?.kind).toBe("materia");
    expect(latest?.tasks.some((t) => t.title === "TP final")).toBe(true);
  });
});

describe("«falta / asignado» con la unidad en el número", () => {
  it("dice «1h40 / 1h40», no «de»", () => {
    inside(<Silos />, () => seedHistory(demoData(NOW), NOW));
    expect(document.querySelector(".pvd")?.textContent).toMatch(/\d+h(\d\d)? \/ \d+h/);
    expect(document.querySelector(".pvd")?.textContent).not.toMatch(/ de \d/);
  });
});
