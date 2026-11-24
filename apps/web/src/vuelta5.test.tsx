import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./App.js";
import { demoData } from "./demo.js";
import { localParts, MINUTE, zonedInstant } from "./engine.js";
import { time, weekdayShort } from "./format.js";
import type { AppData, AppTask } from "./model.js";
import { mealTimes, progress, toEngineTasks } from "./planning.js";
import { reducer } from "./store.js";

const NOW = Date.UTC(2026, 10, 2, 20);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("critical.mode", "demo");
});
afterEach(cleanup);

const stored = () => JSON.parse(localStorage.getItem("critical.demo.v2") ?? "{}") as AppData;

describe("Teclado: la comida no queda debajo del estudio", () => {
  it("does not land a block where a meal would sit on top of it", () => {
    const base = reducer(demoData(NOW), { type: "refresh", now: NOW });
    const block = base.plan
      .filter(
        (b) =>
          b.start > NOW &&
          localParts(base.settings.timezone, b.start).minuteOfDay >= 600 &&
          base.activities.find((a) => a.id === b.activityId)?.academic &&
          // Nothing planned (or fixed) in the hour and a half before: the lunch put there moves nothing.
          !base.plan.some(
            (o) => o.id !== b.id && o.end > b.start - 90 * MINUTE && o.start < b.start,
          ) &&
          !base.events.some((e) => e.end > b.start - 90 * MINUTE && e.start < b.start),
      )
      .sort((a, b) => a.start - b.start)[0] as AppData["plan"][number];
    const tz = base.settings.timezone;
    const date = localParts(tz, block.start).date;
    const startMin = (block.start - zonedInstant(tz, date, 0)) / MINUTE;
    // Lunch put by hand right before the block: a step up would land on it.
    const data: AppData = {
      ...base,
      mealChoices: [{ date, kind: "almuerzo", start: startMin - 60 }],
    };
    render(<App fixedNow={NOW} initial={() => data} />);
    fireEvent.click(screen.getByLabelText("Modo edición"));
    const label = `${data.tasks.find((t) => t.id === block.taskId)?.title}, ${weekdayShort(tz, block.start)} ${time(tz, block.start)}`;
    const pill = [...document.querySelectorAll<HTMLElement>(".pill.planned.movable")].find((p) =>
      (p.getAttribute("aria-label") ?? "").startsWith(label),
    ) as HTMLElement;
    pill.focus();
    fireEvent.keyDown(pill, { key: "ArrowUp" });
    const after = stored();
    for (const pin of after.pins ?? []) {
      for (const m of mealTimes(after, NOW, pin.start - 1440 * MINUTE, pin.end + 1440 * MINUTE)) {
        expect(m.at && m.at.start < pin.end && pin.start < m.at.end).toBe(false);
      }
    }
  });
});

describe("Avance por entrega y «faltan» por partes", () => {
  const subject = (data: AppData) =>
    data.activities.find((a) => a.academic) as AppData["activities"][0];
  const task = (id: string, activityId: string, units: AppTask["units"]): AppTask => ({
    id,
    activityId,
    title: id,
    kind: "deliverable",
    deadline: NOW + 5 * 1440 * MINUTE,
    estimateMinutes: units.reduce((s, u) => s + u.estimateMinutes, 0),
    minMinutes: 0,
    priority: 2,
    status: "active",
    units,
  });

  it("a new entrega shows its own parts, whatever others of its materia logged", () => {
    const d = demoData(NOW);
    const a = subject(d).id;
    const old = task("old", a, [{ id: "o1", title: "o1", estimateMinutes: 300, doneAt: 1 }]);
    const fresh = task("fresh", a, [{ id: "f1", title: "f1", estimateMinutes: 60 }]);
    const data: AppData = {
      ...d,
      tasks: [old, fresh],
      checkIns: [
        {
          id: "c",
          blockId: "b",
          taskId: "old",
          status: "done",
          minutesDone: 100,
          unitIds: ["o1"],
          createdAt: 1,
        },
      ],
    };
    expect(progress(data, NOW).find((p) => p.task.id === "fresh")?.remainingMinutes).toBe(31);
  });

  it("with parts, «faltan» is the parts left, not minus the minutes logged", () => {
    const d = demoData(NOW);
    const a = subject(d).id;
    const t = task("t", a, [
      { id: "u1", title: "u1", estimateMinutes: 60, doneAt: 1 },
      { id: "u2", title: "u2", estimateMinutes: 60 },
      { id: "u3", title: "u3", estimateMinutes: 60 },
    ]);
    const data: AppData = {
      ...d,
      tasks: [t],
      checkIns: [
        {
          id: "c",
          blockId: "b",
          taskId: "t",
          status: "done",
          minutesDone: 100,
          unitIds: ["u1"],
          createdAt: 1,
        },
      ],
    };
    // 120 min of parts left by the materia's learned ratio (1.225): what the plan reserves.
    expect(progress(data, NOW)[0]?.remainingMinutes).toBe(147);
    expect(toEngineTasks(data, NOW)[0]?.remainingMinutes).toBeGreaterThan(0);
  });
});
