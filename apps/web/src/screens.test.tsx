import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { exportJson, parseBackup } from "./backup.js";
import { Backup } from "./components/Backup.js";
import { Semester } from "./components/Semester.js";
import { diffData } from "./data.js";
import { demoData, emptyData, TIMEZONE } from "./demo.js";
import { zonedInstant } from "./engine.js";
import { easter, holidaysBetween, uruguayHolidays, withHolidays } from "./holidays.js";
import { scheduleInput } from "./planning.js";
import { StoreProvider, useStore } from "./store.js";
import { plannedVsDone, weekPlan, weekToPlan } from "./week-review.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

const tz = TIMEZONE;
const at = (date: string, minutes: number) => zonedInstant(tz, date, minutes);

describe("Uruguay's holidays", () => {
  it("follows Easter and the Monday rule", () => {
    expect(easter(2026)).toBe("2026-04-05");
    expect(easter(2027)).toBe("2027-03-28");
    const y2026 = uruguayHolidays(2026);
    const on = (date: string) => y2026.find((h) => h.date === date)?.name;
    expect(on("2026-02-16")).toBe("Carnaval");
    expect(on("2026-02-17")).toBe("Carnaval");
    expect(on("2026-04-02")).toBe("Semana de Turismo");
    // 19 Apr 2026 is a Sunday: stays. 18 May is a Monday: stays. 12 Oct is a Monday.
    expect(on("2026-04-19")).toBe("Desembarco de los 33 Orientales");
    expect(on("2026-05-18")).toBe("Batalla de Las Piedras");
    // 2027: 19 Apr is a Monday; 18 May a Tuesday → Monday 17; 12 Oct a Tuesday → Monday 11.
    const y2027 = uruguayHolidays(2027).map((h) => h.date);
    expect(y2027).toContain("2027-05-17");
    expect(y2027).toContain("2027-10-11");
    // 2029: 19 Apr is a Thursday → Monday 23.
    expect(uruguayHolidays(2029).map((h) => h.date)).toContain("2029-04-23");
    expect(on("2026-11-02")).toBe("Día de los Difuntos");
  });

  it("lists holidays in a range, across years", () => {
    expect(holidaysBetween("2026-12-20", "2027-01-10").map((h) => h.name)).toEqual([
      "Navidad",
      "Año Nuevo",
      "Día de Reyes",
    ]);
  });

  it("plans holidays as Sundays, keeping the user's own wake-up", () => {
    const from = at("2026-11-01", 0);
    const to = at("2026-11-04", 0);
    expect(withHolidays([{ date: "2026-11-02", wake: 600 }], tz, from, to)).toEqual([
      { asWeekday: 0, date: "2026-11-02", wake: 600 },
    ]);
    const data = demoData(at("2026-11-01", 600));
    expect(scheduleInput(data, at("2026-11-01", 600), []).overrides).toContainEqual(
      expect.objectContaining({ date: "2026-11-02", asWeekday: 0 }),
    );
    const off = { ...data, preferences: { holidaysOff: false } };
    expect(scheduleInput(off, at("2026-11-01", 600), []).overrides).toEqual(off.overrides);
  });
});

describe("weekly review", () => {
  it("plans next week on weekends and the current one otherwise", () => {
    const data = emptyData();
    expect(weekToPlan(data, at("2026-11-08", 600))[0]).toBe("2026-11-09");
    expect(weekToPlan(data, at("2026-11-04", 600))[0]).toBe("2026-11-02");
  });

  it("sums each day and compares planned with done", () => {
    const data = {
      ...emptyData(),
      activities: [
        {
          id: "a",
          name: "Mate",
          color: "#f80",
          academic: true,
          maxSessionMinutes: 120,
          minBlockMinutes: 60,
        },
      ],
      tasks: [
        {
          id: "t",
          activityId: "a",
          title: "Parcial",
          kind: "deliverable" as const,
          estimateMinutes: 600,
          minMinutes: 300,
          priority: 2,
          status: "active" as const,
          units: [],
        },
      ],
      plan: [
        {
          id: "b1",
          taskId: "t",
          activityId: "a",
          start: at("2026-11-03", 600),
          end: at("2026-11-03", 720),
          level: "critical" as const,
        },
        {
          id: "b2",
          taskId: "t",
          activityId: "a",
          start: at("2026-11-05", 600),
          end: at("2026-11-05", 660),
        },
      ],
      checkIns: [
        {
          id: "c",
          blockId: "b1",
          taskId: "t",
          status: "partial" as const,
          minutesDone: 90,
          unitIds: [],
          createdAt: at("2026-11-03", 720),
        },
      ],
    };
    const days = weekPlan(data, weekToPlan(data, at("2026-11-04", 600)));
    expect(days[1]).toMatchObject({ date: "2026-11-03", minutes: 120, critical: 1 });
    expect(days[0]?.holiday).toBe("Día de los Difuntos");
    expect(plannedVsDone(data, at("2026-11-04", 600))).toEqual([
      { taskId: "t", title: "Parcial", color: "#f80", planned: 120, done: 90 },
    ]);
  });

  it("opens from the Sunday notification", async () => {
    window.history.replaceState(null, "", "/?plan=week");
    render(<App fixedNow={at("2026-11-08", 19 * 60)} initial={demoData} />);
    fireEvent.click(screen.getByText("Probar con datos de ejemplo"));
    expect(await screen.findByRole("dialog", { name: "Planificación semanal" })).toBeTruthy();
    expect(screen.getByText("Críticos de la semana")).toBeTruthy();
    fireEvent.click(screen.getByText("Listo"));
    expect(screen.queryByRole("dialog", { name: "Planificación semanal" })).toBeNull();
  });
});

function Probe() {
  const { data } = useStore();
  return (
    <output data-testid="state">
      {JSON.stringify({
        activities: data.activities.map((a) => a.name),
        tasks: data.tasks.map((t) => [t.title, t.kind, t.minMinutes]),
        semester: data.preferences?.semester,
        holidaysOff: data.preferences?.holidaysOff,
        checkIns: data.checkIns.map((c) => c.id),
        doneUnits: data.tasks.flatMap((t) => t.units.filter((u) => u.doneAt).map((u) => u.id)),
      })}
    </output>
  );
}
const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}");

describe("semester start", () => {
  it("saves the dates, lists holidays and adds subjects and exams", async () => {
    const now = at("2026-08-01", 600);
    const { container } = render(
      <StoreProvider initial={emptyData} persist={false} fixedNow={now}>
        <Semester />
        <Probe />
      </StoreProvider>,
    );
    const details = container.querySelector("details") as HTMLDetailsElement;
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new Event("toggle"));
    });
    fireEvent.change(screen.getByLabelText("Termina"), { target: { value: "2026-11-30" } });
    expect(screen.getByText(/Declaratoria de la Independencia/)).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Guardar fechas")));
    expect(state().semester).toEqual({ start: "2026-08-01", end: "2026-11-30" });

    fireEvent.change(screen.getByPlaceholderText("Física II"), { target: { value: "Física II" } });
    fireEvent.change(screen.getByLabelText("Mínimo semanal (h)"), { target: { value: "3" } });
    await act(async () => fireEvent.click(screen.getByText("Agregar materia")));
    fireEvent.change(screen.getByPlaceholderText("Física II"), { target: { value: "Inglés" } });
    await act(async () => fireEvent.click(screen.getByText("Agregar materia")));
    expect(state().activities).toEqual(["Física II", "Inglés"]);
    expect(state().tasks).toEqual([["Estudio Física II", "habit", 180]]);

    fireEvent.change(screen.getByLabelText("De la materia"), {
      target: {
        value: (screen.getByRole("option", { name: "Inglés" }) as HTMLOptionElement).value,
      },
    });
    fireEvent.change(screen.getByLabelText("Fecha"), { target: { value: "2026-09-20" } });
    await act(async () => fireEvent.click(screen.getByText("Agregar")));
    expect(state().tasks.at(-1)).toEqual(["Parcial", "deliverable", expect.any(Number)]);

    await act(async () =>
      fireEvent.click(screen.getByLabelText("Los feriados se planifican como domingo")),
    );
    expect(state().holidaysOff).toBe(false);
  });
});

describe("restoring into the database", () => {
  it("deletes subjects and day changes the backup does not have", () => {
    const now = at("2026-11-04", 600);
    const before = { ...demoData(now), overrides: [{ date: "2026-11-05", wake: 600 }] };
    const restored = { ...before, activities: before.activities.slice(1), overrides: [] };
    const w = diffData(before, restored);
    expect(w.deletes).toContainEqual({ table: "activities", ids: [before.activities[0]?.id] });
    expect(w.deletes).toContainEqual({ table: "day_overrides", ids: ["2026-11-05"] });
  });
});

describe("backup", () => {
  it("round-trips and rejects foreign or broken files", () => {
    const data = demoData(at("2026-11-04", 600));
    expect(parseBackup(exportJson(data, 1))).toEqual({ data: JSON.parse(JSON.stringify(data)) });
    expect(parseBackup("nope")).toEqual({ error: "El archivo no es JSON." });
    expect(parseBackup('{"app":"x"}')).toEqual({ error: "No es un respaldo de critiCal." });
    expect(parseBackup('{"app":"critiCal","version":9,"data":{}}')).toEqual({
      error: "El respaldo es de una versión más nueva.",
    });
    expect(parseBackup('{"app":"critiCal","version":1,"data":{"settings":{}}}')).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    expect(
      parseBackup(exportJson({ ...data, settings: { ...data.settings, week: [] } }, 1)),
    ).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    const [first] = data.tasks;
    const brokenUnit = { ...first, units: [null] } as never;
    expect(parseBackup(exportJson({ ...data, tasks: [brokenUnit] }, 1))).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    expect(parseBackup(exportJson({ ...data, activities: [[] as never] }, 1))).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    expect(parseBackup(exportJson({ ...data, tasks: [null as never] }, 1))).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    const orphan = {
      id: "c",
      blockId: "b",
      taskId: "nope",
      status: "done" as const,
      minutesDone: 1,
      unitIds: [],
      createdAt: 0,
    };
    const noUnits = { ...orphan, taskId: data.tasks[0]?.id as string, unitIds: undefined as never };
    expect(parseBackup(exportJson({ ...data, checkIns: [noUnits] }, 1))).toEqual({
      error: "Al respaldo le faltan datos.",
    });
    expect(parseBackup(exportJson({ ...data, checkIns: [orphan] }, 1))).toEqual({
      error: "El respaldo está incompleto: hay registros de tareas que no están.",
    });
    expect(parseBackup(exportJson({ ...data, activities: [] }, 1))).toEqual({
      error: "El respaldo está incompleto: hay actividades sin materia.",
    });
  });

  it("imports a file after confirming, and exports one", async () => {
    const now = at("2026-11-04", 600);
    const full = demoData(now);
    const backup = { ...full, tasks: full.tasks.slice(1) };
    const kept = full.tasks[1]?.id as string;
    vi.stubGlobal("confirm", () => true);
    const created = vi.fn(() => "blob:x");
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} }),
    );
    const withLog = (n: number) => ({
      ...demoData(n),
      // A unit added and completed after the backup was made.
      tasks: demoData(n).tasks.map((t) =>
        t.id === kept
          ? { ...t, units: [...t.units, { id: "new-unit", title: "Nueva", estimateMinutes: 30 }] }
          : t,
      ),
      checkIns: [
        {
          id: "later",
          blockId: "b",
          taskId: kept,
          status: "done" as const,
          minutesDone: 30,
          unitIds: ["new-unit"],
          createdAt: n,
        },
      ],
    });
    render(
      <StoreProvider initial={withLog} persist={false} fixedNow={now}>
        <Backup />
        <Probe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByText("Exportar JSON"));
    expect(created).toHaveBeenCalled();

    const file = new File([exportJson(backup, now)], "critical.json", { type: "application/json" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Archivo de respaldo"), { target: { files: [file] } });
    });
    await waitFor(() => expect(screen.getByText("Datos importados ✓")).toBeTruthy());
    expect(state().tasks.length).toBe(full.tasks.length - 1);
    expect(state().checkIns).toEqual(["later"]);
    expect(state().doneUnits).toEqual(["new-unit"]);

    const bad = new File(["{}"], "x.json");
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Archivo de respaldo"), { target: { files: [bad] } });
    });
    await waitFor(() => expect(screen.getByText("No es un respaldo de critiCal.")).toBeTruthy());
  });
});
