import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { minutesError } from "./components/TaskDetail.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { progress } from "./planning.js";
import { reducer, StoreProvider } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo
const start = () => reducer(demoData(NOW), { type: "refresh", now: NOW });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  clearDrafts();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const openGym = () => {
  render(
    <StoreProvider initial={start} persist={false} fixedNow={NOW}>
      <ToastProvider>
        <Routines />
      </ToastProvider>
    </StoreProvider>,
  );
  fireEvent.click(screen.getByLabelText(/^Gym,/));
  return within(screen.getByRole("dialog", { name: "Gym" }));
};

const gymLeft = () => {
  const gym = progress(start(), NOW).find((p) => p.task.title === "Gym");
  if (!gym) throw new Error("Gym is not in the demo");
  return gym.remainingMinutes;
};

describe("minutesError con tope", () => {
  it("acepta hasta el tope y marca lo que lo pasa", () => {
    expect(minutesError("270", 270)).toBeNull();
    expect(minutesError("271", 270)).toBe("Poné minutos de 0 a 270, solo cifras.");
    expect(minutesError("1441")).toBe("Poné minutos de 0 a 1440, solo cifras.");
  });
});

describe("«Le dediqué» de una rutina", () => {
  it("no acepta más de lo que le falta esta semana y no guarda", () => {
    const left = gymLeft();
    expect(left).toBeGreaterThan(0);
    const hoja = openGym();
    const field = hoja.getByLabelText("Le dediqué (minutos)");
    fireEvent.change(field, { target: { value: String(left + 1) } });
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(hoja.getByRole("alert").textContent).toBe(`Poné minutos de 0 a ${left}, solo cifras.`);
    fireEvent.click(hoja.getByRole("button", { name: "Guardar avance" }));
    expect(screen.queryByText(/^Avance guardado/)).toBeNull();
    fireEvent.change(field, { target: { value: String(left) } });
    expect(field.getAttribute("aria-invalid")).toBeNull();
    fireEvent.click(hoja.getByRole("button", { name: "Guardar avance" }));
    expect(screen.getByText(/^Avance guardado/)).toBeTruthy();
  });

  it("con la semana completa no ofrece registrar", () => {
    const hoja = openGym();
    fireEvent.change(hoja.getByLabelText("Le dediqué (minutos)"), {
      target: { value: String(gymLeft()) },
    });
    fireEvent.click(hoja.getByRole("button", { name: "Guardar avance" }));
    fireEvent.click(screen.getByLabelText(/^Gym,/));
    const otra = within(screen.getByRole("dialog", { name: "Gym" }));
    expect(otra.getByText(/ya está completa/)).toBeTruthy();
    expect(otra.queryByLabelText("Le dediqué (minutos)")).toBeNull();
    expect(otra.queryByRole("button", { name: "Guardar avance" })).toBeNull();
  });
});
