import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { RoutineHours } from "./components/RoutineHours.js";
import { ActivitySettings } from "./components/Subjects.js";
import { ToastProvider, useToast } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { type MoveBounds, moveRefusal } from "./moveBounds.js";
import { emptyHoursForm } from "./routineHours.js";
import { reducer, replanChanged, StoreProvider } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-04", 8 * 60);
const MON = zonedInstant(TIMEZONE, "2026-11-02", 8 * 60);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

function need<T>(x: T | null | undefined): T {
  if (x === null || x === undefined) throw new Error("missing");
  return x;
}

const snackOf = () => need(document.querySelector<HTMLElement>(".snack"));
const noop = () => undefined;

function Say({ message, tone }: { message: string; tone?: "alert" }) {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show(message, { undo: noop, tone });
      }}
    >
      say
    </button>
  );
}

describe("17th round: the skip link is reachable with Tab in Safari", () => {
  it("«Saltar a las pestañas» has tabindex 0", () => {
    render(<App fixedNow={MON} initial={demoData} />);
    const link = screen.getByRole("link", { name: "Saltar a las pestañas" });
    expect(link.getAttribute("tabindex")).toBe("0");
  });
});

describe("17th round: «Reacomodar semana» with nothing to change", () => {
  it("never adds a version to the undo history after the first one, at any hour", () => {
    for (let h = 0; h < 7 * 24; h += 13) {
      const now = Date.UTC(2026, 10, 2, 3) + h * 3_600_000;
      const fresh = reducer(demoData(now), { type: "refresh", now });
      const once = reducer(fresh, { type: "replanWeek", now });
      const again = reducer(once, { type: "replanWeek", now: now + 60_000 });
      expect(again.planHistory?.length ?? 0).toBe(once.planHistory?.length ?? 0);
      // A version exists only when something moved.
      expect(once.planHistory?.length ?? 0).toBe(replanChanged(fresh, once) ? 1 : 0);
    }
  });
});

describe("17th round: only refusals are red", () => {
  it("a notice with «Deshacer» is neutral; one that says no is red", () => {
    render(
      <ToastProvider>
        <Say message="Corregido: ahora figura como hecho." />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("say"));
    expect(screen.getByText(/Corregido/)).toBeTruthy();
    expect(snackOf().classList.contains("alert")).toBe(false);
    expect(snackOf().classList.contains("short")).toBe(false);
    cleanup();
    render(
      <ToastProvider>
        <Say message="Ese horario ya pasó" tone="alert" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByText("say"));
    expect(snackOf().classList.contains("alert")).toBe(true);
  });

  it("deleting a materia is a neutral notice", () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    expect(screen.getByText(/Física I eliminada/)).toBeTruthy();
    expect(snackOf().classList.contains("alert")).toBe(false);
  });

  it("the refusal after the deadline names the task", () => {
    const bounds: MoveBounds = { from: 0, to: 1440, deadline: 600, title: "Parcial" };
    expect(moveRefusal(bounds, 700, 60)).toBe("Después de la entrega de Parcial no");
    expect(moveRefusal({ ...bounds, title: undefined }, 700, 60)).toBe("Después de la entrega no");
  });

  it("both hours of a routine's franja show the same format as an example", () => {
    render(<RoutineHours form={emptyHoursForm()} onChange={noop} problems={[]} errorId="e" />);
    expect(screen.getByLabelText(/^Desde/).getAttribute("placeholder")).toBe("7:00");
    expect(screen.getByLabelText(/^Hasta/).getAttribute("placeholder")).toBe("19:30");
  });
});

describe("17th round: after undoing a deleted materia the focus is on its row", () => {
  it("«Deshacer» focuses the restored materia", async () => {
    render(
      <StoreProvider initial={() => demoData(NOW)} persist={false} fixedNow={NOW}>
        <ToastProvider>
          <ActivitySettings />
        </ToastProvider>
      </StoreProvider>,
    );
    const head = demoData(NOW).activities.find((a) => a.name === "Física I")?.id;
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    await act(() => Promise.resolve());
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("data-activity-head")).toBe(head),
    );
  });
});
