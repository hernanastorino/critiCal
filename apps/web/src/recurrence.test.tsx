import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";
import type { AppData } from "./model.js";
import { endOfWeek, isRunning, pinClashes, progress } from "./planning.js";
import { diffData, rowsToData } from "./remote.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20); // Monday 17:00 in Montevideo

const start = (): AppData => {
  const d = reducer(demoData(NOW), { type: "refresh", now: NOW });
  const gym = d.tasks.find((t) => t.title === "Gym") as AppData["tasks"][number];
  const past = {
    id: "past",
    taskId: gym.id,
    activityId: gym.activityId,
    start: NOW - 7_200_000,
    end: NOW - 3_600_000,
  };
  return {
    ...d,
    plan: [past, ...d.plan],
    checkIns: [
      {
        id: "c",
        blockId: "past",
        taskId: gym.id,
        status: "done",
        minutesDone: 60,
        unitIds: [],
        createdAt: NOW - 3_000_000,
      },
    ],
  };
};
const gymOf = (d: AppData) => d.tasks.find((t) => t.title === "Gym");
const future = (d: AppData, id: string) => d.plan.filter((b) => b.taskId === id && b.start > NOW);

describe("weekly silo recurrence", () => {
  it("skips only this week and comes back on Monday", () => {
    const d = start();
    const gym = gymOf(d) as AppData["tasks"][number];
    expect(future(d, gym.id).length).toBeGreaterThan(0);
    const skipped = reducer(d, {
      type: "recurrence",
      taskId: gym.id,
      change: "skipWeek",
      now: NOW,
    });
    const next = endOfWeek(d.settings.timezone, NOW);
    expect(gymOf(skipped)?.skipUntil).toBe(next);
    expect(future(skipped, gym.id)).toEqual([]);
    expect(progress(skipped, NOW).some((p) => p.task.id === gym.id)).toBe(false);
    // History stays.
    expect(skipped.plan.some((b) => b.id === "past")).toBe(true);
    // Next week it plans again on its own.
    const monday = reducer(skipped, { type: "refresh", now: next + 3_600_000 });
    expect(isRunning(gymOf(monday) as AppData["tasks"][number], next + 3_600_000)).toBe(true);
    expect(monday.plan.some((b) => b.taskId === gym.id && b.start > next)).toBe(true);
  });

  it("pauses until resumed", () => {
    const d = start();
    const gym = gymOf(d) as AppData["tasks"][number];
    const paused = reducer(d, { type: "recurrence", taskId: gym.id, change: "pause", now: NOW });
    const later = reducer(paused, { type: "refresh", now: NOW + 14 * 86_400_000 });
    expect(later.plan.some((b) => b.taskId === gym.id && b.start > NOW)).toBe(false);
    const back = reducer(paused, {
      type: "recurrence",
      taskId: gym.id,
      change: "resume",
      now: NOW,
    });
    expect(gymOf(back)?.paused).toBeUndefined();
    expect(future(back, gym.id).length).toBeGreaterThan(0);
  });

  it("stops from today keeping the past, or erases everything", () => {
    const d = start();
    const gym = gymOf(d) as AppData["tasks"][number];
    const ended = reducer(d, {
      type: "recurrence",
      taskId: gym.id,
      change: "endFromToday",
      now: NOW,
    });
    expect(gymOf(ended)).toMatchObject({ status: "dropped", endedAt: NOW });
    expect(future(ended, gym.id)).toEqual([]);
    expect(ended.plan.some((b) => b.id === "past")).toBe(true);
    expect(ended.checkIns).toHaveLength(1);

    const decided = {
      ...d,
      applied: [{ id: "x", label: "Bajar Gym", at: NOW, before: [gym, ...d.tasks.slice(0, 1)] }],
    };
    const gone = reducer(decided, {
      type: "recurrence",
      taskId: gym.id,
      change: "deleteAll",
      now: NOW,
    });
    expect(gymOf(gone)).toBeUndefined();
    expect(gone.applied?.[0]?.before.some((t) => t.id === gym.id)).toBe(false);
    expect(gone.applied?.[0]?.before).toHaveLength(d.tasks[0]?.id === gym.id ? 0 : 1);
    expect(gone.plan.some((b) => b.taskId === gym.id)).toBe(false);
    expect(gone.checkIns).toEqual([]);
  });

  it("drops future pins of an ended silo and never reports clashes for silos that are off", () => {
    const d = start();
    const gym = gymOf(d) as AppData["tasks"][number];
    const block = future(d, gym.id)[0] as AppData["plan"][number];
    const pinned = reducer(d, { type: "pin", blockId: block.id, start: block.start, now: NOW });
    const clash = {
      id: "x",
      title: "Dentista",
      start: block.start,
      end: block.end,
      busy: true,
      source: "demo" as const,
    };
    const withEvent = { ...pinned, events: [...pinned.events, clash] };
    expect(pinClashes(withEvent, NOW)).toHaveLength(1);
    const paused = reducer(withEvent, {
      type: "recurrence",
      taskId: gym.id,
      change: "pause",
      now: NOW,
    });
    expect(pinClashes(paused, NOW)).toEqual([]);
    expect(paused.pins).toHaveLength(1);
    const ended = reducer(withEvent, {
      type: "recurrence",
      taskId: gym.id,
      change: "endFromToday",
      now: NOW,
    });
    expect(ended.pins).toEqual([]);
  });

  it("persists the state and deletes erased silos", () => {
    const d = start();
    const gym = gymOf(d) as AppData["tasks"][number];
    const skipped = reducer(d, {
      type: "recurrence",
      taskId: gym.id,
      change: "skipWeek",
      now: NOW,
    });
    const row = diffData(d, skipped).upserts.find((u) => u.table === "tasks")?.rows[0];
    expect(row).toMatchObject({ paused: false, ended_at: null });
    expect(typeof row?.skip_until).toBe("string");

    const gone = reducer(d, { type: "recurrence", taskId: gym.id, change: "deleteAll", now: NOW });
    expect(diffData(d, gone).deletes).toContainEqual({ table: "tasks", ids: [gym.id] });

    const loaded = rowsToData({
      settings: null,
      activities: [],
      tasks: [
        {
          id: "t",
          activity_id: "a",
          title: "Gym",
          kind: "habit",
          min_minutes: 0,
          priority: 1,
          status: "dropped",
          skip_until: "2026-11-10T03:00:00Z",
          paused: true,
          ended_at: "2026-11-02T20:00:00Z",
        },
      ],
      units: [],
      checkIns: [],
      events: [],
      overrides: [],
      blocks: [],
    } as never);
    expect(loaded.tasks[0]).toMatchObject({
      paused: true,
      endedAt: NOW,
      skipUntil: Date.UTC(2026, 10, 10, 3),
    });
  });
});

describe("weekly silo controls", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("critical.mode", "demo");
  });
  afterEach(cleanup);

  const openGym = () => {
    fireEvent.click(screen.getByText("Silos"));
    fireEvent.click(screen.getByLabelText(/^Gym/));
    return screen.getByRole("dialog", { name: "Gym" });
  };

  it("skips a week, shows it faded and reactivates it", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(within(openGym()).getByText("Desactivar…"));
    const sheet = screen.getByRole("dialog", { name: "Desactivar Gym" });
    expect(within(sheet).getByText(/Vuelve el lun/)).toBeTruthy();
    fireEvent.click(within(sheet).getByText("Solo esta semana"));
    expect(screen.getByLabelText("Gym: desactivado").textContent).toMatch(/vuelve el lun/);

    fireEvent.click(screen.getByLabelText("Gym: desactivado"));
    const detail = screen.getByRole("dialog", { name: "Gym" });
    expect(within(detail).getByText(/Salteado esta semana/)).toBeTruthy();
    fireEvent.click(within(detail).getByText("Reactivar"));
    expect(within(detail).queryByText(/Salteado/)).toBeNull();
    fireEvent.click(within(detail).getAllByLabelText("Cerrar")[0] as HTMLElement);
    expect(screen.queryByLabelText("Gym: desactivado")).toBeNull();
  });

  it("pauses indefinitely, or deletes from today or entirely, with a cancel", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(within(openGym()).getByText("Desactivar…"));
    fireEvent.click(screen.getByText("Hasta que lo reactive"));
    expect(screen.getByLabelText("Gym: desactivado").textContent).toMatch(/pausado/);

    fireEvent.click(screen.getByLabelText("Gym: desactivado"));
    fireEvent.click(screen.getByText("Eliminar…"));
    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByRole("dialog", { name: "Eliminar Gym" })).toBeNull();
    fireEvent.click(screen.getByText("Eliminar…"));
    fireEvent.click(screen.getByText("Eliminar de hoy en adelante"));
    expect(screen.queryByLabelText(/^Gym/)).toBeNull();
    const saved = JSON.parse(localStorage.getItem("critical.demo.v1") ?? "{}") as AppData;
    expect(gymOf(saved)).toMatchObject({ status: "dropped" });
  });

  it("keeps Reactivar for a paused silo that is no longer weekly", () => {
    const d = start();
    const gym = gymOf(d) as AppData["tasks"][number];
    const paused = reducer(d, { type: "recurrence", taskId: gym.id, change: "pause", now: NOW });
    const changed = {
      ...paused,
      tasks: paused.tasks.map((t) =>
        t.id === gym.id ? { ...t, kind: "deliverable" as const } : t,
      ),
    };
    render(<App fixedNow={NOW} initial={() => changed} />);
    fireEvent.click(screen.getByText("Silos"));
    fireEvent.click(screen.getByLabelText("Gym: desactivado"));
    fireEvent.click(screen.getByText("Reactivar"));
    expect(screen.queryByText("Reactivar")).toBeNull();
  });

  it("caps the number of topics a progress log can create", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(screen.getByText("Silos"));
    fireEvent.click(screen.getByLabelText(/^Entrega TP Programación/));
    fireEvent.change(screen.getByLabelText("Temas en total"), { target: { value: "1e9" } });
    fireEvent.change(screen.getByLabelText("Llevo hechos"), { target: { value: "1" } });
    fireEvent.click(screen.getByText("Guardar avance"));
    const saved = JSON.parse(localStorage.getItem("critical.demo.v1") ?? "{}") as AppData;
    const tp = saved.tasks.find((t) => t.title === "Entrega TP Programación");
    expect(tp?.units.length).toBe(200);
  });

  it("deletes everything", () => {
    render(<App fixedNow={NOW} initial={demoData} />);
    fireEvent.click(within(openGym()).getByText("Eliminar…"));
    fireEvent.click(screen.getByText("Eliminar todo"));
    const saved = JSON.parse(localStorage.getItem("critical.demo.v1") ?? "{}") as AppData;
    expect(gymOf(saved)).toBeUndefined();
  });
});
