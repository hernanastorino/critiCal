import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DetectedDefaults } from "./components/Preferences.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import { StoreProvider } from "./store.js";
import { detectedProblem, estimateProblem } from "./taskForm.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

function inside(ui: React.ReactNode) {
  render(
    <ToastProvider>
      <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
        {ui}
      </StoreProvider>
    </ToastProvider>,
  );
}
function click(name: string | RegExp) {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}
function set(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
const alerts = () => screen.queryAllByRole("alert").map((a) => a.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

describe("2. Nueva entrega: un solo resumen de errores", () => {
  const pickStart = (mode: string) => {
    set("Puedo empezar", mode);
  };
  const lateDate = () => {
    set("Desde el día", "2027-01-10");
  };

  it("«Puedo empezar» typed badly counts in the summary, not as its own alert", () => {
    inside(<TaskEditor onClose={vi.fn()} />);
    pickStart("in");
    set("Dentro de cuántos días", "x");
    click("Guardar");
    // The empty name and the start: two errors, one summary.
    expect(alerts()).toEqual(["Hay 2 campos para corregir: están marcados arriba."]);
  });

  it("a start after the deadline is said in its field, which takes the focus", () => {
    inside(<TaskEditor onClose={vi.fn()} />);
    set("Nombre", "Entrega");
    pickStart("date");
    lateDate();
    const select = screen.getByLabelText("Puedo empezar");
    expect(select.getAttribute("aria-invalid")).toBe("true");
    expect(alerts().join(" ")).toMatch(/Tiene que ser antes de la entrega/);
    click("Guardar");
    expect(document.activeElement).toBe(select);
  });

  it("with another error too, the start error joins the summary", () => {
    inside(<TaskEditor onClose={vi.fn()} />);
    pickStart("date");
    lateDate();
    click("Guardar");
    expect(alerts()).toEqual(["Hay 2 campos para corregir: están marcados arriba."]);
  });
});

describe("3. Horas casi cero", () => {
  it("rejects hours that round to 0 minutes", () => {
    for (const v of ["0,001", "0,004", "0.002"]) {
      expect(estimateProblem(v, 0)).toMatch(/no pueden ser 0/);
    }
    expect(estimateProblem("0,01", 0)).toBeNull();
  });

  it("«Horas para lo detectado» says it too", () => {
    expect(detectedProblem("0,001", "0,001")?.text).toMatch(/no pueden ser 0/);
    inside(<DetectedDefaults />);
    set("Horas de Entrega", "0,004");
    click("Guardar horas");
    expect(alerts().join(" ")).toMatch(/Las horas no pueden ser 0/);
  });
});
