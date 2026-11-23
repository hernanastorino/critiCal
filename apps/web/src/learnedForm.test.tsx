import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { clearDrafts } from "./drafts.js";
import { zonedInstant } from "./engine.js";
import type { AppData, AppTask } from "./model.js";
import { StoreProvider } from "./store.js";

const NOW = zonedInstant(TIMEZONE, "2026-11-18", 12 * 60);

const open = (tasks: AppTask[]) =>
  render(
    <ToastProvider>
      <StoreProvider
        initial={(now): AppData => ({ ...demoData(now), tasks })}
        persist={false}
        fixedNow={NOW}
      >
        <TaskEditor onClose={vi.fn()} />
      </StoreProvider>
    </ToastProvider>,
  );

const typed = (label: string): string => screen.getByLabelText<HTMLInputElement>(label).value;

const exam = (o: Partial<AppTask>): AppTask => ({
  id: "p1",
  activityId: demoData(NOW).activities.find((a) => a.kind !== "rutina")?.id ?? "",
  title: "Parcial anterior",
  kind: "deliverable",
  estimateMinutes: 600,
  minMinutes: 300,
  priority: 2,
  status: "done",
  units: [],
  exam: true,
  ...o,
});

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  clearDrafts();
});

describe("valores por defecto aprendidos en el formulario (SPEC §18.1)", () => {
  it("sin historia trae las horas fijas y no dice nada", () => {
    open([]);
    expect(typed("Horas estimadas")).toBe("4");
    expect(typed("Mínimo (horas)")).toBe("2");
    expect(screen.queryByText(/anteriores/)).toBeNull();
  });

  it("al marcar «Es un parcial» propone las horas de los parciales anteriores y lo dice", () => {
    open([exam({})]);
    expect(typed("Horas estimadas")).toBe("4");
    fireEvent.click(screen.getByLabelText(/Es un parcial/));
    expect(typed("Horas estimadas")).toBe("10");
    expect(typed("Mínimo (horas)")).toBe("5");
    expect(screen.getByText(/Como tus parciales anteriores/)).toBeTruthy();
  });

  it("lo que el usuario escribió no se pisa", () => {
    open([exam({})]);
    fireEvent.change(screen.getByLabelText("Horas estimadas"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText(/Es un parcial/));
    expect(typed("Horas estimadas")).toBe("3");
    expect(screen.queryByText(/Como tus parciales/)).toBeNull();
  });
});
