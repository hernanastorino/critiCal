import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { WeekSettings } from "./components/Preferences.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { demoData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { standingCheckIns } from "./planning.js";
import { reducer, StoreProvider, seedHistory, useStore } from "./store.js";
import { tapDone } from "./testDone.js";
import { pickMateria } from "./testing.js";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const start = () => reducer(demoData(NOW), { type: "refresh", now: NOW });

/** A silo that has blocks ahead, and a way to count them. */
function withBlocks() {
  const d = start();
  const task = d.tasks.find((t) => d.plan.some((b) => b.taskId === t.id && b.start > NOW));
  if (!task) throw new Error("the demo has no silo with blocks ahead");
  const future = (x: AppData) => x.plan.filter((b) => b.taskId === task.id && b.start > NOW);
  return { d, task, future };
}

describe("closing a silo takes its future blocks out of the plan", () => {
  it("when it is done, dropped or past its deadline", () => {
    const { d, task, future } = withBlocks();
    expect(future(d).length).toBeGreaterThan(0);
    for (const over of [
      { status: "done" as const },
      { status: "dropped" as const },
      { deadline: NOW - 1000 },
    ]) {
      const next = reducer(d, { type: "saveTask", task: { ...task, ...over }, now: NOW });
      expect(future(next)).toEqual([]);
    }
  });

  it("an undone reorganization does not bring back a closed silo", () => {
    const { d, task, future } = withBlocks();
    const replanned = reducer(d, { type: "replanWeek", now: NOW });
    const closed = reducer(replanned, {
      type: "saveTask",
      task: { ...task, status: "done" },
      now: NOW,
    });
    const back = reducer(closed, { type: "undoPlan", now: NOW });
    expect(future(back)).toEqual([]);
  });
});

const MON = zonedInstant(TIMEZONE, "2026-11-02", 17 * 60 + 50);
const seeded = (now: number) =>
  seedHistory({ ...demoData(now), preferences: { holidaysOff: false } }, now);

let latest: AppData | null = null;
function Probe() {
  latest = useStore().data;
  return null;
}

describe("Bandeja: a double tap answers one block, and it can be undone", {
  timeout: 30_000,
}, () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ignores the second tap and offers Deshacer", () => {
    // The guard against a double tap lasts 700 ms of the real clock: on a loaded runner the
    // second tap came later than that and counted as a new answer. The clock stands still.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    render(<App fixedNow={MON} initial={seeded} />);
    fireEvent.click(screen.getByRole("button", { name: /Bandeja/ }));
    expect(screen.getAllByLabelText(/^Hecho:/)).toHaveLength(2);
    tapDone(screen.getAllByLabelText(/^Hecho:/)[0] as HTMLElement);
    // The list moved: the next item is under the finger now, and the tap is lost.
    fireEvent.click(screen.getAllByLabelText(/^Hecho:/)[0] as HTMLElement);
    expect(screen.getAllByLabelText(/^Hecho:/)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(screen.getAllByLabelText(/^Hecho:/)).toHaveLength(2);
  });
});

describe("Registrar avance", { timeout: 30_000 }, () => {
  afterEach(cleanup);

  it("refuses minutes that are negative, not a figure or over the hours awake, next to the field", () => {
    const closed = vi.fn();
    const task = demoData(MON).tasks.find((t) => t.kind === "deliverable") as AppData["tasks"][0];
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <TaskDetail task={task} onEdit={() => {}} onClose={closed} />
        <Probe />
      </StoreProvider>,
    );
    const before = (latest as AppData | null)?.checkIns.length;
    for (const bad of ["-500", "1e2", "abc", "901", "1441"]) {
      fireEvent.change(screen.getByPlaceholderText("40"), { target: { value: bad } });
      expect(screen.getByRole("alert").textContent).toMatch(/0 a 900,/);
      fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    }
    expect(closed).not.toHaveBeenCalled();
    expect((latest as AppData | null)?.checkIns.length).toBe(before);
    fireEvent.change(screen.getByPlaceholderText("40"), { target: { value: "90" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Guardar avance" }));
    expect(closed).toHaveBeenCalled();
  });
});

/** Opens Ajustes on one of its sections. */
function openSettings(section?: string) {
  fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
  if (section) fireEvent.click(screen.getByText(section, { selector: ".settings-label" }));
}

describe("Ajustes keeps its notices", { timeout: 30_000 }, () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
  });
  afterEach(cleanup);

  it("«Eliminar materia» can still be undone once Ajustes is closed", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    openSettings("Materias");
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    openSettings();
    expect(screen.getByRole("button", { name: /^Materias, 3/ })).toBeTruthy();
  });

  it("two deleted with Ajustes closed and opened in between share one Deshacer", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    for (const name of ["Física I", "Programación"]) {
      openSettings("Materias");
      fireEvent.click(screen.getByText(name));
      fireEvent.click(screen.getByText(`Eliminar ${name}`));
      fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);
    }
    expect(screen.getByText(/2 eliminadas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    openSettings();
    expect(screen.getByRole("button", { name: /^Materias, 3/ })).toBeTruthy();
  });

  it("«Reiniciar demo» is immediate, says so and can be undone", () => {
    render(<App fixedNow={MON} initial={seeded} />);
    openSettings("Materias");
    fireEvent.click(screen.getByText("Física I"));
    fireEvent.click(screen.getByText("Eliminar Física I"));
    fireEvent.click(screen.getAllByLabelText("Cerrar")[0] as HTMLElement);
    openSettings();
    expect(screen.getByRole("button", { name: /^Materias, 2/ })).toBeTruthy();
    fireEvent.click(screen.getByText("Reiniciar demo"));
    // Nothing asked: the demo starts over and the notice offers the way back.
    expect(screen.getByText("Demo reiniciada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    openSettings();
    expect(screen.getByRole("button", { name: /^Materias, 2/ })).toBeTruthy();
  });
});

describe("Mi semana: changing days keeps what was typed", { timeout: 30_000 }, () => {
  afterEach(cleanup);

  it("does not drop an unsaved edit when the selection of days changes", () => {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <WeekSettings />
      </StoreProvider>,
    );
    const wake = () => (screen.getByLabelText("Me levanto") as HTMLInputElement).value;
    fireEvent.change(screen.getByLabelText("Me levanto"), { target: { value: "09:15" } });
    // Leaving a day, adding another one and coming back: the edit is still there.
    fireEvent.click(screen.getByRole("button", { name: "viernes" }));
    expect(wake()).toBe("09:15");
    fireEvent.click(screen.getByRole("button", { name: "sábado" }));
    expect(wake()).toBe("09:15");
    fireEvent.click(screen.getByRole("button", { name: "viernes" }));
    expect(wake()).toBe("09:15");
    expect(screen.getByText("Cambios sin guardar")).toBeTruthy();
  });
});

describe("the silo form says what is wrong, beside the field", { timeout: 30_000 }, () => {
  afterEach(cleanup);

  function renderEditor() {
    render(
      <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
        <TaskEditor onClose={() => {}} />
        <Probe />
      </StoreProvider>,
    );
    pickMateria();
    return {
      name: screen.getByLabelText("Nombre"),
      estimate: screen.getByLabelText("Horas estimadas"),
      minimum: screen.getByLabelText("Mínimo (horas)"),
      save: screen.getByRole("button", { name: "Guardar" }) as HTMLButtonElement,
    };
  }
  const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

  it("asks for a name instead of saving «Sin título»", () => {
    const { save } = renderEditor();
    const tasks = (latest as AppData | null)?.tasks.length;
    fireEvent.click(save);
    expect(screen.getByRole("alert").textContent).toBe("Poné un nombre");
    expect((latest as AppData | null)?.tasks.length).toBe(tasks);
  });

  it("refuses a minimum above the estimate, and hours that are negative or not figures", () => {
    const { name, estimate, minimum, save } = renderEditor();
    type(name, "Parcial");
    type(estimate, "2");
    type(minimum, "3");
    expect(save.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/mínimo no puede ser mayor/);
    expect(minimum.getAttribute("aria-invalid")).toBe("true");
    type(minimum, "1");
    expect(save.getAttribute("aria-disabled")).toBeNull();
    for (const bad of ["-2", "1e2", "abc"]) {
      type(estimate, bad);
      expect(save.getAttribute("aria-disabled")).toBe("true");
      expect(estimate.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
    }
  });

  it("warns, without blocking, about a deadline in the past", () => {
    const { name, save } = renderEditor();
    type(name, "Parcial");
    type(screen.getByLabelText("Fecha límite"), "2026-10-01T10:00");
    expect(screen.getByRole("status").textContent).toMatch(/ya pasó/);
    expect(save.getAttribute("aria-disabled")).toBeNull();
  });

  it("refuses a new part whose minutes are negative or not a number", () => {
    renderEditor();
    const part = screen.getByLabelText("Nueva parte: nombre y minutos entre paréntesis");
    for (const bad of ["Práctico (-30)", "Práctico (1,5)", "Práctico (0)", "Práctico (70000)"]) {
      type(part, bad);
      fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
      expect(screen.getByRole("alert").textContent).toMatch(/entre paréntesis/);
    }
    type(part, "Práctico (45)");
    fireEvent.click(screen.getByRole("button", { name: "Agregar" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Práctico")).toBeTruthy();
    expect(screen.getByText("45 min")).toBeTruthy();
  });
});

describe("undoCheckIn", () => {
  it("removes the check-in and reopens the parts it marked done", () => {
    const d = start();
    const task = d.tasks.find((t) => t.units.some((u) => !u.doneAt));
    if (!task) throw new Error("no silo with open parts");
    const unit = task.units.find((u) => !u.doneAt);
    const logged = reducer(d, {
      type: "logProgress",
      taskId: task.id,
      minutes: 30,
      unitIds: [unit?.id as string],
      now: NOW,
    });
    const id = logged.checkIns.at(-1)?.id as string;
    expect(logged.checkIns).toHaveLength(d.checkIns.length + 1);
    const undone = reducer(logged, { type: "undoCheckIn", id, now: NOW });
    expect(standingCheckIns(undone)).toHaveLength(standingCheckIns(d).length);
    expect(
      undone.tasks.find((t) => t.id === task.id)?.units.find((u) => u.id === unit?.id)?.doneAt,
    ).toBeUndefined();
    expect(reducer(undone, { type: "undoCheckIn", id, now: NOW })).toBe(undone);
  });
});
