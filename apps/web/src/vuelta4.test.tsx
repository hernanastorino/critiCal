import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { ToastProvider } from "./components/Toast.js";
import { demoData, TIMEZONE } from "./demo.js";
import { localParts, MINUTE, zonedInstant } from "./engine.js";
import { time, weekdayShort } from "./format.js";
import type { AppData } from "./model.js";
import { reducer, StoreProvider } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

/** Keyboard moves: the first upcoming block, its pill focused in edit mode. */
function setup(tweak: (d: AppData, block: AppData["plan"][number]) => AppData) {
  const base = reducer(demoData(NOW), { type: "refresh", now: NOW });
  const block = base.plan
    .filter((b) => b.start > NOW)
    .sort((a, b) => a.start - b.start)[0] as AppData["plan"][number];
  const data = tweak(base, block);
  render(<App fixedNow={NOW} initial={() => data} />);
  fireEvent.click(screen.getByLabelText("Modo edición"));
  const tz = data.settings.timezone;
  const label = `${data.tasks.find((t) => t.id === block.taskId)?.title}, ${weekdayShort(tz, block.start)} ${time(tz, block.start)}`;
  const pill = [...document.querySelectorAll<HTMLElement>(".pill.planned.movable")].find((p) =>
    (p.getAttribute("aria-label") ?? "").startsWith(label),
  ) as HTMLElement;
  pill.focus();
  return { pill, block };
}
const pins = () =>
  (JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData).pins ?? [];

describe("keyboard moves keep the limits of a drop", () => {
  it("does not go past the task's deadline", () => {
    const { pill } = setup((d, b) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.id === b.taskId ? { ...t, deadline: b.end + 15 * MINUTE } : t)),
    }));
    fireEvent.keyDown(pill, { key: "ArrowDown" });
    expect(pins()).toHaveLength(0);
    expect(screen.getAllByText("Después de la entrega no").length).toBeGreaterThan(0);
  });

  it("does not go past «Nada de estudio desde»", () => {
    const { pill } = setup((d, b) => {
      const date = localParts(d.settings.timezone, b.start).date;
      const endMin = (b.end - zonedInstant(d.settings.timezone, date, 0)) / MINUTE;
      return {
        ...d,
        settings: {
          ...d.settings,
          week: d.settings.week.map((w) => ({ ...w, freeFrom: endMin + 10 })),
        },
      };
    });
    fireEvent.keyDown(pill, { key: "ArrowDown" });
    expect(pins()).toHaveLength(0);
    expect(screen.getAllByText("Fuera de tu horario de estudio").length).toBeGreaterThan(0);
  });

  it("does not leave the week on screen, and keeps the focus on a block it moves", () => {
    const { pill } = setup((d) => d);
    for (let i = 0; i < 8; i++)
      fireEvent.keyDown(document.activeElement ?? pill, { key: "ArrowRight" });
    for (const p of pins()) expect(localParts(TIMEZONE, p.start).date <= "2026-11-08").toBe(true);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("the silo form: all errors at once, impossible habits, no rutinas", () => {
  const editor = () =>
    render(
      <ToastProvider>
        <StoreProvider initial={demoData} persist={false} fixedNow={NOW}>
          <TaskEditor onClose={() => {}} />
        </StoreProvider>
      </ToastProvider>,
    );
  const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
  const save = () => fireEvent.click(screen.getByRole("button", { name: "Guardar" }));

  it("refuses 14 × 1440 min a week, beside the field, with the focus on it", () => {
    editor();
    fireEvent.click(screen.getByText("Hábito semanal"));
    type(screen.getByLabelText("Nombre"), "Maratón");
    type(screen.getByLabelText("Veces por semana"), "14");
    const minutes = screen.getByLabelText("Minutos por vez");
    type(minutes, "1440");
    save();
    expect(screen.getByText(/No entra en una semana/)).toBeTruthy();
    expect(minutes.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(minutes);
  });

  it("says an empty name and a minimum above the hours together", () => {
    editor();
    type(screen.getByLabelText("Horas estimadas"), "10");
    type(screen.getByLabelText("Mínimo (horas)"), "50");
    save();
    expect(screen.getByText("Poné un nombre")).toBeTruthy();
    expect(screen.getByText(/mínimo no puede ser mayor/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Parcial Física I"));
  });

  it("does not offer rutinas for an entrega, and starts with no parcial ticked", () => {
    editor();
    const optionNames = () =>
      [...screen.getByLabelText("Materia o actividad").querySelectorAll("option")].map(
        (o) => o.textContent,
      );
    const rutinas = demoData(NOW).activities.filter((a) => a.kind === "rutina");
    expect(rutinas.length).toBeGreaterThan(0);
    for (const r of rutinas) expect(optionNames()).not.toContain(r.name);
    expect((screen.getByLabelText(/Es un parcial/) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByText("Hábito semanal"));
    expect(screen.getByPlaceholderText("Leer 30 min")).toBeTruthy();
    expect(optionNames()).toContain(rutinas[0]?.name);
  });
});
