import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Routines } from "./components/Preferences.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { demoData } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider, useStore } from "./store.js";

afterEach(cleanup);

const MON = zonedInstant("America/Montevideo", "2026-11-02", 17 * 60 + 50);

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

describe("Rutinas", () => {
  const renderRoutines = () => {
    const view = render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <Spy />
        <Routines />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Crear rutina nueva" }));
    return view;
  };

  it("says every wrong field at once, not one by one", () => {
    renderRoutines();
    fireEvent.change(screen.getByLabelText("Veces/sem."), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText("Minutos"), { target: { value: "999" } });
    expect(screen.getAllByRole("alert").map((a) => a.textContent)).toEqual([
      expect.stringMatching(/1 a 14/),
      expect.stringMatching(/1 a 360/),
    ]);
    expect(screen.getByLabelText("Veces/sem.").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Minutos").getAttribute("aria-invalid")).toBe("true");
  });

  it("adds the routine with Enter from any of its fields", () => {
    renderRoutines();
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: "Natación" } });
    fireEvent.keyDown(screen.getByLabelText("Minutos"), { key: "Enter" });
    expect(latest?.activities.some((a) => a.name === "Natación")).toBe(true);
  });

  it("does not add with Enter while a field is wrong", () => {
    renderRoutines();
    fireEvent.change(screen.getByLabelText("Rutina"), { target: { value: "Natación" } });
    fireEvent.change(screen.getByLabelText("Veces/sem."), { target: { value: "0" } });
    fireEvent.keyDown(screen.getByLabelText("Veces/sem."), { key: "Enter" });
    expect(latest?.activities.some((a) => a.name === "Natación")).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("Veces/sem."));
  });
});

describe("hoja del silo: partes hechas", () => {
  it("a part marked done can be unmarked, and the left-over time goes back", () => {
    const base = demoData(MON).tasks.find((x) => x.kind === "deliverable") as AppTask;
    const withParts: AppTask = {
      ...base,
      estimateMinutes: 600,
      minMinutes: 120,
      units: [
        { id: "a", title: "Tema A", estimateMinutes: 300, doneAt: MON - 1000 },
        { id: "b", title: "Tema B", estimateMinutes: 300 },
      ],
    };
    render(
      <StoreProvider
        initial={(now) => ({ ...demoData(now), tasks: [withParts] })}
        persist={false}
        fixedNow={MON}
      >
        <Spy />
        <TaskDetail task={withParts} onEdit={() => {}} onClose={() => {}} />
      </StoreProvider>,
    );
    const a = screen.getByRole("checkbox", { name: "Tema A" }) as HTMLInputElement;
    expect(a.checked).toBe(true);
    fireEvent.click(a);
    expect(a.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    const saved = latest?.tasks.find((t) => t.id === withParts.id);
    expect(saved?.units.find((u) => u.id === "a")?.doneAt).toBeUndefined();
    expect(saved?.units.find((u) => u.id === "b")?.doneAt).toBeUndefined();
  });
});

describe("Editar entrega: horas estimadas y partes", () => {
  const task = (): AppTask => {
    const t = demoData(MON).tasks.find((x) => x.kind === "deliverable") as AppTask;
    return {
      ...t,
      estimateMinutes: 600,
      minMinutes: 120,
      units: [
        { id: "a", title: "Tema A", estimateMinutes: 300 },
        { id: "b", title: "Tema B", estimateMinutes: 300 },
      ],
    };
  };

  it("does not take 0 hours when the parts add up to 10 h", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <Spy />
        <TaskEditor task={task()} onClose={() => {}} />
      </StoreProvider>,
    );
    const hours = screen.getByLabelText("Horas estimadas");
    fireEvent.change(hours, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(hours.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/partes suman 10 h/);
    expect(document.activeElement).toBe(hours);
  });
});
