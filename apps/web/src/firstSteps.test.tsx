import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRST_STEPS_KEY,
  FirstStepsCard,
  firstStepsDone,
  resumeFirstSteps,
} from "./components/FirstSteps.js";
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

  it("counts the steps: the plan step needs a plan with a block", () => {
    expect(firstStepsDone({ google: true, tasks: true, plan: false })).toEqual([true, true, false]);
    expect(firstStepsDone({ google: true, tasks: true, plan: true })).toEqual([true, true, true]);
  });

  it("with everything done it closes once with «Listo» and never comes back", () => {
    show(true, demoData);
    expect(screen.getByText("Primeros pasos · Listo")).toBeTruthy();
    expect(localStorage.getItem(FIRST_STEPS_KEY)).toBe("done");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByText(/Primeros pasos/)).toBeNull();
    cleanup();
    show(true, demoData);
    expect(screen.queryByText(/Primeros pasos/)).toBeNull();
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

  it("Ajustes › Primeros pasos starts it on the week at once, without remounting it", () => {
    show(false);
    fireEvent.click(screen.getByRole("button", { name: "Saltar por ahora" }));
    expect(screen.queryByText(/Primeros pasos/)).toBeNull();
    // The week stays mounted behind the settings sheet.
    act(() => resumeFirstSteps());
    expect(screen.getByText("Primeros pasos · 0 de 3")).toBeTruthy();
  });

  it("a new account on a device where another one skipped it starts the guide on its own", () => {
    const withOwner = (owner: string) => () => ({ ...emptyData(), owner });
    const first = withOwner("cuenta-vieja");
    const { unmount } = render(
      <StoreProvider initial={first} persist={false} fixedNow={NOW}>
        <FirstStepsCard google={false} onSettings={vi.fn()} />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Saltar por ahora" }));
    expect(screen.queryByText(/Primeros pasos/)).toBeNull();
    unmount();
    render(
      <StoreProvider initial={withOwner("cuenta-nueva")} persist={false} fixedNow={NOW}>
        <FirstStepsCard google={false} onSettings={vi.fn()} />
      </StoreProvider>,
    );
    expect(screen.getByText("Primeros pasos · 0 de 3")).toBeTruthy();
  });
});
