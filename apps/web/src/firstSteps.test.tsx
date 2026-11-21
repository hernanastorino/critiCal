import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_STEPS_KEY, FirstStepsCard, resumeFirstSteps } from "./components/FirstSteps.js";
import { demoData, emptyData } from "./demo.js";
import { StoreProvider } from "./store.js";

// Monday 2026-11-02, evening.
const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
});
afterEach(cleanup);

const show = (google: boolean, initial: typeof demoData = emptyData) => {
  const onSettings = vi.fn();
  render(
    <StoreProvider initial={initial} persist={false} fixedNow={NOW}>
      <FirstStepsCard google={google} onSettings={onSettings} />
    </StoreProvider>,
  );
  return onSettings;
};

describe("first-use guide (SPEC §14)", () => {
  it("does not start at zero: connecting Google already counts", () => {
    show(true);
    expect(screen.getByText("Primeros pasos · 1 de 3")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
  });

  it("offers the next step: Google first, then the first materia", () => {
    const onSettings = show(false);
    fireEvent.click(screen.getByRole("button", { name: "Conectar Google" }));
    expect(onSettings).toHaveBeenCalledWith("calendars");
    cleanup();
    const next = show(true);
    fireEvent.click(screen.getByRole("button", { name: "Cargar materias" }));
    expect(next).toHaveBeenCalledWith("semester");
  });

  it("with a task, the last step shows the plan and the guide goes away", () => {
    show(true, demoData);
    expect(screen.getByText("Primeros pasos · 2 de 3")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ver mi plan" }));
    expect(screen.queryByText(/Primeros pasos/)).toBeNull();
    expect(localStorage.getItem(FIRST_STEPS_KEY)).toBe("done");
  });

  it("can be skipped and comes back from Ajustes", () => {
    show(false);
    fireEvent.click(screen.getByRole("button", { name: "Saltar por ahora" }));
    expect(screen.queryByText(/Primeros pasos/)).toBeNull();
    cleanup();
    resumeFirstSteps();
    show(false);
    expect(screen.getByText("Primeros pasos · 0 de 3")).toBeTruthy();
  });
});
