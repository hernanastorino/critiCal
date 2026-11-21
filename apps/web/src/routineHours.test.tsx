import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { edited, errorOf, NOW, roundTrip } from "./atacante11Kit.js";
import { validHoursOk } from "./backupNamed.js";
import { Routines } from "./components/Preferences.js";
import { TaskEditor } from "./components/TaskEditor.js";
import { diffData, rowsToData } from "./data.js";
import { demoData } from "./demo.js";
import { localParts, MINUTE, type ValidHours, zonedInstant } from "./engine.js";
import type { AppData } from "./model.js";
import { describeHours, emptyHoursForm, formOfHours, readHours } from "./routineHours.js";
import { reducer, StoreProvider, useStore } from "./store.js";

afterEach(cleanup);

const TZ = "America/Montevideo";
// Monday 2026-11-02, early: the whole week is ahead.
const MON = zonedInstant(TZ, "2026-11-02", 6 * 60);

let latest: AppData | undefined;
function Spy() {
  latest = useStore().data;
  return null;
}

const renderRoutines = () =>
  render(
    <StoreProvider initial={demoData} persist={false} fixedNow={MON}>
      <Spy />
      <Routines />
    </StoreProvider>,
  );
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const added = () => latest?.activities.find((a) => a.name === "Correr");

describe("the plan keeps a routine inside its valid hours", () => {
  // From 17:00 to 19:00 on weekdays and to 20:00 on Saturdays (the user's example).
  const hours: ValidHours = {
    all: { start: 17 * 60, end: 19 * 60 },
    days: { 6: { start: 17 * 60, end: 20 * 60 } },
  };
  const planned = (validHours?: ValidHours) => {
    const d = reducer(
      { ...demoData(MON), activities: demoData(MON).activities.slice(0, 0), tasks: [], plan: [] },
      {
        type: "saveRoutine",
        name: "Correr",
        sessionsPerWeek: 7,
        sessionMinutes: 60,
        validHours,
        now: MON,
      },
    );
    const run = d.tasks.find((t) => t.title === "Correr");
    return { d, blocks: d.plan.filter((b) => b.taskId === run?.id) };
  };

  it("keeps it from 17:00, up to 19:00 on weekdays and 20:00 on Saturdays", () => {
    const { blocks } = planned(hours);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) {
      const p = localParts(TZ, b.end - MINUTE);
      const limit = p.weekday === 6 ? 20 * 60 : 19 * 60;
      expect(p.minuteOfDay + 1).toBeLessThanOrEqual(limit);
      expect(localParts(TZ, b.start).minuteOfDay).toBeGreaterThanOrEqual(17 * 60);
    }
  });

  it("without hours it still runs in the evening (as before)", () => {
    const { blocks } = planned(undefined);
    const late = blocks.some((b) => localParts(TZ, b.end - MINUTE).minuteOfDay + 1 > 19 * 60);
    expect(blocks.length).toBeGreaterThan(0);
    // Nothing forces the evening here, but nothing keeps it out of the morning either.
    expect(late || blocks.some((b) => localParts(TZ, b.start).minuteOfDay < 19 * 60)).toBe(true);
  });

  it("a franja shorter than the session leaves it unplanned and says so", () => {
    const { d } = planned({ all: { start: 17 * 60, end: 17 * 60 + 30 } });
    expect(d.plan.filter((b) => b.taskId === d.tasks[0]?.id)).toHaveLength(0);
  });
});

describe("the Rutinas form", () => {
  it("saves «Desde» and «Hasta» for every day", () => {
    renderRoutines();
    type("Rutina", "Correr");
    type("Desde, todos los días", "7");
    type("Hasta, todos los días", "19:30");
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(added()?.validHours).toEqual({ all: { start: 420, end: 1170 } });
    expect(screen.getByText(/07:00 a 19:30/)).toBeTruthy();
  });

  it("with only «Hasta», it is up to that hour", () => {
    renderRoutines();
    type("Rutina", "Correr");
    type("Hasta, todos los días", "19");
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(added()?.validHours).toEqual({ all: { start: 0, end: 1140 } });
  });

  it("«distinto según el día» gives Saturday its own hours", () => {
    renderRoutines();
    type("Rutina", "Correr");
    type("Hasta, todos los días", "19");
    fireEvent.click(screen.getByLabelText("Distinto según el día"));
    type("Hasta, sábado", "20");
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(added()?.validHours).toEqual({
      all: { start: 0, end: 1140 },
      days: { 6: { start: 0, end: 1200 } },
    });
  });

  it("without hours there is no limit (as before)", () => {
    renderRoutines();
    type("Rutina", "Correr");
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(added()).toBeTruthy();
    expect(added()?.validHours).toBeUndefined();
  });

  it("«Desde» after «Hasta» is said in its field and does not add", () => {
    renderRoutines();
    type("Rutina", "Correr");
    type("Desde, todos los días", "20");
    type("Hasta, todos los días", "19");
    fireEvent.click(screen.getByRole("button", { name: "Agregar rutina" }));
    expect(added()).toBeUndefined();
    expect(screen.getByLabelText("Desde, todos los días").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByRole("alert").textContent).toMatch(/antes de «Hasta»/);
    expect(document.activeElement).toBe(screen.getByLabelText("Desde, todos los días"));
  });

  it("an hour that is not one is said in its field", () => {
    renderRoutines();
    type("Rutina", "Correr");
    type("Hasta, todos los días", "25");
    expect(screen.getByLabelText("Hasta, todos los días").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(screen.getByRole("alert").textContent).toMatch(/«Hasta» no es válida/);
  });

  it("a franja shorter than a session is said", () => {
    renderRoutines();
    type("Rutina", "Correr");
    type("Desde, todos los días", "17");
    type("Hasta, todos los días", "17:30");
    expect(screen.getByRole("alert").textContent).toMatch(/más corta que una sesión \(60 min\)/);
  });

  it("several errors make one announcement, each field marked", () => {
    renderRoutines();
    type("Rutina", "Correr");
    fireEvent.click(screen.getByLabelText("Distinto según el día"));
    type("Desde, los demás días", "x");
    type("Desde, lunes", "20");
    type("Hasta, lunes", "19");
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.textContent).toMatch(/^Revisá los horarios/);
    expect(screen.getByLabelText("Desde, lunes").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Desde, los demás días").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });
});

describe("editing a routine's hours", () => {
  it("the editor of its habit changes them", () => {
    const d = reducer(demoData(MON), {
      type: "saveRoutine",
      name: "Correr",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      validHours: { all: { start: 0, end: 1140 } },
      now: MON,
    });
    const act = d.activities.find((a) => a.name === "Correr");
    const habit = d.tasks.find((t) => t.activityId === act?.id);
    if (!habit) throw new Error("the routine has no habit");
    render(
      <StoreProvider initial={() => d} persist={false} fixedNow={MON}>
        <Spy />
        <TaskEditor task={habit} onClose={vi.fn()} />
      </StoreProvider>,
    );
    expect(screen.getByDisplayValue("19:00")).toBe(screen.getByLabelText("Hasta, todos los días"));
    type("Hasta, todos los días", "20");
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(latest?.activities.find((a) => a.name === "Correr")?.validHours).toEqual({
      all: { start: 0, end: 1200 },
    });
    // The routine itself is not duplicated.
    expect(latest?.activities.filter((a) => a.name === "Correr")).toHaveLength(1);
  });
});

describe("persistence of the hours", () => {
  const hours: ValidHours = { all: { start: 0, end: 1140 }, days: { 6: { start: 0, end: 1200 } } };
  const withRoutine = () =>
    reducer(demoData(NOW), {
      type: "saveRoutine",
      name: "Correr",
      sessionsPerWeek: 3,
      sessionMinutes: 60,
      validHours: hours,
      now: NOW,
    });

  it("a backup brings them back, identical", () => {
    const r = roundTrip(withRoutine());
    expect(errorOf(r)).toBe("");
    const back = "data" in r ? r.data : undefined;
    expect(back?.activities.find((a) => a.name === "Correr")?.validHours).toEqual(hours);
  });

  it.each([
    ["a range that ends before it starts", { all: { start: 600, end: 500 } }],
    ["a weekday 9", { days: { 9: { start: 0, end: 600 } } }],
    ["a text", "hasta las 19"],
  ])("a backup with %s is refused, saying so", (_n, bad) => {
    const r = edited([["activities.0.validHours", bad]]);
    expect(errorOf(r)).toMatch(/horario válido/i);
  });

  it("the database rows write and read them", () => {
    const next = withRoutine();
    const writes = diffData(demoData(NOW), next);
    const row = writes.upserts
      .find((u) => u.table === "activities")
      ?.rows.find((x) => x.name === "Correr");
    expect(row?.valid_hours).toEqual(hours);
    const read = rowsToData({
      settings: null,
      activities: [{ ...row, color: "#fff", academic: false }],
      tasks: [],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
    });
    expect(read.activities[0]?.validHours).toEqual(hours);
  });
});

describe("routineHours helpers", () => {
  it("round-trips a form and describes a franja", () => {
    const hours: ValidHours = {
      all: { start: 420, end: 1140 },
      days: { 6: { start: 0, end: 1200 } },
    };
    const form = formOfHours(hours);
    expect(form.perDay).toBe(true);
    expect(readHours(form).hours).toEqual(hours);
    expect(describeHours(hours)).toBe("07:00 a 19:00 (con 1 día distinto)");
    expect(readHours(emptyHoursForm()).hours).toBeUndefined();
  });
});

describe("«No ese día» (decidido el 2026-11-20)", () => {
  const hours: ValidHours = { all: { start: 1020, end: 1140 }, days: { 0: null } };

  it("is read from the form as null and comes back as a ticked day", () => {
    const form = formOfHours(hours);
    expect(form.perDay).toBe(true);
    expect(form.days[0]).toMatchObject({ off: true });
    expect(readHours(form).hours).toEqual(hours);
  });

  it("is said in the routine's row", () => {
    expect(describeHours(hours)).toBe("17:00 a 19:00 · no el domingo");
    expect(describeHours({ days: { 1: null, 0: null } })).toBe("no el lunes ni el domingo");
  });

  it("an off day ignores what is typed in its hours", () => {
    const form = emptyHoursForm();
    form.perDay = true;
    form.days[3] = { from: "25", to: "", off: true };
    expect(readHours(form)).toEqual({ hours: { days: { 3: null } }, problems: [] });
  });

  it("a backup with an off day is valid", () => {
    expect(validHoursOk(hours, {})).toBe(true);
    expect(validHoursOk({ days: { 7: null } }, {})).toBe(false);
  });

  it("the editor has a «No» for each day of its own", () => {
    renderRoutines();
    fireEvent.click(screen.getByLabelText("Distinto según el día"));
    fireEvent.click(screen.getByLabelText("No ese día: domingo"));
    expect(screen.getByLabelText("Desde, domingo").hasAttribute("disabled")).toBe(true);
  });
});

describe("every day «No» (21.ª vuelta)", () => {
  it("is not saved: the routine would never go", () => {
    const form = emptyHoursForm();
    form.perDay = true;
    form.days = form.days.map(() => ({ from: "", to: "", off: true }));
    const read = readHours(form);
    expect(read.hours).toBeUndefined();
    expect(read.problems.map((p) => p.text).join(" ")).toMatch(/todos los días/);
  });
});
